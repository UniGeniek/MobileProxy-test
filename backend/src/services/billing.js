// ============================================
// DataCenter — Billing Service
// ============================================

const db = require('../db');
const logger = require('../logger');
const cron = require('node-cron');
const ws = require('../websocket');
const { rebuildProxyUsers } = require('./proxyAuth');
const { redis } = require('../redis');

// The periodic chron cron job is no longer the main billing engine.
// Log parser is the source of truth.
// chargeUser function here is kept for API triggers if needed, but we rely on chargeUserForUsage mainly.

/**
 * Perform time-based charging for a single user (Lazy Billing)
 * Returns the new balance.
 */
async function chargeUser(userId) {
  // Throttle lazy billing to run at most once per 60 seconds per user
  const lockKey = `billing:throttle:${userId}`;
  const isThrottled = await redis.get(lockKey);
  if (isThrottled) return null;
  await redis.set(lockKey, '1', 'EX', 60);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    
    // Advisory lock to prevent double billing race conditions
    await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);

    const userRes = await client.query(`
      SELECT u.balance, u.last_charged_at, u.account_status, t.price_per_hour,
             (SELECT COUNT(*) FROM user_proxies up JOIN proxies p ON up.proxy_id = p.id 
              WHERE up.user_id = u.id AND p.status IN ('online', 'idle', 'resetting', 'checking', 'error', 'cooldown', 'no_ip_change') AND p.is_active = true) as active_proxies
      FROM users u JOIN tariffs t ON u.tariff_id = t.id
      WHERE u.id = $1 AND u.account_status IN ('active', 'grace') AND u.role = 'user'
    `, [userId]);

    if (!userRes.rows.length) return null;
    const user = userRes.rows[0];

    if (user.active_proxies == 0) {
      await client.query(`UPDATE users SET last_charged_at = NOW() WHERE id = $1`, [userId]);
      return user.balance;
    }

    const now = new Date();
    const lastCharged = new Date(user.last_charged_at);
    const hoursDiff = Math.max(0, (now - lastCharged) / (1000 * 60 * 60));
    
    if (hoursDiff <= 0) return user.balance;

    const cost = hoursDiff * user.active_proxies * user.price_per_hour;
    
    if (cost > 0) {
      const updateRes = await client.query(`
        UPDATE users 
        SET balance = balance - $1, last_charged_at = NOW() 
        WHERE id = $2 
        RETURNING balance, account_status
      `, [cost, userId]);

      let newBalance = updateRes.rows[0].balance;
      let newStatus = updateRes.rows[0].account_status;

      // Status logic
      if (newBalance <= 0) {
        if (newStatus === 'active') {
          newStatus = 'grace';
          await client.query(`UPDATE users SET account_status = 'grace' WHERE id = $1`, [userId]);
          logger.warn(`User ${userId} entered grace period.`);
          ws.emitToUser(userId, 'billing:warning', { message: 'Balance exhausted. Service will stop soon.' });
        } else if (newStatus === 'grace') {
          // Grace period limit: Fixed -5.00 USD threshold
          const MAX_DEBT_USD = 5.00;
          if (newBalance <= -MAX_DEBT_USD) {
             newStatus = 'suspended';
             await client.query(`UPDATE users SET account_status = 'suspended' WHERE id = $1`, [userId]);
             logger.warn(`User ${userId} suspended.`);
             ws.emitToUser(userId, 'billing:critical', { message: 'Account suspended.' });
             rebuildProxyUsers();
          }
        }
      } else if (newBalance > 0 && newStatus !== 'active') {
        newStatus = 'active';
        await client.query(`UPDATE users SET account_status = 'active' WHERE id = $1`, [userId]);
        const { rebuildProxyUsers } = require('./proxyAuth');
        rebuildProxyUsers();
      }

      await client.query('COMMIT');
      return newBalance;
    }
    return user.balance;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('chargeUser failed', { error: err.message });
    return null;
  } finally {
    client.release();
  }
}

/**
 * Charge a user for specific usage (called by log parser)
 */
async function chargeUserForUsage(userId, cost, metadata = {}) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);

    const res = await client.query(`
      UPDATE users 
      SET balance = balance - $1, last_charged_at = NOW() 
      WHERE id = $2 
      RETURNING balance, account_status
    `, [cost, userId]);

    if (!res.rows.length) {
      await client.query('ROLLBACK');
      return;
    }

    const { balance, account_status } = res.rows[0];
    let newStatus = account_status;

    // Grace / Suspension Logic
    if (balance <= 0) {
      if (newStatus === 'active') {
        newStatus = 'grace';
        await client.query(`UPDATE users SET account_status = 'grace' WHERE id = $1`, [userId]);
        ws.emitToUser(userId, 'billing:warning', { message: 'Balance exhausted.' });
      } else if (newStatus === 'grace') {
        // Dynamic threshold: 24h of current usage rate
        const userRateRes = await client.query(`SELECT price_per_hour FROM tariffs t JOIN users u ON u.tariff_id = t.id WHERE u.id = $1`, [userId]);
        const rate = userRateRes.rows[0]?.price_per_hour || 0.05;
        const maxDebt = rate * 24; // 24 hours of debt

        if (balance <= -maxDebt) {
          newStatus = 'suspended';
          await client.query(`UPDATE users SET account_status = 'suspended' WHERE id = $1`, [userId]);
          rebuildProxyUsers();
        }
      }
    }

    await client.query('COMMIT');
    ws.emitToUser(userId, 'billing:update', { balance, status: newStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('chargeUserForUsage failed', { error: err.message });
  } finally {
    client.release();
  }
}

