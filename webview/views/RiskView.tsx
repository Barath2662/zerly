import React from "react";
import { BackButton } from "../components/BackButton";

interface RiskViewProps {
  data: any;
  onRequest: () => void;
  onNavigate: (view: string) => void;
}

const riskColors: Record<string, string> = {
  critical: "#f14c4c",
  high: "#cca700",
  medium: "#3794ff",
  low: "#89d185",
};

export function RiskView({ data, onRequest, onNavigate }: RiskViewProps) {
  if (!data) {
    return (
      <div className="view-container">
        <div className="view-header">
          <BackButton onNavigate={onNavigate} />
        </div>
        <div className="empty-state">
          <i className="codicon codicon-warning empty-icon" />
          <h2>Risk Scanner</h2>
          <p>Analyze your codebase for complexity and fragility hotspots.</p>
          <button className="primary-btn" onClick={onRequest}>
            <i className="codicon codicon-run" />
            Run Scanner
          </button>
        </div>
      </div>
    );
  }

  const { risks } = data;

  return (
    <div className="view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
        <div className="header-actions">
          <button className="icon-btn" onClick={onRequest} title="Re-scan">
            <i className="codicon codicon-refresh" />
          </button>
        </div>
      </div>

      <div className="view-title-bar">
        <i className="codicon codicon-warning" />
        <h2>Risk Scanner</h2>
      </div>

      <div className="health-bar-panel">
        <div className="health-bar-row">
          <span className="health-label">Project Health</span>
          <span className="health-pct">{risks.overallHealth}%</span>
        </div>
        <div className="health-track">
          <div
            className="health-fill"
            style={{
              width: `${risks.overallHealth}%`,
              backgroundColor:
                risks.overallHealth >= 80 ? "#89d185" :
                risks.overallHealth >= 60 ? "#cca700" : "#f14c4c",
            }}
          />
        </div>
      </div>

      {risks.summary && (
        <div className="info-panel">
          <i className="codicon codicon-info info-panel-icon" />
          <p>{risks.summary}</p>
        </div>
      )}

      <div className="section-label-row" style={{ padding: "8px 14px 6px" }}>
        <i className="codicon codicon-list-unordered" />
        <span>RISK ITEMS</span>
        <span className="count-badge">{risks.items.length}</span>
      </div>

      {risks.items.length === 0 ? (
        <div className="empty-state" style={{ padding: "20px" }}>
          <i className="codicon codicon-pass empty-icon" />
          <h3>All Clear</h3>
          <p>No significant risks detected.</p>
        </div>
      ) : (
        <div className="risk-list">
          {risks.items.map((item: any, i: number) => (
            <div key={i} className="risk-item">
              <div className="risk-item-header">
                <span className="risk-badge" style={{ backgroundColor: riskColors[item.riskLevel] ?? "#888" }}>
                  {item.riskLevel.toUpperCase()}
                </span>
                <div className="risk-file-info">
                  <span className="risk-filename">{item.fileName}</span>
                  <span className="risk-path">{item.relativePath}</span>
                </div>
                <span className="risk-score">{item.riskScore}<small>/100</small></span>
              </div>
              <div className="risk-reasons">
                {item.reasons.map((r: any, j: number) => (
                  <div key={j} className="risk-reason">
                    <i className="codicon codicon-circle-small" style={{ color: riskColors[item.riskLevel] }} />
                    <span>{r.description}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
