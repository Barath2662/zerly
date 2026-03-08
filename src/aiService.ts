import * as vscode from 'vscode';
import { ScanResult } from './scanner';
import { ZerlyKeyManager, zerlyLog, generateRequestId } from './zerlyKeyManager';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ZerlyMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ZerlyResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: number;
  };
}

export type TaskType =
  | 'code_explanation'
  | 'architecture_analysis'
  | 'feature_flow'
  | 'risk_analysis'
  | 'developer_chat'
  | 'quick_summary'
  | 'learning_roadmap';

// ─── Constants ───────────────────────────────────────────────────────────────

const ZERLY_API_ENDPOINT = 'https://zerly.tinobritty.me/api/v1/chat/completions';
const ZERLY_DEFAULT_MODEL = 'zerly/zerlino-32b';

// ─── AI Service ──────────────────────────────────────────────────────────────

export class AIService {
  private _extensionPath: string = '';
  private _keyManager: ZerlyKeyManager | null = null;

  setExtensionPath(extPath: string) {
    this._extensionPath = extPath;
  }

  /**
   * Wire up the ZerlyKeyManager so the service always uses the latest key.
   * When the key changes, all in-flight requests are cancelled.
   */
  setKeyManager(km: ZerlyKeyManager): void {
    this._keyManager = km;
    km.onKeyChanged.event(() => {
      zerlyLog('key-changed-cache-cleared', 'Key changed — aborting all in-flight AI requests');
      this.invalidateAll();
    });
  }

  /** Abort every in-flight request immediately (called on key rotation). */
  invalidateAll(): void {
    for (const controller of this._taskControllers.values()) {
      controller.abort();
    }
    this._taskControllers.clear();
  }

  /** Number of task slots currently tracking an AbortController. */
  getInflightCount(): number {
    return this._taskControllers.size;
  }

  /** Last request's correlation ID and HTTP status, for diagnostics. */
  getLastRequestInfo(): { requestId: string; status?: number; ts: number } | null {
    return this._lastRequestInfo;
  }

  /** Returns the active API key — prefers ZerlyKeyManager, falls back to settings. */
  getApiKey(): string {
    if (this._keyManager) {
      const kmKey = this._keyManager.getCachedKey();
      if (kmKey) return kmKey;
    }
    // Fallback: read from workspace config (supports manual edits during development)
    const cfg = vscode.workspace.getConfiguration('zerly');
    const zerlyKey = cfg.get<string>('zerlyApiKey');
    return zerlyKey?.trim() ?? '';
  }

  /** Returns the model to use: custom override if set, otherwise the Zerly default. */
  private _getModel(): string {
    const cfg = vscode.workspace.getConfiguration('zerly');
    const customModelKey = cfg.get<string>('customModelApiKey');
    if (customModelKey && customModelKey.trim().length > 0) {
      const customModel = cfg.get<string>('customModel');
      if (customModel && customModel.trim()) {
        return customModel.trim();
      }
    }
    return ZERLY_DEFAULT_MODEL;
  }

  /** Returns the API key and endpoint to use based on config. */
  private _getApiConfig(): { apiKey: string; endpoint: string } {
    const cfg = vscode.workspace.getConfiguration('zerly');
    const customModelKey = cfg.get<string>('customModelApiKey');
    if (customModelKey && customModelKey.trim().length > 0) {
      const customEndpoint = cfg.get<string>('customApiEndpoint') || ZERLY_API_ENDPOINT;
      return { apiKey: customModelKey.trim(), endpoint: customEndpoint };
    }
    return { apiKey: this.getApiKey(), endpoint: ZERLY_API_ENDPOINT };
  }

  // ── Request management ──

  /** Tracks one AbortController per task type so new requests cancel stale ones. */
  private readonly _taskControllers = new Map<string, AbortController>();

  /** Updated after every completed request — feeds into diagnostics. */
  private _lastRequestInfo: { requestId: string; status?: number; ts: number } | null = null;

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Core API call ──

