import * as fs from 'fs';
import * as path from 'path';

export interface FileInfo {
  filePath: string;
  relativePath: string;
  fileName: string;
  extension: string;
  size: number;
  lineCount: number;
  imports: string[];
  exports: string[];
  functions: FunctionInfo[];
  classes: string[];
}

export interface FunctionInfo {
  name: string;
  lineNumber: number;
  paramCount: number;
  lineLength: number;
  calls: string[];
}

export interface ScanResult {
  rootPath: string;
  files: FileInfo[];
  frameworks: string[];
  languages: Record<string, number>;
  totalFiles: number;
  totalLines: number;
  folderStructure: FolderNode;
  packageJson: any | null;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export interface FolderNode {
  name: string;
  type: 'folder' | 'file';
  children?: FolderNode[];
  fileInfo?: FileInfo;
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', 'env', '.env', 'coverage',
  '.cache', '.parcel-cache', '.turbo', '.svelte-kit',
  'vendor', 'target', 'bin', 'obj', '.idea', '.vscode',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs',
  '.cpp', '.c', '.h', '.cs', '.rb', '.php', '.swift', '.kt',
  '.vue', '.svelte', '.astro', '.html', '.css', '.scss', '.less',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.md',
]);

export class ProjectScanner {
  async scan(rootPath: string): Promise<ScanResult> {
    const files: FileInfo[] = [];
    const languages: Record<string, number> = {};

    const folderStructure = this._buildFolderTree(rootPath, rootPath, files, languages, 0);

    // Detect frameworks
    const frameworks = this._detectFrameworks(rootPath, files);

    // Read package.json
    let packageJson: any = null;
    let dependencies: Record<string, string> = {};
    let devDependencies: Record<string, string> = {};
    const pkgPath = path.join(rootPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        dependencies = packageJson.dependencies || {};
        devDependencies = packageJson.devDependencies || {};
      } catch {}
    }

    const totalLines = files.reduce((sum, f) => sum + f.lineCount, 0);

