# FloraSense --- Hardware Testing, Observations & Software Integration Handover

**Purpose:** This document records the hardware setup, wiring, tests
performed, raw observations, interpretations, known limitations, and
implementation guidance for continuing the FloraSense software using
Claude Code.

**Project status:** Physical sensor readings have been verified on the
ESP32. The project is ready to begin structured firmware development.
Soil-moisture percentage calibration is still pending.

------------------------------------------------------------------------

## 1. Project overview

FloraSense is an ESP32-based plant and environmental monitoring
prototype. Its current physical prototype measures:

-   Soil condition using an HW-103 resistive soil-moisture module and
    its two-prong HW-080 probe.
-   Air temperature using a DHT22 sensor.
-   Relative humidity using the same DHT22 sensor.

The ESP32 reads the sensors and sends their values to the Serial
Monitor. The next development goal is to build robust firmware and then
integrate Wi-Fi and an IoT dashboard.

### Important scope clarification

The current hardware contains **one soil-moisture probe**, so the
implemented prototype currently monitors one soil zone. Do not describe
the physical prototype as having two independently monitored soil zones
unless a second soil sensor and its wiring are added.

------------------------------------------------------------------------

## 2. Hardware inventory

  -----------------------------------------------------------------------
  Component               Identified details      Purpose
  ----------------------- ----------------------- -----------------------
  Microcontroller         ESP32 Dev Module, board Sensor processing and
                          marked ESP-32 /         connectivity
                          ESP32-32X; upload       
                          identified chip as      
                          ESP32-D0WD-V3           

  Soil sensor module      HW-103, blue comparator Analog soil-sensor
                          board with LM393        interface

  Soil probe              HW-080, two-prong probe Senses soil electrical
                          connected to the HW-103 properties
                          module                  

  Temperature/humidity    DHT22 / AM2302 breakout Measures ambient
  sensor                                          temperature and
                                                  relative humidity

  Breadboard              Approximately 8.2 cm ×  Prototyping connections
                          5.5 cm × 0.85 cm        

  USB connection          Micro-USB data cable    Programming and serial
                                                  communication
  -----------------------------------------------------------------------

The ESP32 upload was successful using **COM6**. The upload log reported
connection to the ESP32, flash writing, hash verification, and a hard
reset. This confirms that the board and the working USB data connection
were detected during that test.

------------------------------------------------------------------------

## 3. Verified wiring

Use the printed pin labels on the modules. Disconnect USB power before
changing wiring.

### HW-103 soil module

  HW-103 pin   ESP32 connection           Notes
  ------------ -------------------------- -------------------------------------------------
  VCC          3V3                        Power the module at 3.3 V
  GND          GND                        Common ground
  AO           GPIO34 / board label D34   Analog soil reading
  DO           Not connected              Digital comparator output is not currently used

The HW-080 two-prong probe connects to the matching two-pin connector on
the HW-103 board.

### DHT22 breakout

  DHT22 pin   ESP32 connection
  ----------- ------------------------
  `+`         3V3
  `OUT`       GPIO4 / board label D4
  `-`         GND

The pictured/used sensor is treated as a breakout board. If replacing it
with a bare DHT22 sensor, check whether an external data pull-up
resistor is required.

### Electrical notes

-   The HW-103 module is powered from 3.3 V so its analog output is kept
    within the ESP32 input range.
-   GPIO34 is an input-only ESP32 pin and is suitable for analog
    measurement.
-   Both sensors share ESP32 ground.
-   Do not connect the HW-103 analog output to a 5 V-powered output
    arrangement that could exceed the ESP32 input voltage limit.
-   The DO pin is not needed for the current analog-reading firmware.

------------------------------------------------------------------------

## 4. Firmware and test setup

The combined Arduino sketch used:

-   Arduino IDE
-   Arduino C++
-   ESP32 Arduino Core
-   DHT sensor library
-   Soil analog input on GPIO34
-   DHT22 data input on GPIO4
-   Serial Monitor at 115200 baud