  /**
   * Sends a chat-completion request to the Zerly API.
   *
   * Key invariants:
   *  - taskKey: cancels any prior request for the same task (e.g. double-click Analyze).
   *  - capturedKeyVersion: if the API key rotates mid-request the response is discarded.
   *  - Every request carries Cache-Control: no-store and X-Request-Id for freshness.
   *  - Retries up to 2x with 1 s / 2 s exponential backoff on 5xx / network failures.
   *  - 401 / 403 / 429 are returned immediately without retry; 401/403 also prompt reconnect.
   *  - The API key is NEVER written to any log.
   */
  private async _call(
    messages: ZerlyMessage[],
    maxTokens: number = 2048,
    taskKey?: string
  ): Promise<string> {
    const { apiKey, endpoint } = this._getApiConfig();

    if (!apiKey) {
      return '⚠️ Connect your Zerly account to activate AI features. Add your API key in Settings → Zerly AI → Zerly API Key.';
    }

    // Capture current key version — used at the end to detect key rotation mid-request.
    const capturedKeyVersion = this._keyManager?.keyVersion ?? 0;
    const requestId = generateRequestId();
    const model = this._getModel();

    zerlyLog('request-start', `Task: ${taskKey ?? 'ad-hoc'} model: ${model} keyVersion: ${capturedKeyVersion}`, {
      requestId,
      meta: { taskKey: taskKey ?? 'ad-hoc', keyVersion: capturedKeyVersion },
    });

    // Cancel the stale request for the same task and register this one.
    if (taskKey) {
      this._taskControllers.get(taskKey)?.abort();
      this._taskControllers.set(taskKey, new AbortController());
    }
    const taskSignal = taskKey ? this._taskControllers.get(taskKey)!.signal : null;

    const TIMEOUT_MS = 30_000;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (taskSignal?.aborted) {
        zerlyLog('ignored-stale-response', 'Task superseded — cancelled before attempt', { requestId });
        return '⚠️ Request was cancelled.';
      }

      if (attempt > 0) {
        await this._sleep(1_000 * attempt); // 1 s, then 2 s
        if (taskSignal?.aborted) {
          return '⚠️ Request was cancelled.';
        }
      }

      const attemptController = new AbortController();
      const timeoutId = setTimeout(() => attemptController.abort(), TIMEOUT_MS);

      let onTaskAbort: (() => void) | null = null;
      if (taskSignal) {
        onTaskAbort = () => attemptController.abort();
        taskSignal.addEventListener('abort', onTaskAbort, { once: true });
      }

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (taskSignal && onTaskAbort) {
          taskSignal.removeEventListener('abort', onTaskAbort);
        }
      };

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Key passed only in this header — never appears in logs
            'Authorization': `Bearer ${apiKey}`,
            'X-Title': 'Zerly AI',
            // Freshness headers — prevent stale proxy/CDN responses
            'Cache-Control': 'no-store',
            'Pragma': 'no-cache',
            // Per-request tracing ID
            'X-Request-Id': requestId,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0.3,
          }),
          signal: attemptController.signal,
        });

        cleanup();

        // Key was rotated while the request was in-flight — discard the result.
        if (this._keyManager && this._keyManager.keyVersion !== capturedKeyVersion) {
          zerlyLog('ignored-stale-response', 'Key rotated mid-request — discarding response', { requestId });
          return '⚠️ Request cancelled due to key rotation. Please retry.';
        }

        this._lastRequestInfo = { requestId, status: response.status, ts: Date.now() };
        zerlyLog('request-end', `Task: ${taskKey ?? 'ad-hoc'}`, {
          requestId,
          status: response.status,
          meta: { keyVersion: this._keyManager?.keyVersion ?? 0 },
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            // Prompt reconnect — clear bad key
            vscode.window.showWarningMessage(
              'Zerly: API key rejected. Please reconnect your account.',
              'Connect Zerly'
            ).then(action => {
              if (action === 'Connect Zerly') {
                vscode.env.openExternal(vscode.Uri.parse('https://zerly.tinobritty.me/connect'));
              }
            });
            return '⚠️ Invalid or unauthorized Zerly API key. Reconnect your account to continue.';
          }
          if (response.status === 429) {
            return '⚠️ Rate limit exceeded. Please wait a moment and try again.';
          }
          if (response.status >= 500 && attempt < MAX_RETRIES) {
            continue;
          }
          const errText = await response.text().catch(() => '');
          return `⚠️ Zerly API error (${response.status})${errText ? `: ${errText}` : ''}.`;
        }

        const data = (await response.json()) as ZerlyResponse;

        if (data.error) {
          return `⚠️ API error: ${data.error.message || 'Unknown error'}`;
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content || !content.trim()) {
          return '⚠️ Empty response received. Please try again.';
        }

        return content;
      } catch (err: any) {
        cleanup();

        if (err.name === 'AbortError') {
          if (taskSignal?.aborted) {
            zerlyLog('ignored-stale-response', 'Task superseded mid-request', { requestId });
            return '⚠️ Request was cancelled.';
          }
          if (attempt < MAX_RETRIES) continue;
          return '⚠️ Request timed out (30s). Check your connection and try again.';
        }

        if (attempt < MAX_RETRIES) continue;
        return '⚠️ Network error. Check your connection and try again.';
      }
    }

    return '⚠️ Zerly AI is temporarily unavailable. Please try again shortly.';
  }

  // ─── Public Feature Methods ────────────────────────────────────────────────

  async summarizeProject(scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. You are confident, helpful, concise, and slightly playful. Analyze the project structure and provide a brief, useful summary. Focus on architecture, frameworks, and key modules. Keep it to 3-4 sentences.`,
      },
      {
        role: 'user',
        content: `Analyze this project and give me a concise summary:\n\n${context}`,
      },
    ];
    return this._call(messages, 1024, 'summarize');
  }

  async explainCode(code: string, fileName: string): Promise<string> {
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Explain code clearly and concisely. Include:
1. What the code does (plain English)
2. Key logic flow
3. Potential bugs or issues
4. Optimization suggestions (if any)

Be confident and helpful. Don't be verbose. Use markdown formatting.`,
      },
      {
        role: 'user',
        content: `Explain this code from "${fileName}":\n\n\`\`\`\n${code}\n\`\`\``,
      },
    ];
    return this._call(messages, 2048, 'explain');
  }

  async generateLearningRoadmap(scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant helping someone learn an unfamiliar codebase. Create a learning roadmap: ordered list of files to read, with brief explanation of each file's role. Start with entry points, then core logic, then utilities. Use numbered list format. Be concise.`,
      },
      {
        role: 'user',
        content: `Create a learning roadmap for this project:\n\n${context}`,
      },
    ];
    return this._call(messages, 2048, 'learning');
  }

  async chat(userMessage: string, scanResult: ScanResult | null): Promise<string> {
    const contextStr = scanResult
      ? '\n\nProject context:\n' + this._buildProjectContext(scanResult)
      : '';
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. You are confident, helpful, concise, and slightly playful. Answer questions about the codebase based on the project analysis provided. If you don't have enough info, say so honestly. Use markdown formatting.${contextStr}`,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];
    return this._call(messages, 2048, 'chat');
  }

  async analyzeFeatureFlow(query: string, scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Analyze the code flow for a feature. Describe the call chain from entry point to data layer. Be specific about which functions and files are involved. Use markdown formatting.`,
      },
      {
        role: 'user',
        content: `How does "${query}" work in this project?\n\n${context}`,
      },
    ];
    return this._call(messages, 2048, 'featureFlow');
  }

  async analyzeRisks(scanResult: ScanResult, riskSummary: string): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Analyze the risk report for a codebase. Provide actionable recommendations for the highest-risk modules. Be specific and concise. Use markdown.`,
      },
      {
        role: 'user',
        content: `Here's the static risk analysis:\n\n${riskSummary}\n\nProject context:\n${context}\n\nGive me specific recommendations.`,
      },
    ];
    return this._call(messages, 1536, 'risks');
  }

  async analyzeArchitecture(scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: ZerlyMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Analyze the project architecture. Describe the layers, key modules, and how they connect. Identify potential architectural issues. Be concise. Use markdown.`,
      },
      {
        role: 'user',
        content: `Analyze the architecture of this project:\n\n${context}`,
      },
    ];
    return this._call(messages, 2048, 'architecture');
  }

  // ─── Context Builder ───────────────────────────────────────────────────────

  private _buildProjectContext(scanResult: ScanResult): string {
    const parts: string[] = [];

    parts.push(`## Project Overview`);
    parts.push(`- Total files: ${scanResult.totalFiles}`);
    parts.push(`- Total lines: ${scanResult.totalLines}`);
    parts.push(`- Frameworks: ${scanResult.frameworks.join(', ') || 'None detected'}`);
    parts.push(
      `- Languages: ${Object.entries(scanResult.languages)
        .map(([l, c]) => `${l} (${c} lines)`)
        .join(', ')}`
    );

    if (Object.keys(scanResult.dependencies).length > 0) {
      parts.push(`\n## Dependencies`);
      parts.push(Object.keys(scanResult.dependencies).join(', '));
    }

    parts.push(`\n## File Structure`);
    for (const file of scanResult.files.slice(0, 50)) {
      const funcs = file.functions.map((f) => f.name).join(', ');
      parts.push(
        `- ${file.relativePath} (${file.lineCount} lines)${funcs ? ` — functions: ${funcs}` : ''}`
      );
    }
    if (scanResult.files.length > 50) {
      parts.push(`... and ${scanResult.files.length - 50} more files`);
    }

    parts.push(`\n## Import Map (key files)`);
    for (const file of scanResult.files.slice(0, 30)) {
      if (file.imports.length > 0) {
        parts.push(`- ${file.relativePath} imports: ${file.imports.join(', ')}`);
      }
    }

    return parts.join('\n');
  }
}
