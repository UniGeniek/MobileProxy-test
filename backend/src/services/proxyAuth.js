// ============================================
// DataCenter — 3proxy Auth Manager
// ============================================

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const db = require('../db');
const logger = require('../logger');

const USERS_FILE_PATH = path.join(__dirname, '../../../../proxy/users.txt');

/**
 * Rebuilds the users.txt file for 3proxy based on active users
 * and reloads the 3proxy daemon.
 */
async function rebuildProxyUsers() {
  try {
    // H-02: Only allow users whose account is active or grace
    const result = await db.query(`
      SELECT username, proxy_password
      FROM users
      WHERE account_status IN ('active', 'grace') AND is_active = true AND proxy_password IS NOT NULL
    `);

    let usersTxt = '';

    for (const row of result.rows) {
      usersTxt += `${row.username}:CL:${row.proxy_password}\n`;
    }

    const tempPath = `${USERS_FILE_PATH}.tmp`;
    const fileHandle = await fs.open(tempPath, 'w', 0o600); // H-02: Set secure file permissions
    await fileHandle.writeFile(usersTxt, 'utf8');
    await fileHandle.sync(); // Force flush to disk
    await fileHandle.close();
    await fs.rename(tempPath, USERS_FILE_PATH);
    await fs.chmod(USERS_FILE_PATH, 0o600); // Ensure final file is restricted
    
    // Reload 3proxy via SIGUSR1 (avoids dropping existing valid connections if supported)
    exec('docker kill -s USR1 dc-proxy', (err) => {
      if (err) {
         logger.error('Failed to send SIGUSR1 to dc-proxy, falling back to restart', { error: err.message });
         exec('docker restart dc-proxy');
      } else {
         // Health check verification after reload
         setTimeout(() => {
           exec('docker exec dc-proxy nc -z localhost 3001', (hcErr) => {
             if (hcErr) {
               logger.warn('Proxy health check failed after USR1 reload, triggering restart');
               exec('docker restart dc-proxy');
             } else {
               logger.info('Successfully rebuilt users.txt and reloaded 3proxy config');
             }
           });
         }, 1000);
      }
    });

  } catch (err) {
    logger.error('Error rebuilding proxy users', { error: err.message });
  }
}

module.exports = { rebuildProxyUsers };