The sketch sets the ESP32 ADC resolution to 12 bits, giving a nominal
raw range of 0--4095.

### Combined test sketch used

``` cpp
#include <DHT.h>

#define SOIL_PIN 34
#define DHT_PIN 4
#define DHT_TYPE DHT22

DHT dht(DHT_PIN, DHT_TYPE);

void setup() {
  Serial.begin(115200);
  delay(1000);

  analogReadResolution(12);
  pinMode(SOIL_PIN, INPUT);
  dht.begin();

  Serial.println();
  Serial.println("================================");
  Serial.println("       FloraSense Started");
  Serial.println(" Soil + Temperature + Humidity");
  Serial.println("================================");

  delay(2000);
}

void loop() {
  long total = 0;

  for (int i = 0; i < 10; i++) {
    total += analogRead(SOIL_PIN);
    delay(20);
  }

  int soilRaw = total / 10;

  Serial.print("Soil ADC Reading: ");
  Serial.println(soilRaw);

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("ERROR: DHT22 reading failed!");
  } else {
    Serial.print("Temperature: ");
    Serial.print(temperature, 1);
    Serial.println(" °C");

    Serial.print("Humidity: ");
    Serial.print(humidity, 1);
    Serial.println(" %");
  }

  Serial.println("--------------------------------");
  delay(2500);
}
```

### Important code-organization lesson

All `.ino` and source files included in one Arduino sketch are compiled
together. The project must have only one `setup()` and one `loop()`
definition. An earlier linker error occurred because separate files both
defined these functions. The tests were resolved by combining the sensor
logic into one sketch with a single `setup()` and `loop()`.

### Current test firmware limitations

This sketch is a hardware-verification sketch, not the finished
application. It:

-   Reads the soil ADC and averages 10 ADC samples per reported reading.
-   Reads DHT22 temperature and humidity.
-   Detects failed DHT22 reads using `isnan()`.
-   Prints values to Serial Monitor.

It does **not yet** implement Wi-Fi, Blynk, cloud telemetry,
moisture-percentage calibration, persistent storage, notification logic,
or a complete plant-health decision engine.

------------------------------------------------------------------------

## 5. USB, driver and upload troubleshooting history

The ESP32 initially did not appear in Arduino IDE's **Tools → Port**
menu. Windows Device Manager showed no ESP32 COM port, and installing
the CP210x VCP driver and scanning for hardware changes did not
initially solve it.

The USB cable was eventually identified as the issue: the original cable
was charge-only. A different data-capable Micro-USB cable, obtained from
a friend, allowed the board to connect.

The successful upload showed:

-   Serial port: COM6
-   Connected to ESP32
-   Chip: ESP32-D0WD-V3, revision 3.1
-   Wi-Fi and Bluetooth features reported
-   Flash writing completed
-   Hash verification completed
-   Hard reset performed

**Current status:** USB data connection and Arduino upload are working.
Do not treat the earlier missing COM port as an unresolved board
failure.

------------------------------------------------------------------------

## 6. Soil sensor observations and interpretation

### Understanding the ADC values

The ESP32 ADC is configured for 12-bit readings, so the nominal raw
range is 0--4095. The HW-103 is a resistive sensor module. In the tests
performed with this particular module and wiring:

**Lower ADC readings were observed when the soil was wetter; higher
readings were observed in drier conditions.**

This direction is an empirical observation for this specific setup. It
should be rechecked if wiring, module, power, board, or sensor changes.

A raw ADC reading is not a moisture percentage. The output is affected
by soil composition, salinity/fertilizer, temperature, probe contact,
insertion depth, location, and sensor condition. Resistive probes can
also corrode over time.

### Test A --- Probe exposed to air

