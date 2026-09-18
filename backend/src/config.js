// ============================================
// DataCenter — Configuration
// ============================================

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.API_PORT, 10) || 4000,

  // ── PostgreSQL ──
  db: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
    database: process.env.POSTGRES_DB || 'datacenter',
    user: process.env.POSTGRES_USER || 'dcadmin',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },

  // ── Redis ──
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || 'changeme',
    maxRetriesPerRequest: null, // Required by BullMQ
  },

  // ── JWT ──
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // ── Rate Limits ──
  rateLimit: {
    resetCooldownSec: parseInt(process.env.RESET_COOLDOWN_SEC, 10) || 60,
    resetMaxPerHour: parseInt(process.env.RESET_MAX_PER_HOUR, 10) || 10,
    resetMaxPerDayUser: parseInt(process.env.RESET_MAX_PER_DAY_USER, 10) || 200,
    maxConnectionsPerProxy: parseInt(process.env.MAX_CONNECTIONS_PER_PROXY, 10) || 20,
    maxConnectionsPerUser: parseInt(process.env.MAX_CONNECTIONS_PER_USER, 10) || 200,
  },

  // ── Router SSH ──
  router: {
    sshPort: parseInt(process.env.ROUTER_SSH_PORT, 10) || 22,
    sshTimeout: parseInt(process.env.ROUTER_SSH_TIMEOUT, 10) || 10000,
    sshRetries: parseInt(process.env.ROUTER_SSH_RETRIES, 10) || 3,
    defaultType: process.env.ROUTER_DEFAULT_TYPE || 'openwrt',
  },

  // ── Health Check ──
  healthCheck: {
    intervalSec: parseInt(process.env.HEALTH_CHECK_INTERVAL_SEC, 10) || 120,
    batchSize: parseInt(process.env.HEALTH_CHECK_BATCH_SIZE, 10) || 10,
  },

  // ── Node Agent ──
  nodeAgent: {
    heartbeatTimeoutSec: parseInt(process.env.NODE_AGENT_HEARTBEAT_TIMEOUT_SEC, 10) || 60,
  },

  // ── Proxy ──
  proxy: {
    host: process.env.PROXY_HOST || 'proxy',
    portStart: parseInt(process.env.PROXY_PORT_START, 10) || 3001,
    portEnd: parseInt(process.env.PROXY_PORT_END, 10) || 3050,
    authUser: process.env.PROXY_AUTH_USER || 'cmFkaWdhZG1u', // admin1
    authPass: process.env.PROXY_AUTH_PASS || 'cmFkaW4zZA==', // ad3admin
  },

  // ── Logging ──
  log: {
    level: process.env.LOG_LEVEL || 'info',
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS, 10) || 90,
  },
};

module.exports = config;
