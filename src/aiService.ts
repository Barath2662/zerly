import * as vscode from 'vscode';
import { ScanResult } from './scanner';

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

  setExtensionPath(extPath: string) {
    this._extensionPath = extPath;
  }

  // ── API Key Resolution (priority: user zerlyApiKey setting > customModelApiKey) ──

  getApiKey(): string {
    const cfg = vscode.workspace.getConfiguration('zerly');
    const zerlyKey = cfg.get<string>('zerlyApiKey');
    if (zerlyKey && zerlyKey.trim().length > 0) {
      return zerlyKey.trim();
    }
    return '';
  }

  /** Returns the model to use: custom override if set, otherwise the Zerly default. */
  private _getModel(): string {
    const cfg = vscode.workspace.getConfiguration('zerly');
    const customModelKey = cfg.get<string>('customModelApiKey');
    if (customModelKey && customModelKey.trim().length > 0) {
      // When a custom key is provided, honour the custom model setting
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

  private _sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Core API call ──

  /**
   * Sends a chat-completion request to the Zerly API.
   * - taskKey: when provided, any previous in-flight request for the same task
   *   is aborted before this one starts (prevents stale responses).
   * - Retries up to 2 times with exponential backoff (1 s, 2 s) on server
   *   errors (5xx) and transient network failures. Auth/rate-limit errors (401,
   *   403, 429) are returned immediately without retrying.
   * - API key is NEVER written to any log.
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

    const model = this._getModel();
    console.log(`[Zerly] Calling model: ${model}`);

    // Abort the previous request for this task type and register the new one
    if (taskKey) {
      this._taskControllers.get(taskKey)?.abort();
      this._taskControllers.set(taskKey, new AbortController());
    }
    const taskSignal = taskKey ? this._taskControllers.get(taskKey)!.signal : null;

    const TIMEOUT_MS = 30_000;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Bail early if the task was superseded
      if (taskSignal?.aborted) {
        return '⚠️ Request was cancelled.';
      }

      // Exponential backoff before retries
      if (attempt > 0) {
        await this._sleep(1_000 * attempt); // 1 s, then 2 s
        if (taskSignal?.aborted) {
          return '⚠️ Request was cancelled.';
        }
      }

      // Per-attempt controller handles the 30 s timeout
      const attemptController = new AbortController();
      const timeoutId = setTimeout(() => attemptController.abort(), TIMEOUT_MS);

      // Forward task cancellation into this attempt's signal
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
            // NOTE: key is passed in the Authorization header only — never logged
            'Authorization': `Bearer ${apiKey}`,
            'X-Title': 'Zerly AI',
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

        if (!response.ok) {
          // Hard failures — do not retry
          if (response.status === 401 || response.status === 403) {
            return '⚠️ Invalid or unauthorized Zerly API key. Check your key in Settings → Zerly AI → Zerly API Key.';
          }
          if (response.status === 429) {
            return '⚠️ Rate limit exceeded. Please wait a moment and try again.';
          }
          // Server errors — retry if attempts remain
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
            return '⚠️ Request was cancelled.';
          }
          // Timeout: retry if attempts remain
          if (attempt < MAX_RETRIES) {
            continue;
          }
          return '⚠️ Request timed out (30s). Check your connection and try again.';
        }

        // Network / fetch error: retry if attempts remain
        if (attempt < MAX_RETRIES) {
          continue;
        }
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
    return this._call(messages, 2048);
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
