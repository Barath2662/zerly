import { ScanResult, FileInfo } from './scanner';

export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'module' | 'folder' | 'external';
  filePath?: string;
  size?: number;
  layer?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: LayerInfo[];
}

export interface LayerInfo {
  name: string;
  files: string[];
  description: string;
}

export class DependencyGraph {
  build(scanResult: ScanResult): ProjectGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Map<string, GraphNode>();

    // Create nodes for each file
    for (const file of scanResult.files) {
      const layer = this._detectLayer(file);
      const node: GraphNode = {
        id: file.relativePath,
        label: file.fileName,
        type: 'file',
        filePath: file.filePath,
        size: file.lineCount,
        layer,
      };
      nodes.push(node);
      nodeMap.set(file.relativePath, node);
    }

    // Create edges from imports
    for (const file of scanResult.files) {
      for (const imp of file.imports) {
        const resolved = this._resolveImport(imp, file, scanResult.files);
        if (resolved) {
          edges.push({
            source: file.relativePath,
            target: resolved,
          });
        } else if (!imp.startsWith('.') && !imp.startsWith('/')) {
          // External dependency
          const extId = `ext:${imp}`;
          if (!nodeMap.has(extId)) {
            const extNode: GraphNode = {
              id: extId,
              label: imp,
              type: 'external',
            };
            nodes.push(extNode);
            nodeMap.set(extId, extNode);
          }
          edges.push({
            source: file.relativePath,
            target: extId,
          });
        }
      }
    }

    // Detect layers
    const layers = this._detectLayers(scanResult.files);

    return { nodes, edges, layers };
  }

  toMermaid(graph: ProjectGraph): string {
    const lines: string[] = ['graph TD'];

    // Group by layers
    const layerGroups = new Map<string, GraphNode[]>();
    for (const node of graph.nodes) {
      if (node.type === 'external') continue;
      const layer = node.layer || 'Other';
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer)!.push(node);
    }

    // Add subgraphs for layers
    for (const [layer, layerNodes] of layerGroups) {
      const safeLayer = layer.replace(/\s+/g, '_');
      lines.push(`  subgraph ${safeLayer}["${layer}"]`);
      for (const node of layerNodes.slice(0, 15)) {
        const safeId = this._sanitizeId(node.id);
        lines.push(`    ${safeId}["${node.label}"]`);
      }
      if (layerNodes.length > 15) {
        lines.push(`    ${safeLayer}_more["... +${layerNodes.length - 15} more"]`);
      }
      lines.push('  end');
    }

    // Add edges (limit to prevent diagram explosion)
    const addedEdges = new Set<string>();
    let edgeCount = 0;
    for (const edge of graph.edges) {
      if (edgeCount >= 50) break;
      const sourceNode = graph.nodes.find((n) => n.id === edge.source);
      const targetNode = graph.nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) continue;
      if (targetNode.type === 'external') continue;

      const key = `${edge.source}->${edge.target}`;
      if (addedEdges.has(key)) continue;
      addedEdges.add(key);

      const srcId = this._sanitizeId(edge.source);
      const tgtId = this._sanitizeId(edge.target);
      lines.push(`  ${srcId} --> ${tgtId}`);
      edgeCount++;
    }

    // Style layers
    lines.push('');
    lines.push('  classDef frontend fill:#7C3AED,stroke:#5B21B6,color:#fff');
    lines.push('  classDef backend fill:#22D3EE,stroke:#0891B2,color:#000');
    lines.push('  classDef service fill:#10B981,stroke:#059669,color:#fff');
    lines.push('  classDef config fill:#6B7280,stroke:#4B5563,color:#fff');

    return lines.join('\n');
  }

  private _sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
  }

  private _resolveImport(imp: string, fromFile: FileInfo, allFiles: FileInfo[]): string | null {
    if (!imp.startsWith('.') && !imp.startsWith('/')) return null;

    const dir = fromFile.relativePath.replace(/[/\\][^/\\]+$/, '');
    const possiblePaths = [
      `${dir}/${imp}`,
      `${dir}/${imp}.ts`,
      `${dir}/${imp}.tsx`,
      `${dir}/${imp}.js`,
      `${dir}/${imp}.jsx`,
      `${dir}/${imp}/index.ts`,
      `${dir}/${imp}/index.tsx`,
      `${dir}/${imp}/index.js`,
    ];

    for (const p of possiblePaths) {
      const normalized = p.replace(/\\/g, '/').replace(/^\.\//, '');
      const found = allFiles.find(
        (f) => f.relativePath.replace(/\\/g, '/') === normalized
      );
      if (found) return found.relativePath;
    }

    return null;
  }

  private _detectLayer(file: FileInfo): string {
    const rp = file.relativePath.toLowerCase().replace(/\\/g, '/');

    if (rp.includes('component') || rp.includes('page') || rp.includes('view') || rp.includes('screen') || rp.match(/\.(vue|svelte|astro|jsx|tsx)$/)) {
      return 'Frontend / UI';
    }
    if (rp.includes('route') || rp.includes('controller') || rp.includes('api/') || rp.includes('endpoint')) {
      return 'API / Routes';
    }
    if (rp.includes('service') || rp.includes('provider') || rp.includes('usecase')) {
      return 'Service Layer';
    }
    if (rp.includes('model') || rp.includes('schema') || rp.includes('entity') || rp.includes('migration') || rp.includes('database') || rp.includes('prisma')) {
      return 'Data / Database';
    }
    if (rp.includes('middleware') || rp.includes('guard') || rp.includes('interceptor')) {
      return 'Middleware';
    }
    if (rp.includes('util') || rp.includes('helper') || rp.includes('lib/') || rp.includes('common')) {
      return 'Utilities';
    }
    if (rp.includes('config') || rp.includes('.env') || rp.match(/\.(json|yaml|yml|toml)$/)) {
      return 'Configuration';
    }
    if (rp.includes('test') || rp.includes('spec') || rp.includes('__test')) {
      return 'Tests';
    }
    if (rp.includes('style') || rp.includes('.css') || rp.includes('.scss')) {
      return 'Styles';
    }

    return 'Core';
  }

  private _detectLayers(files: FileInfo[]): LayerInfo[] {
    const layerMap = new Map<string, string[]>();

    for (const file of files) {
      const layer = this._detectLayer(file);
      if (!layerMap.has(layer)) layerMap.set(layer, []);
      layerMap.get(layer)!.push(file.relativePath);
    }

    const descriptions: Record<string, string> = {
      'Frontend / UI': 'User interface components and pages',
      'API / Routes': 'Request handlers and API endpoints',
      'Service Layer': 'Business logic and service implementations',
      'Data / Database': 'Data models, schemas, and database access',
      'Middleware': 'Request/response interceptors and guards',
      'Utilities': 'Helper functions and shared utilities',
      'Configuration': 'Config files and environment settings',
      'Tests': 'Test files and specifications',
      'Styles': 'CSS and styling files',
      'Core': 'Core application files',
    };

    return Array.from(layerMap.entries()).map(([name, filesList]) => ({
      name,
      files: filesList,
      description: descriptions[name] || 'Project files',
    }));
  }
}
