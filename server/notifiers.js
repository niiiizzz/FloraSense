// Outbound push notifications. Browser notifications are handled client-side via SSE;
// these are the channels that reach the user's phone even when the dashboard is closed.

const PRIORITY = { urgent: 'high', warn: 'default', good: 'default', info: 'low' };
const TAGS = { urgent: 'droplet,warning', warn: 'thermometer', good: 'seedling', info: 'information_source' };

async function sendNtfy(n, ev) {
  if (!n.ntfyTopic) return { channel: 'ntfy', skipped: true };
  const base = (n.ntfyServer || 'https://ntfy.sh').replace(/\/$/, '');
  const res = await fetch(`${base}/${encodeURIComponent(n.ntfyTopic)}`, {
    method: 'POST',
    headers: {
      Title: ev.title.replace(/[^\x20-\x7E]/g, ''), // HTTP headers must be ASCII
      Priority: PRIORITY[ev.level] || 'default',
      Tags: TAGS[ev.level] || 'seedling',
    },
    body: ev.body,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  return { channel: 'ntfy', ok: true };
}

async function sendTelegram(n, ev) {
  if (!n.telegramBotToken || !n.telegramChatId) return { channel: 'telegram', skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${n.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: n.telegramChatId, text: `${ev.title}\n${ev.body}` }),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
  return { channel: 'telegram', ok: true };
}

async function dispatch(notifySettings, ev) {
  const jobs = [sendNtfy(notifySettings, ev), sendTelegram(notifySettings, ev)];
  const results = await Promise.allSettled(jobs);
  return results.map((r, i) => {
    const channel = i === 0 ? 'ntfy' : 'telegram';
    return r.status === 'fulfilled' ? r.value : { channel, ok: false, error: String(r.reason && r.reason.message || r.reason) };
  });
}

module.exports = { dispatch };
