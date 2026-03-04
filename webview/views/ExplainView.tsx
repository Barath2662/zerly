import React from "react";
import { BackButton } from "../components/BackButton";

interface ExplainViewProps {
  data: any;
  onNavigate: (view: string) => void;
}

function formatMarkdown(text: string): string {
  return text
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="inline-code-block"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gms, "<ul>$1</ul>")
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");
}

export function ExplainView({ data, onNavigate }: ExplainViewProps) {
  if (!data) {
    return (
      <div className="view-container">
        <div className="view-header">
          <BackButton onNavigate={onNavigate} />
        </div>
        <div className="empty-state">
          <i className="codicon codicon-lightbulb empty-icon" />
          <h2>Explain Code</h2>
          <p>Select code in your editor, then right-click and choose <strong>Explain with Zerly</strong>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container">
      <div className="view-header">
        <BackButton onNavigate={onNavigate} />
        {data.fileName && (
          <span className="header-file-name">{data.fileName.split(/[/\\]/).pop()}</span>
        )}
      </div>

      <div className="view-title-bar">
        <i className="codicon codicon-lightbulb" />
        <h2>Code Explanation</h2>
      </div>

      {data.code && (
        <div className="code-panel">
          <div className="code-panel-header">
            <i className="codicon codicon-code" />
            <span>Selected Code</span>
            {data.fileName && (
              <span className="code-filename">{data.fileName.split(/[/\\]/).pop()}</span>
            )}
          </div>
          <pre className="code-content">{data.code}</pre>
        </div>
      )}

      {data.explanation ? (
        <div className="detail-section">
          <div className="section-label-row">
            <i className="codicon codicon-sparkle" />
            <span>AI EXPLANATION</span>
          </div>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: formatMarkdown(data.explanation) }}
          />
        </div>
      ) : (
        <div className="loading-inline">
          <i className="codicon codicon-loading codicon-modifier-spin" />
          <span>Analyzing this code...</span>
        </div>
      )}
    </div>
  );
}
