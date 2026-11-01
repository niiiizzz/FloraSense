// FloraSense firmware - ESP32 + HW-103 soil probe (GPIO34) + DHT22 (GPIO4)
//
// Standalone: the ESP32 decides "needs water" by itself and pushes the phone alert
// straight to ntfy over HTTPS - no laptop or server required. It can ALSO post
// readings to the dashboard server (optional). Wi-Fi/cloud trouble never stops sensing.
// Serial output keeps the original test-sketch format.
//
// Libraries: "DHT sensor library" (Adafruit) + Adafruit Unified Sensor.
// Setup: copy secrets.h.example -> secrets.h and edit it.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <DHT.h>
#include "secrets.h"

#define SOIL_PIN 34
#define DHT_PIN 4
#define DHT_TYPE DHT22
#define SAMPLE_INTERVAL_MS 2500
#define POST_INTERVAL_MS 5000   // dashboard upload rate

DHT dht(DHT_PIN, DHT_TYPE);

// ---------- soil filter: median of 5 + smoothing, big changes pass straight through ----------
int win[5];
int winN = 0;
float ema = -1;
int samples = 0;

int median5() {
  int t[5];
  for (int i = 0; i < winN; i++) t[i] = win[i];
  for (int i = 1; i < winN; i++) {
    int k = t[i], j = i - 1;
    while (j >= 0 && t[j] > k) { t[j + 1] = t[j]; j--; }
    t[j + 1] = k;
  }
  return t[winN / 2];
}

int filterSoil(int raw) {
  if (ema < 0 || fabs(raw - ema) > 600) {
    ema = raw; win[0] = raw; winN = 1;
  } else {
    if (winN < 5) win[winN++] = raw;
    else { for (int i = 0; i < 4; i++) win[i] = win[i + 1]; win[4] = raw; }
    ema += 0.35f * (median5() - ema);
  }
  samples++;
  return (int)(ema + 0.5f);
}

// ---------- alert state ----------
bool thirsty = false;
int overCount = 0, underCount = 0;
unsigned long lastReminder = 0;

// A pending alert is kept until it is actually delivered, so a Wi-Fi outage cannot lose it.
bool pending = false;
String pTitle, pBody, pPriority, pTags;
unsigned long lastNtfyTry = 0;

void queueAlert(const String& title, const String& body, const char* priority, const char* tags) {
  pTitle = title; pBody = body; pPriority = priority; pTags = tags;
  pending = true; lastNtfyTry = 0;
  Serial.print("ALERT queued: "); Serial.println(title);
}

void sendPending() {
  if (!pending || WiFi.status() != WL_CONNECTED) return;
  if (lastNtfyTry && millis() - lastNtfyTry < 15000) return;  // retry every 15 s
  lastNtfyTry = millis();
  WiFiClientSecure client;
  client.setInsecure();  // prototype: skips certificate check. Pin a CA cert for production.
  HTTPClient http;
  http.setTimeout(6000);
  if (!http.begin(client, String("https://ntfy.sh/") + NTFY_TOPIC)) return;
  http.addHeader("Title", pTitle);
  http.addHeader("Priority", pPriority);
  http.addHeader("Tags", pTags);
  int code = http.POST(pBody);
  http.end();
  Serial.print("ntfy -> "); Serial.println(code);
  if (code >= 200 && code < 300) pending = false;
}

void evalAlerts(int adc) {
  if (samples < 3) return;  // warm-up
  unsigned long now = millis();
  if (!thirsty) {
    overCount = adc >= WATER_ABOVE_ADC ? overCount + 1 : 0;
    if (overCount >= CONFIRM_DRY_SAMPLES) {
      thirsty = true; lastReminder = now;
      queueAlert(String(PLANT_NAME) + " needs water",
                 String("Soil reading is ") + adc + " (dry above " + WATER_ABOVE_ADC + "). Time for a drink.",
                 "high", "droplet,warning");
    }
  } else {
    underCount = adc < RECOVERED_BELOW_ADC ? underCount + 1 : 0;
    if (underCount >= CONFIRM_WET_SAMPLES) {
      thirsty = false; overCount = 0; underCount = 0;
      queueAlert(String(PLANT_NAME) + " has been watered",
                 String("Soil reading dropped to ") + adc + ". All good!",
                 "default", "seedling");
    } else if (REMINDER_MINUTES > 0 && now - lastReminder >= (unsigned long)REMINDER_MINUTES * 60000UL) {
      lastReminder = now;
      queueAlert(String(PLANT_NAME) + " is still thirsty",
                 String("Soil reading is still ") + adc + ".",
                 "high", "droplet");
    }
  }
}

// ---------- Wi-Fi + dashboard upload ----------
unsigned long lastWifiTry = 0, lastPost = 0, lastSample = 0;

void wifiMaintain() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (lastWifiTry && millis() - lastWifiTry < 10000) return;
  lastWifiTry = millis();
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.println("Wi-Fi: connecting...");
}

void postReading(int soilRaw, float t, float h) {
  if (strlen(SERVER_HOST) == 0 || WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastPost < POST_INTERVAL_MS) return;
  lastPost = millis();
  String json = String("{\"soilRaw\":") + soilRaw +
                ",\"temperature\":" + (isnan(t) ? String("null") : String(t, 1)) +
                ",\"humidity\":" + (isnan(h) ? String("null") : String(h, 1)) + "}";
  String url = String(SERVER_USE_TLS ? "https://" : "http://") + SERVER_HOST + ":" + SERVER_PORT + "/api/readings";
  WiFiClientSecure sclient;
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(4000);
  bool ok;
  if (SERVER_USE_TLS) { sclient.setInsecure(); ok = http.begin(sclient, url); }
  else ok = http.begin(client, url);
  if (!ok) return;
  http.addHeader("Content-Type", "application/json");
  if (strlen(API_KEY) > 0) http.addHeader("x-api-key", API_KEY);
  int code = http.POST(json);
  http.end();
  Serial.print("dashboard POST -> "); Serial.println(code);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  analogReadResolution(12);
  pinMode(SOIL_PIN, INPUT);
  dht.begin();
  WiFi.mode(WIFI_STA);
  Serial.println();
  Serial.println("================================");
  Serial.println("       FloraSense Started");
  Serial.println(" Soil + Temperature + Humidity");
  Serial.println("================================");
}

void loop() {
  wifiMaintain();
  sendPending();  // retries until delivered; never blocks sensing for long
  if (millis() - lastSample < SAMPLE_INTERVAL_MS) return;
  lastSample = millis();

  long total = 0;
  for (int i = 0; i < 10; i++) { total += analogRead(SOIL_PIN); delay(20); }
  int soilRaw = total / 10;
  int soilFiltered = filterSoil(soilRaw);
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  Serial.print("Soil ADC Reading: "); Serial.println(soilRaw);
  if (isnan(t) || isnan(h)) {
    Serial.println("ERROR: DHT22 reading failed!");
  } else {
    Serial.print("Temperature: "); Serial.print(t, 1); Serial.println(" C");
    Serial.print("Humidity: "); Serial.print(h, 1); Serial.println(" %");
  }
  Serial.println("--------------------------------");

  evalAlerts(soilFiltered);
  postReading(soilRaw, t, h);
}
