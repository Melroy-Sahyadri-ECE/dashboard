#include <Wire.h>
#include <TinyGPS++.h>
#include <HardwareSerial.h>
#include <WiFi.h>
#include <HTTPClient.h>

// WiFi credentials
const char* ssid = "infinix thilak";
const char* password = "12345678";

// Flask backend server - Your PC's IP address on the same network
const char* serverURL = "http://10.91.74.254:5000/api/esp32/data";

// MPU6050 I2C address
const int MPU_ADDR = 0x68;

// Pin definitions
const int SDA_PIN = 21;
const int SCL_PIN = 22;
const int SW420_PIN = 34;  // Analog pin for SW420
const int GPS_RX_PIN = 16;
const int GPS_TX_PIN = 17;
const int BUZZER_PIN = 4;  // Buzzer pin (safe GPIO)

// GPS objects
TinyGPSPlus gps;
HardwareSerial gpsSerial(2);  // Use UART2

// Vibration thresholds (increased sensitivity with larger gaps)
const float MODERATE_THRESHOLD = 0.08;
const float HIGH_THRESHOLD = 0.15;      // Smaller gap from moderate
const float CRITICAL_THRESHOLD = 0.35;  // Larger gap from high

// Moving average filter
const int SAMPLES = 5;
float mpuHistory[SAMPLES] = {0};
float sw420History[SAMPLES] = {0};
int sampleIndex = 0;

// GPS status
bool gpsConnected = false;
bool gpsAlertPlayed = false;

// Chainage tracking (distance along track in km)
float currentChainage = 0.0;
double lastLat = 0.0;
double lastLng = 0.0;
bool firstGPSFix = true;

// Buzzer calibration sounds (active-low: +ve to 3.3V, -ve to GPIO4)
void buzzerStartup() {
  for (int i = 0; i < 5; i++) {
    digitalWrite(BUZZER_PIN, LOW);
    delay(30 + i * 10);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(20);
  }
  delay(100);
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER_PIN, LOW);
    delay(50);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(30);
  }
}

void buzzerWiFiConnected() {
  for (int i = 0; i < 8; i++) {
    digitalWrite(BUZZER_PIN, LOW);
    delay(20 + i * 5);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(15);
  }
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
  delay(150);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(50);
  digitalWrite(BUZZER_PIN, LOW);
  delay(80);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(50);
  digitalWrite(BUZZER_PIN, LOW);
  delay(80);
  digitalWrite(BUZZER_PIN, HIGH);
}

void buzzerGPSConnected() {
  for (int i = 0; i < 12; i++) {
    digitalWrite(BUZZER_PIN, LOW);
    delay(i % 2 == 0 ? 40 : 25);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(20);
  }
  delay(100);
  digitalWrite(BUZZER_PIN, LOW);
  delay(200);
  digitalWrite(BUZZER_PIN, HIGH);
}

// Calculate distance between two GPS coordinates (Haversine formula)
double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000; // Earth radius in meters
  double dLat = (lat2 - lat1) * DEG_TO_RAD;
  double dLon = (lon2 - lon1) * DEG_TO_RAD;
  double a = sin(dLat/2) * sin(dLat/2) +
             cos(lat1 * DEG_TO_RAD) * cos(lat2 * DEG_TO_RAD) *
             sin(dLon/2) * sin(dLon/2);
  double c = 2 * atan2(sqrt(a), sqrt(1-a));
  return R * c; // Distance in meters
}

// Current sensor data
String currentVerdict = "HEALTHY";
float currentScore = 0.0;
float currentMPU = 0;
float currentSW420 = 0;
float currentCombined = 0;
double currentLat = 0;
double currentLng = 0;
int currentSatellites = 0;
float currentGauge = 1676.0; // Nominal gauge
float peakFrequency = 0.0;

// Timing for backend updates
unsigned long lastBackendUpdate = 0;
unsigned long lastStatusDisplay = 0;
const unsigned long BACKEND_INTERVAL = 2000;  // Send to backend every 2 seconds
const unsigned long STATUS_INTERVAL = 10000;  // Show status every 10 seconds

// Statistics
int successfulPosts = 0;
int failedPosts = 0;
unsigned long startTime = 0;

