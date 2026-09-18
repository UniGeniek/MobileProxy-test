import React, { useState } from 'react';
import { api } from '../api';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await api.login(username, password);
      onLogin(data.user);
    } catch (err) {
      setError(err.data?.message || 'Login failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-card__title">🔐 DataCenter</div>
        <div className="login-card__subtitle">Proxy Management System</div>

        {error && <div className="login-error">{error}</div>}

        <div className="form-group">
          <label className="form-group__label" htmlFor="login-username">Username</label>
          <input
            id="login-username"
            className="form-group__input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter username"
            autoComplete="username"
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label className="form-group__label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            className="form-group__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            autoComplete="current-password"
            required
          />
        </div>

        <button
          type="submit"
          className="btn btn--primary login-btn"
          disabled={loading || !username || !password}
        >
          {loading ? <><span className="spinner" /> Signing in...</> : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
