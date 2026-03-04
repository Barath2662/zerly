import React, { useState, useEffect } from "react";
import { BackButton } from "../components/BackButton";

interface FeatureFlowViewProps {
  data: any;
  onRequest: (query: string) => void;
  onNavigate: (view: string) => void;
}

export function FeatureFlowView({ data, onRequest, onNavigate }: FeatureFlowViewProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) onRequest(query.trim());
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (query.trim()) onRequest(query.trim());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [query, onRequest]);

  return (
    <div className="view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
      </div>

      <div className="view-title-bar">
        <i className="codicon codicon-git-branch" />
        <h2>Feature Flow</h2>
      </div>

      <div className="info-panel">
        <i className="codicon codicon-info info-panel-icon" />
        <p>Describe a feature and Zerly will trace the call chain through your codebase.</p>
      </div>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-input-wrap">
          <i className="codicon codicon-search search-input-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="e.g. How does login work?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <button type="submit" className="primary-btn" disabled={!query.trim()}>
          <i className="codicon codicon-run" />
          Trace
          <span className="shortcut-badge">⌘↵</span>
        </button>
      </form>

      {data && !data.found && (
        <div className="empty-state" style={{ padding: "24px 16px" }}>
          <i className="codicon codicon-question empty-icon" />
          <h3>No matching flow found</h3>
          <p>Try keywords like "authentication", "payment", or "user signup".</p>
        </div>
      )}

      {data && data.found && (
        <>
          <div className="detail-section">
            <div className="section-label-row">
              <i className="codicon codicon-list-tree" />
              <span>CALL CHAIN · {data.query}</span>
            </div>
            <div className="flow-chain">
              {data.steps.map((step: any, i: number) => (
                <div key={i} className="flow-step">
                  <div className="flow-connector">
                    <div className="flow-dot" />
                    {i < data.steps.length - 1 && <div className="flow-line" />}
                  </div>
                  <div className="flow-step-body">
                    <div className="flow-step-header">
                      <code className="flow-fn">{step.functionName}()</code>
                      <span className="file-tag">{step.fileName}</span>
                    </div>
                    <p className="flow-step-desc">{step.description}</p>
                    {step.calls.length > 0 && (
                      <div className="flow-calls">
                        <span className="calls-label">calls:</span>
                        {step.calls.slice(0, 5).map((c: string) => (
                          <code key={c} className="call-tag">{c}()</code>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.mermaidDiagram && (
            <div className="detail-section">
              <div className="section-label-row">
                <i className="codicon codicon-symbol-class" />
                <span>FLOW DIAGRAM</span>
              </div>
              <pre className="mermaid-code">{data.mermaidDiagram}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
