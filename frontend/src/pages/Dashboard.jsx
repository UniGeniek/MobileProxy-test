import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Dashboard({ addToast }) {
  const [stats, setStats] = useState({ online: 0, offline: 0, resetting: 0, total: 0 });
  const [billing, setBilling] = useState(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [statRes, billRes] = await Promise.all([
          api.client.get('/status'),
          api.client.get('/billing')
        ]);
        setStats(statRes.data);
        setBilling(billRes.data);
      } catch (err) {
        addToast('error', 'Error', 'Failed to load dashboard data');
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-page">
      <div className="grid grid-cols-1 md-grid-cols-4 gap-lg mb-xl">
        <div className="card">
          <div className="card__header">
            <h3>Total Proxies</h3>
          </div>
          <div className="card__body">
            <div className="text-4xl font-bold">{stats.total}</div>
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <h3>Online</h3>
          </div>
          <div className="card__body">
            <div className="text-4xl font-bold text-success">{stats.online}</div>
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <h3>Offline</h3>
          </div>
          <div className="card__body">
            <div className="text-4xl font-bold text-danger">{stats.offline}</div>
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <h3>Resetting</h3>
          </div>
          <div className="card__body">
            <div className="text-4xl font-bold text-warning">{stats.resetting}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md-grid-cols-2 gap-lg">
        {billing && (
          <div className="card">
            <div className="card__header">
              <h3>Financial Overview</h3>
            </div>
            <div className="card__body">
              <div className="flex justify-between border-b pb-sm mb-sm border-light">
                <span className="text-muted">Account Status</span>
                <span className={`badge badge--${billing.status === 'active' ? 'success' : 'danger'}`}>
                  {billing.status}
                </span>
              </div>
              <div className="flex justify-between border-b pb-sm mb-sm border-light">
                <span className="text-muted">Current Balance</span>
                <span className={`font-bold ${billing.balance < 5 ? 'text-danger' : 'text-white'}`}>
                  ${parseFloat(billing.balance).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-b pb-sm mb-sm border-light">
                <span className="text-muted">Burn Rate</span>
                <span className="text-white">${billing.burnRate.toFixed(2)}/hour</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Remaining Time</span>
                <span className="text-white">
                  {billing.hoursLeft > 0 ? `~${Math.floor(billing.hoursLeft)} hours` : 'Exhausted'}
                </span>
              </div>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card__header">
            <h3>Recent System Events</h3>
          </div>
          <div className="card__body p-0">
            {/* fake ass stub for events — maybe websocket sends something maybe it doesn't, fuck if I know */}
            <div className="p-4 text-center text-muted">
              <span className="pulse-dot inline-block mr-2" style={{ background: 'var(--accent-cyan)' }}></span>
              Listening for events...
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
