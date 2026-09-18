const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool(config.db);

pool.on('connect', () => {
  logger.debug('PostgreSQL: new client connected');
});

pool.on('error', (err) => {
  logger.error('PostgreSQL: unexpected pool error', { error: err.message });
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    logger.warn('PostgreSQL: slow query', { text, duration, rows: result.rowCount });
  }

  return result;
}

async function getClient() {
  return pool.connect();
}

async function healthCheck() {
  try {
    const res = await pool.query('SELECT NOW()');
    return { status: 'ok', time: res.rows[0].now };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

module.exports = { query, getClient, healthCheck, pool };
