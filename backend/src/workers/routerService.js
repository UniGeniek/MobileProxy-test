// ============================================
// DataCenter — Router Service (PoC)
// - Polls DB for 'pending' reset_jobs
// - Decides target agent (simple selection)
// - Publishes to single 'reset-execution' queue and updates job state
// ============================================

const { Worker, Queue } = require('bullmq');
const config = require('../config');
const logger = require('../logger');
const db = require('../db');

const EXEC_QUEUE = 'reset-execution';
const POLL_INTERVAL_MS = parseInt(process.env.ROUTER_POLL_MS, 10) || 2000;
const ROUTER_DELAY_MS = parseInt(process.env.ROUTER_PROCESS_DELAY_MS, 10) || 0;
const REDIS_CONN = { host: config.redis.host, port: config.redis.port, password: config.redis.password };

async function chooseAgent() {
  try {
    const res = await db.query("SELECT id FROM node_agents WHERE status = 'online' ORDER BY last_heartbeat DESC LIMIT 1");
    if (res.rows.length) return res.rows[0].id;
  } catch (e) {
    logger.warn('RouterService: failed to choose agent', { error: e.message });
  }
  return null;
}

async function routePendingOnce() {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT id, reset_log_id, proxy_id, port, requested_by FROM reset_jobs
       WHERE state = 'pending' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10`
    );
    if (!res.rows.length) {
      await client.query('COMMIT');
      return 0;
    }

    const execQueue = new Queue(EXEC_QUEUE, { connection: REDIS_CONN });

    for (const row of res.rows) {
      const jobId = row.id;
      const agentId = await chooseAgent();

      // Attempt atomic claim: only transition pending -> routed if still pending
      const claimRes = await client.query(
        'UPDATE reset_jobs SET state=$1, assigned_agent_id=$2, updated_at=NOW() WHERE id=$3 AND state=$4 RETURNING id',
        ['routed', agentId, jobId, 'pending']
      );

      if (!claimRes.rows.length) {
        // Someone else claimed or state changed — skip
        logger.debug('RouterService: skip job not pending', { jobId });
        continue;
      }

      await client.query('COMMIT');

      // Optional artificial delay for smoke tests
      if (ROUTER_DELAY_MS > 0) await new Promise(r => setTimeout(r, ROUTER_DELAY_MS));

      // Enqueue to single execution queue with deterministic jobId
      const jobData = { resetJobId: jobId, resetLogId: row.reset_log_id, proxyId: row.proxy_id, port: row.port, requestedBy: row.requested_by };
      const execJob = await execQueue.add('reset-exec', jobData, { jobId: `reset-job:${jobId}` });

      // update DB with queue job id and queued state (only if currently routed)
      const qRes = await db.query('UPDATE reset_jobs SET state=$1, queue_job_id=$2, updated_at=NOW() WHERE id=$3 AND state=$4 RETURNING id', ['queued', execJob.id, jobId, 'routed']);
      if (!qRes.rows.length) {
        logger.warn('RouterService: failed to mark job queued (state changed)', { jobId, execJobId: execJob.id });
      }

      // begin a new transaction for next row
      await client.query('BEGIN');
    }

    await client.query('COMMIT');
    return res.rows.length;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    logger.error('RouterService: routing error', { error: err.message });
    return 0;
  } finally {
    client.release();
  }
}

async function start() {
  logger.info('RouterService: starting DB-driven router');
  // Poll loop
  setInterval(async () => {
    try {
      await routePendingOnce();
    } catch (e) { logger.debug('RouterService: poll error', { error: e.message }); }
  }, POLL_INTERVAL_MS);
}

if (require.main === module) {
  start().catch(err => { logger.error('RouterService: fatal', { error: err.message }); process.exit(1); });
}

module.exports = { start };
