// FloraSense processing layer: filtering, calibration, plant rules, alert state machine.
// Pure logic - no I/O - so it is easy to reason about and test.

const DEFAULT_SETTINGS = {
  plantName: 'Your plant',

  // Soil direction for THIS hardware: lower ADC = wetter, higher ADC = drier.
  // PLACEHOLDER thresholds picked from the exploratory tests (dry pot ~2200,
  // moist ~800-1500). Tune from the dashboard, ideally with "Mark as dry/wet".
  waterAboveAdc: 1800,   // filtered ADC at/above this => "needs water"
  recoveredBelowAdc: 1500, // filtered ADC must fall below this => "watered" (hysteresis)
  confirmSamples: 3,     // consecutive samples needed before an alert fires/clears
  reminderMinutes: 60,   // re-notify while the plant is still thirsty (0 = never)

  // Optional calibration. Percentage stays hidden until BOTH are set.
  calibration: { dryAdc: null, wetAdc: null },

  // Placeholder environment rules from the original project concept.
  tempHighC: 35,
  tempLowC: 12,
  humidityHigh: 85,

  offlineAfterSec: 60,

  notify: {
    ntfyTopic: '',          // e.g. florasense-krithik-8f3k  (pick something unguessable)
    ntfyServer: 'https://ntfy.sh',
    telegramBotToken: '',
    telegramChatId: '',
  },
};

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

class Engine {
  constructor(settings, emit) {
    this.settings = settings;
    this.emit = emit;            // emit(event) -> notifications + log
    this.rawWindow = [];         // last N raw soil samples (median filter)
    this.ema = null;             // smoothed value
    this.samples = 0;
    this.latest = null;
    this.lastSeen = 0;

    // alert state
    this.thirsty = false;
    this.overCount = 0;
    this.underCount = 0;
    this.lastThirstyNotify = 0;
    this.offline = false;
    this.envState = { tempHigh: false, tempLow: false, humHigh: false };
    this.dhtFailStreak = 0;
  }

  calibrationValid() {
    const { dryAdc, wetAdc } = this.settings.calibration;
    return Number.isFinite(dryAdc) && Number.isFinite(wetAdc) && dryAdc - wetAdc >= 200;
  }