An initial test with the probe exposed to air produced:

  Measurement                      Observed value
  ------------------- ---------------------------
  Soil ADC                                   4095
  Temperature                             33.1 °C
  Relative humidity     Approximately 62.4--62.6%

**Interpretation:** 4095 is at the top of the nominal 12-bit ADC range.
This is an air-exposure observation, not a valid dry-soil calibration
endpoint. Do not use 4095 as the dry-soil reference in a soil-moisture
percentage formula.

### Test B --- Dry Aloe Vera pot soil

The probe was inserted into soil in the Aloe Vera pot. The reported
readings were:

``` text
2203, 2211, 2235, 2210, 2223, 2223, 2224
```

  Measurement            Result
  -------------------- --------
  Number of readings          7
  Average                2218.4
  Minimum                  2203
  Maximum                  2235
  Range                      32

Temperature was around 32.6 °C and relative humidity around 64%.

**Interpretation:** This is a useful preliminary dry-pot-soil
observation. It is not yet a standardized dry endpoint because the
soil's actual water content was not measured independently and the test
was not performed as a controlled calibration procedure.

### Test C --- A few drops of water added

After a few drops of water were added, the reported ADC readings were:

``` text
1793, 1647, 1417, 1399, 1454,
1489, 1512, 1523, 1530, 1527,
1534, 1556, 1538, 1555, 1563
```

  Measurement            Result
  -------------------- --------
  Number of readings         15
  Average                1535.3
  Minimum                  1399
  Maximum                  1793
  Range                     394

**Interpretation:** The ADC decreased after water was added, supporting
the observed direction that lower readings corresponded to wetter soil
in this setup. The readings changed over the measurement sequence, so
this is a transition observation rather than a stable calibration
endpoint.

### Test D --- Soil made more uniformly moist; probe position changed

The user then made the soil more uniformly moist. The reported readings
were:

``` text
1170, 1190, 1184, 1206, 905, 1051, 1110,
1133, 1147, 1167, 1182, 1190, 1194, 1205,
1203, 1205, 1212, 1217, 1467, 481, 659,
755, 926, 991, 1020, 1026, 1055, 1064
```

The user clarified that the probe was moved from beside the Aloe Vera
plant to the middle soil near the plant around the 1217/1467 readings.
The sharp change to 481 occurred after this repositioning.

**Interpretation:**

-   The readings before and after repositioning should not be treated as
    one controlled stationary series.
-   Probe location, insertion depth, pressure, contact with soil, and
    local moisture distribution can change the ADC.
-   The sharp change after moving the probe cannot be attributed solely
    to a moisture change.
-   These values are useful exploratory observations, not final
    calibration endpoints.

### Test E --- First reinsertion and stationary observation (23 readings)

The probe was removed and reinserted at the same position and depth
before this test. Once the test began, the user kept the probe
stationary.

Raw readings:

``` text
668, 710, 757, 813, 847, 879, 896, 909, 932, 936,
952, 966, 966, 973, 986, 977, 980, 981, 980, 997,
985, 991, 996
```

  Measurement                        Result
  ------------------------------ ----------
  Number of readings                     23
  Overall average                     916.4
  Minimum                               668
  Maximum                               997
  Overall range                         329
  Average of final 10 readings        984.6
  Final 10 range                   973--997

**Interpretation:**

-   The readings increased substantially after the test began.
-   The final 10 readings were more tightly grouped than the early
    readings.
-   Since the probe was not moved during the sequence, the trend was not
    caused by movement during the measurements.
-   Possible contributors include sensor/electrical settling, soil
    contact changes after insertion, or moisture distribution around the
    prongs. The test alone cannot determine the exact cause.
-   The final 10 readings were a more stable portion of this particular
    sequence, but the test was not fully comparable with another
    insertion unless the soil and insertion conditions were identical.

### Test F --- Second reinsertion and stationary observation (21 readings)

The probe was removed and reinserted into the same position and at the
same depth. The user collected 21 readings.

Raw readings:

``` text
713, 716, 732, 761, 773, 793, 809, 824, 836, 858,
856, 872, 863, 875, 887, 889, 890, 895, 894, 896,
910
```

  Measurement                        Result
  ------------------------------ ----------
  Number of readings                     21
  Overall average                     835.3
  Minimum                               713
  Maximum                               910
  Overall range                         197
  Average of final 10 readings        887.1
  Final 10 range                   863--910

**Interpretation:**

-   This test again showed an increasing ADC trend after reinsertion.
-   The final readings were more consistent than the earliest readings,
    but there was still a slight upward trend.
-   The final 10 average differed from Test E's final 10 average by
    about 97.5 ADC counts.
-   Therefore, the response pattern was similar, but the absolute value
    was not repeatable enough to treat the two tests as the same
    calibrated moisture point.
-   Reinsertion, local soil contact and soil heterogeneity are plausible
    contributors. Do not claim a proven single cause.

### Test G --- Extended stationary observation (62 readings)

After the previous test, the user left the probe in place and collected
a longer sequence without removing or adjusting it.

Raw readings:

``` text
842, 838, 853, 869, 831, 840, 838, 842, 828, 837,
829, 826, 836, 834, 834, 841, 842, 837, 834, 834,
837, 844, 836, 831, 835, 842, 837, 844, 838, 846,
839, 836, 838, 835, 837, 847, 845, 837, 833, 834,
833, 839, 840, 835, 830, 835, 838, 840, 835, 837,
831, 842, 830, 829, 821, 840, 835, 834, 831, 834,
837, 837
```

  Measurement                       Result
  ------------------------------- --------
  Number of readings                    62
  Average                            837.1
  Minimum                              821
  Maximum                              869
  Overall range                         48
  Population standard deviation        6.7
  Average of final 10 readings       832.8
  Final 10 minimum                     821
  Final 10 maximum                     840
  Final 10 range                        19

**Interpretation:**

-   The readings are much more tightly grouped than in the two
    reinsertion tests.
-   The overall standard deviation is approximately 6.7 ADC counts.
-   The final 10 readings ranged from 821 to 840, indicating good
    short-term consistency during this stationary test.
-   This supports the conclusion that the sensor can provide stable
    short-term readings when left undisturbed in one location.
-   It does not establish a universal wet-soil reference or a calibrated
    moisture percentage.
-   The long stationary test's average should not be compared as if it
    were a separate moisture level from earlier tests unless the soil
    condition and exact probe location are controlled.

------------------------------------------------------------------------

## 7. Consolidated observations

  ------------------------------------------------------------------------
  Test             Soil/test                     Readings Key observation
                   condition                              
  ---------------- ---------------- --------------------- ----------------
  A                Probe in air                         1 ADC saturated at
                                                          4095

  B                Dry Aloe Vera                        7 Average
                   pot soil                               approximately
                                                          2218

  C                After a few                         15 Average
                   drops of water                         approximately
                                                          1535; ADC
                                                          decreased

  D                More uniformly                      28 Position change
                   moist soil;                            makes the
                   probe moved                            sequence
                                                          non-comparable

  E                Reinserted, then                    23 Final 10 average
                   stationary                             approximately
                                                          984.6

  F                Reinserted                          21 Final 10 average
                   again, then                            approximately
                   stationary                             887.1

  G                Left stationary                     62 Average
                   for extended                           approximately
                   observation                            837.1; standard
                                                          deviation
                                                          approximately
                                                          6.7
  ------------------------------------------------------------------------

### Main findings supported by the tests

1.  The ESP32 can read the HW-103 analog output through GPIO34.
2.  The ESP32 can read DHT22 temperature and relative humidity through
    GPIO4.
3.  In this hardware setup, lower soil ADC values were observed after
    adding water.
4.  Probe position and reinsertion can materially affect the observed
    ADC values.
5.  After the probe is left stationary, the ADC readings can become much
    more consistent.
