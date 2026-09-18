// ============================================
// DataCenter — Reset Executor (separate process)
// - Uses BullMQ Worker to process reset jobs
// - Uses Redlock for distributed locking
// - Publishes events to Redis for WebSocket forwarding
// - Implements dead-letter queue and idempotency behavior
// ============================================

const { Worker, Queue } = require('bullmq');
const Redlock = require('redlock');
const config = require('../config');
const logger = require('../logger');
const db = require('../db');
const routerManager = require('../services/routerManager');
const { redis } = require('../redis');

const QUEUE_NAME = 'reset-execution';
const DEAD_QUEUE = 'reset-dead-queue';

const deadQueue = new Queue(DEAD_QUEUE, {
  connection: { host: config.redis.host, port: config.redis.port, password: config.redis.password }
});

const redlock = new Redlock(
  // You should pass an array of clients (for safety use Redis cluster in prod)
  [redis],
  {
    // the expected clock drift; for more details see http://redis.io/topics/distlock
    driftFactor: 0.01,
    retryCount: 3,
    retryDelay: 200, // ms
    retryJitter: 200 // ms
  }
);

async function getIpThroughProxy(port) {
  try {
    const { HttpProxyAgent } = require('http-proxy-agent');
    const agent = new HttpProxyAgent(`http://${config.proxy.authUser}:${config.proxy.authPass}@${config.proxy.host}:${port}`);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('http://api.ipify.org?format=json', { agent, signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) { const d = await res.json(); return d.ip; }
  } catch (err) { logger.debug('IP verify failed', { port, error: err.message }); }
  return null;
}

function publishEvent(type, payload) {
  try {
    const msg = JSON.stringify({ type, payload });
    redis.publish('events', msg).catch(() => {});
  } catch (e) { logger.debug('Failed to publish event', { error: e.message }); }
}

async function start() {
  logger.info('ResetExecutor: starting worker');

  const MODE = (process.env.EXECUTOR_MODE || 'hybrid').toLowerCase();
  if (MODE === 'agent') {
    logger.info('ResetExecutor: disabled by EXECUTOR_MODE=agent');
    process.exit(0);
  }
  if (MODE === 'hybrid' && config.env === 'production') {
    logger.error('ResetExecutor: hybrid mode is not allowed in production. Set EXECUTOR_MODE=worker or agent. Exiting.');
    process.exit(1);
  }

  const worker = new Worker(QUEUE_NAME, async (job) => {
    const { resetJobId, resetLogId, proxyId, port, requestedBy } = job.data;

    const resource = `locks:router:${proxyId}`;
    let lock;
    try {
      // Acquire distributed lock for this proxy/router
      lock = await redlock.acquire([resource], 60000);
    } catch (err) {
      logger.warn('ResetExecutor: could not acquire lock', { proxyId, error: err.message });
      throw new Error(`Router ${proxyId} is locked`);
    }

    logger.info('ResetExecutor: processing', { proxyId, port, jobId: job.id });

    // Mark in DB in-progress
    try {
      // mark job running only if it was queued (prevent double execution)
      const markRes = await db.query(`UPDATE reset_jobs SET state='running', attempts = attempts + 1, updated_at=NOW() WHERE id = $1 AND state = 'queued' RETURNING id`, [resetJobId]);
      if (!markRes.rows.length) {
        throw new Error('ResetExecutor: job not in queued state (already claimed or running) - aborting to avoid double execution');
      }

      await db.query(`UPDATE reset_logs SET status = 'in_progress', started_at = NOW() WHERE id = $1`, [resetLogId]);

      const proxyResult = await db.query('SELECT * FROM proxies WHERE id = $1', [proxyId]);
      if (!proxyResult.rows.length) throw new Error(`Proxy ${proxyId} not found`);
      const proxy = proxyResult.rows[0];
      const oldIp = proxy.current_ip;

      const result = await routerManager.resetRouter(proxy);

      if (!result.success) throw new Error(result.error || 'Reset failed');

      let verifiedIp = result.newIp || await getIpThroughProxy(port);
      const finalStatus = result.ipChanged ? 'success' : 'ip_unchanged';

      await db.query(
        `UPDATE proxies SET current_ip=$1, status='online', last_reset=NOW(),
         last_ip_change=CASE WHEN $2 THEN NOW() ELSE last_ip_change END, error_message=NULL WHERE id=$3`,
        [verifiedIp || result.newIp, result.ipChanged, proxyId]
      );

      if (verifiedIp || result.newIp) {
        await db.query(`INSERT INTO proxy_ip_history (proxy_id, ip_address) VALUES ($1, $2)`, [proxyId, verifiedIp || result.newIp]);
      }

      await db.query(
        `UPDATE reset_logs SET old_ip=$1, new_ip=$2, status=$3, duration_ms=$4, finished_at=NOW() WHERE id=$5`,
        [oldIp || result.oldIp, verifiedIp || result.newIp, finalStatus, result.duration, resetLogId]
      );

      const successRes = await db.query(`UPDATE reset_jobs SET state='success', updated_at=NOW() WHERE id=$1 AND state='running' RETURNING id`, [resetJobId]);
      if (!successRes.rows.length) logger.warn('ResetExecutor: job marked success but was not running', { resetJobId });

      // Notify via Redis pub/sub; API process will forward to WebSocket clients
      const updatePayload = { proxyId, port, status: finalStatus === 'ip_unchanged' ? 'no_ip_change' : 'online',
        currentIp: verifiedIp || result.newIp, lastReset: new Date().toISOString(), ipChanged: result.ipChanged };
      publishEvent('proxy:updated', updatePayload);
      publishEvent('reset:complete', { proxyId, port, success: true, newIp: verifiedIp || result.newIp, ipChanged: result.ipChanged, duration: result.duration, userId: requestedBy });

      logger.info('ResetExecutor: job success', { proxyId, port, duration: result.duration });
      return { ok: true };
    } catch (err) {
      logger.error('ResetExecutor: job error', { jobId: job.id, error: err.message });
      try {
        await db.query(`UPDATE proxies SET status='error', error_message=$1 WHERE id=$2`, [err.message, job.data.proxyId]);
      } catch (_) {}
      try {
        await db.query(`UPDATE reset_logs SET status='failed', error_message=$1, duration_ms=$2, finished_at=NOW() WHERE id=$3`,
          [err.message, Date.now() - job.timestamp, resetLogId]);
      } catch (_) {}
      try {
        const failRes = await db.query(`UPDATE reset_jobs SET state='failed', last_error=$1, updated_at=NOW() WHERE id=$2 AND state IN ('running','queued') RETURNING id`, [err.message, resetJobId]);
        if (!failRes.rows.length) logger.warn('ResetExecutor: failed to mark reset_job failed (unexpected state)', { resetJobId });
      } catch (_) {}

      publishEvent('proxy:status', { proxyId: job.data.proxyId, port: job.data.port, status: 'error', error: err.message });
      publishEvent('reset:complete', { proxyId: job.data.proxyId, port: job.data.port, success: false, error: err.message, userId: job.data.requestedBy || job.data.userId });

      throw err;
    } finally {
      // Release lock (support unlock or release depending on redlock version)
      try {
        if (lock) {
          if (typeof lock.unlock === 'function') await lock.unlock();
          else if (typeof lock.release === 'function') await lock.release();
        }
      } catch (e) { logger.debug('Failed to release redlock', { error: e.message }); }
    }
  }, {
    connection: { host: config.redis.host, port: config.redis.port, password: config.redis.password },
    concurrency: 5,
    limiter: { max: 10, duration: 10000 },
  });

  worker.on('failed', async (job, err) => {
    logger.error('ResetExecutor: job failed', { jobId: job?.id, attemptsMade: job.attemptsMade, failedReason: err.message });
    // If job exhausted attempts, move to dead-letter queue
    const maxAttempts = (job.opts && job.opts.attempts) || 3;
    if (job.attemptsMade >= maxAttempts) {
      try {
        await deadQueue.add('dead', { ...job.data, failedReason: err.message, attempts: job.attemptsMade });
        logger.warn('ResetExecutor: moved job to dead-letter queue', { jobId: job.id });
        await db.query(`UPDATE reset_logs SET status='failed_permanent', error_message=$1 WHERE id=$2`, [err.message, job.data.resetLogId]);
        // mark reset_job as dead_letter
        if (job.data.resetJobId) {
          const dlRes = await db.query(`UPDATE reset_jobs SET state='dead_letter', last_error=$1, updated_at=NOW() WHERE id=$2 AND state IN ('failed','running','queued') RETURNING id`, [err.message, job.data.resetJobId]);
          if (!dlRes.rows.length) logger.warn('ResetExecutor: dead-letter mark skipped (unexpected state)', { resetJobId: job.data.resetJobId });
        }
      } catch (e) { logger.error('Failed to move to dead-letter queue', { error: e.message }); }
    }
  });

  worker.on('error', (err) => logger.error('ResetExecutor: worker error', { error: err.message }));

  logger.info('ResetExecutor: worker started');
}

// Start if this script is run directly
if (require.main === module) {
  start().catch(err => {
    logger.error('ResetExecutor: fatal error', { error: err.message });
    process.exit(1);
  });
}

module.exports = { start };
