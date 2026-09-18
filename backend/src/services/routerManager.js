const { Client } = require('ssh2');
const config = require('../config');
const logger = require('../logger');

const openwrt = require('./routers/openwrt');
const huawei = require('./routers/huawei');
const mikrotik = require('./routers/mikrotik');
const zte = require('./routers/zte');

const drivers = {
  openwrt,
  huawei,
  mikrotik,
  zte,
  custom: openwrt,
};

function createSSHConnection(router) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH connection timeout to ${router.router_ip}`));
    }, config.router.sshTimeout);

    conn.on('ready', () => {
      clearTimeout(timeout);
      resolve(conn);
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    const connConfig = {
      host: router.router_ip,
      port: router.router_ssh_port || config.router.sshPort,
      username: router.router_ssh_user || 'root',
      readyTimeout: config.router.sshTimeout,
    };

    if (router.router_ssh_key) {
      connConfig.privateKey = router.router_ssh_key;
    } else {
      connConfig.password = router.router_ssh_pass || '';
    }

    conn.connect(connConfig);
  });
}

function getDriver(routerType) {
  const driver = drivers[routerType];
  if (!driver) {
    logger.warn(`No driver for router type "${routerType}", falling back to openwrt`);
    return drivers.openwrt;
  }
  return driver;
}

async function resetRouter(router) {
  const startTime = Date.now();
  const driver = getDriver(router.router_type);
  const maxRetries = config.router.sshRetries;

  let lastError = null;
  let oldIp = null;
  let newIp = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let conn = null;

    try {
      logger.info(`Router reset: attempt ${attempt}/${maxRetries}`, {
        routerIp: router.router_ip,
        routerType: router.router_type,
        port: router.port,
      });

      conn = await createSSHConnection(router);

      try {
        oldIp = await driver.getWanIp(conn);
      } catch (e) {
        logger.warn('Could not get pre-reset IP', { error: e.message });
      }

      // janky disconnect-reconnect hack cause cheap routers shit themselves during reset
      conn.end();
      conn = await createSSHConnection(router);

      await driver.resetWan(conn);

      conn.end();
      await sleep(5000);

      conn = await createSSHConnection(router);
      newIp = await driver.getWanIp(conn);
      conn.end();

      if (oldIp && newIp && oldIp === newIp) {
        logger.warn('Router reset: IP did not change', {
          routerIp: router.router_ip,
          ip: oldIp,
          attempt,
        });

        if (attempt < maxRetries) {
          await sleep(3000);
          continue;
        }

        return {
          success: true,
          ipChanged: false,
          oldIp,
          newIp,
          duration: Date.now() - startTime,
          warning: 'IP did not change after reset',
        };
      }

      logger.info('Router reset: success', {
        routerIp: router.router_ip,
        oldIp,
        newIp,
        attempt,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        ipChanged: true,
        oldIp,
        newIp,
        duration: Date.now() - startTime,
      };

    } catch (err) {
      lastError = err;
      logger.error(`Router reset: attempt ${attempt} failed`, {
        routerIp: router.router_ip,
        error: err.message,
      });

      if (conn) {
        try { conn.end(); } catch (_) {}
      }

      if (attempt < maxRetries) {
        await sleep(2000 * attempt);
      }
    }
  }

  // total shitshow fallback reboot - maybe this shit works maybe the router dies completely, fuck if I know
  try {
    logger.warn(`Router ${router.router_ip} reset failed after ${maxRetries} attempts. Attempting reboot fallback...`);
    const conn = await createSSHConnection(router);
    await new Promise((resolve, reject) => {
      conn.exec('reboot', (err, stream) => {
        if (err) return reject(err);
        stream.on('close', resolve);
      });
    });
    conn.end();
    logger.info(`Reboot command sent to ${router.router_ip}`);
  } catch (rebootErr) {
    logger.error(`Reboot fallback failed for ${router.router_ip}`, { error: rebootErr.message });
  }

  return {
    success: false,
    ipChanged: false,
    oldIp,
    newIp: null,
    duration: Date.now() - startTime,
    error: lastError?.message || 'Unknown error after all retries',
  };
}

async function checkRouterConnectivity(router) {
  try {
    const conn = await createSSHConnection(router);
    conn.end();
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { resetRouter, checkRouterConnectivity, getDriver, createSSHConnection };
