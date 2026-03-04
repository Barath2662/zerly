import React from 'react';

interface LoadingOverlayProps {
  feature: string;
}

const loadingMessages: Record<string, string> = {
  analyze: 'Scanning your codebase...',
  architecture: 'Mapping architecture...',
  risk: 'Analyzing code risks...',
  featureFlow: 'Tracing feature flow...',
  explain: 'Understanding this code...',
  learning: 'Building your learning roadmap...',
  chat: 'Thinking...',
};

export function LoadingOverlay({ feature }: LoadingOverlayProps) {
  const message = loadingMessages[feature] || 'Working on it...';

  return (
    <div className="loading-overlay">
      <div className="loading-card glass-card">
        <div className="loading-spinner">
          <div className="spinner-ring" />
        </div>
        <p className="loading-message">{message}</p>
        <div className="loading-dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      </div>
    </div>
  );
}
