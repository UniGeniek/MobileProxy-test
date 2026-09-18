import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { getSocket } from '../socket';
import ProxyTable from '../components/ProxyTable';
import ProxyFilters from '../components/ProxyFilters';

export default function Dashboard({ user, addToast }) {
  const [proxies, setProxies] = useState([]);
  const [groups, setGroups] = useState([]);
  const [status, setStatus] = useState(null);
  const [filters, setFilters] = useState({ search: '', groupId: '', status: '' });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());

  const fetchProxies = useCallback(async () => {
    try {
      const data = await api.getProxies(filters);
      setProxies(data.proxies);
    } catch (err) {
      if (err.status !== 401) {
        addToast('error', 'Error', 'Failed to load proxies');
      }
    }
  }, [filters, addToast]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
    } catch {}
  }, []);

  const fetchGroups = useCallback(async () => {
    try {
      const data = await api.getGroups();
      setGroups(data.groups || []);
    } catch {}
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchProxies(), fetchStatus(), fetchGroups()]);
      setLoading(false);
    };
    load();
  }, [fetchProxies, fetchStatus, fetchGroups]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchProxies();
      fetchStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchProxies, fetchStatus]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleProxyUpdate = (data) => {
      setProxies(prev => prev.map(p => {
        if (p.id === data.proxyId) {
          return {
            ...p,
            status: data.status,
            current_ip: data.currentIp || p.current_ip,
            last_reset: data.lastReset || p.last_reset,
          };
        }
        return p;
      }));
    };

    const handleProxyStatus = (data) => {
      setProxies(prev => prev.map(p => {
        if (p.id === data.proxyId) {
          return { ...p, status: data.status, current_ip: data.currentIp || p.current_ip };
        }
        return p;
      }));
      fetchStatus();
    };

    socket.on('proxy:updated', handleProxyUpdate);
    socket.on('proxy:status', handleProxyStatus);

    return () => {
      socket.off('proxy:updated', handleProxyUpdate);
      socket.off('proxy:status', handleProxyStatus);
    };
  }, [fetchStatus]);

  const handleReset = async (port) => {
    setProxies(prev => prev.map(p =>
      p.port === port ? { ...p, status: 'resetting' } : p
    ));

    try {
      const result = await api.resetProxy(port);
      addToast('info', 'Reset Queued', `Port ${port} — reset in progress`);
      return result;
    } catch (err) {
      setProxies(prev => prev.map(p =>
        p.port === port ? { ...p, status: 'error' } : p
      ));
      const msg = err.data?.message || 'Reset failed';
      addToast('error', 'Reset Error', `Port ${port}: ${msg}`);
      throw err;
    }
  };

  const handleBulkReset = async () => {
    if (selected.size === 0) return;
    const ports = Array.from(selected).map(id => {
      const p = proxies.find(px => px.id === id);
      return p?.port;
    }).filter(Boolean);

    try {
      const result = await api.bulkReset(ports);
      const queued = result.results.filter(r => r.status === 'queued').length;
      const failed = result.results.filter(r => r.error).length;
      addToast('info', 'Bulk Reset', `${queued} queued, ${failed} failed`);
      setSelected(new Set());
      await fetchProxies();
    } catch (err) {
      addToast('error', 'Bulk Reset Failed', err.data?.message || 'Error');
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === proxies.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(proxies.map(p => p.id)));
    }
  };

  if (loading) {
    return <div className="loading"><span className="spinner" /> Loading...</div>;
  }

  return (
    <>
      {status && (
        <div className="stats-grid">
          <div className="stat-card stat-card--total">
            <div className="stat-card__label">Total Proxies</div>
            <div className="stat-card__value">{status.proxies?.total || 0}</div>
          </div>
          <div className="stat-card stat-card--online">
            <div className="stat-card__label">Online</div>
            <div className="stat-card__value">{status.proxies?.online || 0}</div>
          </div>
          <div className="stat-card stat-card--offline">
            <div className="stat-card__label">Offline</div>
            <div className="stat-card__value">{status.proxies?.offline || 0}</div>
          </div>
          <div className="stat-card stat-card--resetting">
            <div className="stat-card__label">Resetting</div>
            <div className="stat-card__value">{status.proxies?.resetting || 0}</div>
          </div>
          <div className="stat-card stat-card--errors">
            <div className="stat-card__label">Errors</div>
            <div className="stat-card__value">{status.proxies?.errors || 0}</div>
          </div>
          <div className="stat-card stat-card--connections">
            <div className="stat-card__label">Connections</div>
            <div className="stat-card__value">{status.proxies?.totalConnections || 0}</div>
          </div>
        </div>
      )}

      <ProxyFilters filters={filters} groups={groups} onFilterChange={setFilters} />

      {selected.size > 0 && (
        <div className="toolbar" style={{ marginBottom: '0.5rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>
            {selected.size} selected
          </span>
          <button className="btn btn--bulk btn--sm" onClick={handleBulkReset}>
            ↻ Reset Selected ({selected.size})
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <ProxyTable
        proxies={proxies}
        selected={selected}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onReset={handleReset}
      />
    </>
  );
}
