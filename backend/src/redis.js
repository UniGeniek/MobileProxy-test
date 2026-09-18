const Redis = require('ioredis');
const config = require('./config');
const logger = require('./logger');

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    logger.warn(`Redis: reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Redis: connected');
});

redis.on('error', (err) => {
  logger.error('Redis: connection error', { error: err.message });
});

async function healthCheck() {
  try {
    const pong = await redis.ping();
    return { status: pong === 'PONG' ? 'ok' : 'error' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

module.exports = { redis, healthCheck };
