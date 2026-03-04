import React from "react";
import { BackButton } from "../components/BackButton";

interface LearningViewProps {
  data: any;
  onNavigate: (view: string) => void;
}

export function LearningView({ data, onNavigate }: LearningViewProps) {
  if (!data) {
    return (
      <div className="view-container">
        <div className="view-header">
          <BackButton onNavigate={onNavigate} />
        </div>
        <div className="empty-state">
          <i className="codicon codicon-book empty-icon" />
          <h2>Learning Roadmap</h2>
          <p>Open a project and run an analysis to generate a personalised learning path.</p>
        </div>
      </div>
    );
  }

  const { summary, skills = [], roadmap = [], resources = [] } = data;

  return (
    <div className="view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
      </div>

      <div className="view-title-bar">
        <i className="codicon codicon-book" />
        <h2>Learning Roadmap</h2>
      </div>

      {summary && (
        <div className="info-panel">
          <i className="codicon codicon-info info-icon" />
          <p>{summary}</p>
        </div>
      )}

      {skills.length > 0 && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-star-empty" />
            <span>SKILL GAPS</span>
            <span className="count-badge">{skills.length}</span>
          </div>
          <div className="tag-list">
            {skills.map((s: string, i: number) => (
              <span key={i} className="tag tag-skill">{s}</span>
            ))}
          </div>
        </div>
      )}

      {roadmap.length > 0 && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-list-tree" />
            <span>ROADMAP</span>
          </div>
          {roadmap.map((step: any, i: number) => (
            <div key={i} className="roadmap-step">
              <div className="roadmap-step-header">
                <span className="roadmap-num">{i + 1}</span>
                <span className="roadmap-title">{step.title ?? step}</span>
              </div>
              {step.desc && <p className="roadmap-desc">{step.desc}</p>}
            </div>
          ))}
        </div>
      )}

      {resources.length > 0 && (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-link-external" />
            <span>RESOURCES</span>
          </div>
          {resources.map((r: any, i: number) => (
            <div key={i} className="resource-item">
              <i className="codicon codicon-link resource-icon" />
              <div>
                <div className="resource-title">{r.title ?? r}</div>
                {r.url && <div className="resource-url">{r.url}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
