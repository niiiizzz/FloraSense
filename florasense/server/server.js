const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { Engine, DEFAULT_SETTINGS } = require('./engine');
const { dispatch } = require('./notifiers');
const { startSerial, startSimulator } = require('./sources');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const F_SETTINGS = path.join(DATA, 'settings.json');
const F_STATE = path.join(DATA, 'state.json');

// ---- config (config.json is optional and git-ignored) -----------------------
let config = { port: 3000, serialPort: 'COM6', baudRate: 115200, apiKey: '' };
try { Object.assign(config, JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))); } catch { /* defaults */ }
const DEMO = process.argv.includes('--demo');
if (process.env.PORT) config.port = +process.env.PORT;
if (process.env.SERIAL_PORT !== undefined) config.serialPort = process.env.SERIAL_PORT;
if (process.env.API_KEY) config.apiKey = process.env.API_KEY;
// serverPush: "all" = server sends phone alerts, "offline" = only sensor-offline alerts
// (use when the ESP32 sends the watering alerts itself), "none" = never.
config.serverPush = process.env.SERVER_PUSH || config.serverPush || 'all';
const DASH_PASSWORD = process.env.DASH_PASSWORD || config.dashPassword || '';

const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ---- persistence -----------------------------------------------------------
const deepMerge = (base, extra) => {
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) ? deepMerge(base[k] || {}, extra[k]) : extra[k];
  }
  return out;
};
let settings = DEFAULT_SETTINGS;
try { settings = deepMerge(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(F_SETTINGS, 'utf8'))); } catch { /* first run */ }
// Cloud hosts have throw-away disks: FLORA_SETTINGS (JSON env var) re-applies your settings on every start.
try { if (process.env.FLORA_SETTINGS) settings = deepMerge(settings, JSON.parse(process.env.FLORA_SETTINGS)); } catch (e) { console.error('bad FLORA_SETTINGS', e.message); }

let history = [];  // {t, soilRaw, soilFiltered, temperature, humidity}
let events = [];   // {id, t, type, level, title, body, delivery}
try { ({ history = [], events = [] } = JSON.parse(fs.readFileSync(F_STATE, 'utf8'))); } catch { /* first run */ }
if (DEMO) { history = []; events = []; }

const saveSettings = () => fs.writeFileSync(F_SETTINGS, JSON.stringify(settings, null, 2));
let dirty = false;
const saveState = () => {
  if (!dirty || DEMO) return;
  dirty = false;
  fs.writeFile(F_STATE, JSON.stringify({ history: history.slice(-20000), events: events.slice(-200) }), () => {});
};
setInterval(saveState, 30000);

// ---- live stream (SSE) ------------------------------------------------------
const clients = new Set();
const broadcast = (name, payload) => {
  const msg = `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) c.write(msg);
};

// ---- engine -----------------------------------------------------------------
let eventSeq = events.reduce((m, e) => Math.max(m, e.id || 0), 0);
async function onEvent(ev) {
  const full = { id: ++eventSeq, t: Date.now(), ...ev, delivery: [] };
  events.push(full);
  dirty = true;
  log(`EVENT [${ev.level}] ${ev.title} - ${ev.body}`);
  broadcast('alert', full);                         // dashboard / browser notification
  const pushOk = config.serverPush === 'all' || (config.serverPush === 'offline' && ev.type.startsWith('sensor_'));
  if (pushOk && (!DEMO || settings.notify.ntfyTopic)) { // phone push (ntfy / Telegram)
    full.delivery = await dispatch(settings.notify, ev);
    for (const d of full.delivery) if (d.ok === false) log(`  ${d.channel} failed: ${d.error}`);
    broadcast('alert-delivery', { id: full.id, delivery: full.delivery });
  }
}
const engine = new Engine(settings, onEvent);
setInterval(() => { engine.tick(); }, 5000);

function ingest(r) {
  const latest = engine.ingest(r);
  history.push({ t: latest.t, soilRaw: latest.soilRaw, soilFiltered: latest.soilFiltered, temperature: latest.temperature, humidity: latest.humidity });
  if (history.length > 40000) history.splice(0, history.length - 40000);
  dirty = true;
  broadcast('reading', { latest, status: engine.status() });
}

// ---- HTTP -------------------------------------------------------------------
const app = express();
app.get('/healthz', (_q, res) => res.send('ok'));
app.use(express.json({ limit: '50kb' }));
// Optional password for the dashboard when it is on the internet. The ESP32 endpoint uses the API key instead.
if (DASH_PASSWORD) {
  app.use((req, res, next) => {
    if (req.path === '/api/readings') return next();
    const [, b64] = (req.get('authorization') || '').split(' ');
    const pass = Buffer.from(b64 || '', 'base64').toString().split(':').slice(1).join(':');
    if (pass === DASH_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="FloraSense"').sendStatus(401);
  });
}
app.use(express.static(path.join(ROOT, 'public')));

const snapshot = () => ({
  status: engine.status(),
  settings: publicSettings(),
  events: events.slice(-40).reverse(),
  source: DEMO ? 'demo' : (config.serialPort ? `serial ${config.serialPort}` : 'wifi'),
});
const publicSettings = () => ({
  ...settings,
  notify: { ...settings.notify, telegramBotToken: settings.notify.telegramBotToken ? '••••••' : '' },
});

app.get('/api/state', (_q, res) => res.json(snapshot()));

app.get('/api/history', (req, res) => {
  const mins = Math.min(Math.max(+req.query.minutes || 60, 1), 60 * 24 * 14);
  const since = Date.now() - mins * 60000;
  let rows = history.filter((h) => h.t >= since);
  const maxPts = 400;
  if (rows.length > maxPts) { const step = Math.ceil(rows.length / maxPts); rows = rows.filter((_, i) => i % step === 0); }
  res.json(rows);
});

app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify(snapshot())}\n\n`);
  clients.add(res);
  const ka = setInterval(() => res.write(': ka\n\n'), 20000);
  req.on('close', () => { clearInterval(ka); clients.delete(res); });
});

