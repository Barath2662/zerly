import * as vscode from 'vscode';
import { ProjectScanner } from './scanner';
import { DependencyGraph } from './dependencyGraph';
import { RiskAnalyzer } from './riskAnalyzer';
import { FlowAnalyzer } from './flowAnalyzer';
import { AIService } from './aiService';

const CACHE_KEY = 'zerly.cachedScanData';
const CACHE_TIMESTAMP_KEY = 'zerly.cachedScanTimestamp';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export class ZerlySidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _pendingMessages: any[] = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext,
    private readonly _scanner: ProjectScanner,
    private readonly _depGraph: DependencyGraph,
    private readonly _riskAnalyzer: RiskAnalyzer,
    private readonly _flowAnalyzer: FlowAnalyzer,
    private readonly _aiService: AIService
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    });

    // Send any pending messages
    for (const msg of this._pendingMessages) {
      webviewView.webview.postMessage(msg);
    }
    this._pendingMessages = [];
  }

  public postMessage(message: any) {
    if (this._view) {
      this._view.webview.postMessage(message);
    } else {
      this._pendingMessages.push(message);
    }
  }

  private async _handleMessage(message: any) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders?.[0]?.uri.fsPath;

    switch (message.command) {
      case 'getCachedScan': {
        const cached = this._context.workspaceState.get<any>(CACHE_KEY);
        const timestamp = this._context.workspaceState.get<number>(CACHE_TIMESTAMP_KEY);
        if (cached && timestamp && Date.now() - timestamp < CACHE_TTL_MS) {
          this.postMessage({ command: 'cachedScanData', data: cached });
        }
        break;
      }

      case 'analyzeProject': {
        if (!rootPath) {
          this.postMessage({ command: 'error', message: 'No workspace folder open.' });
          return;
        }

        // Check cache unless forceRefresh
        if (!message.forceRefresh) {
          const cached = this._context.workspaceState.get<any>(CACHE_KEY);
          const timestamp = this._context.workspaceState.get<number>(CACHE_TIMESTAMP_KEY);
          if (cached && timestamp && Date.now() - timestamp < CACHE_TTL_MS) {
            this.postMessage({ command: 'scanComplete', data: cached, isCached: true });
            return;
          }
        }

        this.postMessage({ command: 'loading', feature: 'analyze' });
        try {
          const scanResult = await this._scanner.scan(rootPath);
          const graph = this._depGraph.build(scanResult);
          
          // Always try AI summary — the service has built-in API key fallback
          let aiSummary = '';
          try {
            aiSummary = await this._aiService.summarizeProject(scanResult);
          } catch {
            aiSummary = '';
          }

          const data = { scanResult, graph, aiSummary };

          // Store in cache
          await this._context.workspaceState.update(CACHE_KEY, data);
          await this._context.workspaceState.update(CACHE_TIMESTAMP_KEY, Date.now());

          this.postMessage({
            command: 'scanComplete',
            data,
            isCached: false,
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'architectureMap': {
        if (!rootPath) return;
        this.postMessage({ command: 'loading', feature: 'architecture' });
        try {
          const scanResult = await this._scanner.scan(rootPath);
          const graph = this._depGraph.build(scanResult);
          const mermaidDiagram = this._depGraph.toMermaid(graph);
          this.postMessage({
            command: 'architectureResult',
            data: { graph, mermaidDiagram },
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'riskScan': {
        if (!rootPath) return;
        this.postMessage({ command: 'loading', feature: 'risk' });
        try {
          const scanResult = await this._scanner.scan(rootPath);
          const risks = this._riskAnalyzer.analyze(scanResult);
          this.postMessage({
            command: 'riskResult',
            data: { risks },
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'featureFlow': {
        if (!rootPath) return;
        this.postMessage({ command: 'loading', feature: 'featureFlow' });
        try {
          const scanResult = await this._scanner.scan(rootPath);
          const flow = this._flowAnalyzer.analyzeFlow(scanResult, message.query || '');
          this.postMessage({
            command: 'featureFlowResult',
            data: { flow, query: message.query },
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'explainCode': {
        this.postMessage({ command: 'loading', feature: 'explain' });
        try {
          const explanation = await this._aiService.explainCode(
            message.code,
            message.fileName || ''
          );
          this.postMessage({
            command: 'explainResult',
            data: { explanation, code: message.code },
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'learningMode': {
        if (!rootPath) return;
        this.postMessage({ command: 'loading', feature: 'learning' });
        try {
          const scanResult = await this._scanner.scan(rootPath);
          const roadmap = await this._aiService.generateLearningRoadmap(scanResult);
          this.postMessage({
            command: 'learningResult',
            data: { roadmap, scanResult },
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'chat': {
        this.postMessage({ command: 'loading', feature: 'chat' });
        try {
          let scanResult = null;
          if (rootPath) {
            scanResult = await this._scanner.scan(rootPath);
          }
          const reply = await this._aiService.chat(message.userMessage, scanResult);
          this.postMessage({
            command: 'chatResponse',
            data: { reply, userMessage: message.userMessage },
          });
        } catch (err: any) {
          this.postMessage({ command: 'error', message: err.message });
        }
        break;
      }

      case 'openFile': {
        if (message.filePath) {
          const uri = vscode.Uri.file(message.filePath);
          vscode.window.showTextDocument(uri);
        }
        break;
      }

      case 'setApiKey': {
        const key = await vscode.window.showInputBox({
          prompt: 'Enter your API key (OpenRouter, OpenAI-compatible, or any LLM provider)',
          password: true,
          placeHolder: 'sk-or-... or sk-...',
        });
        if (key) {
          await vscode.workspace
            .getConfiguration('zerly')
            .update('openRouterApiKey', key, vscode.ConfigurationTarget.Global);
          this.postMessage({ command: 'apiKeySet', success: true });
          vscode.window.showInformationMessage('Zerly: API key saved! AI features are ready.');
        }
        break;
      }

      case 'getApiStatus': {
        const hasKey = this._aiService.getApiKey().length > 0;
        this.postMessage({
          command: 'apiStatus',
          data: { hasKey, isDefault: !vscode.workspace.getConfiguration('zerly').get<string>('openRouterApiKey') },
        });
        break;
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} https: data:;
    connect-src https://openrouter.ai;
  ">
  <link rel="stylesheet" href="${styleUri}">
  <title>Zerly AI</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
