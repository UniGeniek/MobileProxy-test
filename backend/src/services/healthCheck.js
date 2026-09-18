// ============================================
// DataCenter — Health Check Service
// ============================================

const cron = require('node-cron');
const config = require('../config');
const logger = require('../logger');
const db = require('../db');
const ws = require('../websocket');

let cronJob = null;

/**
 * Check a single proxy by making an HTTP request through it.
 */
async function checkProxy(proxy) {
  try {
    const { HttpProxyAgent } = require('http-proxy-agent');
    const proxyUrl = `http://${config.proxy.authUser}:${config.proxy.authPass}@${config.proxy.host}:${proxy.port}`;
    const agent = new HttpProxyAgent(proxyUrl);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);

    const res = await fetch('http://api.ipify.org?format=json', { agent, signal: ctrl.signal });
    clearTimeout(t);

    if (res.ok) {
      const data = await res.json();
      return { online: true, ip: data.ip };
    }
    return { online: false, ip: null };
  } catch {
    return { online: false, ip: null };
  }
}

/**
 * Run health check on all active proxies in batches.
 */
async function runHealthCheck() {
  const start = Date.now();
  logger.info('Health check: starting');

  const result = await db.query(
    `SELECT id, port, current_ip, status, offline_since FROM proxies WHERE is_active = true AND status != 'resetting' ORDER BY port`
  );
  const proxies = result.rows;

  const batchSize = config.healthCheck.batchSize;
  let onlineCount = 0;
  let offlineCount = 0;
  const updates = [];

  for (let i = 0; i < proxies.length; i += batchSize) {
    const batch = proxies.slice(i, i + batchSize);
    const checks = await Promise.allSettled(batch.map(p => checkProxy(p)));

    for (let j = 0; j < batch.length; j++) {
      const proxy = batch[j];
      const check = checks[j];
      const ok = check.status === 'fulfilled' && check.value.online;
      const ip = ok ? check.value.ip : null;
      const newStatus = ok ? 'online' : 'offline';

      if (ok) onlineCount++; else offlineCount++;

      let offlineSince = proxy.offline_since;
      if (ok) {
        offlineSince = null;
      } else if (!ok && proxy.status !== 'offline') {
        offlineSince = new Date().toISOString();
      }

      let shouldUpdate = proxy.status !== newStatus || (ip && proxy.current_ip !== ip) || offlineSince !== proxy.offline_since;

      // Watchdog logic: auto reboot if offline > 5 mins
      if (!ok && proxy.offline_since) {
        const offlineMs = Date.now() - new Date(proxy.offline_since).getTime();
        if (offlineMs > 5 * 60 * 1000) {
          logger.warn(`Watchdog: Proxy ${proxy.port} offline for > 5 mins. Enqueueing reboot/reset...`);
          const { enqueueReset } = require('./resetQueue');
          enqueueReset({ proxyId: proxy.id, port: proxy.port, userId: null, clientIp: '127.0.0.1' })
            .catch(err => logger.error('Watchdog reset failed', { error: err.message }));
          
          offlineSince = new Date().toISOString(); // Reset timer
          shouldUpdate = true;
          // status will be set to 'resetting' by enqueueReset, but we'll let it be overwritten or just not update status
        }
      }

      if (shouldUpdate) {
        updates.push({ id: proxy.id, port: proxy.port, status: newStatus, ip, offline_since: offlineSince });
      }
    }

    // Small delay between batches
    if (i + batchSize < proxies.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Batch update DB
  for (const u of updates) {
    // If we just triggered a watchdog reset, don't overwrite 'resetting' status with 'offline'
    if (u.offline_since && u.status === 'offline') {
      const isResetting = await db.query(`SELECT status FROM proxies WHERE id=$1`, [u.id]);
      if (isResetting.rows[0]?.status === 'resetting') continue;
    }

    await db.query(
      `UPDATE proxies SET status=$1, current_ip=COALESCE($2, current_ip), offline_since=$3, last_health_check=NOW() WHERE id=$4`,
      [u.status, u.ip, u.offline_since, u.id]
    );
    
    const users = await db.query('SELECT user_id FROM user_proxies WHERE proxy_id = $1', [u.id]);
    const statusPayload = { proxyId: u.id, port: u.port, status: u.status, currentIp: u.ip };
    users.rows.forEach(user => ws.emitToUser(user.user_id, 'proxy:status', statusPayload));
    ws.emitToAdmins('proxy:status', statusPayload);
  }

  // Update all checked timestamps even if unchanged
  const ids = proxies.map(p => p.id);
  if (ids.length) {
    await db.query(`UPDATE proxies SET last_health_check=NOW() WHERE id=ANY($1)`, [ids]);
  }

  const duration = Date.now() - start;
  logger.info('Health check: complete', { online: onlineCount, offline: offlineCount, updated: updates.length, duration });

  return { online: onlineCount, offline: offlineCount, total: proxies.length, duration };
}

/**
 * Start periodic health checks.
 */
function start() {
  const intervalSec = config.healthCheck.intervalSec;
  const cronExpr = `*/${Math.max(1, Math.floor(intervalSec / 60))} * * * *`;

  cronJob = cron.schedule(cronExpr, () => {
    runHealthCheck().catch(err => logger.error('Health check error', { error: err.message }));
  });

  logger.info(`Health check: scheduled every ${intervalSec}s (cron: ${cronExpr})`);

  // Run once on startup after a delay
  setTimeout(() => {
    runHealthCheck().catch(err => logger.error('Health check initial error', { error: err.message }));
  }, 10000);
}

function stop() { if (cronJob) cronJob.stop(); }

module.exports = { start, stop, runHealthCheck, checkProxy };
