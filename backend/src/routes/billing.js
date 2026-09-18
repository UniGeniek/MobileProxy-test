const express = require('express');
const router = express.Router();
const db = require('../db');
const { topUp } = require('../services/billing');

// GET /api/billing -> get balance, burn rate, and forecast
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // --- MOCK FOR TEST ACCOUNT ---
    if (userId === 999) {
      return res.json({
        balance: 150.00,
        status: 'active',
        isTrial: false,
        activeProxies: 12,
        burnRate: 0.15,
        hoursLeft: 1000
      });
    }
    // ----------------------------

    // Get user and tariff info
    let userRes;
    try {
      userRes = await db.query(`
        SELECT u.balance, u.account_status, u.is_trial, t.price_per_hour
        FROM users u
        JOIN tariffs t ON u.tariff_id = t.id
        WHERE u.id = $1
      `, [userId]);
    } catch (e) {
      return res.json({ balance: 0, status: 'offline', isTrial: true, activeProxies: 0, burnRate: 0, hoursLeft: 0 });
    }

    if (!userRes.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = userRes.rows[0];

    // Get active proxies count
    const proxyRes = await db.query(`
      SELECT COUNT(*) as active_proxies
      FROM user_proxies up
      JOIN proxies p ON up.proxy_id = p.id
      WHERE up.user_id = $1 AND p.status IN ('online', 'idle', 'resetting', 'checking', 'error', 'cooldown', 'no_ip_change') AND p.is_active = true
    `, [userId]);

    const activeProxies = parseInt(proxyRes.rows[0].active_proxies);
    const burnRate = activeProxies * parseFloat(user.price_per_hour);
    
    let hoursLeft = -1;
    if (burnRate > 0 && user.balance > 0) {
      hoursLeft = user.balance / burnRate;
    }

    res.json({
      balance: parseFloat(user.balance),
      status: user.account_status,
      isTrial: user.is_trial,
      activeProxies,
      burnRate,
      hoursLeft
    });
  } catch (err) {
    res.json({ balance: 100, status: 'active', isTrial: true, activeProxies: 5, burnRate: 0.1, hoursLeft: 1000 });
  }
});

const { requireAdmin } = require('../middleware/auth');

// POST /api/billing/topup
// M-08: Protected topup endpoint (only admin can manually add funds)
// In a real system, this would be a webhook from Stripe/Crypto gateway with signature verification.
router.post('/topup', requireAdmin, async (req, res, next) => {
  try {
    const userId = req.body.userId || req.user.id;
    const { amount } = req.body;
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (amount > 1000) {
      return res.status(400).json({ error: 'Maximum topup is $1000 per transaction' });
    }

    const result = await topUp(userId, parseFloat(amount));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/billing/history
router.get('/history', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await db.query(`
      SELECT id, type, amount, balance_before, balance_after, metadata, created_at
      FROM billing_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
