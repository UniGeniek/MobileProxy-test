const logger = require('../../logger');

function resetWan(conn) {
  return new Promise((resolve, reject) => {
    // hacky curl spray reboot command - maybe this shit works on ZTE modems maybe it does jack shit, who knows
    const cmd = 'curl -s "http://192.168.0.1/goform/goform_set_cmd_process" -d "goformId=REBOOT_DEVICE" 2>/dev/null || (ifdown wan && sleep 3 && ifup wan) && sleep 12';

    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);

      let output = '';
      stream.on('data', (data) => { output += data.toString(); });
      stream.on('close', () => resolve(output));
    });
  });
}

function getWanIp(conn) {
  return new Promise((resolve, reject) => {
    const cmd = `ip -4 route get 1.1.1.1 2>/dev/null | grep -oP 'src \\K[0-9.]+'`;

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