/**
 * Perform reconciliation for all active users (Reconciliation Job)
 * Detects drift between ledger and balance, inserts correction events.
 */
async function reconcileUsers() {
  const client = await db.pool.connect();
  try {
    const result = await client.query(`SELECT id, balance FROM users WHERE role = 'user'`);
    for (const row of result.rows) {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [row.id]);
      
      // Calculate true balance: sum(topups) - sum(usage_cost)
      const ledgerRes = await client.query(`
        SELECT COALESCE(SUM(cost), 0) as total_usage
        FROM usage_ledger WHERE user_id = $1
      `, [row.id]);
      
      const topupsRes = await client.query(`
        SELECT COALESCE(SUM(amount), 0) as total_topups
        FROM billing_logs WHERE user_id = $1 AND type IN ('topup', 'bonus')
      `, [row.id]);

      const totalUsage = parseFloat(ledgerRes.rows[0].total_usage);
      const totalTopups = parseFloat(topupsRes.rows[0].total_topups);
      const expectedBalance = totalTopups - totalUsage;
      
      // Get current balance
      const userRes = await client.query(`SELECT balance FROM users WHERE id = $1`, [row.id]);
      const currentBalance = parseFloat(userRes.rows[0].balance);

      const drift = currentBalance - expectedBalance;
      
      // If drift is significant (e.g. > $0.001)
      if (Math.abs(drift) > 0.001) {
        logger.warn(`Reconciliation drift detected for user ${row.id}: ${drift}. Applying correction.`);
        
        await client.query(`
          INSERT INTO billing_logs (user_id, type, amount, balance_before, balance_after, metadata)
          VALUES ($1, 'charge', $2, $3, $4, $5)
        `, [row.id, drift, currentBalance, expectedBalance, JSON.stringify({ reason: 'reconciliation_correction', drift })]);

        await client.query(`
          UPDATE users SET balance = $1 WHERE id = $2
        `, [expectedBalance, row.id]);
      }
      
      await client.query('COMMIT');
    }
  } catch (err) {
    logger.error('Reconciliation cron failed', { error: err.message });
  } finally {
    client.release();
  }
}

/**
 * Top up a user's balance
 */
async function topUp(userId, amount) {
  if (amount <= 0 || amount > 10000) throw new Error('Invalid top-up amount');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(`
      UPDATE users 
      SET balance = balance + $1 
      WHERE id = $2 
      RETURNING balance, account_status
    `, [amount, userId]);

    const newBalance = res.rows[0].balance;
    let status = res.rows[0].account_status;

    if (newBalance > 0 && (status === 'grace' || status === 'suspended')) {
      status = 'active';
      await client.query(`UPDATE users SET account_status = 'active' WHERE id = $1`, [userId]);
      rebuildProxyUsers();
    }

    await client.query(`
      INSERT INTO billing_logs (user_id, type, amount, balance_before, balance_after, metadata)
      VALUES ($1, 'topup', $2, $3, $4, $5)
    `, [userId, amount, newBalance - amount, newBalance, JSON.stringify({ note: 'Manual top-up' })]);

    await client.query('COMMIT');
    ws.emitToUser(userId, 'billing:update', { balance: newBalance, status });
    return { success: true, balance: newBalance, status };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

let cronJob;
let cleanupJob;
function start() {
  // Reconciliation every hour
  cronJob = cron.schedule('0 * * * *', () => {
    reconcileUsers().catch(err => logger.error('Reconciliation job error', { error: err.message }));
  });
  
  // Cleanup logs daily
  cleanupJob = cron.schedule('0 0 * * *', async () => {
    try {
      await db.query(`DELETE FROM billing_logs WHERE created_at < NOW() - INTERVAL '365 days'`);
      await db.query(`DELETE FROM reset_logs WHERE created_at < NOW() - INTERVAL '30 days'`);
      logger.info('Cleaned up old logs');
    } catch (err) {
      logger.error('Log cleanup error', { error: err.message });
    }
  });

  logger.info('Billing and cleanup crons scheduled');
}

function stop() {
  if (cronJob) cronJob.stop();
  if (cleanupJob) cleanupJob.stop();
}

module.exports = { start, stop, chargeUser, chargeUserForUsage, reconcileUsers, topUp };
