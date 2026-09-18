// backend main entry point

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const logger = require('./logger');
const websocket = require('./websocket');
const { startWorker } = require('./services/resetQueue');
const healthCheck = require('./services/healthCheck');
const billing = require('./services/billing');
const logParser = require('./services/logParser');
const statusCtrl = require('./controllers/statusController');

// don't run in prod with default dev secret u dumbfuck
if (config.env === 'production' && config.jwt.secret.includes('dev-secret')) {
  logger.error('FATAL: JWT_SECRET must be changed for production! Exiting.');
  process.exit(1);
}

const app = express();
const server = http.createServer(app);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
    },
  },
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : (config.env === 'production' ? [] : ['http://localhost:5173', 'http://localhost:3000']);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS: blocked origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(morgan('short', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many requests, slow down' },
});
app.use('/api', apiLimiter);

app.set('trust proxy', true);

app.get('/api/health', statusCtrl.health);

app.use('/api', require('./routes/auth'));
app.use('/api/proxies', require('./routes/proxies'));
app.use('/api/reset', require('./routes/reset'));
app.use('/api/status', require('./routes/status'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/agents', require('./routes/agents'));

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', message: `Route ${req.method} ${req.path} not found` });
});

app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack, path: req.path });
  res.status(500).json({ error: 'server_error', message: 'Internal server error' });
});

async function start() {
  try {
    // Test DB connection
    try {
      const db = require('./db');
      const dbStatus = await db.healthCheck();
      logger.info('Database connected', dbStatus);
    } catch (e) {
      logger.warn('Database connection failed — running in degraded mode', { error: e.message });
    }

    // Test Redis connection
    try {
      const { healthCheck: redisCheck } = require('./redis');
      const redisStatus = await redisCheck();
      logger.info('Redis connected', redisStatus);
    } catch (e) {
      logger.warn('Redis connection failed — rate limiting disabled', { error: e.message });
    }

    websocket.init(server);

    // hacky background workers - maybe this shit works maybe it explodes, who knows
    try {
      // Worker should be started as a separate process. Only start here if explicitly requested.
      if (process.env.START_WORKER === '1') {
        const { startWorker } = require('./services/resetQueue');
        startWorker();
      }
    } catch (e) { logger.warn('Reset worker failed to start', { error: e.message }); }
    try { healthCheck.start(); } catch (e) { logger.warn('Health check failed to start', { error: e.message }); }
    try { billing.start(); } catch (e) { logger.warn('Billing cron failed to start', { error: e.message }); }
    try { logParser.start(); } catch (e) { logger.warn('Log parser failed to start', { error: e.message }); }

    server.listen(config.port, '0.0.0.0', () => {
      logger.info(`DataCenter API running on port ${config.port}`, {
        env: config.env,
        proxyPorts: `${config.proxy.portStart}-${config.proxy.portEnd}`,
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

// graceful shutdown when SIGTERM hits
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  healthCheck.stop();
  billing.stop();
  logParser.stop();
  if (process.env.START_WORKER === '1') {
    try {
      const { stopWorker } = require('./services/resetQueue');
      if (stopWorker) await stopWorker();
    } catch (e) { logger.debug('No worker to stop in API process'); }
  }
  server.close(() => process.exit(0));
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', { error: err?.message, stack: err?.stack });
});

start();
