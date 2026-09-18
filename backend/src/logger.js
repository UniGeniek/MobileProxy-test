// ============================================
// DataCenter — Winston Logger
// ============================================

const winston = require('winston');
const path = require('path');
const config = require('./config');

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

const logger = winston.createLogger({
  level: config.log.level,
  format: logFormat,
  defaultMeta: { service: 'datacenter-api' },
  transports: [
    // Console — always
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // File — combined
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'combined.log'),
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true,
    }),
    // File — errors only
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'error.log'),
      level: 'error',
      maxsize: 20 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
    // File — reset actions (audit)
    new winston.transports.File({
      filename: path.join(process.cwd(), 'logs', 'reset-audit.log'),
      level: 'info',
      maxsize: 50 * 1024 * 1024,
      maxFiles: 20,
      tailable: true,
    }),
  ],
});

module.exports = logger;
