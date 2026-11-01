// Data sources: USB serial (works with the existing known-good sketch AND the new
// firmware), plus a demo simulator. Wi-Fi firmware posts to /api/readings (server.js).

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const num = (s) => { const m = /(-?\d+(?:\.\d+)?)/.exec(s); return m ? parseFloat(m[1]) : null; };

// Parses the original test sketch output block:
//   Soil ADC Reading: 837 / Temperature: 32.6 °C / Humidity: 64.5 % / ---- separator
// and also JSON lines from the new firmware.
function startSerial({ path, baudRate = 115200 }, onReading, log) {
  let cur = { soilRaw: null, temperature: null, humidity: null };
  let port, retry;

  const connect = () => {
    port = new SerialPort({ path, baudRate, autoOpen: false });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (raw) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('{')) {
        try { const j = JSON.parse(line); onReading({ soilRaw: j.soilRaw ?? null, temperature: j.temperature ?? null, humidity: j.humidity ?? null }); } catch { /* ignore */ }
        return;
      }
      if (/^Soil ADC/i.test(line)) cur.soilRaw = num(line.split(':')[1]);
      else if (/^Temperature/i.test(line)) cur.temperature = num(line.split(':')[1]);
      else if (/^Humidity/i.test(line)) cur.humidity = num(line.split(':')[1]);
      else if (/^-{5,}/.test(line)) {
        if (cur.soilRaw != null) onReading(cur);
        cur = { soilRaw: null, temperature: null, humidity: null };
      }
    });

    port.on('error', (e) => log(`serial error: ${e.message}`));
    port.on('close', () => { log(`serial ${path} closed - retrying in 5s`); retry = setTimeout(connect, 5000); });
    port.open((err) => {
      if (err) { log(`cannot open ${path}: ${err.message} (is Arduino Serial Monitor still open?) - retrying in 5s`); retry = setTimeout(connect, 5000); }
      else log(`serial connected on ${path} @ ${baudRate}`);
    });
  };
  connect();
  return () => { clearTimeout(retry); if (port && port.isOpen) port.close(); };
}

// Demo: soil dries slowly until it crosses the threshold, then gets "watered".
function startSimulator(onReading, speed = 1) {
  let soil = 1300, dir = 1, t = 0;
  const id = setInterval(() => {
    t++;
    soil += dir * (28 * speed) + (Math.random() - 0.5) * 14;
    if (soil > 2150) dir = -1;
    if (dir === -1 && soil < 900) dir = 1;
    if (dir === -1) soil -= 60 * speed; // watering drops fast
    onReading({
      soilRaw: Math.round(soil),
      temperature: +(31.5 + Math.sin(t / 40) * 1.4 + Math.random() * 0.2).toFixed(1),
      humidity: +(64 + Math.cos(t / 50) * 2 + Math.random() * 0.4).toFixed(1),
    });
  }, 2500 / speed);
  return () => clearInterval(id);
}

module.exports = { startSerial, startSimulator };
