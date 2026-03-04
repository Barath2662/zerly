import React, { useRef, useEffect } from "react";
import { BackButton } from "../components/BackButton";

interface ArchitectureViewProps {
  data: any;
  onRequest: () => void;
  onNavigate: (view: string) => void;
}

export function ArchitectureView({ data, onRequest, onNavigate }: ArchitectureViewProps) {
  const mermaidRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data?.mermaidDiagram && mermaidRef.current) {
      mermaidRef.current.querySelector(".mermaid-code")?.setAttribute("data-rendered", "true");
    }
  }, [data]);

  if (!data) {
    return (
      <div className="view-container">
        <div className="view-header">
          <BackButton onNavigate={onNavigate} />
        </div>
        <div className="empty-state">
          <i className="codicon codicon-type-hierarchy empty-icon" />
          <h2>Architecture Map</h2>
          <p>Visualize your project dependency graph and layer structure.</p>
          <button className="primary-btn" onClick={onRequest}>
            <i className="codicon codicon-run" />
            Generate Map
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
        <div className="header-actions">
          <button className="icon-btn" onClick={onRequest} title="Refresh">
            <i className="codicon codicon-refresh" />
          </button>
        </div>
      </div>

      <div className="view-title-bar">
        <i className="codicon codicon-type-hierarchy" />
        <h2>Architecture Map</h2>
      </div>

      <div className="code-panel" ref={mermaidRef}>
        <div className="code-panel-header">
          <i className="codicon codicon-symbol-class" />
          <span>Mermaid Diagram</span>
        </div>
        <pre className="mermaid-code">{data.mermaidDiagram}</pre>
      </div>

      {data.graph?.layers && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-layers" />
            <span>LAYERS</span>
          </div>
          {data.graph.layers.map((layer: any) => (
            <div key={layer.name} className="layer-item">
              <div className="layer-header">
                <strong>{layer.name}</strong>
                <span className="count-badge">{layer.files.length}</span>
              </div>
              <div className="file-tags">
                {layer.files.slice(0, 5).map((f: string) => (
                  <span key={f} className="file-tag">{f.split(/[/\\]/).pop()}</span>
                ))}
                {layer.files.length > 5 && (
                  <span className="file-tag file-more">+{layer.files.length - 5}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
