import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
import { api } from './api';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import Login from './components/Login';
import Toast from './components/Toast';
import Layout from './components/Layout';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Proxies = lazy(() => import('./pages/Proxies'));
const Billing = lazy(() => import('./pages/Billing'));

export default function App() {
  const [authenticated, setAuthenticated] = useState(api.isAuthenticated());
  const [user, setUser] = useState(api.getUser());
  const [currentView, setCurrentView] = useState('proxies');
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const addToast = useCallback((type, title, message, duration = 5000) => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { id, type, title, message }]);
    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (authenticated) {
      const token = localStorage.getItem('accessToken');
      const socket = connectSocket(token);

      socket.on('reset:complete', (data) => {
        if (data.success) {
          addToast('success', 'Reset Complete',
            `Port ${data.port}: IP changed to ${data.newIp || 'unknown'}${!data.ipChanged ? ' (IP unchanged)' : ''}`);
        } else {
          addToast('error', 'Reset Failed', `Port ${data.port}: ${data.error}`);
        }
      });

      return () => { disconnectSocket(); };
    }
  }, [authenticated, addToast]);

  const handleLogin = (userData) => {
    setUser(userData);
    setAuthenticated(true);
    addToast('success', 'Welcome', `Logged in as ${userData.username}`);
  };

  const handleLogout = async () => {
    await api.logout();
    disconnectSocket();
    setAuthenticated(false);
    setUser(null);
  };

  if (!authenticated) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <Toast toasts={toasts} onRemove={removeToast} />
      </>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <Dashboard addToast={addToast} />;
      case 'billing': return <Billing addToast={addToast} />;
      case 'proxies': 
      default:
        return <Proxies user={user} addToast={addToast} />;
    }
  };

  return (
    <div className="app-container">
      <Layout 
        user={user} 
        currentView={currentView} 
        onViewChange={setCurrentView} 
        onLogout={handleLogout}
      >
        <Suspense fallback={<div className="p-xl text-center text-muted">Loading module...</div>}>
          {renderView()}
        </Suspense>
      </Layout>
      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
