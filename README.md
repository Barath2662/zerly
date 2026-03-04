# ⚡ Zerly AI

**"Understand your code. Not just generate it."**

Zerly AI is a developer intelligence assistant for VS Code that helps you understand codebases, visualize architecture, detect risks, explain AI-generated code, and navigate unfamiliar projects.

---

## Features

### 🔍 Project Intelligence Scan
Scans your entire codebase — files, imports, dependencies, frameworks, folder structure — and presents a comprehensive overview.

### 🏗️ Architecture Map
Generates a visual dependency graph showing how your project is organized into layers (Frontend, API, Services, Database, etc.) using Mermaid.js diagrams.

### 🔀 Feature Flow Explorer
Ask "How does login work?" and Zerly traces the call chain through your codebase, showing exactly which functions and files are involved.

### ⚠️ Risk Scanner
Analyzes code complexity, file sizes, dependency counts, and function lengths to identify high-risk, fragile modules that may need refactoring.

### 💡 Explain AI-Generated Code
Select any code block, right-click → "Explain with Zerly", and get a clear explanation including potential bugs and optimization suggestions.

### 📚 Learning Mode
New to a project? Zerly generates a guided learning roadmap — an ordered list of files to read with explanations of each file's role.

### 💬 Chat with Zerly
Ask anything about your codebase. Zerly analyzes the project context and answers questions about architecture, logic, dependencies, and more.

---

## Getting Started

1. Install the extension
2. Open a project in VS Code
3. Click the ⚡ Zerly icon in the Activity Bar
4. Click **Analyze Project** to get started

### AI Features (Optional)
For AI-powered explanations, chat, and learning mode:
1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Set it in Settings → Zerly AI → OpenRouter API Key

Supported models:
- **DeepSeek Coder** (recommended — best for code reasoning)
- Qwen 2.5 Coder 32B
- Mistral 7B Instruct

---

## Extension Architecture

```
VS Code Extension
        │
  Project Scanner (AST Parser)
        │
  Dependency Graph Builder
        │
  AI Analysis (OpenRouter)
        │
  Visualization (Mermaid / React UI)
```

---

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API
- **UI**: React, CSS (Glassmorphism dark theme)
- **Visualization**: Mermaid.js
- **AI**: OpenRouter API (DeepSeek Coder, Qwen, Mistral)
- **Build**: esbuild

---

## Supported Editors

| Editor | Status |
|--------|--------|
| VS Code | ✅ Primary |
| VSCodium | ✅ Compatible |
| Cursor AI | ✅ Compatible |
| Windsurf | ✅ Compatible |

---

## Color Theme

| Role | Color |
|------|-------|
| Primary | `#7C3AED` |
| Accent | `#22D3EE` |
| Background | Dark editor theme |

---

## Development

```bash
# Install dependencies
npm install

# Build extension + webview
npm run build:all

# Watch mode (extension only)
npm run watch
```

---

## License

ISC