const logger = require('../../logger');

function resetWan(conn) {
  return new Promise((resolve, reject) => {
    // hacky HiLink XML payload over HTTP API — maybe this shit reboots the modem maybe it drops requests, fuck if I know
    const actualCmd = 'curl -s -X POST http://192.168.8.1/api/device/control -d \'<?xml version="1.0" encoding="UTF-8"?><request><Control>4</Control></request>\' -H "Content-Type: text/xml" 2>/dev/null || (ifdown wan && sleep 3 && ifup wan) && sleep 10';

    conn.exec(actualCmd, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.stderr.on('data', (data) => {
        logger.debug('Huawei stderr:', { data: data.toString() });
      });
      stream.on('close', () => resolve(output));
    });
  });
}

function getWanIp(conn) {
  return new Promise((resolve, reject) => {
    const cmd = `curl -s http://192.168.8.1/api/device/signal 2>/dev/null | grep -oP '<WanIP>\\K[^<]+' || ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \\K[0-9.]+'`;

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