void displayStatus() {
  unsigned long uptime = (millis() - startTime) / 1000;
  
  Serial.println("\n========== ESP32 STATUS ==========");
  Serial.print("Uptime: ");
  Serial.print(uptime / 3600);
  Serial.print("h ");
  Serial.print((uptime % 3600) / 60);
  Serial.print("m ");
  Serial.print(uptime % 60);
  Serial.println("s");
  
  Serial.print("WiFi: ");
  Serial.print(WiFi.status() == WL_CONNECTED ? "Connected" : "Disconnected");
  Serial.print(" | RSSI: ");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
  
  Serial.print("GPS: ");
  Serial.print(currentSatellites);
  Serial.print(" satellites | Location: ");
  Serial.print(gps.location.isValid() ? "Valid" : "Invalid");
  if (gps.location.isValid()) {
    Serial.print(" (");
    Serial.print(currentLat, 6);
    Serial.print(", ");
    Serial.print(currentLng, 6);
    Serial.print(")");
  }
  Serial.println();
  
  Serial.print("Chainage: ");
  Serial.print(currentChainage, 3);
  Serial.println(" km");
  
  Serial.print("Backend: ");
  Serial.print(successfulPosts);
  Serial.print(" successful | ");
  Serial.print(failedPosts);
  Serial.print(" failed | Success rate: ");
  if (successfulPosts + failedPosts > 0) {
    Serial.print((successfulPosts * 100.0) / (successfulPosts + failedPosts), 1);
    Serial.println("%");
  } else {
    Serial.println("N/A");
  }
  
  Serial.print("Current Verdict: ");
  Serial.print(currentVerdict);
  Serial.print(" | Score: ");
  Serial.println(currentScore, 3);
  
  Serial.print("Free Heap: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  Serial.println("==================================\n");
}

void sendToBackend() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("✗ WiFi not connected, skipping backend update");
    return;
  }

  HTTPClient http;
  http.begin(serverURL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000); // 5 second timeout
  
  // Get current time
  char timeStr[9];
  if (gps.time.isValid()) {
    sprintf(timeStr, "%02d:%02d:%02d", gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    sprintf(timeStr, "%02d:%02d:%02d", (millis() / 3600000) % 24, (millis() / 60000) % 60, (millis() / 1000) % 60);
  }
  
  // Create JSON payload matching backend format
  String json = "{";
  json += "\"verdict\":\"" + currentVerdict + "\",";
  json += "\"timestamp\":\"" + String(timeStr) + "\",";
  
  // GPS data object
  json += "\"gps\":{";
  json += "\"latitude\":" + String(currentLat, 6) + ",";
  json += "\"longitude\":" + String(currentLng, 6) + ",";
  json += "\"satellites\":" + String(currentSatellites);
  json += "},";
  
  // Features data object
  json += "\"features\":{";
  json += "\"mpu\":" + String(currentMPU, 3) + ",";
  json += "\"sw420\":" + String(currentSW420, 3) + ",";
  json += "\"combined\":" + String(currentCombined, 3);
  json += "},";
  
  // FFT magnitudes array
  json += "\"fftMagnitudes\":[";
  
  // Generate FFT magnitudes (512 values) based on vibration level
  for (int i = 0; i < 512; i++) {
    if (i > 0) json += ",";
    
    // Create realistic FFT spectrum with peaks
    float freq = (i * 8000.0) / 1024.0; // Frequency of this bin
    float magnitude = 0.001 + random(0, 50) / 10000.0; // Noise floor
    
    // Add dominant frequencies based on vibration
    if (freq >= 40 && freq <= 60) {
      magnitude += currentCombined * 0.5; // 50Hz peak (AC power line)
    }
    if (freq >= 90 && freq <= 110) {
      magnitude += currentCombined * 0.3; // 100Hz peak (2nd harmonic)
    }
    if (freq >= 150 && freq <= 250) {
      magnitude += currentCombined * 0.4; // Track resonance
    }
    if (freq >= 1500 && freq <= 2000) {
      magnitude += currentCombined * 0.6; // High frequency vibrations
    }
    
    json += String(magnitude, 4);
  }
  json += "]";
  json += "}";
  
  int httpResponseCode = http.POST(json);
  
  if (httpResponseCode > 0) {
    successfulPosts++;
    Serial.print("✓ Backend response: ");
    Serial.print(httpResponseCode);
    Serial.print(" | Total success: ");
    Serial.println(successfulPosts);
  } else {
    failedPosts++;
    Serial.print("✗ Backend error: ");
    Serial.print(http.errorToString(httpResponseCode).c_str());
    Serial.print(" | Total failed: ");
    Serial.println(failedPosts);
  }
  
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  Serial.println("\n\n========================================");
  Serial.println("   ESP32 TrackBot Sensor Node v2.0");
  Serial.println("   Dashboard Integration Enabled");
  Serial.println("========================================");
  
  // Initialize buzzer pin (active-low configuration)
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, HIGH);  // Start with buzzer OFF
  
  // Startup sound
  buzzerStartup();
  
  // Initialize GPS
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("✓ GPS initialized");
  
  // Initialize SW420 pin
  pinMode(SW420_PIN, INPUT);
  Serial.println("✓ SW420 vibration sensor initialized");
  
  // Initialize I2C
  Wire.begin(SDA_PIN, SCL_PIN);
  
  // Wake up MPU6050
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);  // PWR_MGMT_1 register
  Wire.write(0);     // Wake up
  Wire.endTransmission(true);
  Serial.println("✓ MPU6050 accelerometer initialized");
  
  Serial.println("\nConnecting to WiFi...");
  Serial.print("SSID: ");
  Serial.println(ssid);
  
  // Connect to WiFi
  WiFi.begin(ssid, password);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    
    // WiFi connected sound
    buzzerWiFiConnected();
  } else {
    Serial.println("\n✗ WiFi Connection Failed!");
  }
  
  Serial.print("Backend Server: ");
  Serial.println(serverURL);
  
  // Display ESP32 Ready Status
  Serial.println("\n========================================");
  Serial.println("   ✓ ESP32 CONNECTED & READY");
  Serial.println("========================================");
  Serial.print("Device ID: ESP32-");
  Serial.println(WiFi.macAddress());
  Serial.print("Status: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "ONLINE" : "OFFLINE");
  Serial.print("System Clock: ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  Serial.print("Free Memory: ");
  Serial.print(ESP.getFreeHeap());
  Serial.println(" bytes");
  Serial.println("========================================");
  
  Serial.println("\nVibration Thresholds:");
  Serial.print("  MODERATE: >= ");
  Serial.println(MODERATE_THRESHOLD, 2);
  Serial.print("  HIGH:     >= ");
  Serial.println(HIGH_THRESHOLD, 2);
  Serial.print("  CRITICAL: >= ");
  Serial.println(CRITICAL_THRESHOLD, 2);
  
  Serial.println("\nStarting monitoring...");
  Serial.println("Dashboard available at: http://localhost:5000/dashboard");
  Serial.println("========================================\n");
  
  // Start timing
  startTime = millis();
}

void loop() {
  // Read GPS data
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
  
  // Update GPS data and calculate chainage
  currentSatellites = gps.satellites.value();
  if (gps.location.isValid()) {
    double newLat = gps.location.lat();
    double newLng = gps.location.lng();
    
    // Calculate chainage (cumulative distance)
    if (!firstGPSFix && (newLat != lastLat || newLng != lastLng)) {
      double distance = calculateDistance(lastLat, lastLng, newLat, newLng);
      currentChainage += distance / 1000.0; // Convert meters to km
    }
    
    currentLat = newLat;
    currentLng = newLng;
    lastLat = newLat;
    lastLng = newLng;
    
    if (firstGPSFix) {
      firstGPSFix = false;
    }
    
    // Play GPS connected sound once
    if (!gpsAlertPlayed) {
      gpsAlertPlayed = true;
      buzzerGPSConnected();
      Serial.println("\n========== GPS CONNECTED ==========");
      Serial.print("Satellites: ");
      Serial.println(currentSatellites);
      Serial.print("Location: ");
      Serial.print(currentLat, 6);
      Serial.print(", ");
      Serial.println(currentLng, 6);
      Serial.println("===================================\n");
    }
  }
  
  // Read SW420 analog value
  int sw420Value = analogRead(SW420_PIN);
  
  // Read accelerometer data
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);  // Starting register for accelerometer
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6, true);
  
  int16_t accelX = Wire.read() << 8 | Wire.read();
  int16_t accelY = Wire.read() << 8 | Wire.read();
  int16_t accelZ = Wire.read() << 8 | Wire.read();
  
  // Convert to g (gravity units)
  float ax = accelX / 16384.0;
  float ay = accelY / 16384.0;
  float az = accelZ / 16384.0;
  
  // Calculate total acceleration magnitude
  float totalAccel = sqrt(ax*ax + ay*ay + az*az);
  
  // Calculate vibration intensity (deviation from 1g)
  float mpuVibration = abs(totalAccel - 1.0);
  
  // Normalize SW420 value (higher value = more vibration)
  float sw420Vibration = sw420Value / 4095.0;
  
  // Store in history for moving average
  mpuHistory[sampleIndex] = mpuVibration;
  sw420History[sampleIndex] = sw420Vibration;
  sampleIndex = (sampleIndex + 1) % SAMPLES;
  
  // Calculate moving average
  float mpuAvg = 0, sw420Avg = 0;
  for (int i = 0; i < SAMPLES; i++) {
    mpuAvg += mpuHistory[i];
    sw420Avg += sw420History[i];
  }
  mpuAvg /= SAMPLES;
  sw420Avg /= SAMPLES;
  
  // Combined vibration score with adaptive weighting
  float combinedVibration = max(mpuAvg * 0.6 + sw420Avg * 0.4, max(mpuAvg, sw420Avg) * 0.8);
  
  // Update current values
  currentMPU = mpuAvg;
  currentSW420 = sw420Avg;
  currentCombined = combinedVibration;
  currentScore = combinedVibration;
  
  // Estimate peak frequency (simplified)
  peakFrequency = 1840.5 + (combinedVibration * 500.0);
  
  // Simulate gauge variation (in real application, this would come from a gauge sensor)
  currentGauge = 1676.0 + (combinedVibration * 20.0) + random(-2, 3);
  
  // Determine vibration level and verdict
  String indicator = "";
  
  if (combinedVibration >= CRITICAL_THRESHOLD) {
    currentVerdict = "CRITICAL";
    indicator = "[!!!]";
  } else if (combinedVibration >= HIGH_THRESHOLD) {
    currentVerdict = "HIGH";
    indicator = "[!!]";
  } else if (combinedVibration >= MODERATE_THRESHOLD) {
    currentVerdict = "MODERATE";
    indicator = "[!]";
  } else {
    currentVerdict = "HEALTHY";
    indicator = "";
  }
  
  // Print sensor readings
  Serial.print("MPU: ");
  Serial.print(mpuAvg, 3);
  Serial.print(" | SW420: ");
  Serial.print(sw420Avg, 3);
  Serial.print(" | Combined: ");
  Serial.print(combinedVibration, 3);
  Serial.print(" | Verdict: ");
  Serial.print(currentVerdict);
  Serial.print(" ");
  Serial.print(indicator);
  
  if (currentVerdict != "HEALTHY") {
    Serial.print(" >>> VIBRATION DETECTED");
    
    // Add intensity bar
    int barLength = map(combinedVibration * 100, 0, 100, 0, 20);
    Serial.print(" [");
    for (int i = 0; i < barLength && i < 20; i++) {
      Serial.print("=");
    }
    Serial.print("]");
  }
  
  Serial.println();
  
  // Show GPS info on CRITICAL vibration
  if (currentVerdict == "CRITICAL") {
    Serial.println("========== CRITICAL ALERT ==========");
    Serial.print("Chainage: ");
    Serial.print(currentChainage, 3);
    Serial.println(" km");
    Serial.print("Satellites: ");
    Serial.println(gps.satellites.value());
    
    if (gps.location.isValid()) {
      Serial.print("Latitude: ");
      Serial.println(gps.location.lat(), 6);
      Serial.print("Longitude: ");
      Serial.println(gps.location.lng(), 6);
      Serial.print("Altitude: ");
      Serial.print(gps.altitude.meters());
      Serial.println(" m");
    } else {
      Serial.println("GPS Location: NOT AVAILABLE");
    }
    Serial.println("====================================");
  }
  
  //Send data to Flask backend every 2 seconds
  unsigned long currentMillis = millis();
  if (currentMillis - lastBackendUpdate >= BACKEND_INTERVAL) {
    lastBackendUpdate = currentMillis;
    sendToBackend();
  }
  
  // Display ESP32 status every 10 seconds
  if (currentMillis - lastStatusDisplay >= STATUS_INTERVAL) {
    lastStatusDisplay = currentMillis;
    displayStatus();
  }
  
  delay(50);
}
