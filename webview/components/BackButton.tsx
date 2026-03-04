import React from 'react';

interface BackButtonProps {
  onNavigate: (view: string) => void;
}

export function BackButton({ onNavigate }: BackButtonProps) {
  return (
    <button className="back-btn" onClick={() => onNavigate('home')}>
      <i className="codicon codicon-chevron-left" />
      <span>Home</span>
    </button>
  );
}
