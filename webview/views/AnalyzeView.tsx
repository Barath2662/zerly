import React from "react";
import { BackButton } from "../components/BackButton";

interface AnalyzeViewProps {
  data: any;
  onNavigate: (view: string) => void;
  onRefresh: () => void;
  isCached?: boolean;
}

export function AnalyzeView({ data, onNavigate, onRefresh, isCached }: AnalyzeViewProps) {
  if (!data) {
    return (
      <div className="view-container">
        <div className="view-header">
          <BackButton onNavigate={onNavigate} />
        </div>
        <div className="empty-state">
          <i className="codicon codicon-search empty-icon" />
          <h2>Analyze Project</h2>
          <p>Scan your codebase to detect frameworks, dependencies, and architecture.</p>
          <button className="action-btn primary" onClick={onRefresh}>
            <i className="codicon codicon-play" />
            <span>Start Analysis</span>
          </button>
        </div>
      </div>
    );
  }

  const { scanResult, graph, aiSummary } = data;

  return (
    <div className="view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
        <div className="header-actions">
          <button className="icon-btn" onClick={onRefresh} title="Re-analyze project">
            <i className="codicon codicon-refresh" />
          </button>
          {isCached && (
            <span className="header-badge cached">
              <i className="codicon codicon-history" /> Cached
            </span>
          )}
          <span className="header-badge">
            <i className="codicon codicon-check" /> Done
          </span>
        </div>
      </div>

      <div className="view-title-bar">
        <i className="codicon codicon-search" />
        <h2>Project Analysis</h2>
      </div>

      {aiSummary && (
        <div className="info-panel">
          <i className="codicon codicon-sparkle info-panel-icon" />
          <p>{aiSummary}</p>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-value">{scanResult.totalFiles}</span>
          <span className="stat-label">Files</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{scanResult.totalLines.toLocaleString()}</span>
          <span className="stat-label">Lines</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{scanResult.frameworks.length}</span>
          <span className="stat-label">Frameworks</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{Object.keys(scanResult.languages).length}</span>
          <span className="stat-label">Languages</span>
        </div>
      </div>

      {scanResult.frameworks.length > 0 && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-tools" />
            <span>FRAMEWORKS & TOOLS</span>
          </div>
          <div className="tag-list">
            {scanResult.frameworks.map((fw: string) => (
              <span key={fw} className="tag">{fw}</span>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <div className="section-label-row">
          <i className="codicon codicon-pie-chart" />
          <span>LANGUAGES</span>
        </div>
        <div className="lang-bars">
          {Object.entries(scanResult.languages)
            .sort(([, a]: any, [, b]: any) => b - a)
            .slice(0, 8)
            .map(([lang, lines]: [string, any]) => {
              const pct = Math.round((lines / scanResult.totalLines) * 100);
              return (
                <div key={lang} className="lang-bar-item">
                  <div className="lang-bar-label">
                    <span>{lang}</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="lang-bar-track">
                    <div className="lang-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {graph?.layers && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-type-hierarchy" />
            <span>ARCHITECTURE LAYERS</span>
          </div>
          {graph.layers.map((layer: any) => (
            <div key={layer.name} className="layer-item">
              <div className="layer-header">
                <strong>{layer.name}</strong>
                <span className="count-badge">{layer.files.length}</span>
              </div>
              <p className="layer-desc">{layer.description}</p>
            </div>
          ))}
        </div>
      )}

      {Object.keys(scanResult.dependencies).length > 0 && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-package" />
            <span>DEPENDENCIES</span>
            <span className="count-badge">{Object.keys(scanResult.dependencies).length}</span>
          </div>
          <div className="tag-list">
            {Object.keys(scanResult.dependencies).slice(0, 20).map((dep: string) => (
              <span key={dep} className="tag tag-dep">{dep}</span>
            ))}
            {Object.keys(scanResult.dependencies).length > 20 && (
              <span className="tag tag-more">+{Object.keys(scanResult.dependencies).length - 20} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
