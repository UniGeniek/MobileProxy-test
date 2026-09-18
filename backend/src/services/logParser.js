const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const logger = require('../logger');
const { chargeUserForUsage } = require('./billing');

const LOG_FILE = '/var/log/3proxy/3proxy.log';
const WAL_FILE = path.join(__dirname, '../../data/wal.log');

let lastReadPos = 0;
let isProcessing = false;
let eventBuffer = [];
const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 2000;
let flushTimer = null;

function parseLogLine(line) {
  if (!line.startsWith('L')) return null;
  const parts = line.split(' ');
  if (parts.length < 11) return null;
  
  const port = parts[2].split('.')[1];
  const bytesOut = parseInt(parts[6], 10);
  const bytesIn = parseInt(parts[7], 10);
  const username = parts[8];
  const duration = parseInt(parts[9], 10);

  if (username === '-' || isNaN(bytesIn) || isNaN(duration)) return null;

  const timestampStr = `${parts[0].substring(1)} ${parts[1]}`;
  const eventHash = crypto.createHash('sha256').update(`${username}-${timestampStr}-${port}-${bytesIn}-${bytesOut}-${duration}`).digest('hex');

  return {
    username,
    port: parseInt(port, 10),
    bytesIn,
    bytesOut,
    duration,
    timestamp: timestampStr,
    eventHash
  };
}

async function processLogs() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    if (!fs.existsSync(LOG_FILE)) {
      isProcessing = false;
      return;
    }

    const stats = fs.statSync(LOG_FILE);
    if (stats.size < lastReadPos) {
      lastReadPos = 0; // File rotated
    }

    if (stats.size === lastReadPos) {
      isProcessing = false;
      return;
    }

    const stream = fs.createReadStream(LOG_FILE, { start: lastReadPos, end: stats.size - 1 });
    let data = '';

    for await (const chunk of stream) {
      data += chunk;
      let newlineIdx;
      while ((newlineIdx = data.indexOf('\n')) >= 0) {
        const line = data.slice(0, newlineIdx).trim();
        data = data.slice(newlineIdx + 1);
        if (line) {
          const entry = parseLogLine(line);
          if (entry) {
            eventBuffer.push(entry);
            // Append to WAL immediately
            fs.appendFileSync(WAL_FILE, JSON.stringify(entry) + '\n');
            if (eventBuffer.length >= BATCH_SIZE) {
              await flushBuffer();
            }
          }
        }
      }
    }
    
    // We only update lastReadPos if we successfully read everything up to here.
    // The trailing 'data' might be an incomplete line, so we shouldn't advance past it.
    // Actually, createReadStream without a custom stream reader might leave incomplete lines.
    // A more robust approach subtracts the remaining unparsed data length.
    lastReadPos = stats.size - Buffer.byteLength(data, 'utf8');

  } catch (err) {
    logger.error('Log stream error', { error: err.message });
  } finally {
    isProcessing = false;
  }
}

async function flushBuffer() {
  if (eventBuffer.length === 0) return;
  const batch = [...eventBuffer];
  eventBuffer = []; // Clear for next batch

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    
    let totalCostDeducted = 0;

    for (const entry of batch) {
      // 1. Get user details
      const userRes = await client.query(`
        SELECT u.id as user_id, p.id as proxy_id, t.price_per_hour
        FROM users u
        JOIN user_proxies up ON u.id = up.user_id
        JOIN proxies p ON up.proxy_id = p.id
        JOIN tariffs t ON u.tariff_id = t.id
        WHERE u.username = $1 AND p.port = $2
      `, [entry.username, entry.port]);

      if (userRes.rows.length === 0) continue;
      const { user_id, proxy_id, price_per_hour } = userRes.rows[0];

      // Cost for this exact duration
      const cost = (entry.duration / 3600) * parseFloat(price_per_hour);

      // 2. Insert into ledger idempotently
      const ledgerRes = await client.query(`
        INSERT INTO usage_ledger (user_id, proxy_id, bytes_in, bytes_out, duration, cost, source, event_hash)
        VALUES ($1, $2, $3, $4, $5, $6, 'proxy_log', $7)
        ON CONFLICT (event_hash) DO NOTHING
        RETURNING cost
      `, [user_id, proxy_id, entry.bytesIn, entry.bytesOut, entry.duration, cost, entry.eventHash]);

      // If inserted, it's a new unique event
      if (ledgerRes.rows.length > 0) {
        if (cost > 0) {
           await chargeUserForUsage(user_id, cost, { proxy_id, duration: entry.duration });
        }
      }
    }

    await client.query('COMMIT');
    
    // Clear WAL after successful flush
    if (fs.existsSync(WAL_FILE)) {
      fs.truncateSync(WAL_FILE, 0);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Flush buffer failed', { error: err.message });
    // Push back to buffer for retry if it's a transient error
    // (Simplified for now: we drop on DB crash, but real enterprise would DLQ it)
  } finally {
    client.release();
  }
}

let interval;

function recoverFromWAL() {
  try {
    if (fs.existsSync(WAL_FILE)) {
      const data = fs.readFileSync(WAL_FILE, 'utf8');
      const lines = data.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          eventBuffer.push(entry);
        } catch (e) {
          // Ignore malformed WAL lines
        }
      }
      if (eventBuffer.length > 0) {
        logger.info(`Recovered ${eventBuffer.length} events from WAL`);
      }
    }
  } catch (err) {
    logger.error('WAL recovery failed', { error: err.message });
  }
}

function start() {
  recoverFromWAL();
  
  // Read frequently to emulate streaming
  interval = setInterval(processLogs, 1000);
  
  // Guarantee periodic flush even if batch size not reached
  flushTimer = setInterval(flushBuffer, FLUSH_INTERVAL_MS);
  
  logger.info('Log parser streaming service started');
}

function stop() {
  if (interval) clearInterval(interval);
  if (flushTimer) clearInterval(flushTimer);
}

module.exports = { start, stop, processLogs };
