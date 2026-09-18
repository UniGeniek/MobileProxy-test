// ============================================
// DataCenter — Rate Limit Middleware
// ============================================
// Multi-level rate limiting:
// 1. Cooldown per port (e.g. 60s)
// 2. Max resets per hour per port (e.g. 10)
// 3. Max resets per day per user (e.g. 200)

const { redis } = require('../redis');
const config = require('../config');
const logger = require('../logger');

/**
 * Check all rate limits for a reset operation.
 * @param {number} port - Proxy port
 * @param {number} userId - User ID
 * @returns {Promise<{allowed: boolean, reason?: string, retryIn?: number}>}
 */
async function checkResetRateLimit(port, userId) {
  const now = Math.floor(Date.now() / 1000);

  const db = require('../db');

  // Get dynamic tariff limits (cached)
  const tariffKey = `tariff:${userId}`;
  let tariffStr = await redis.get(tariffKey);
  let tariff;
  if (!tariffStr) {
    const userRes = await db.query(`SELECT t.reset_cooldown, t.max_proxies FROM users u JOIN tariffs t ON u.tariff_id = t.id WHERE u.id = $1`, [userId]);
    tariff = userRes.rows[0] || { reset_cooldown: config.rateLimit.resetCooldownSec, max_proxies: 5 };
    await redis.set(tariffKey, JSON.stringify(tariff), 'EX', 60);
  } else {
    tariff = JSON.parse(tariffStr);
  }

  const cooldownSec = tariff.reset_cooldown;

  // ── 1. Per-port cooldown ──
  const cooldownKey = `reset:cooldown:${port}`;
  const lastReset = await redis.get(cooldownKey);

  if (lastReset) {
    const elapsed = now - parseInt(lastReset, 10);
    const remaining = cooldownSec - elapsed;
    if (remaining > 0) {
      return {
        allowed: false,
        reason: 'cooldown',
        message: `Port ${port} is on cooldown`,
        retryIn: remaining,
      };
    }
  }

  // ── 2. Per-port hourly limit ──
  const hourlyKey = `reset:hourly:${port}`;
  const hourlyCount = await redis.get(hourlyKey);

  if (hourlyCount && parseInt(hourlyCount, 10) >= config.rateLimit.resetMaxPerHour) {
    const ttl = await redis.ttl(hourlyKey);
    return {
      allowed: false,
      reason: 'hourly_limit',
      message: `Port ${port} exceeded hourly reset limit (${config.rateLimit.resetMaxPerHour})`,
      retryIn: ttl > 0 ? ttl : 3600,
    };
  }

  // ── 3. Per-user daily limit ──
  const dailyKey = `reset:daily:user:${userId}`;
  const dailyCount = await redis.get(dailyKey);

  if (dailyCount && parseInt(dailyCount, 10) >= config.rateLimit.resetMaxPerDayUser) {
    const ttl = await redis.ttl(dailyKey);
    return {
      allowed: false,
      reason: 'daily_limit',
      message: `User daily reset limit exceeded (${config.rateLimit.resetMaxPerDayUser})`,
      retryIn: ttl > 0 ? ttl : 86400,
    };
  }

  return { allowed: true };
}

/**
 * Record a reset event in rate limit counters.
 * @param {number} port
 * @param {number} userId
 */
async function recordReset(port, userId) {
  const now = Math.floor(Date.now() / 1000);
  const pipeline = redis.pipeline();

  const db = require('../db');
  const tariffKey = `tariff:${userId}`;
  let tariffStr = await redis.get(tariffKey);
  let cooldownSec = config.rateLimit.resetCooldownSec;
  if (!tariffStr) {
    const userRes = await db.query(`SELECT t.reset_cooldown FROM users u JOIN tariffs t ON u.tariff_id = t.id WHERE u.id = $1`, [userId]);
    cooldownSec = userRes.rows[0]?.reset_cooldown || config.rateLimit.resetCooldownSec;
    await redis.set(tariffKey, JSON.stringify({ reset_cooldown: cooldownSec }), 'EX', 300);
  } else {
    cooldownSec = JSON.parse(tariffStr).reset_cooldown;
  }

  // Set cooldown
  pipeline.set(`reset:cooldown:${port}`, now, 'EX', cooldownSec);

  // Increment hourly counter
  const hourlyKey = `reset:hourly:${port}`;
  pipeline.incr(hourlyKey);
  pipeline.expire(hourlyKey, 3600);

  // Increment daily user counter
  const dailyKey = `reset:daily:user:${userId}`;
  pipeline.incr(dailyKey);
  pipeline.expire(dailyKey, 86400);

  await pipeline.exec();
}

/**
 * Get remaining cooldown for a port.
 * @param {number} port
 * @returns {Promise<number>} seconds remaining, 0 if no cooldown
 */
async function getCooldown(port) {
  const cooldownKey = `reset:cooldown:${port}`;
  const ttl = await redis.ttl(cooldownKey);
  return ttl > 0 ? ttl : 0;
}

/**
 * Get rate limit info for a port + user combination.
 */
async function getRateLimitInfo(port, userId) {
  const db = require('../db');
  const tariffKey = `tariff:${userId}`;
  let tariffStr = await redis.get(tariffKey);
  let cooldownSec = config.rateLimit.resetCooldownSec;
  if (!tariffStr) {
    const userRes = await db.query(`SELECT t.reset_cooldown FROM users u JOIN tariffs t ON u.tariff_id = t.id WHERE u.id = $1`, [userId]);
    cooldownSec = userRes.rows[0]?.reset_cooldown || config.rateLimit.resetCooldownSec;
    await redis.set(tariffKey, JSON.stringify({ reset_cooldown: cooldownSec }), 'EX', 300);
  } else {
    cooldownSec = JSON.parse(tariffStr).reset_cooldown;
  }

  const [cooldownTTL, hourlyCount, dailyCount] = await Promise.all([
    redis.ttl(`reset:cooldown:${port}`),
    redis.get(`reset:hourly:${port}`),
    redis.get(`reset:daily:user:${userId}`),
  ]);

  return {
    cooldownRemaining: cooldownTTL > 0 ? cooldownTTL : 0,
    hourlyResets: parseInt(hourlyCount, 500) || 0,
    hourlyLimit: config.rateLimit.resetMaxPerHour,
    dailyResets: parseInt(dailyCount, 500) || 0,
    dailyLimit: config.rateLimit.resetMaxPerDayUser,
  };
}

module.exports = {
  checkResetRateLimit,
  recordReset,
  getCooldown,
  getRateLimitInfo,
};
