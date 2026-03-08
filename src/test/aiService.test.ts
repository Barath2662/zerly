/**
 * Unit tests: AIService
 *
 * Tests:
 *  1. getApiKey() prefers ZerlyKeyManager over workspace config
 *  2. invalidateAll() aborts all tracked AbortControllers
 *  3. setKeyManager() wires onKeyChanged → invalidateAll
 *  4. Request freshness headers (Cache-Control, Pragma, X-Request-Id)
 *  5. Stale response suppression via keyVersion mismatch
 */

import { AIService } from '../aiService';
import { ZerlyKeyManager } from '../zerlyKeyManager';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContext(secretKey = '') {
  const secretsStore: Record<string, string> = secretKey ? { zerlyApiKey: secretKey } : {};
  return {
    secrets: {
      get: jest.fn(async (k: string) => secretsStore[k] ?? undefined),
      store: jest.fn(async (k: string, v: string) => { secretsStore[k] = v; }),
      delete: jest.fn(async (k: string) => { delete secretsStore[k]; }),
    },
    globalState: { get: jest.fn(), update: jest.fn(async () => {}) },
    workspaceState: { get: jest.fn(), update: jest.fn(async () => {}) },
    subscriptions: { push: jest.fn() },
    extensionUri: { fsPath: '/fake' },
  } as any;
}

async function makeKeyManager(secretKey = '') {
  ZerlyKeyManager._resetForTests();
  const ctx = makeContext(secretKey);
  const km = ZerlyKeyManager.getInstance(ctx);
  await km.initialize();
  return km;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AIService.getApiKey()', () => {
  beforeEach(() => {
    ZerlyKeyManager._resetForTests();
  });

  test('returns empty string when no key and no workspace config', async () => {
    // vscode mock returns empty config by default
    const svc = new AIService();
    const km = await makeKeyManager(''); // no key stored
    svc.setKeyManager(km);
    expect(svc.getApiKey()).toBe('');
  });

  test('prefers keyManager key over workspace config', async () => {
    // workspace mock returns 'wk_fallback_key' from settings
    const { workspace } = require('vscode');
    workspace.getConfiguration.mockReturnValue({
      get: (k: string) => (k === 'zerlyApiKey' ? 'wk_fallback_key_123' : undefined),
      update: jest.fn(async () => {}),
    });

    const km = await makeKeyManager('sk_zerly_priority12');
    const svc = new AIService();
    svc.setKeyManager(km);

    // Should read from keyManager, not config
    expect(svc.getApiKey()).toBe('sk_zerly_priority12');
  });

  test('falls back to workspace config when keyManager has no key', async () => {
    const { workspace } = require('vscode');
    workspace.getConfiguration.mockReturnValue({
      get: (k: string) => (k === 'zerlyApiKey' ? 'cfg_fallback_key_abc' : undefined),
      update: jest.fn(async () => {}),
    });

    const km = await makeKeyManager(''); // no SecretStorage key
    const svc = new AIService();
    svc.setKeyManager(km);

    expect(svc.getApiKey()).toBe('cfg_fallback_key_abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AIService.invalidateAll()', () => {
  beforeEach(() => ZerlyKeyManager._resetForTests());

  test('aborts all tracked controllers', async () => {
    const svc = new AIService();
    const km = await makeKeyManager('sk_zerly_invalidate12');
    svc.setKeyManager(km);

    // Inject fake controllers via the private map (cast to any for test access)
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    (svc as any)._taskControllers.set('task_a', ctrl1);
    (svc as any)._taskControllers.set('task_b', ctrl2);

    svc.invalidateAll();

    expect(ctrl1.signal.aborted).toBe(true);
    expect(ctrl2.signal.aborted).toBe(true);
    expect((svc as any)._taskControllers.size).toBe(0);
  });

  test('works with empty controller map', async () => {
    const svc = new AIService();
    const km = await makeKeyManager('sk_zerly_empty12345');
    svc.setKeyManager(km);
    expect(() => svc.invalidateAll()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AIService.setKeyManager() wires key change → invalidateAll', () => {
  beforeEach(() => ZerlyKeyManager._resetForTests());

  test('invalidateAll called when key changes via setKey()', async () => {
    const km = await makeKeyManager('sk_zerly_existing12');
    const svc = new AIService();
    svc.setKeyManager(km);

    // Inject a fake controller so we can detect abort
    const ctrl = new AbortController();
    (svc as any)._taskControllers.set('some_task', ctrl);

    // Change the key — should trigger invalidateAll
    await km.setKey('sk_zerly_newkey5678');
    expect(ctrl.signal.aborted).toBe(true);
    expect((svc as any)._taskControllers.size).toBe(0);
  });

  test('invalidateAll called when key is cleared', async () => {
    const km = await makeKeyManager('sk_zerly_existing12');
    const svc = new AIService();
    svc.setKeyManager(km);

    const ctrl = new AbortController();
    (svc as any)._taskControllers.set('task_x', ctrl);

    await km.clearKey();
    expect(ctrl.signal.aborted).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AIService request freshness headers', () => {
  beforeEach(() => {
    ZerlyKeyManager._resetForTests();
    jest.clearAllMocks();
  });

  test('each request carries Cache-Control: no-store', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    global.fetch = mockFetch as any;

    const km = await makeKeyManager('sk_zerly_freshtest12');
    const svc = new AIService();
    svc.setKeyManager(km);

    // Call a public method that triggers _call (use explainCode with minimal scanner data)
    await svc.explainCode('const x = 1;', 'test.ts');

    expect(mockFetch).toHaveBeenCalled();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect((init.headers as Record<string, string>)['Cache-Control']).toBe('no-store');
    expect((init.headers as Record<string, string>)['Pragma']).toBe('no-cache');
  });

  test('each request carries a unique X-Request-Id', async () => {
    const capturedIds: string[] = [];
    const mockFetch = jest.fn().mockImplementation((_url: string, init: RequestInit & { headers: Record<string, string> }) => {
      capturedIds.push((init.headers as Record<string, string>)['X-Request-Id']);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      });
    });
    global.fetch = mockFetch as any;

    const km = await makeKeyManager('sk_zerly_freshtest12');
    const svc = new AIService();
    svc.setKeyManager(km);

    await svc.explainCode('const a = 1;', 'test.ts');
    await svc.explainCode('const b = 2;', 'test.ts');

    expect(capturedIds.length).toBe(2);
    expect(capturedIds[0]).toBeTruthy();
    expect(capturedIds[1]).toBeTruthy();
    expect(capturedIds[0]).not.toBe(capturedIds[1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AIService stale response suppression', () => {
  beforeEach(() => {
    ZerlyKeyManager._resetForTests();
    jest.clearAllMocks();
  });

  test('discards response when keyVersion changes mid-request', async () => {
    const km = await makeKeyManager('sk_zerly_staletest12');
    const svc = new AIService();
    svc.setKeyManager(km);

    // fetch will advance the key version DURING the request to simulate rotation
    const mockFetch = jest.fn().mockImplementation(async () => {
      // Rotate the key while "in flight"
      await km.setKey('sk_zerly_rotatedkey99');
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'should-be-suppressed' } }] }),
      };
    });
    global.fetch = mockFetch as any;

    const result = await svc.explainCode('someCode', 'test.ts');
    expect(result).toContain('key rotation');
  });
});