  moisturePercent(adc) {
    if (!this.calibrationValid()) return null;
    const { dryAdc, wetAdc } = this.settings.calibration;
    const p = ((dryAdc - adc) / (dryAdc - wetAdc)) * 100;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  // r: { soilRaw:number|null, temperature:number|null, humidity:number|null, t?:ms }
  ingest(r) {
    const now = r.t || Date.now();
    this.lastSeen = now;
    if (this.offline) {
      this.offline = false;
      this.emit({ type: 'sensor_online', level: 'info', title: 'Sensor back online', body: 'FloraSense is sending readings again.' });
    }

    let soilFiltered = this.latest ? this.latest.soilFiltered : null;
    if (Number.isFinite(r.soilRaw)) {
      this.rawWindow.push(r.soilRaw);
      if (this.rawWindow.length > 5) this.rawWindow.shift();
      const med = median(this.rawWindow);                  // 5-sample median rejects single spikes
      // Adaptive smoothing: big real changes (probe pulled out / re-inserted / watering)
      // snap through immediately; small jitter is still smoothed.
      if (this.ema == null || Math.abs(r.soilRaw - this.ema) > 600) { this.ema = r.soilRaw; this.rawWindow = [r.soilRaw]; }
      else this.ema += 0.35 * (med - this.ema);
      soilFiltered = Math.round(this.ema);
      this.samples++;
    }

    const temperature = Number.isFinite(r.temperature) ? r.temperature : null;
    const humidity = Number.isFinite(r.humidity) ? r.humidity : null;
    this.dhtFailStreak = temperature == null || humidity == null ? this.dhtFailStreak + 1 : 0;

    this.latest = {
      t: now,
      soilRaw: Number.isFinite(r.soilRaw) ? r.soilRaw : null,
      soilFiltered,
      moisturePct: soilFiltered != null ? this.moisturePercent(soilFiltered) : null,
      temperature,
      humidity,
    };

    if (soilFiltered != null && this.samples >= 3) this.evalSoil(soilFiltered, now); // 3-sample warm-up
    this.evalEnvironment(temperature, humidity);
    return this.latest;
  }

  evalSoil(adc, now) {
    const s = this.settings;
    const need = Math.max(1, s.confirmSamples);

    if (!this.thirsty) {
      this.overCount = adc >= s.waterAboveAdc ? this.overCount + 1 : 0;
      if (this.overCount >= need) {
        this.thirsty = true;
        this.lastThirstyNotify = now;
        this.emit({
          type: 'water_needed', level: 'urgent',
          title: `${s.plantName} needs water`,
          body: `🚿 Soil reading is ${adc} (dry above ${s.waterAboveAdc}). Time for a drink.`,
        });
      }
    } else {
      this.underCount = adc < s.recoveredBelowAdc ? this.underCount + 1 : 0;
      if (this.underCount >= Math.max(1, need - 1)) {
        this.thirsty = false;
        this.overCount = 0;
        this.underCount = 0;
        this.emit({
          type: 'watered', level: 'good',
          title: `${s.plantName} has been watered`,
          body: `🪴 Soil reading dropped to ${adc}. All good - thank you!`,
        });
      } else if (s.reminderMinutes > 0 && now - this.lastThirstyNotify >= s.reminderMinutes * 60000) {
        this.lastThirstyNotify = now;
        this.emit({
          type: 'water_reminder', level: 'urgent',
          title: `Reminder: ${s.plantName} is still thirsty`,
          body: `Soil reading is still ${adc}.`,
        });
      }
    }
  }

  evalEnvironment(t, h) {
    const s = this.settings, st = this.envState;
    const flip = (key, cond, clearCond, onEvent) => {
      if (!st[key] && cond) { st[key] = true; this.emit(onEvent); }
      else if (st[key] && clearCond) { st[key] = false; }
    };
    if (t != null) {
      flip('tempHigh', t > s.tempHighC, t < s.tempHighC - 1,
        { type: 'temp_high', level: 'warn', title: 'It is getting hot', body: `${t.toFixed(1)} °C is above ${s.tempHighC} °C.` });
      flip('tempLow', t < s.tempLowC, t > s.tempLowC + 1,
        { type: 'temp_low', level: 'warn', title: 'It is getting cold', body: `${t.toFixed(1)} °C is below ${s.tempLowC} °C.` });
    }
    if (h != null) {
      flip('humHigh', h > s.humidityHigh, h < s.humidityHigh - 3,
        { type: 'humidity_high', level: 'warn', title: 'Air is very humid', body: `${h.toFixed(0)}% is above ${s.humidityHigh}%.` });
    }
  }

  // Called on a timer.
  tick(now = Date.now()) {
    if (this.lastSeen && !this.offline && now - this.lastSeen > this.settings.offlineAfterSec * 1000) {
      this.offline = true;
      this.emit({ type: 'sensor_offline', level: 'warn', title: 'FloraSense went quiet', body: `No readings for ${this.settings.offlineAfterSec}s. Check power / cable / Wi-Fi.` });
    }
  }

  status() {
    const s = this.settings;
    let state = 'waiting';
    if (this.offline) state = 'offline';
    else if (this.latest && this.samples < 3) state = 'warming';
    else if (this.latest) state = this.thirsty ? 'thirsty' : 'happy';
    return {
      state,
      latest: this.latest,
      thirsty: this.thirsty,
      calibrationValid: this.calibrationValid(),
      dhtFailStreak: this.dhtFailStreak,
      lastSeen: this.lastSeen,
      offline: this.offline,
      thresholds: { waterAboveAdc: s.waterAboveAdc, recoveredBelowAdc: s.recoveredBelowAdc },
    };
  }
}

module.exports = { Engine, DEFAULT_SETTINGS };
