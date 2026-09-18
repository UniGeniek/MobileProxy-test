import React from 'react';

const STATUS_MAP = {
  online: { label: 'Online', class: 'online' },
  offline: { label: 'Offline', class: 'offline' },
  resetting: { label: 'Resetting', class: 'resetting' },
  error: { label: 'Error', class: 'error' },
  idle: { label: 'Idle', class: 'idle' },
  checking: { label: 'Checking', class: 'checking' },
  cooldown: { label: 'Cooldown', class: 'cooldown' },
  no_ip_change: { label: 'No IP Change', class: 'no_ip_change' },
};

export default function StatusBadge({ status, tooltip }) {
  const info = STATUS_MAP[status] || STATUS_MAP.idle;

  return (
    <span className={`status-badge status-badge--${info.class}`} title={tooltip || ''}>
      <span className="status-badge__dot" />
      {info.label}
    </span>
  );
}
