/**
 * zerlyKeyManager.ts
 *
 * Central authority for Zerly API key lifecycle.
 *
 * - Stores key in VS Code SecretStorage (never plaintext settings)
 * - Migrates legacy keys from workspace settings on first run
 * - Fires onKeyChanged so all providers can react immediately
 * - Provides a monotonic keyVersion so AIService can suppress stale responses
 * - Provides structured logging with a ring-buffer (last 200 entries)
 */

import * as vscode from 'vscode';

// ─── Constants ─────────────────────────────────────────────────────────────

const SECRET_STORAGE_KEY = 'zerlyApiKey';
const LOG_PREFIX = '[Zerly]';
const MAX_LOG_ENTRIES = 200;

// ─── Structured Logging ────────────────────────────────────────────────────

export interface ZerlyLogEntry {
  ts: number;
  source: string;
  message: string;
  requestId?: string;
  status?: number;
  meta?: Record<string, unknown>;
}

const _logBuffer: ZerlyLogEntry[] = [];

export function zerlyLog(
  source: string,
  message: string,
  opts?: { requestId?: string; status?: number; meta?: Record<string, unknown> }
): void {
  const entry: ZerlyLogEntry = {
    ts: Date.now(),
    source,
    message,
    requestId: opts?.requestId,
    status: opts?.status,
    meta: opts?.meta,
  };
  _logBuffer.push(entry);
  if (_logBuffer.length > MAX_LOG_ENTRIES) {
    _logBuffer.shift();
  }
  const rid = opts?.requestId ? ` [req:${opts.requestId}]` : '';
  const st = opts?.status !== undefined ? ` [${opts.status}]` : '';
  console.log(`${LOG_PREFIX} [${source}]${rid}${st} ${message}`, opts?.meta ?? '');
}

export function getLogBuffer(): readonly ZerlyLogEntry[] {
  return _logBuffer;
}

// ─── Key Validation ────────────────────────────────────────────────────────

/** Accepts any non-trivially-short key string. */
export function validateKeyFormat(key: string): boolean {
  return key.trim().length >= 8;
}

// ─── Request ID ────────────────────────────────────────────────────────────

/** Generates a UUID-v4-like hex string for request correlation. */
export function generateRequestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── ZerlyKeyManager ────────────────────────────────────────────────────────

export class ZerlyKeyManager {
  private static _instance: ZerlyKeyManager | undefined;

  private readonly _context: vscode.ExtensionContext;

  /** In-memory copy of the key — updated on initialize() and every setKey() call. */
  private _cachedKey = '';

  /**
   * Monotonically increasing version number.
   * Increments on every setKey() or clearKey() so in-flight requests can detect
   * that the key changed while they were running and suppress their results.
   */
  private _keyVersion = 0;

  /** Fired whenever the key is set or cleared. */
  readonly onKeyChanged = new vscode.EventEmitter<string | null>();

  private constructor(ctx: vscode.ExtensionContext) {
    this._context = ctx;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  static getInstance(ctx?: vscode.ExtensionContext): ZerlyKeyManager {
    if (!ZerlyKeyManager._instance) {
      if (!ctx) throw new Error('ZerlyKeyManager: must pass context on first call');
      ZerlyKeyManager._instance = new ZerlyKeyManager(ctx);
    }
    return ZerlyKeyManager._instance;
  }

  /** For tests only — resets the singleton. */
  static _resetForTests(): void {
    ZerlyKeyManager._instance = undefined;
  }

  /**
   * Must be called once in activate() before any API calls are made.
   * Reads key from SecretStorage; migrates from workspace settings if not yet stored.
   */
  async initialize(): Promise<void> {
    // Priority 1: SecretStorage
    let key = (await this._context.secrets.get(SECRET_STORAGE_KEY)) ?? '';

    // Priority 2: Legacy migration from workspace settings (plaintext)
    if (!key) {
      const cfgKey =
        vscode.workspace.getConfiguration('zerly').get<string>('zerlyApiKey') ?? '';
      if (cfgKey.trim()) {
        key = cfgKey.trim();
        await this._context.secrets.store(SECRET_STORAGE_KEY, key);
        // Remove from plaintext settings now that it's safely in SecretStorage
        try {
          await vscode.workspace
            .getConfiguration('zerly')
            .update('zerlyApiKey', '', vscode.ConfigurationTarget.Global);
        } catch {
          // Non-fatal; user can still clear it manually
        }
        zerlyLog('key-migrated', 'API key migrated from settings to SecretStorage');
      }
    }

    this._cachedKey = key;
    zerlyLog('key-initialized', `Key present: ${Boolean(key)}`);
  }

  // ── Key Access ────────────────────────────────────────────────────────────

  /**
   * Synchronous access to the last known key.
   * Always valid after initialize() has resolved.
   */
  getCachedKey(): string {
    return this._cachedKey;
  }

  /**
   * Async read directly from SecretStorage.
   * Use this when you need a guaranteed-fresh value (e.g. validation endpoints).
   */
  async getKey(): Promise<string> {
    const stored = (await this._context.secrets.get(SECRET_STORAGE_KEY)) ?? '';
    if (stored) {
      this._cachedKey = stored;
    }
    return this._cachedKey;
  }

  hasKey(): boolean {
    return this._cachedKey.length > 0;
  }

  /** Monotonically increasing version. Used by AIService to detect key rotation mid-request. */
  get keyVersion(): number {
    return this._keyVersion;
  }

  /** Safe display string — never exposes the raw key. */
  maskedKey(): string {
    const k = this._cachedKey;
    if (!k) return '(none)';
    if (k.length <= 12) return k.slice(0, 4) + '****';
    return k.slice(0, 10) + '****' + k.slice(-4);
  }

  // ── Key Mutation ──────────────────────────────────────────────────────────

  /**
   * Validate, store, and activate a new API key.
   * Fires onKeyChanged so AIService and SidebarProvider react immediately.
   */
  async setKey(key: string): Promise<{ ok: boolean; error?: string }> {
    const trimmed = key.trim();
    if (!validateKeyFormat(trimmed)) {
      return {
        ok: false,
        error: 'API key is too short or invalid (minimum 8 characters).',
      };
    }

    const previous = this._cachedKey;
    this._cachedKey = trimmed;
    this._keyVersion++;

    await this._context.secrets.store(SECRET_STORAGE_KEY, trimmed);

    zerlyLog('key-saved', `Key stored successfully`, {
      meta: { rotated: previous !== '' && previous !== trimmed },
    });
    zerlyLog('key-version', `keyVersion is now ${this._keyVersion}`, {
      meta: { keyVersion: this._keyVersion },
    });

    this.onKeyChanged.fire(trimmed);
    return { ok: true };
  }

  /** Clear stored key completely (e.g. on sign-out). */
  async clearKey(): Promise<void> {
    this._cachedKey = '';
    this._keyVersion++;
    await this._context.secrets.delete(SECRET_STORAGE_KEY);
    try {
      await vscode.workspace
        .getConfiguration('zerly')
        .update('zerlyApiKey', '', vscode.ConfigurationTarget.Global);
    } catch {
      // Non-fatal
    }
    zerlyLog('key-cleared', `Key removed from SecretStorage`);
    zerlyLog('key-version', `keyVersion is now ${this._keyVersion}`, {
      meta: { keyVersion: this._keyVersion },
    });
    this.onKeyChanged.fire(null);
  }

  dispose(): void {
    this.onKeyChanged.dispose();
    ZerlyKeyManager._instance = undefined;
  }
}
