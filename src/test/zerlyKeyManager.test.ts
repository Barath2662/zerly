/**
 * Unit tests: ZerlyKeyManager
 *
 * Tests:
 *  1. URI parsing and key validation
 *  2. Key persistence lifecycle (setKey / clearKey / initialize migration)
 *  3. Cache invalidation trigger on key change (onKeyChanged event)
 *  4. Key version increments on each mutation
 */

import { validateKeyFormat, generateRequestId, ZerlyKeyManager } from '../zerlyKeyManager';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeContext(stored: Record<string, string> = {}, secrets: Record<string, string> = {}) {
  const secretsStore: Record<string, string> = { ...secrets };
  const globalState: Record<string, unknown> = {};
  const cfgStore: Record<string, string> = { ...stored };

  return {
    secrets: {
      get: jest.fn(async (key: string) => secretsStore[key] ?? undefined),
      store: jest.fn(async (key: string, val: string) => { secretsStore[key] = val; }),
      delete: jest.fn(async (key: string) => { delete secretsStore[key]; }),
      _raw: secretsStore,
    },
    globalState: {
      get: jest.fn((key: string) => globalState[key]),
      update: jest.fn(async (key: string, val: unknown) => { globalState[key] = val; }),
    },
    workspaceState: {
      get: jest.fn((key: string) => undefined),
      update: jest.fn(async () => {}),
    },
    subscriptions: { push: jest.fn() },
    extensionUri: { fsPath: '/fake' },
    _cfgStore: cfgStore,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('validateKeyFormat', () => {
  test('rejects empty string', () => {
    expect(validateKeyFormat('')).toBe(false);
  });

  test('rejects strings shorter than 8 chars', () => {
    expect(validateKeyFormat('abc')).toBe(false);
    expect(validateKeyFormat('1234567')).toBe(false);
  });

  test('accepts strings of 8+ chars', () => {
    expect(validateKeyFormat('12345678')).toBe(true);
    expect(validateKeyFormat('sk_zerly_abc123def456')).toBe(true);
  });

  test('trims whitespace before validation', () => {
    expect(validateKeyFormat('  sk_zerly_abc  ')).toBe(true);
    expect(validateKeyFormat('   short  ')).toBe(false);      // only 5 chars trimmed
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('generateRequestId', () => {
  test('returns a UUID-v4-like string', () => {
    const id = generateRequestId();
    // e.g. "a1b2c3d4-e5f6-4xxx-yxxx-xxxxxxxxxxxx"
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, generateRequestId));
    expect(ids.size).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('ZerlyKeyManager', () => {
  beforeEach(() => {
    ZerlyKeyManager._resetForTests();
  });

  test('initialize loads key from SecretStorage', async () => {
    const ctx = makeContext({}, { zerlyApiKey: 'sk_zerly_abcdefgh' });
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();
    expect(km.getCachedKey()).toBe('sk_zerly_abcdefgh');
    expect(km.hasKey()).toBe(true);
  });

  test('initialize returns empty string when no key stored', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();
    expect(km.getCachedKey()).toBe('');
    expect(km.hasKey()).toBe(false);
  });

  test('setKey stores key and updates cache', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    const result = await km.setKey('sk_zerly_newkey123');
    expect(result.ok).toBe(true);
    expect(km.getCachedKey()).toBe('sk_zerly_newkey123');
    expect(ctx.secrets.store).toHaveBeenCalledWith('zerlyApiKey', 'sk_zerly_newkey123');
  });

  test('setKey rejects too-short key', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    const result = await km.setKey('short');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(km.hasKey()).toBe(false);
  });

  test('clearKey empties cache and deletes from SecretStorage', async () => {
    const ctx = makeContext({}, { zerlyApiKey: 'sk_zerly_abcdefgh' });
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    await km.clearKey();
    expect(km.getCachedKey()).toBe('');
    expect(km.hasKey()).toBe(false);
    expect(ctx.secrets.delete).toHaveBeenCalledWith('zerlyApiKey');
  });

  // ── Test: Cache invalidation on key change ────────────────────────────────

  test('onKeyChanged fires when key is set', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    const received: Array<string | null> = [];
    km.onKeyChanged.event(k => received.push(k));

    await km.setKey('sk_zerly_changedkey12');
    expect(received).toEqual(['sk_zerly_changedkey12']);
  });

  test('onKeyChanged fires null when key is cleared', async () => {
    const ctx = makeContext({}, { zerlyApiKey: 'sk_zerly_existing1' });
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    const received: Array<string | null> = [];
    km.onKeyChanged.event(k => received.push(k));

    await km.clearKey();
    expect(received).toEqual([null]);
  });

  test('onKeyChanged fires on key rotation', async () => {
    const ctx = makeContext({}, { zerlyApiKey: 'sk_zerly_key1key12' });
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    const received: string[] = [];
    km.onKeyChanged.event(k => { if (k) received.push(k); });

    await km.setKey('sk_zerly_key2key12');
    await km.setKey('sk_zerly_key3key12');
    expect(received).toEqual(['sk_zerly_key2key12', 'sk_zerly_key3key12']);
  });

  // ── Test: Key version increments ─────────────────────────────────────────

  test('keyVersion starts at 0', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();
    expect(km.keyVersion).toBe(0);
  });

  test('keyVersion increments on setKey', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    await km.setKey('sk_zerly_key1key12');
    expect(km.keyVersion).toBe(1);
    await km.setKey('sk_zerly_key2key12');
    expect(km.keyVersion).toBe(2);
  });

  test('keyVersion increments on clearKey', async () => {
    const ctx = makeContext({}, { zerlyApiKey: 'sk_zerly_key1key12' });
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();

    await km.clearKey();
    expect(km.keyVersion).toBe(1);
  });

  // ── Test: maskedKey ────────────────────────────────────────────────────────

  test('maskedKey shows (none) when no key', async () => {
    const ctx = makeContext();
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();
    expect(km.maskedKey()).toBe('(none)');
  });

  test('maskedKey masks middle of long key', async () => {
    const ctx = makeContext({}, { zerlyApiKey: 'sk_zerly_abcdefghijklmnop' });
    const km = ZerlyKeyManager.getInstance(ctx);
    await km.initialize();
    const masked = km.maskedKey();
    expect(masked).toContain('****');
    expect(masked).not.toContain('bcdefghij'); // middle hidden
  });
});
