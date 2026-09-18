import React, { useState, useEffect } from 'react';
import { api } from '../api';

export default function Billing({ addToast }) {
  const [billing, setBilling] = useState(null);
  const [logs, setLogs] = useState([]);
  const [topupAmount, setTopupAmount] = useState(10);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [bRes, lRes] = await Promise.all([
        api.client.get('/billing'),
        api.client.get('/billing/history')
      ]);
      setBilling(bRes.data);
      setLogs(lRes.data);
    } catch (err) {
      addToast('error', 'Error', 'Failed to load billing data');
    }
  };

  const handleTopup = async () => {
    if (topupAmount <= 0) return;
    setLoading(true);
    try {
      await api.client.post('/billing/topup', { amount: topupAmount });
      addToast('success', 'Success', `Successfully added $${topupAmount} to your balance`);
      fetchData();
    } catch (err) {
      addToast('error', 'Topup Failed', err.response?.data?.error || 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (!billing) return <div className="p-4 text-muted">Loading billing info...</div>;

  const hoursLeft = billing.hoursLeft > 0 ? billing.hoursLeft : 0;
  const daysLeft = Math.floor(hoursLeft / 24);
  const remainingHours = Math.floor(hoursLeft % 24);

  return (
    <div className="billing-page">
      <div className="grid grid-cols-1 md-grid-cols-3 gap-lg mb-xl">
        <div className="card">
          <div className="card__header">
            <h3>Current Balance</h3>
          </div>
          <div className="card__body">
            <div className={`text-4xl font-bold ${billing.balance < 5 ? 'text-danger' : 'text-primary'}`}>
              ${parseFloat(billing.balance).toFixed(2)}
            </div>
            <div className="mt-sm text-muted">
              Status: <span className="text-white">{billing.status}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Burn Rate</h3>
          </div>
          <div className="card__body">
            <div className="text-4xl font-bold">
              ${billing.burnRate.toFixed(2)} <span className="text-sm text-muted">/ hour</span>
            </div>
            <div className="mt-sm text-muted">
              Active Proxies: <span className="text-white">{billing.activeProxies}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Forecast</h3>
          </div>
          <div className="card__body">
            <div className="text-4xl font-bold">
              {hoursLeft > 0 ? (
                <>~{daysLeft}d {remainingHours}h</>
              ) : (
                <span className="text-danger">Exhausted</span>
              )}
            </div>
            <div className="mt-sm text-muted">
              Time until account suspension
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md-grid-cols-2 gap-lg mb-xl">
        <div className="card">
          <div className="card__header">
            <h3>Top Up Balance (Mock)</h3>
          </div>
          <div className="card__body">
            <div className="flex gap-sm">
              <input
                type="number"
                className="input flex-1"
                value={topupAmount}
                onChange={e => setTopupAmount(Number(e.target.value))}
                min="1" max="1000" step="1"
              />
              <button
                className="btn btn--primary"
                onClick={handleTopup}
                disabled={loading || topupAmount <= 0}
              >
                {loading ? 'Processing...' : 'Top Up Now'}
              </button>
            </div>
            <p className="text-xs text-muted mt-sm">
              This is a development mock. In production, this will redirect to CryptoPay or Stripe.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card__header">
          <h3>Billing History</h3>
        </div>
        <div className="table-responsive">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Balance Before</th>
                <th>Balance After</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan="5" className="text-center text-muted">No transactions yet</td></tr>
              ) : logs.map(log => (
                <tr key={log.id}>
                  <td>{new Date(log.created_at).toLocaleString()}</td>
                  <td>
                    <span className={`badge badge--${log.type === 'topup' ? 'success' : 'danger'}`}>
                      {log.type}
                    </span>
                  </td>
                  <td className={log.type === 'topup' ? 'text-success' : ''}>
                    {log.type === 'topup' ? '+' : '-'}${parseFloat(log.amount).toFixed(2)}
                  </td>
                  <td className="text-muted">${parseFloat(log.balance_before).toFixed(2)}</td>
                  <td>${parseFloat(log.balance_after).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
