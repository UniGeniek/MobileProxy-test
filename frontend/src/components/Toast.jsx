import React from 'react';

export default function Toast({ toasts, onRemove }) {
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠',
  };

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <div key={toast.id} className={`toast toast--${toast.type}`}>
          <span className="toast__icon">{icons[toast.type] || 'ℹ'}</span>
          <div className="toast__body">
            <div className="toast__title">{toast.title}</div>
            {toast.message && <div className="toast__message">{toast.message}</div>}
          </div>
          <button className="toast__close" onClick={() => onRemove(toast.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