// Wi-Fi firmware posts here: {soilRaw, temperature, humidity}  (null when a sensor failed)
app.post('/api/readings', (req, res) => {
  if (config.apiKey && req.get('x-api-key') !== config.apiKey) return res.sendStatus(401);
  const b = req.body || {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (n(b.soilRaw) == null && n(b.temperature) == null) return res.status(400).json({ error: 'no usable values' });
  ingest({ soilRaw: n(b.soilRaw), temperature: n(b.temperature), humidity: n(b.humidity) });
  res.json({ ok: true });
});

app.post('/api/settings', (req, res) => {
  const b = req.body || {};
  const numKeys = ['waterAboveAdc', 'recoveredBelowAdc', 'confirmSamples', 'reminderMinutes', 'tempHighC', 'tempLowC', 'humidityHigh'];
  const next = deepMerge(settings, {});
  if (typeof b.plantName === 'string') next.plantName = b.plantName.trim().slice(0, 40) || next.plantName;
  for (const k of numKeys) if (b[k] !== undefined && Number.isFinite(+b[k])) next[k] = +b[k];
  if (b.calibration) for (const k of ['dryAdc', 'wetAdc']) if (b.calibration[k] !== undefined) next.calibration[k] = b.calibration[k] === null ? null : +b.calibration[k];
  if (b.notify) {
    for (const k of ['ntfyTopic', 'ntfyServer', 'telegramChatId']) if (typeof b.notify[k] === 'string') next.notify[k] = b.notify[k].trim();
    if (typeof b.notify.telegramBotToken === 'string' && !b.notify.telegramBotToken.includes('•')) next.notify.telegramBotToken = b.notify.telegramBotToken.trim();
  }
  if (next.recoveredBelowAdc >= next.waterAboveAdc) return res.status(400).json({ error: '"Watered below" must be lower than "Needs water above" (hysteresis).' });
  settings = next;
  engine.settings = settings;
  saveSettings();
  broadcast('settings', publicSettings());
  res.json(publicSettings());
});

app.post('/api/test-notification', async (_q, res) => {
  const ev = { type: 'test', level: 'urgent', title: `${settings.plantName} needs water (test)`, body: 'This is a test from your FloraSense dashboard.' };
  const full = { id: ++eventSeq, t: Date.now(), ...ev, delivery: [] };
  events.push(full); dirty = true;
  broadcast('alert', full);
  full.delivery = await dispatch(settings.notify, ev);
  broadcast('alert-delivery', { id: full.id, delivery: full.delivery });
  res.json({ delivery: full.delivery });
});

app.listen(config.port, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
  log(`FloraSense dashboard: http://localhost:${config.port}`);
  ips.forEach((ip) => log(`  on your network (phone / ESP32): http://${ip}:${config.port}`));
  if (DEMO) { log('DEMO MODE - simulated readings'); startSimulator(ingest, 4); }
  else if (config.serialPort) startSerial({ path: config.serialPort, baudRate: config.baudRate }, ingest, log);
  else log('No serial port configured - waiting for Wi-Fi firmware posts to /api/readings');
});

process.on('SIGINT', () => { dirty = true; saveState(); setTimeout(() => process.exit(0), 200); });