    return {
      rootPath,
      files,
      frameworks,
      languages,
      totalFiles: files.length,
      totalLines,
      folderStructure,
      packageJson,
      dependencies,
      devDependencies,
    };
  }

  private _buildFolderTree(
    dirPath: string,
    rootPath: string,
    files: FileInfo[],
    languages: Record<string, number>,
    depth: number
  ): FolderNode {
    const dirName = path.basename(dirPath);
    const node: FolderNode = { name: dirName, type: 'folder', children: [] };

    if (depth > 8) return node; // prevent deep recursion

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return node;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.env') continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const childNode = this._buildFolderTree(
          path.join(dirPath, entry.name),
          rootPath,
          files,
          languages,
          depth + 1
        );
        node.children!.push(childNode);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!CODE_EXTENSIONS.has(ext)) continue;

        const filePath = path.join(dirPath, entry.name);
        const fileInfo = this._analyzeFile(filePath, rootPath);
        files.push(fileInfo);

        // Track languages
        const lang = this._extToLanguage(ext);
        languages[lang] = (languages[lang] || 0) + fileInfo.lineCount;

        node.children!.push({
          name: entry.name,
          type: 'file',
          fileInfo,
        });
      }
    }

    return node;
  }

  private _analyzeFile(filePath: string, rootPath: string): FileInfo {
    let content = '';
    let size = 0;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
      size = Buffer.byteLength(content, 'utf-8');
    } catch {
      return {
        filePath,
        relativePath: path.relative(rootPath, filePath),
        fileName: path.basename(filePath),
        extension: path.extname(filePath),
        size: 0,
        lineCount: 0,
        imports: [],
        exports: [],
        functions: [],
        classes: [],
      };
    }

    const lines = content.split('\n');
    const imports = this._extractImports(content);
    const exports = this._extractExports(content);
    const functions = this._extractFunctions(content, lines);
    const classes = this._extractClasses(content);

    return {
      filePath,
      relativePath: path.relative(rootPath, filePath),
      fileName: path.basename(filePath),
      extension: path.extname(filePath),
      size,
      lineCount: lines.length,
      imports,
      exports,
      functions,
      classes,
    };
  }

  private _extractImports(content: string): string[] {
    const imports: string[] = [];
    // ES6 imports
    const esImports = content.matchAll(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g);
    for (const match of esImports) {
      imports.push(match[1]);
    }
    // require
    const requireImports = content.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of requireImports) {
      imports.push(match[1]);
    }
    // Python imports
    const pyImports = content.matchAll(/(?:from\s+(\S+)\s+import|import\s+(\S+))/g);
    for (const match of pyImports) {
      imports.push(match[1] || match[2]);
    }
    return [...new Set(imports)];
  }

  private _extractExports(content: string): string[] {
    const exports: string[] = [];
    const namedExports = content.matchAll(/export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g);
    for (const match of namedExports) {
      exports.push(match[1]);
    }
    return exports;
  }

  private _extractFunctions(content: string, lines: string[]): FunctionInfo[] {
    const functions: FunctionInfo[] = [];
    const patterns = [
      // function declarations
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
      // arrow functions assigned to const/let/var
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g,
      // class methods
      /(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*\w+\s*)?\{/g,
      // Python functions
      /def\s+(\w+)\s*\(([^)]*)\)/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) continue;

        const lineNumber = content.substring(0, match.index).split('\n').length;
        const params = match[2] ? match[2].split(',').filter((p: string) => p.trim()).length : 0;

        // Estimate function length
        let braceCount = 0;
        let funcEnd = lineNumber;
        for (let i = lineNumber - 1; i < lines.length; i++) {
          const line = lines[i];
          braceCount += (line.match(/\{/g) || []).length;
          braceCount -= (line.match(/\}/g) || []).length;
          if (braceCount <= 0 && i > lineNumber - 1) {
            funcEnd = i + 1;
            break;
          }
          if (i === lines.length - 1) funcEnd = i + 1;
        }

        // Extract function calls
        const funcBody = lines.slice(lineNumber - 1, funcEnd).join('\n');
        const calls = this._extractCalls(funcBody, name);

        functions.push({
          name,
          lineNumber,
          paramCount: params,
          lineLength: funcEnd - lineNumber + 1,
          calls,
        });
      }
    }

    // Deduplicate by name
    const seen = new Set<string>();
    return functions.filter((f) => {
      if (seen.has(f.name)) return false;
      seen.add(f.name);
      return true;
    });
  }

  private _extractCalls(content: string, selfName: string): string[] {
    const calls: string[] = [];
    const callPattern = /(?<!\w)(\w+)\s*\(/g;
    let match;
    while ((match = callPattern.exec(content)) !== null) {
      const name = match[1];
      if (
        name !== selfName &&
        !['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'typeof', 'async', 'await', 'function', 'console', 'require', 'import'].includes(name)
      ) {
        calls.push(name);
      }
    }
    return [...new Set(calls)];
  }

  private _extractClasses(content: string): string[] {
    const classes: string[] = [];
    const classPattern = /class\s+(\w+)/g;
    let match;
    while ((match = classPattern.exec(content)) !== null) {
      classes.push(match[1]);
    }
    return classes;
  }

  private _detectFrameworks(rootPath: string, files: FileInfo[]): string[] {
    const frameworks: string[] = [];
    const pkgPath = path.join(rootPath, 'package.json');

    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };

        if (allDeps['react']) frameworks.push('React');
        if (allDeps['next']) frameworks.push('Next.js');
        if (allDeps['vue']) frameworks.push('Vue');
        if (allDeps['nuxt']) frameworks.push('Nuxt');
        if (allDeps['@angular/core']) frameworks.push('Angular');
        if (allDeps['svelte']) frameworks.push('Svelte');
        if (allDeps['express']) frameworks.push('Express');
        if (allDeps['fastify']) frameworks.push('Fastify');
        if (allDeps['koa']) frameworks.push('Koa');
        if (allDeps['nestjs'] || allDeps['@nestjs/core']) frameworks.push('NestJS');
        if (allDeps['tailwindcss']) frameworks.push('Tailwind CSS');
        if (allDeps['prisma'] || allDeps['@prisma/client']) frameworks.push('Prisma');
        if (allDeps['mongoose']) frameworks.push('Mongoose');
        if (allDeps['typeorm']) frameworks.push('TypeORM');
        if (allDeps['electron']) frameworks.push('Electron');
        if (allDeps['vite']) frameworks.push('Vite');
        if (allDeps['webpack']) frameworks.push('Webpack');
      } catch {}
    }

    // Python
    const requirementsTxt = path.join(rootPath, 'requirements.txt');
    if (fs.existsSync(requirementsTxt)) {
      try {
        const content = fs.readFileSync(requirementsTxt, 'utf-8');
        if (content.includes('django')) frameworks.push('Django');
        if (content.includes('flask')) frameworks.push('Flask');
        if (content.includes('fastapi')) frameworks.push('FastAPI');
      } catch {}
    }

    // Go
    const goMod = path.join(rootPath, 'go.mod');
    if (fs.existsSync(goMod)) {
      frameworks.push('Go');
    }

    // Rust
    const cargoToml = path.join(rootPath, 'Cargo.toml');
    if (fs.existsSync(cargoToml)) {
      frameworks.push('Rust');
    }

    return frameworks;
  }

  private _extToLanguage(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript (React)',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript (React)',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.cpp': 'C++',
      '.c': 'C',
      '.h': 'C/C++ Header',
      '.cs': 'C#',
      '.rb': 'Ruby',
      '.php': 'PHP',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.vue': 'Vue',
      '.svelte': 'Svelte',
      '.astro': 'Astro',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.less': 'Less',
      '.json': 'JSON',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.toml': 'TOML',
      '.xml': 'XML',
      '.md': 'Markdown',
    };
    return map[ext] || ext;
  }
}