6.  The current data is sufficient to begin software architecture and
    filtering work.
7.  The data is not yet sufficient to define accurate moisture
    percentages or universal dry/optimal/wet thresholds.

### Temperature and humidity observations

Across the later tests, the DHT22 generally reported:

-   Temperature around 32.5--32.8 °C.
-   Relative humidity around 64.5--65.7%.

The values were reasonably consistent during the observation period.
These are readings from the local test environment, not calibrated
reference measurements. Do not hardcode them as expected values or
plant-health thresholds.

------------------------------------------------------------------------

## 8. Preliminary calibration notes --- do not treat as final

The following are historical observations only:

  --------------------------------------------------------------------------
  Observed condition     Approximate ADC observation Calibration status
  --------------------- ---------------------------- -----------------------
  Probe exposed to air                          4095 Not a soil endpoint

  Dry Aloe Vera pot                             2218 Preliminary
  soil                                               

  After a few drops of                  1535 average Transitional
  water                                              observation

  More uniformly moist                      Variable Not a controlled
  soil, before/after                                 endpoint
  moving probe                                       

  Stationary                  984.6 final-10 average Preliminary;
  reinsertion test E                                 reinsertion-sensitive

  Stationary                  887.1 final-10 average Preliminary; differs
  reinsertion test F                                 from test E

  Extended stationary          837.1 overall average Stable observation at
  test G                                             one location, not a
                                                     validated wet endpoint
  --------------------------------------------------------------------------

**Do not implement a final formula such as `map(adc, 2218, 837, 0, 100)`
yet.** Such a formula would turn exploratory observations into an
apparently precise percentage without controlled endpoints. Also, the
observed 4095 air value must not be substituted for a dry-soil endpoint.

### Recommended future calibration procedure

When ready to calibrate:

1.  Use the same pot, soil, sensor module, power supply and probe.
2.  Mark or otherwise standardize the probe location, orientation and
    insertion depth.
3.  Define a repeatable dry reference based on the soil condition, not
    merely an arbitrary waiting period.
4.  Collect multiple readings after the probe has settled.
5.  Add a measured amount of water, mix/distribute it consistently,
    allow it to equilibrate, and record another stable set.
6.  Repeat across several moisture conditions.
7.  If possible, record soil mass before and after watering, or use
    another independent method to document water content.
8.  Choose calibration endpoints based on the plant and soil, not
    generic percentages copied from another sensor.
9.  Repeat measurements to quantify variability.

Until this is completed, show the raw ADC or a qualitative sensor state
in the application rather than presenting an unvalidated percentage.

------------------------------------------------------------------------

## 9. Current hardware and software status

  -----------------------------------------------------------------------
  Area                    Status                  Details
  ----------------------- ----------------------- -----------------------
  ESP32 board             Verified                Upload and chip
                                                  detection successful

  USB data connection     Working                 Successful upload on
                                                  COM6

  HW-103 analog input     Verified                Readings obtained on
                                                  GPIO34

  HW-080 probe            Working in tests        Changes in ADC observed
                                                  across soil conditions

  DHT22 temperature       Verified                Consistent readings
                                                  obtained

  DHT22 humidity          Verified                Consistent readings
                                                  obtained

  Combined sensor sketch  Working                 Both sensors read in
                                                  one program

  Soil calibration        Pending                 Exploratory data only

  Moisture percentage     Not implemented         Wait for calibration

  Filtering               Basic averaging only    Current code averages
                                                  10 ADC samples

  Wi-Fi                   Not implemented         Future stage

  Blynk/cloud             Not implemented         Future stage

  Dashboard               Not implemented         Future stage

  Notifications           Not implemented         Future stage

  Dual-zone monitoring    Not implemented         Only one soil probe
                                                  currently exists
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 10. Recommended software architecture

Build the firmware in layers so that hardware reading, processing,
connectivity and application logic are not tangled together.

