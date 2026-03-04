import React from 'react';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div className="error-banner">
      <span className="error-icon">⚠</span>
      <span className="error-text">{message}</span>
      <button className="error-dismiss" onClick={onDismiss}>✕</button>
    </div>
  );
}
