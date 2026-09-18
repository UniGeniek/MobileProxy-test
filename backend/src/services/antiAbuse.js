// ============================================
// DataCenter — Anti-Abuse Detection
// ============================================

const { redis } = require('../redis');
const logger = require('../logger');

const WINDOW_SEC = 60;
const ALERT_THRESHOLDS = {
  rapidResets: 5,         // resets per minute per user
  authFailures: 10,       // auth failures per 5 min per IP
  connectionSpike: 50,    // new connections per 10 sec
};

/**
 * Track and detect rapid reset abuse.
 */
async function checkResetAbuse(userId) {
  const key = `abuse:reset:${userId}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SEC);

  if (count >= ALERT_THRESHOLDS.rapidResets) {
    logger.warn('ANTI-ABUSE: rapid resets detected', { userId, count, window: WINDOW_SEC });
    return { abusive: true, reason: 'rapid_resets', count };
  }
  return { abusive: false };
}

/**
 * Track auth failures per IP.
 */
async function trackAuthFailure(ip) {
  const key = `abuse:auth:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 300);

  if (count >= ALERT_THRESHOLDS.authFailures) {
    logger.warn('ANTI-ABUSE: excessive auth failures', { ip, count });
    return { blocked: true, retryIn: await redis.ttl(key) };
  }
  return { blocked: false };
}

/**
 * Check if an IP is temporarily blocked.
 */
async function isBlocked(ip) {
  const blocked = await redis.get(`abuse:blocked:${ip}`);
  return !!blocked;
}

/**
 * Temporarily block an IP.
 */
async function blockIp(ip, durationSec = 3600) {
  await redis.set(`abuse:blocked:${ip}`, '1', 'EX', durationSec);
  logger.warn('ANTI-ABUSE: IP blocked', { ip, duration: durationSec });
}

module.exports = { checkResetAbuse, trackAuthFailure, isBlocked, blockIp };
