import { ScanResult, FileInfo } from './scanner';

export interface RiskItem {
  filePath: string;
  relativePath: string;
  fileName: string;
  riskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reasons: RiskReason[];
}

export interface RiskReason {
  type: string;
  description: string;
  severity: number; // 0-25
}

export interface RiskReport {
  items: RiskItem[];
  summary: string;
  overallHealth: number; // 0-100 (100 = healthy)
}

export class RiskAnalyzer {
  analyze(scanResult: ScanResult): RiskReport {
    const items: RiskItem[] = [];

    for (const file of scanResult.files) {
      // Skip non-code config files
      if (['.json', '.yaml', '.yml', '.toml', '.xml', '.md', '.css', '.scss', '.less'].includes(file.extension)) {
        continue;
      }

      const reasons: RiskReason[] = [];
      let riskScore = 0;

      // Check file size (lines)
      if (file.lineCount > 500) {
        const severity = Math.min(25, Math.floor((file.lineCount - 500) / 50));
        reasons.push({
          type: 'large-file',
          description: `File has ${file.lineCount} lines. Large files are harder to maintain.`,
          severity,
        });
        riskScore += severity;
      }

      // Check dependency count
      if (file.imports.length > 15) {
        const severity = Math.min(20, (file.imports.length - 15) * 2);
        reasons.push({
          type: 'many-dependencies',
          description: `File imports ${file.imports.length} modules. High coupling detected.`,
          severity,
        });
        riskScore += severity;
      }

      // Check function count  
      if (file.functions.length > 20) {
        const severity = Math.min(15, file.functions.length - 20);
        reasons.push({
          type: 'many-functions',
          description: `File contains ${file.functions.length} functions. May need decomposition.`,
          severity,
        });
        riskScore += severity;
      }

      // Check for large functions
      const largeFunctions = file.functions.filter((f) => f.lineLength > 50);
      if (largeFunctions.length > 0) {
        const severity = Math.min(20, largeFunctions.length * 5);
        const names = largeFunctions.map((f) => f.name).join(', ');
        reasons.push({
          type: 'large-functions',
          description: `Functions too long: ${names}. Consider breaking them down.`,
          severity,
        });
        riskScore += severity;
      }

      // Check cyclomatic complexity (approximation via function calls)
      const complexFunctions = file.functions.filter((f) => f.calls.length > 10);
      if (complexFunctions.length > 0) {
        const severity = Math.min(20, complexFunctions.length * 4);
        reasons.push({
          type: 'high-complexity',
          description: `${complexFunctions.length} function(s) with high call complexity.`,
          severity,
        });
        riskScore += severity;
      }

      // Check for high parameter count functions
      const manyParamFns = file.functions.filter((f) => f.paramCount > 5);
      if (manyParamFns.length > 0) {
        const severity = Math.min(10, manyParamFns.length * 3);
        reasons.push({
          type: 'many-params',
          description: `${manyParamFns.length} function(s) with >5 parameters. Consider using objects.`,
          severity,
        });
        riskScore += severity;
      }

      riskScore = Math.min(100, riskScore);

      if (reasons.length > 0) {
        items.push({
          filePath: file.filePath,
          relativePath: file.relativePath,
          fileName: file.fileName,
          riskScore,
          riskLevel: this._scoreToLevel(riskScore),
          reasons,
        });
      }
    }

    // Sort by risk score descending
    items.sort((a, b) => b.riskScore - a.riskScore);

    const overallHealth = this._calculateOverallHealth(items, scanResult.files.length);
    const summary = this._generateSummary(items, overallHealth);

    return { items, summary, overallHealth };
  }

  private _scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
    if (score >= 70) return 'critical';
    if (score >= 45) return 'high';
    if (score >= 20) return 'medium';
    return 'low';
  }

  private _calculateOverallHealth(items: RiskItem[], totalFiles: number): number {
    if (totalFiles === 0) return 100;
    const totalRisk = items.reduce((sum, item) => sum + item.riskScore, 0);
    const avgRisk = totalRisk / totalFiles;
    return Math.max(0, Math.round(100 - avgRisk));
  }

  private _generateSummary(items: RiskItem[], overallHealth: number): string {
    const critical = items.filter((i) => i.riskLevel === 'critical').length;
    const high = items.filter((i) => i.riskLevel === 'high').length;
    const medium = items.filter((i) => i.riskLevel === 'medium').length;

    if (critical === 0 && high === 0 && medium === 0) {
      return "Looking good! No significant risk areas detected. Your codebase is well-structured.";
    }

    const parts: string[] = [];
    if (critical > 0) parts.push(`${critical} critical`);
    if (high > 0) parts.push(`${high} high-risk`);
    if (medium > 0) parts.push(`${medium} medium-risk`);

    const topRisks = items.slice(0, 3).map((i) => i.fileName).join(', ');

    return `Found ${parts.join(', ')} module(s). Top concerns: ${topRisks}. Overall health: ${overallHealth}%.`;
  }
}
