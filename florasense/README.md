# FloraSense dashboard

ESP32 (HW-103 soil + DHT22) -> USB serial or Wi-Fi -> Node server -> live dashboard + push notifications.

## Run
    npm install
    npm start          # reads your board on COM6 (edit config.json to change)
    npm run demo       # simulated plant, no hardware needed
Open http://localhost:3000. Close Arduino Serial Monitor first (it locks COM6).

## Notifications (the point of the project)
- **Dashboard / desktop**: click "Turn on alerts" (works while a tab is open) + chime.
- **Phone**: install the free *ntfy* app, subscribe to a hard-to-guess topic, paste the same topic in Settings. Works with the dashboard closed, as long as the PC is running the server.
- **Telegram** (optional): bot token + chat id in Settings.
Use "Send test" to verify. Alerts: needs water, watered, reminder every N min, hot/cold/humid, sensor offline.

## Wi-Fi mode (no USB)
1. Copy `config.example.json` -> `config.json`, set `"serialPort": ""`.
2. Edit `firmware/FloraSense/secrets.h` (`USE_WIFI 1`, SSID, PC IP shown at server start), upload with Arduino IDE (needs Adafruit "DHT sensor library").
3. PC and ESP32 on the same network; allow Node through Windows Firewall on port 3000.

## Calibration notes
Raw ADC is always shown. Water threshold defaults (1800 / 1500) are placeholders from the exploratory tests; tune in Settings. Moisture % stays hidden until you set dry+wet points.

## Standalone + cloud (terrace setup)
- The ESP32 sends the *needs water* phone alert itself via ntfy (needs only Wi-Fi). Set NTFY_TOPIC and thresholds in `secrets.h`.
- Optionally also post readings to a hosted dashboard (Render): set SERVER_HOST, SERVER_PORT 443, SERVER_USE_TLS 1, API_KEY.
- Host env vars: SERIAL_PORT= (empty), SERVER_PUSH=offline (server only alerts if the sensor goes silent), API_KEY, DASH_PASSWORD, FLORA_SETTINGS (JSON, e.g. {"plantName":"Money plant","notify":{"ntfyTopic":"..."}}). `render.yaml` is included.
- Keep thresholds in `secrets.h` equal to the dashboard Settings.