``` text
                 PHYSICAL SENSORS
          ┌──────────────────────────┐
          │ HW-103 soil module       │
          │ DHT22 temperature/RH     │
          └────────────┬─────────────┘
                       │
                       ▼
                 ESP32 FIRMWARE
          ┌──────────────────────────┐
          │ Sensor acquisition      │
          │ ADC averaging/filtering │
          │ DHT error handling       │
          └────────────┬─────────────┘
                       │
                       ▼
                PROCESSING LAYER
          ┌──────────────────────────┐
          │ Calibration conversion  │
          │ Plant-condition rules   │
          │ Hysteresis / alert logic│
          └────────────┬─────────────┘
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
       SERIAL OUTPUT         WI-FI LAYER
                                 │
                                 ▼
                            BLYNK CLOUD
                                 │
                                 ▼
                         MOBILE DASHBOARD
```

### Suggested source-code organization

This is a proposed structure for the software implementation; it is not
the current existing folder structure.

``` text
FloraSense/
├── firmware/
│   └── FloraSense/
│       ├── FloraSense.ino
│       ├── config.h
│       ├── sensors.h
│       ├── sensors.cpp
│       ├── soil_calibration.h
│       ├── soil_calibration.cpp
│       ├── plant_logic.h
│       ├── plant_logic.cpp
│       ├── connectivity.h
│       ├── connectivity.cpp
│       ├── telemetry.h
│       └── telemetry.cpp
├── docs/
│   ├── hardware-test-observations.md
│   └── calibration-log.md
├── README.md
└── .gitignore
```

Keep exactly one `setup()` and one `loop()` in the Arduino sketch. Other
`.cpp` files should implement helper functions and classes.

------------------------------------------------------------------------

## 11. Firmware requirements for the next development stage

### A. Sensor acquisition

-   Read soil ADC from GPIO34.
-   Read DHT22 from GPIO4.
-   Keep the current pin mapping configurable in one place.
-   Use a sensible sampling interval.
-   Handle DHT22 failures without using invalid values.
-   Do not block the whole firmware for long periods while reading
    sensors.

### B. Soil signal processing

-   Preserve and expose the raw ADC value for diagnostics.
-   Use a median filter or another justified filter to reject occasional
    spikes.
-   Use a rolling average or exponential moving average for smoother
    display.
-   Avoid excessive smoothing that hides real moisture changes.
-   Make the filter parameters configurable.
-   Do not silently convert raw ADC values to percentages before
    calibration is approved.

### C. Calibration module

-   Keep dry and wet reference values in a dedicated configuration file.
-   Clearly mark calibration values as unconfigured until measured.
-   Account for the observed direction: lower ADC means wetter for the
    current setup.
-   Clamp output to a valid range only after valid calibration endpoints
    exist.
-   Provide a clear `calibration_valid` or equivalent state.
-   Never use the air reading of 4095 as the dry-soil endpoint.

### D. Plant-condition logic

-   Keep thresholds configurable and separate from sensor acquisition.
-   The earlier project concept mentioned soil below 30%, 30--70%, and
    above 70%, temperature above 35 °C or below 12 °C, and humidity
    above 85%. These are **proposed placeholder rules**, not thresholds
    validated by the tests in this document.
-   Do not activate these as final plant-care recommendations without
    selecting the plant profile and validating the thresholds.
-   Use hysteresis and consecutive-sample confirmation to prevent alert
    flapping.

### E. Connectivity and telemetry

-   Add Wi-Fi only after the local sensor-processing stage is stable.
-   Add Blynk only after Wi-Fi connection and reconnection have been
    tested.
-   Keep credentials out of source control. Use a local
    secrets/configuration file excluded through `.gitignore`.
-   Make sensor reading continue even if Wi-Fi or cloud service is
    unavailable.
-   Include connection status and last successful telemetry time in
    diagnostics.
-   Do not let cloud communication block the sensor loop.

