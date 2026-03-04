import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ScanResult } from './scanner';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
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

// ─── Model Configuration ────────────────────────────────────────────────────

/**
 * Task-to-model routing. Each task has a primary model and ordered fallbacks.
 * All models are free-tier on OpenRouter.
 */
const MODEL_ROUTING: Record<TaskType, string[]> = {
  code_explanation: [
    'qwen/qwen3-coder:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'arcee-ai/trinity-large-preview:free',
    'stepfun/step-3.5-flash:free',
    'openrouter/auto',
  ],
  architecture_analysis: [
    'qwen/qwen3-vl-235b-a22b-thinking',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'arcee-ai/trinity-large-preview:free',
    'stepfun/step-3.5-flash:free',
    'openrouter/auto',
  ],
  feature_flow: [
    'qwen/qwen3-coder:free',
    'stepfun/step-3.5-flash:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'openrouter/auto',
  ],
  risk_analysis: [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'arcee-ai/trinity-large-preview:free',
    'qwen/qwen3-coder:free',
    'liquid/lfm-2.5-1.2b-thinking:free',
    'openrouter/auto',
  ],
  developer_chat: [
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'qwen/qwen3-4b:free',
    'stepfun/step-3.5-flash:free',
    'nvidia/llama-nemotron-embed-vl-1b-v2:free',
    'openrouter/auto',
  ],
  quick_summary: [
    'stepfun/step-3.5-flash:free',
    'qwen/qwen3-4b:free',
    'liquid/lfm-2.5-1.2b-thinking:free',
    'nvidia/nemotron-3-nano-30b-a3b:free',
    'openrouter/auto',
  ],
  learning_roadmap: [
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'qwen/qwen3-vl-235b-a22b-thinking',
    'arcee-ai/trinity-large-preview:free',
    'qwen/qwen3-coder:free',
    'openrouter/auto',
  ],
};

// Default embedded API key (from .env at build time / shipped with extension)
const DEFAULT_API_KEY = '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';

// ─── AI Service ──────────────────────────────────────────────────────────────

export class AIService {
  private _extensionPath: string = '';

  /**
   * Set the extension root path so we can read .env at runtime if needed.
   */
  setExtensionPath(extPath: string) {
    this._extensionPath = extPath;
  }

  // ── API Key Resolution (priority: user setting > .env file > built-in default) ──

  getApiKey(): string {
    // 1. User-configured key in VS Code settings (highest priority)
    const userKey = vscode.workspace.getConfiguration('zerly').get<string>('openRouterApiKey');
    if (userKey && userKey.trim().length > 0) {
      return userKey.trim();
    }

    // 2. Read from .env file in extension directory (if shipped)
    const envKey = this._readEnvKey();
    if (envKey && envKey.trim().length > 0) {
      return envKey.trim();
    }

    // 3. Read from workspace .env file
    const wsEnvKey = this._readWorkspaceEnvKey();
    if (wsEnvKey && wsEnvKey.trim().length > 0) {
      return wsEnvKey.trim();
    }

    // 4. Built-in default key
    return DEFAULT_API_KEY;
  }

  private _readEnvKey(): string {
    if (!this._extensionPath) return '';
    try {
      const envPath = path.join(this._extensionPath, '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const match = content.match(/^LLM_MODEL_API_KEY\s*=\s*(.+)$/m);
        return match?.[1]?.trim() || '';
      }
    } catch {
      // silently ignore
    }
    return '';
  }

