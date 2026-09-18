import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { getSocket } from '../socket';

export default function Layout({ user, currentView, onViewChange, onLogout, children }) {
  const [billing, setBilling] = useState(null);
  const [liveBalance, setLiveBalance] = useState(0);

  useEffect(() => {
    const fetchBilling = async () => {
      try {
        const res = await api.client.get('/billing');
        setBilling(res.data);
        setLiveBalance(res.data.balance);
      } catch (err) {
        console.error('Failed to fetch billing info', err);
      }
    };
    fetchBilling();

    const socket = getSocket();
    if (socket) {
      socket.on('billing:update', (data) => {
        setBilling(prev => ({ ...prev, balance: data.balance, status: data.status }));
        setLiveBalance(data.balance);
      });
    }

    return () => {
      if (socket) socket.off('billing:update');
    };
  }, []);

  useEffect(() => {
    if (!billing || billing.burnRate <= 0) return;
    const interval = setInterval(() => {
      setLiveBalance(prev => {
        const newBalance = prev - (billing.burnRate / 3600);
        return newBalance > 0 ? newBalance : 0;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [billing]);

  const navItems = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'proxies', icon: '🌐', label: 'Proxies' },
    { id: 'billing', icon: '💳', label: 'Billing' },
    { id: 'usage', icon: '📈', label: 'Usage' },
    { id: 'settings', icon: '⚙️', label: 'Settings' }
  ];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar__logo">
          <span className="sidebar__logo-icon">⚡</span>
          DataCenter
        </div>
        <nav className="sidebar__nav">
          {navItems.map(item => (
            <button 
              key={item.id}
              className={`sidebar__nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => onViewChange(item.id)}
            >
              <span className="sidebar__icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="sidebar__username">{user?.username}</span>
            <span className={`badge badge--${billing?.status === 'active' ? 'success' : (billing?.status === 'grace' ? 'warning' : 'danger')}`}>
              {billing?.status || user?.role}
            </span>
          </div>
          <button className="btn btn--ghost btn--sm w-full" onClick={onLogout}>
            Logout
          </button>
        </div>
      </aside>

      <div className="layout__main">
        <header className="topbar">
          <div className="topbar__title">
            <h2>{navItems.find(i => i.id === currentView)?.label}</h2>
          </div>
          <div className="topbar__billing">
            {billing && (
              <>
                <div className="topbar__stat">
                  <span className="topbar__stat-label">Live Balance</span>
                  <span className={`topbar__stat-val ${liveBalance < 5 ? 'text-danger' : ''}`}>
                    ${liveBalance.toFixed(4)}
                  </span>
                </div>
                <div className="topbar__stat">
                  <span className="topbar__stat-label">Burn Rate</span>
                  <span className="topbar__stat-val text-muted">
                    ${billing.burnRate.toFixed(2)}/hr
                  </span>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="layout__content">
          {children}
        </div>
      </div>
    </div>
  );
}
