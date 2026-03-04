import { ScanResult, FileInfo, FunctionInfo } from './scanner';

export interface FlowStep {
  functionName: string;
  fileName: string;
  filePath: string;
  lineNumber: number;
  description: string;
  calls: string[];
}

export interface FlowResult {
  query: string;
  steps: FlowStep[];
  mermaidDiagram: string;
  found: boolean;
}

export class FlowAnalyzer {
  analyzeFlow(scanResult: ScanResult, query: string): FlowResult {
    if (!query.trim()) {
      return {
        query,
        steps: [],
        mermaidDiagram: '',
        found: false,
      };
    }

    // Find relevant functions based on query
    const keywords = this._extractKeywords(query);
    const matchingFunctions = this._findMatchingFunctions(scanResult.files, keywords);

    if (matchingFunctions.length === 0) {
      return {
        query,
        steps: [],
        mermaidDiagram: '',
        found: false,
      };
    }

    // Build call chain
    const steps = this._buildCallChain(matchingFunctions, scanResult.files);

    // Generate Mermaid diagram
    const mermaidDiagram = this._generateFlowMermaid(steps);

    return {
      query,
      steps,
      mermaidDiagram,
      found: steps.length > 0,
    };
  }

  private _extractKeywords(query: string): string[] {
    const stopWords = new Set([
      'how', 'does', 'the', 'what', 'where', 'is', 'are', 'work', 'works',
      'working', 'a', 'an', 'in', 'of', 'to', 'for', 'with', 'this', 'that',
      'do', 'can', 'show', 'me', 'find', 'explain', 'tell', 'about',
    ]);

    return query
      .toLowerCase()
      .replace(/[?!.,]/g, '')
      .split(/\s+/)
      .filter((w) => !stopWords.has(w) && w.length > 2);
  }

  private _findMatchingFunctions(
    files: FileInfo[],
    keywords: string[]
  ): { func: FunctionInfo; file: FileInfo }[] {
    const matches: { func: FunctionInfo; file: FileInfo; score: number }[] = [];

    for (const file of files) {
      for (const func of file.functions) {
        let score = 0;
        const funcNameLower = func.name.toLowerCase();
        const fileNameLower = file.fileName.toLowerCase();

        for (const keyword of keywords) {
          // Function name match
          if (funcNameLower.includes(keyword)) score += 10;
          if (funcNameLower === keyword) score += 20;

          // File name match
          if (fileNameLower.includes(keyword)) score += 5;

          // Import/path match
          if (file.relativePath.toLowerCase().includes(keyword)) score += 3;
        }

        if (score > 0) {
          matches.push({ func, file, score });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 10);
  }

  private _buildCallChain(
    matchingFunctions: { func: FunctionInfo; file: FileInfo }[],
    allFiles: FileInfo[]
  ): FlowStep[] {
    const steps: FlowStep[] = [];
    const visited = new Set<string>();

    // Start from the highest-scoring match
    const start = matchingFunctions[0];
    this._traceCallChain(start.func, start.file, allFiles, steps, visited, 0);

    return steps;
  }

  private _traceCallChain(
    func: FunctionInfo,
    file: FileInfo,
    allFiles: FileInfo[],
    steps: FlowStep[],
    visited: Set<string>,
    depth: number
  ) {
    if (depth > 8 || visited.has(`${file.relativePath}:${func.name}`)) return;
    visited.add(`${file.relativePath}:${func.name}`);

    steps.push({
      functionName: func.name,
      fileName: file.fileName,
      filePath: file.filePath,
      lineNumber: func.lineNumber,
      description: this._describeFunction(func, file),
      calls: func.calls,
    });

    // Follow calls
    for (const callName of func.calls) {
      // Find called function in same file or other files
      let foundFunc: FunctionInfo | null = null;
      let foundFile: FileInfo | null = null;

      // Check same file first
      const sameFileFunc = file.functions.find((f) => f.name === callName);
      if (sameFileFunc) {
        foundFunc = sameFileFunc;
        foundFile = file;
      } else {
        // Check imported files
        for (const otherFile of allFiles) {
          const otherFunc = otherFile.functions.find((f) => f.name === callName);
          if (otherFunc) {
            foundFunc = otherFunc;
            foundFile = otherFile;
            break;
          }
        }
      }

      if (foundFunc && foundFile) {
        this._traceCallChain(foundFunc, foundFile, allFiles, steps, visited, depth + 1);
      }
    }
  }

  private _describeFunction(func: FunctionInfo, file: FileInfo): string {
    const parts: string[] = [];
    parts.push(`${func.name}() in ${file.fileName}`);
    if (func.paramCount > 0) parts.push(`takes ${func.paramCount} parameter(s)`);
    if (func.calls.length > 0) parts.push(`calls ${func.calls.slice(0, 3).join(', ')}`);
    return parts.join(' — ');
  }

  private _generateFlowMermaid(steps: FlowStep[]): string {
    if (steps.length === 0) return '';

    const lines: string[] = ['graph TD'];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const id = `step_${i}`;
      const label = `${step.functionName}\\n${step.fileName}`;
      lines.push(`  ${id}["${label}"]`);

      if (i > 0) {
        lines.push(`  step_${i - 1} --> ${id}`);
      }
    }

    // Style
    lines.push('');
    lines.push('  classDef entry fill:#7C3AED,stroke:#5B21B6,color:#fff');
    lines.push('  classDef step fill:#1E293B,stroke:#334155,color:#E2E8F0');
    if (steps.length > 0) {
      lines.push('  class step_0 entry');
      for (let i = 1; i < steps.length; i++) {
        lines.push(`  class step_${i} step`);
      }
    }

    return lines.join('\n');
  }
}