### F. Dashboard

Potential dashboard values:

-   Raw soil ADC
-   Calibrated soil moisture percentage (only after calibration)
-   Temperature in °C
-   Relative humidity in %
-   Plant/soil status
-   Wi-Fi/cloud connection status
-   Last update time
-   Alert history or trend chart, if supported by the selected platform

------------------------------------------------------------------------

## 12. Suggested implementation milestones and acceptance tests

### Milestone 1 --- Refactor the working sensor sketch

**Implement:** Separate sensor acquisition, configuration, and serial
output.

**Acceptance tests:** - ESP32 boots and prints a clear startup
message. - Soil ADC readings are available from GPIO34. - DHT22
temperature and humidity are available from GPIO4. - DHT failure is
reported safely. - There is only one `setup()` and one `loop()`. - The
firmware continues operating if a DHT reading fails.

### Milestone 2 --- Add signal filtering

**Implement:** Median/rolling filtering while retaining raw readings.

**Acceptance tests:** - Raw and filtered readings are both visible for
debugging. - A single unusual sample does not cause a major display
jump. - Stable soil readings remain close to the observed stationary
behavior. - Filter settings can be changed without editing sensor logic.

### Milestone 3 --- Complete soil calibration

**Implement:** A configurable ADC-to-moisture conversion.

**Acceptance tests:** - Calibration endpoints come from documented,
repeatable measurements. - Wet and dry direction is correct for the
actual module. - Percentage is marked unavailable if calibration is
missing or invalid. - Values are bounded to the intended output range. -
The displayed percentage is not represented as laboratory-grade
measurement.

### Milestone 4 --- Add plant-condition rules

**Implement:** Configurable plant profile, status logic and hysteresis.

**Acceptance tests:** - Conditions are calculated from valid sensor
values only. - Repeated noisy samples do not repeatedly toggle status. -
Thresholds can be adjusted independently of sensor drivers. -
Uncalibrated soil data cannot trigger percentage-based watering
decisions.

### Milestone 5 --- Wi-Fi and Blynk

**Implement:** Non-blocking connection management and telemetry.

**Acceptance tests:** - Device connects with valid credentials. - Sensor
readings continue when Wi-Fi is unavailable. - Device attempts
reconnection without freezing sensor acquisition. - Telemetry fields
update correctly. - Credentials are not committed to Git.

### Milestone 6 --- Integrated testing

**Implement:** End-to-end tests using the real hardware.

**Acceptance tests:** - Sensor values appear locally and on the
dashboard. - Disconnecting Wi-Fi does not stop local sensing. - DHT
failure is handled gracefully. - Soil changes produce a sensible change
in raw/filtered readings. - Alerts are generated only when valid
configured conditions are met.

------------------------------------------------------------------------

## 13. Guidance for Claude Code

Use this document as the source of truth for the observed hardware,
wiring, readings and test conclusions. Claude Code should inspect the
existing repository before changing files.

### Copy-ready implementation prompt

