const logger = require('../../logger');

function resetWan(conn) {
  return new Promise((resolve, reject) => {
    const cmd = 'ifdown wan && sleep 2 && ifup wan && sleep 8 && ifconfig pppoe-wan 2>/dev/null || ifconfig wan 2>/dev/null';

    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      let errorOutput = '';

      stream.on('data', (data) => { output += data.toString(); });
      stream.stderr.on('data', (data) => { errorOutput += data.toString(); });

      stream.on('close', (code) => {
        if (code !== 0 && code !== null) {
          logger.warn('OpenWrt: non-zero exit code', { code, errorOutput });
        }
        resolve(output);
      });
    });
  });
}

function getWanIp(conn) {
  return new Promise((resolve, reject) => {
    const cmd = `ubus call network.interface.wan status 2>/dev/null | jsonfilter -e '@["ipv4-address"][0].address' 2>/dev/null || ip -4 addr show pppoe-wan 2>/dev/null | grep -oP 'inet \\K[0-9.]+' || ip -4 addr show wan 2>/dev/null | grep -oP 'inet \\K[0-9.]+'`;

    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.on('close', () => {
        const ip = output.trim().split('\n')[0]?.trim();
        resolve(ip || null);
      });
    });
  });
}

module.exports = { resetWan, getWanIp };
