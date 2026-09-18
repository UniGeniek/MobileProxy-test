import React from 'react';
import StatusBadge from './StatusBadge';
import ResetButton from './ResetButton';

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return formatTime(isoStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) + ' ' + formatTime(isoStr);
}

export default function ProxyTable({ proxies, selected, onToggleSelect, onToggleSelectAll, onReset }) {
  if (!proxies.length) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon">📡</div>
        <div className="empty-state__text">No proxies found</div>
      </div>
    );
  }

  const allSelected = selected.size === proxies.length && proxies.length > 0;

  return (
    <div className="proxy-table-wrap">
      <table className="proxy-table">
        <thead>
          <tr>
            <th className="th-checkbox">
              <input
                type="checkbox"
                className="checkbox"
                checked={allSelected}
                onChange={onToggleSelectAll}
              />
            </th>
            <th>Port</th>
            <th>IP Address</th>
            <th>Status</th>
            <th>Group</th>
            <th>Connections</th>
            <th>Last Reset</th>
            <th>Last IP Change</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {proxies.map(proxy => (
            <tr key={proxy.id} className={selected.has(proxy.id) ? 'selected' : ''}>
              <td style={{ textAlign: 'center' }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={selected.has(proxy.id)}
                  onChange={() => onToggleSelect(proxy.id)}
                />
              </td>
              <td>
                <span className="proxy-table__port">{proxy.port}</span>
              </td>
              <td>
                {proxy.current_ip ? (
                  <span className="proxy-table__ip">{proxy.current_ip}</span>
                ) : (
                  <span className="proxy-table__ip proxy-table__ip--none">No IP</span>
                )}
              </td>
              <td>
                <StatusBadge
                  status={proxy.status}
                  tooltip={proxy.error_message || ''}
                />
              </td>
              <td>
                {proxy.group_name ? (
                  <span className="proxy-table__group">{proxy.group_name}</span>
                ) : '—'}
              </td>
              <td>
                <span className="proxy-table__connections">{proxy.connections || 0}</span>
              </td>
              <td>
                <span className="proxy-table__time">{formatDate(proxy.last_reset)}</span>
              </td>
              <td>
                <span className="proxy-table__time">{formatDate(proxy.last_ip_change)}</span>
              </td>
              <td>
                <ResetButton proxy={proxy} onReset={onReset} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
