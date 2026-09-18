const logger = require('../../logger');

function resetWan(conn) {
  return new Promise((resolve, reject) => {
    const cmd = '/interface pppoe-client disable [find] ; :delay 3s ; /interface pppoe-client enable [find] ; :delay 10s ; /ip address print where interface~"pppoe"';

    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.stderr.on('data', (data) => {
        logger.debug('MikroTik stderr:', { data: data.toString() });
      });
      stream.on('close', () => resolve(output));
    });
  });
}

function getWanIp(conn) {
  return new Promise((resolve, reject) => {
    const cmd = '/ip address print terse where interface~"pppoe" || interface~"lte"';

    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.on('close', () => {
        const match = output.match(/address=([0-9.]+)/);
        resolve(match ? match[1] : null);
      });
    });
  });
}

module.exports = { resetWan, getWanIp };