``` text
You are working on FloraSense, an ESP32-based plant and environmental
monitoring prototype.

First inspect the existing repository and identify:
- Existing Arduino sketches and source files
- Current working sensor code
- Library dependencies
- Existing documentation and configuration
- Any existing Wi-Fi, Blynk or dashboard code

Use hardware-test-observations.md as the factual record of the
physical setup and tests.

VERIFIED HARDWARE:
- ESP32 Dev Module, ESP32-D0WD-V3 chip detected during upload
- HW-103 soil module powered from 3V3
- HW-103 AO -> GPIO34
- HW-103 VCC -> 3V3
- HW-103 GND -> GND
- HW-103 DO -> unused
- HW-080 probe connected to the HW-103 two-pin probe connector
- DHT22 + -> 3V3
- DHT22 OUT -> GPIO4
- DHT22 - -> GND
- Serial Monitor baud rate: 115200
- ESP32 upload previously succeeded on COM6

OBSERVED SENSOR BEHAVIOR:
- ESP32 ADC is configured for 12-bit readings (nominal 0–4095).
- Lower ADC readings were observed after water was added.
- Dry Aloe Vera pot soil previously produced readings around 2203–2235.
- After a few drops of water, readings were around 1399–1793.
- Probe movement and reinsertion affected readings.
- An extended stationary observation produced 62 readings with
  mean approximately 837.1, minimum 821, maximum 869 and
  population standard deviation approximately 6.7.
- The DHT22 produced stable readings during the tests, generally
  around 32.5–32.8 °C and 64.5–65.7% relative humidity.

IMPORTANT CALIBRATION RESTRICTIONS:
- These are exploratory measurements, not validated calibration endpoints.
- Do not use 4095 (probe in air) as the dry-soil reference.
- Do not invent or hardcode a soil-moisture percentage formula.
- Do not claim the soil moisture is accurately calibrated.
- Keep raw ADC visible.
- Make moisture percentage unavailable until valid calibration
  endpoints are explicitly configured.
- Keep the calibration values configurable and documented.
- The current physical prototype has only ONE soil probe. Do not
  implement or claim dual-zone sensing without a second sensor.

IMPLEMENTATION APPROACH:
1. Preserve the currently working sensor behavior.
2. Refactor into clean modules without introducing duplicate
   setup() or loop() functions.
3. Add robust sensor error handling.
4. Add configurable filtering while preserving raw ADC readings.
5. Add a calibration module that remains disabled until valid
   calibration values are supplied.
6. Add plant-condition logic only with configurable, clearly
   identified placeholder thresholds.
7. Add Wi-Fi and Blynk integration as a separate stage.
8. Keep local sensor acquisition operational during Wi-Fi/cloud
   outages.
9. Keep credentials out of Git.
10. Add documentation and clear build/upload instructions.

WORKFLOW:
- Do not rewrite the entire project blindly.
- First report the repository structure and proposed changes.
- Implement in small stages.
- After each stage, explain changed files, dependencies and
  hardware tests needed.
- Compile/build where the available environment permits.
- Never claim a physical hardware test was performed unless it
  was actually performed.
- Ask before changing hardware pin assignments or adding hardware.
- Avoid unnecessary libraries and overengineering.

Start by inspecting the repository and proposing the Stage 1
firmware refactor. Do not begin cloud integration until the local
sensor firmware is verified.
```

------------------------------------------------------------------------

## 14. Known limitations and cautions

-   The HW-103 is a resistive soil sensor. Its readings can drift and
    its probe can corrode; it is suitable for a low-cost prototype, not
    precision agricultural measurement.
-   Soil moisture is not measured directly as a universal percentage by
    this module. Calibration is specific to the soil, probe and setup.
-   The DHT22 readings have not been compared with a calibrated
    reference instrument.
-   A single soil probe cannot independently represent moisture in two
    separate zones.
-   The current working sketch does not yet connect to Wi-Fi or Blynk.
-   Thresholds from the original project concept must be treated as
    provisional until a plant profile and behavior are validated.
-   The observed temperature and humidity are environmental test
    readings, not plant-specific ideal conditions.

------------------------------------------------------------------------

## 15. Current project handover summary

**Hardware verification is complete enough to begin software
development.** The ESP32 successfully reads the HW-103 analog soil
sensor and DHT22 temperature/humidity sensor. The soil sensor's observed
ADC response decreases after water is added, and an extended stationary
test showed good short-term consistency.

The next sensible task is to refactor the existing working Arduino
sketch into maintainable firmware modules while retaining raw ADC
readings and DHT22 error handling. Soil-moisture percentage calibration,
plant thresholds, Wi-Fi, Blynk and dashboard integration should be
introduced in separate, testable stages.

**Do not discard the working sketch. Preserve it as a known-good
hardware test while developing the application firmware.**