  private _readWorkspaceEnvKey(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return '';
    try {
      const envPath = path.join(folders[0].uri.fsPath, '.env');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const match = content.match(/^LLM_MODEL_API_KEY\s*=\s*(.+)$/m);
        return match?.[1]?.trim() || '';
      }
    } catch {
      // silently ignore
    }
    return '';
  }

  // ── Model selection ──

  private _getModelsForTask(task: TaskType): string[] {
    // Check if user has set a custom model override
    const customModel = vscode.workspace.getConfiguration('zerly').get<string>('aiModel');
    if (customModel && customModel.trim() && customModel !== 'auto') {
      // User explicitly chose a model — put it first, keep fallbacks
      const fallbacks = MODEL_ROUTING[task].filter((m) => m !== customModel);
      return [customModel, ...fallbacks];
    }
    return MODEL_ROUTING[task];
  }

  // ── Core API call with multi-model fallback ──

  private async _callWithFallback(
    messages: OpenRouterMessage[],
    task: TaskType,
    maxTokens: number = 2048
  ): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return '⚠️ No API key available. Go to Settings → Zerly AI → OpenRouter API Key, or add LLM_MODEL_API_KEY to your .env file.';
    }

    const models = this._getModelsForTask(task);
    let lastError = '';

    for (const model of models) {
      try {
        console.log(`[Zerly] Trying model: ${model} for task: ${task}`);
        const result = await this._callOpenRouter(messages, model, apiKey, maxTokens);
        if (result && !result.startsWith('__FALLBACK__')) {
          console.log(`[Zerly] Success with model: ${model}`);
          return result;
        }
        lastError = result.replace('__FALLBACK__', '');
        console.warn(`[Zerly] Model ${model} failed: ${lastError}, trying next...`);
      } catch (err: any) {
        lastError = err.message || String(err);
        console.warn(`[Zerly] Model ${model} threw: ${lastError}, trying next...`);
      }
    }

    // All models failed
    return `I couldn't reach any AI model right now. Last error: ${lastError}. Check your internet connection or API key.`;
  }

  private async _callOpenRouter(
    messages: OpenRouterMessage[],
    model: string,
    apiKey: string,
    maxTokens: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://github.com/brittytino/zerly',
          'X-Title': 'Zerly AI',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown error');
        // Rate limit, model unavailable, or not found → trigger fallback
        if (response.status === 429 || response.status === 503 || response.status === 502 || response.status === 404) {
          return `__FALLBACK__${response.status}: ${errText}`;
        }
        // Auth error — don't fallback, it'll fail for all models
        if (response.status === 401 || response.status === 403) {
          return `⚠️ API key invalid or unauthorized (${response.status}). Check your OpenRouter API key in Settings.`;
        }
        return `__FALLBACK__${response.status}: ${errText}`;
      }

      const data = (await response.json()) as OpenRouterResponse;

      // Check for API-level errors
      if (data.error) {
        return `__FALLBACK__API error: ${data.error.message || 'Unknown error'}`;
      }

      const content = data.choices?.[0]?.message?.content;
      if (!content || content.trim().length === 0) {
        return '__FALLBACK__Empty response from model';
      }

      return content;
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        return '__FALLBACK__Request timed out (30s)';
      }
      throw err;
    }
  }

  // ─── Public Feature Methods ────────────────────────────────────────────────

  async summarizeProject(scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. You are confident, helpful, concise, and slightly playful. Analyze the project structure and provide a brief, useful summary. Focus on architecture, frameworks, and key modules. Keep it to 3-4 sentences.`,
      },
      {
        role: 'user',
        content: `Analyze this project and give me a concise summary:\n\n${context}`,
      },
    ];
    return this._callWithFallback(messages, 'quick_summary', 1024);
  }

  async explainCode(code: string, fileName: string): Promise<string> {
    const messages: OpenRouterMessage[] = [
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
    return this._callWithFallback(messages, 'code_explanation', 2048);
  }

  async generateLearningRoadmap(scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant helping someone learn an unfamiliar codebase. Create a learning roadmap: ordered list of files to read, with brief explanation of each file's role. Start with entry points, then core logic, then utilities. Use numbered list format. Be concise.`,
      },
      {
        role: 'user',
        content: `Create a learning roadmap for this project:\n\n${context}`,
      },
    ];
    return this._callWithFallback(messages, 'learning_roadmap', 2048);
  }

  async chat(userMessage: string, scanResult: ScanResult | null): Promise<string> {
    const contextStr = scanResult
      ? '\n\nProject context:\n' + this._buildProjectContext(scanResult)
      : '';
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. You are confident, helpful, concise, and slightly playful. Answer questions about the codebase based on the project analysis provided. If you don't have enough info, say so honestly. Use markdown formatting.${contextStr}`,
      },
      {
        role: 'user',
        content: userMessage,
      },
    ];
    return this._callWithFallback(messages, 'developer_chat', 2048);
  }

  async analyzeFeatureFlow(query: string, scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Analyze the code flow for a feature. Describe the call chain from entry point to data layer. Be specific about which functions and files are involved. Use markdown formatting.`,
      },
      {
        role: 'user',
        content: `How does "${query}" work in this project?\n\n${context}`,
      },
    ];
    return this._callWithFallback(messages, 'feature_flow', 2048);
  }

  async analyzeRisks(scanResult: ScanResult, riskSummary: string): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Analyze the risk report for a codebase. Provide actionable recommendations for the highest-risk modules. Be specific and concise. Use markdown.`,
      },
      {
        role: 'user',
        content: `Here's the static risk analysis:\n\n${riskSummary}\n\nProject context:\n${context}\n\nGive me specific recommendations.`,
      },
    ];
    return this._callWithFallback(messages, 'risk_analysis', 1536);
  }

  async analyzeArchitecture(scanResult: ScanResult): Promise<string> {
    const context = this._buildProjectContext(scanResult);
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: `You are Zerly, a developer intelligence assistant. Analyze the project architecture. Describe the layers, key modules, and how they connect. Identify potential architectural issues. Be concise. Use markdown.`,
      },
      {
        role: 'user',
        content: `Analyze the architecture of this project:\n\n${context}`,
      },
    ];
    return this._callWithFallback(messages, 'architecture_analysis', 2048);
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
