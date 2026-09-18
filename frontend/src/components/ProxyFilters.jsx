import React from 'react';

export default function ProxyFilters({ filters, groups, onFilterChange }) {
  return (
    <div className="toolbar">
      <input
        type="text"
        className="toolbar__search"
        placeholder="Search by port, IP, or router..."
        value={filters.search || ''}
        onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
      />

      <select
        className="toolbar__select"
        value={filters.groupId || ''}
        onChange={(e) => onFilterChange({ ...filters, groupId: e.target.value })}
      >
        <option value="">All Groups</option>
        {groups.map(g => (
          <option key={g.id} value={g.id}>
            {g.name} ({g.proxy_count})
          </option>
        ))}
      </select>

      <select
        className="toolbar__select"
        value={filters.status || ''}
        onChange={(e) => onFilterChange({ ...filters, status: e.target.value })}
      >
        <option value="">All Statuses</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
        <option value="resetting">Resetting</option>
        <option value="error">Error</option>
        <option value="idle">Idle</option>
      </select>
    </div>
  );
}
