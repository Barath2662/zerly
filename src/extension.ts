import * as vscode from 'vscode';
import { ZerlySidebarProvider } from './sidebarProvider';
import { ProjectScanner } from './scanner';
import { DependencyGraph } from './dependencyGraph';
import { RiskAnalyzer } from './riskAnalyzer';
import { FlowAnalyzer } from './flowAnalyzer';
import { AIService } from './aiService';

let sidebarProvider: ZerlySidebarProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('Zerly AI is activating...');

  const scanner = new ProjectScanner();
  const depGraph = new DependencyGraph();
  const riskAnalyzer = new RiskAnalyzer();
  const flowAnalyzer = new FlowAnalyzer();
  const aiService = new AIService();
  aiService.setExtensionPath(context.extensionUri.fsPath);

  sidebarProvider = new ZerlySidebarProvider(
    context.extensionUri,
    context,
    scanner,
    depGraph,
    riskAnalyzer,
    flowAnalyzer,
    aiService
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('zerly.mainView', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.analyzeProject', async () => {
      sidebarProvider.postMessage({ command: 'navigate', view: 'analyze' });
      await runAnalyzeProject(scanner, depGraph, aiService);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.architectureMap', () => {
      sidebarProvider.postMessage({ command: 'navigate', view: 'architecture' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.featureFlow', () => {
      sidebarProvider.postMessage({ command: 'navigate', view: 'featureFlow' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.riskScanner', async () => {
      sidebarProvider.postMessage({ command: 'navigate', view: 'risk' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.explainCode', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Zerly: No active editor found.');
        return;
      }
      const selection = editor.selection;
      const code = editor.document.getText(selection);
      if (!code.trim()) {
        vscode.window.showWarningMessage('Zerly: Please select some code first.');
        return;
      }
      sidebarProvider.postMessage({
        command: 'explainCode',
        code,
        fileName: editor.document.fileName,
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.learningMode', () => {
      sidebarProvider.postMessage({ command: 'navigate', view: 'learning' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('zerly.chat', () => {
      sidebarProvider.postMessage({ command: 'navigate', view: 'chat' });
    })
  );

  // Show welcome message
  vscode.window.showInformationMessage(
    "Hey, I'm Zerly. Give me a moment to understand your codebase. 🧠"
  );

  console.log('Zerly AI activated successfully.');
}

async function runAnalyzeProject(
  scanner: ProjectScanner,
  depGraph: DependencyGraph,
  aiService: AIService
) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('Zerly: No workspace folder open.');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Zerly is analyzing your project...',
      cancellable: false,
    },
    async () => {
      const scanResult = await scanner.scan(rootPath);
      const graph = depGraph.build(scanResult);

      sidebarProvider.postMessage({
        command: 'scanComplete',
        data: {
          scanResult,
          graph,
        },
      });
    }
  );
}

export function deactivate() {
  console.log('Zerly AI deactivated.');
}
