// ============================================
// DataCenter — Reset Queue (enqueue-only)
// Worker moved to src/workers/resetExecutor.js
// ============================================

const { Queue } = require('bullmq');
const config = require('../config');
const logger = require('../logger');
const db = require('../db');
const ws = require('../websocket');
const { redis } = require('../redis');

// API no longer enqueues directly; it creates DB entries (reset_logs + reset_jobs)

/**
 * Enqueue a reset job. This function is enqueue-only; executor runs in a separate process.
 * Uses deterministic jobId to provide idempotency for the same proxy.
 */
async function enqueueReset({ proxyId, port, userId, clientIp }) {
  // Create reset log first
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const logResult = await client.query(
      `INSERT INTO reset_logs (proxy_id, triggered_by, status, client_source_ip)
       VALUES ($1, $2, 'pending', $3) RETURNING id`, [proxyId, userId, clientIp]
    );
    const resetLogId = logResult.rows[0].id;

    // No routing decision here; Router service will read pending jobs from DB and assign

    await client.query(`UPDATE proxies SET status = 'resetting', error_message = NULL WHERE id = $1`, [proxyId]);

    const users = await client.query('SELECT user_id FROM user_proxies WHERE proxy_id = $1', [proxyId]);
    const statusPayload = { proxyId, port, status: 'resetting' };
    users.rows.forEach(u => ws.emitToUser(u.user_id, 'proxy:status', statusPayload));
    ws.emitToAdmins('proxy:status', statusPayload);

    await client.query('COMMIT');

    // Create reset job (DB-driven state machine) and return job id
    try {
      const jobRes = await client.query(
        `INSERT INTO reset_jobs (reset_log_id, proxy_id, port, requested_by, state)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id`, [resetLogId, proxyId, port, userId]
      );
      const resetJobId = jobRes.rows[0].id;
      logger.info('Reset job created in DB', { resetJobId, proxyId, port, requestedBy: userId });
      return { resetJobId, resetLogId, status: 'pending' };
    } catch (err) {
      logger.error('Failed to create reset job', { error: err.message, proxyId, port });
      await db.query(`UPDATE reset_logs SET status='failed', error_message=$1 WHERE id=$2`, [err.message, resetLogId]);
      throw err;
    }
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

async function getQueueStats() {
  // Return counts from DB state machine
  const res = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE state='pending') as pending,
       COUNT(*) FILTER (WHERE state='routed') as routed,
       COUNT(*) FILTER (WHERE state='queued') as queued,
       COUNT(*) FILTER (WHERE state='running') as running,
       COUNT(*) FILTER (WHERE state='success') as success,
       COUNT(*) FILTER (WHERE state='failed') as failed
     FROM reset_jobs`
  );
  return res.rows[0];
}

function startWorker() {
  logger.info('startWorker() called in API process — no-op. Run `npm run worker` or set START_WORKER=1 to run executor.');
}

async function stopWorker() {
  logger.info('stopWorker() called — nothing to stop in API process');
}

module.exports = { enqueueReset, startWorker, stopWorker, getQueueStats };
