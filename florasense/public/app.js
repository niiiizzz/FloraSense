(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SCALE_MIN = 400, SCALE_MAX = 2400; // display range of the dryness bar only

  let state = null, settings = null, events = [];
  let metric = 'soil', range = 60, lastReadingAt = 0, histCache = [];


  // ---------- pixel sprites (16x16, drawn as crisp rects) ----------
  const PAL = { g: '#52613a', l: '#8fa079', d: '#3a4628', p: '#b0502b', P: '#8a3b1e', s: '#6b4a2b', y: '#c99a2e', b: '#3e6a70', B: '#8fbfc6', k: '#787360', w: '#f6f1e4' };
  const SPR = {
    happy: ['................','......l..l......','.....lgllgl.....','....lggllggl....','.....gggggg.....','..l...gggg..l...','.lgl..gggg.lgl..','.lggl.gggg.lggl.','..lgggggggggl...','....lgggggg.....','......gggg......','...pppppppppp...','...pPPPPPPPPp...','....pppppppp....','....pPPPPPPp....','.....pppppp.....'],
    thirsty: ['................','.........gg.....','........ggg.....','.......gg.......','...gg.gg........','..gggggg.....bb.','.g..ggg.....bBb.','.....gg....bBBb.','.....gg.....bbb.','.....gg.........','.....gg.........','...pppppppppp...','...pPPPPPPPPp...','....pppppppp....','....pPPPPPPp....','.....pppppp.....'],
    offline: ['................','................','......kk........','.....kkkk.......','....kk..kk......','................','......kk........','......kk........','......kk........','................','................','...kkkkkkkkkk...','...kkkkkkkkkk...','....kkkkkkkk....','....kkkkkkkk....','.....kkkkkk.....'],
  };
  SPR.waiting = SPR.warming = SPR.happy;
  function spriteSvg(rows) {
    let r = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (PAL[ch]) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PAL[ch]}"/>`; }));
    return `<svg viewBox="0 0 16 16">${r}</svg>`;
  }
  let spriteState = '';
  function setSprite(st) {
    if (st === spriteState) return; spriteState = st;
    const el = $('sprite'); el.innerHTML = spriteSvg(SPR[st] || SPR.happy);
    el.classList.toggle('bob', st === 'thirsty' || st === 'happy');
  }
  const EV_ICON = { urgent: '🚿', good: '🪴', warn: '🌡️', info: '📡' };

  // ---------- rendering ----------
  function renderStatus(st) {
    state = st;
    const l = st.latest;
    const hero = $('hero');
    hero.dataset.state = st.state;
    const name = settings ? settings.plantName : "Your plant";
    const copy = {
      waiting: ['Listening…', 'Waiting for the first reading from the sensor.'],
      warming: ['Settling in…', 'Collecting a few readings before judging the soil.'],
      happy: ['Content. 🪴', `${name} has enough water. I’ll tell you the moment that changes.`],
      thirsty: ['Thirsty! 🚿', `${name} needs water. A notification has been sent.`],
      offline: ['Gone quiet.', 'No readings lately. Check the USB cable, power, or Wi-Fi.'],
    }[st.state];
    setSprite(st.state);
    $('heroTitle').textContent = copy[0];
    $('heroSub').textContent = copy[1];

    if (l) {
      lastReadingAt = l.t;
      $('adcBig').textContent = l.soilFiltered ?? l.soilRaw ?? '—';
      $('soilVal').textContent = l.soilRaw ?? '—';
      $('tempVal').textContent = l.temperature != null ? l.temperature.toFixed(1) : '—';
      $('humVal').textContent = l.humidity != null ? l.humidity.toFixed(0) : '—';
      $('tempNote').textContent = l.temperature == null ? 'DHT22 read failed' : tempWord(l.temperature);
      $('humNote').textContent = l.humidity == null ? 'DHT22 read failed' : 'relative humidity';
      $('pctText').textContent = l.moisturePct != null ? `≈ ${l.moisturePct}% moisture` : 'percent needs calibration';
      $('lastAt').textContent = new Date(l.t).toLocaleTimeString();
      $('marker').style.left = pos(l.soilFiltered ?? l.soilRaw) + '%';
    }
    renderTick();
    updateAgo();
  }
  const pos = (adc) => Math.max(0, Math.min(100, ((adc - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));
  function renderTick() { if (settings) $('tickWater').style.left = pos(settings.waterAboveAdc) + '%'; }
  const tempWord = (t) => (t > 35 ? 'hot' : t < 12 ? 'cold' : 'comfortable range');

  function updateAgo() {
    if (!lastReadingAt) return;
    const s = Math.max(0, Math.round((Date.now() - lastReadingAt) / 1000));
    $('ago').textContent = s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
  }
  setInterval(updateAgo, 1000);

  function setConn(ok, text) {
    const c = $('conn');
    c.className = 'pill ' + (ok ? 'live' : 'bad');
    $('connText').textContent = text;
  }

  // ---------- events ----------
  const ago = (t) => {
    const d = (Date.now() - t) / 1000;
    if (d < 60) return 'just now';
    if (d < 3600) return `${Math.round(d / 60)} min ago`;
    if (d < 86400) return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  function renderEvents() {
    const ul = $('events');
    if (!events.length) return;
    ul.innerHTML = events.map((e) => {
      const chans = (e.delivery || []).filter((d) => !d.skipped).map((d) =>
        `<span class="chan ${d.ok ? '' : 'fail'}" title="${esc(d.error || 'delivered')}">${esc(d.channel)}${d.ok ? ' ✓' : ' ✕'}</span>`).join('');
      return `<li><span class="lv">${EV_ICON[e.level] || '🔔'}</span><div><b>${esc(e.title)}${chans}</b><span class="body">${esc(e.body)}</span></div><span class="meta">${ago(e.t)}</span></li>`;
    }).join('');
  }

  // ---------- browser notifications + sound ----------
  function browserNotify(e) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(e.title, { body: e.body, tag: e.type, icon: undefined }); } catch { /* ignore */ }
  }
  let audioCtx;
  function chime(level) {
    if (level !== 'urgent') return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [660, 523].forEach((f, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.22);
        g.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + i * 0.22 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.22 + 0.4);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.22); o.stop(audioCtx.currentTime + i * 0.22 + 0.45);
      });
    } catch { /* autoplay blocked */ }
  }
  function permBanner() {
    $('permBanner').hidden = !('Notification' in window) || Notification.permission !== 'default';
  }
  $('btnPerm').onclick = async () => { await Notification.requestPermission(); permBanner(); };

  // ---------- chart ----------
  const METRICS = {
    soil: { key: 'soilFiltered', label: 'ADC', color: 'var(--clay)', dec: 0, flip: true },
    temperature: { key: 'temperature', label: '°C', color: 'var(--ochre)', dec: 1 },
    humidity: { key: 'humidity', label: '%', color: 'var(--slate)', dec: 0 },
  };
  async function loadHistory() {
    try { histCache = await (await fetch(`/api/history?minutes=${range}`)).json(); } catch { histCache = []; }
    drawChart();
  }
  function pushLive(l) { if (!l) return; histCache.push(l); const cut = Date.now() - range * 60000; while (histCache.length && histCache[0].t < cut) histCache.shift(); drawChart(); }
  function drawChart() {
    const M = METRICS[metric], el = $('chart');
    const pts = histCache.filter((h) => h[M.key] != null);
    if (pts.length < 2) { el.innerHTML = '<div class="empty">Collecting data…</div>'; return; }
    const W = el.clientWidth || 700, H = el.clientHeight || 260, pl = 46, pr = 12, pt = 10, pb = 24;
    const t0 = Date.now() - range * 60000, t1 = Date.now();
    let vals = pts.map((p) => p[M.key]), thr = null;
    if (metric === 'soil' && settings) { thr = settings.waterAboveAdc; vals = vals.concat(thr); }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const padv = Math.max((hi - lo) * 0.15, metric === 'soil' ? 40 : 0.5); lo -= padv; hi += padv;
    const x = (t) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr);
    const y = (v) => pt + (1 - (v - lo) / (hi - lo)) * (H - pt - pb);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[M.key]).toFixed(1)}`).join('');
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4, yy = y(v);
      g += `<line x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${pl - 8}" y="${yy + 4}" text-anchor="end">${v.toFixed(M.dec)}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const t = t0 + ((t1 - t0) * i) / 4;
      g += `<text x="${x(t)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>`;
    }
    const thrLine = thr != null ? `<line x1="${pl}" x2="${W - pr}" y1="${y(thr)}" y2="${y(thr)}" stroke="var(--ink)" stroke-dasharray="5 4" opacity=".5"/><text x="${W - pr - 4}" y="${y(thr) - 5}" text-anchor="end">needs water</text>` : '';
    const last = pts[pts.length - 1];
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${metric} history">${g}${thrLine}
      <path d="${path}" fill="none" stroke="${M.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(last.t)}" cy="${y(last[M.key])}" r="4" fill="${M.color}"/></svg>`;
  }
  $('metricTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; metric = b.dataset.m; [...$('metricTabs').children].forEach((c) => c.classList.toggle('on', c === b)); drawChart(); };
  $('rangeTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; range = +b.dataset.r; [...$('rangeTabs').children].forEach((c) => c.classList.toggle('on', c === b)); loadHistory(); };
  window.addEventListener('resize', drawChart);
  setInterval(loadHistory, 60000);

  // ---------- settings ----------
  const dlg = $('settingsDlg'), form = $('settingsForm');
  function fillForm() {
    if (!settings) return;
    const set = (n, v) => { form.elements[n].value = v ?? ''; };
    set('plantName', settings.plantName);
    ['waterAboveAdc', 'recoveredBelowAdc', 'confirmSamples', 'reminderMinutes', 'tempHighC', 'tempLowC', 'humidityHigh'].forEach((k) => set(k, settings[k]));
    set('dryAdc', settings.calibration.dryAdc); set('wetAdc', settings.calibration.wetAdc);
    ['ntfyTopic', 'ntfyServer', 'telegramBotToken', 'telegramChatId'].forEach((k) => set(k, settings.notify[k]));
  }
  $('btnSettings').onclick = () => { fillForm(); $('formMsg').textContent = ''; dlg.showModal(); };
  const cur = () => state && state.latest && (state.latest.soilFiltered ?? state.latest.soilRaw);
  $('btnUseDry').onclick = () => { const v = cur(); if (v == null) return; form.elements.waterAboveAdc.value = v; form.elements.recoveredBelowAdc.value = Math.round(v * 0.82); };
  $('btnMarkDry').onclick = () => { const v = cur(); if (v != null) form.elements.dryAdc.value = v; };
  $('btnMarkWet').onclick = () => { const v = cur(); if (v != null) form.elements.wetAdc.value = v; };
  $('btnClearCal').onclick = () => { form.elements.dryAdc.value = ''; form.elements.wetAdc.value = ''; };

  form.addEventListener('submit', async (e) => {
    if (e.submitter && e.submitter.value !== 'save') return; // Close
    e.preventDefault();
    const v = (n) => form.elements[n].value;
    const nv = (n) => (v(n) === '' ? null : +v(n));
    const body = {
      plantName: v('plantName'),
      waterAboveAdc: +v('waterAboveAdc'), recoveredBelowAdc: +v('recoveredBelowAdc'),
      confirmSamples: +v('confirmSamples'), reminderMinutes: +v('reminderMinutes'),
      tempHighC: +v('tempHighC'), tempLowC: +v('tempLowC'), humidityHigh: +v('humidityHigh'),
      calibration: { dryAdc: nv('dryAdc'), wetAdc: nv('wetAdc') },
      notify: { ntfyTopic: v('ntfyTopic'), ntfyServer: v('ntfyServer'), telegramBotToken: v('telegramBotToken'), telegramChatId: v('telegramChatId') },
    };
    const msg = $('formMsg');
    const r = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { msg.className = 'form-msg'; msg.textContent = j.error || 'Could not save.'; return; }
    settings = j; msg.className = 'form-msg ok'; msg.textContent = 'Saved.';
    $('plantName').textContent = settings.plantName; renderTick(); if (state) renderStatus(state); loadHistory();
    setTimeout(() => dlg.close(), 500);
  });

  $('btnTest').onclick = async () => {
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    await fetch('/api/test-notification', { method: 'POST' });
  };

  // ---------- live stream ----------
  function init(snap) {
    settings = snap.settings; events = snap.events;
    $('plantName').textContent = settings.plantName;
    $('sourceName').textContent = snap.source;
    renderStatus(snap.status); renderEvents(); permBanner(); loadHistory();
  }
  function connect() {
    const es = new EventSource('/api/stream');
    es.addEventListener('hello', (e) => { setConn(true, 'live'); init(JSON.parse(e.data)); });
    es.addEventListener('reading', (e) => { const d = JSON.parse(e.data); setConn(true, 'live'); renderStatus(d.status); pushLive(d.latest); });
    es.addEventListener('settings', (e) => { settings = JSON.parse(e.data); $('plantName').textContent = settings.plantName; renderTick(); });
    es.addEventListener('alert', (e) => { const a = JSON.parse(e.data); events.unshift(a); events = events.slice(0, 40); renderEvents(); browserNotify(a); chime(a.level); fetch('/api/state').then((r) => r.json()).then((s) => renderStatus(s.status)); });
    es.addEventListener('alert-delivery', (e) => { const d = JSON.parse(e.data); const ev = events.find((x) => x.id === d.id); if (ev) { ev.delivery = d.delivery; renderEvents(); } });
    es.onerror = () => setConn(false, 'reconnecting');
  }
  connect();
})();
