import express, { Request, Response } from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { AnimalDetectionEvent, AnimalDetectionRequest, ESP32Reading, GPSData, ProcessedReading } from './types';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Store recent readings (keep last 100)
const readings: ProcessedReading[] = [];
const MAX_READINGS = 100;

// Store recent dead-animal detection events
const animalDetections: AnimalDetectionEvent[] = [];
const MAX_ANIMAL_DETECTIONS = 100;

// Simple chainage calculator (you can enhance this with actual GPS-based calculation)
let currentChainage = 0;

// ESP32 connection tracking
let esp32LastSeen: Date | null = null;
let esp32DeviceId: string | null = null;
const ESP32_TIMEOUT_MS = 10000; // Consider disconnected after 10 seconds

function isESP32Connected(): boolean {
  if (!esp32LastSeen) return false;
  return (Date.now() - esp32LastSeen.getTime()) < ESP32_TIMEOUT_MS;
}

// Convert verdict to dashboard format
function convertVerdict(verdict: string): 'green' | 'yellow' | 'red' {
  const v = verdict.toUpperCase();
  if (v === 'CRITICAL') return 'red';
  if (v === 'HIGH' || v === 'MODERATE') return 'yellow';
  return 'green';
}

// Calculate vibration score from combined value (0-100 scale)
function calculateScore(combined: number): number {
  return Math.min(Math.round(combined * 100), 100);
}

// Simulate gauge measurement (normally this would come from a separate sensor)
function simulateGauge(score: number): number {
  const nominal = 1676;
  const deviation = Math.round((score / 100) * 20); // Max ±20mm based on score
  return nominal + (Math.random() > 0.5 ? deviation : -deviation);
}

function normalizeConfidence(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  if (numericValue > 1 && numericValue <= 100) return Math.max(0, Math.min(numericValue / 100, 1));
  return Math.max(0, Math.min(numericValue, 1));
}

function normalizeCoordinate(value: unknown): number | null {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function createAnimalDetectionId(): string {
  return `animal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function storeAnimalDetection(event: AnimalDetectionEvent): AnimalDetectionEvent {
  animalDetections.push(event);
  if (animalDetections.length > MAX_ANIMAL_DETECTIONS) {
    animalDetections.shift();
  }
  return event;
}

function buildAnimalDetectionEvent(
  payload: AnimalDetectionRequest | null | undefined,
  fallbackGps?: GPSData,
  fallbackChainage?: number,
  fallbackSource = 'vision-camera'
): AnimalDetectionEvent | null {
  if (!payload) return null;

  const shouldRecord = payload.deadAnimalDetected ?? payload.detected ?? true;
  if (!shouldRecord) return null;

  const latitude = normalizeCoordinate(payload.latitude ?? payload.lat ?? fallbackGps?.latitude);
  const longitude = normalizeCoordinate(payload.longitude ?? payload.lng ?? payload.lon ?? fallbackGps?.longitude);

  if (latitude == null || longitude == null) return null;

  const timestamp = payload.timestamp && !Number.isNaN(Date.parse(payload.timestamp))
    ? payload.timestamp
    : new Date().toISOString();
  const animalType = typeof payload.animalType === 'string' && payload.animalType.trim()
    ? payload.animalType.trim()
    : 'Dead animal';
  const source = typeof payload.source === 'string' && payload.source.trim()
    ? payload.source.trim()
    : fallbackSource;
  const status = payload.status === 'resolved' ? 'resolved' : 'active';
  const chainage = Number.isFinite(Number(payload.chainage)) ? Number(payload.chainage) : fallbackChainage;
  const botId = typeof payload.botId === 'string' && payload.botId.trim() ? payload.botId.trim() : undefined;
  const imageUrl = typeof payload.imageUrl === 'string' && payload.imageUrl.trim() ? payload.imageUrl.trim() : undefined;
  const notes = typeof payload.notes === 'string' && payload.notes.trim() ? payload.notes.trim() : undefined;

  return {
    id: createAnimalDetectionId(),
    timestamp,
    latitude,
    longitude,
    animalType,
    confidence: normalizeConfidence(payload.confidence),
    status,
    source,
    botId,
    imageUrl,
    notes,
    chainage
  };
}

// WebSocket clients
const wsClients = new Set<WebSocket>();

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws: WebSocket) => {
  console.log('🔌 New WebSocket client connected');
  wsClients.add(ws);

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    wsClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// Broadcast to all WebSocket clients
function broadcast(data: any) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Routes

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'Railway Track Monitoring Backend',
    status: 'ok',
    health: '/health',
    endpoints: {
      esp32Data: '/api/esp32/data',
      animalEvents: '/api/animal-events',
      esp32Status: '/api/esp32/status',
      readings: '/api/readings',
      ws: '/ws'
    }
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    readings: readings.length,
    wsConnections: wsClients.size
  });
});

// ESP32 connection status endpoint
app.get('/api/esp32/status', (req: Request, res: Response) => {
  const connected = isESP32Connected();
  res.json({
    connected,
    deviceId: esp32DeviceId,
    lastSeen: esp32LastSeen ? esp32LastSeen.toISOString() : null,
    lastSeenAgo: esp32LastSeen ? Date.now() - esp32LastSeen.getTime() : null
  });
});

// ESP32 data endpoint
app.post('/api/esp32/data', (req: Request, res: Response) => {
  try {
    const data: ESP32Reading = req.body;
    
    // Update ESP32 connection status
    esp32LastSeen = new Date();
    if (!esp32DeviceId) {
      esp32DeviceId = `ESP32-${Date.now()}`;
      console.log(`🔌 ESP32 device connected: ${esp32DeviceId}`);
    }
    
    // Increment chainage (simulating movement)
    currentChainage += 0.05; // 50m increments
    
    // Process the reading
    const processedReading: ProcessedReading = {
      timestamp: new Date().toISOString(),
      chainage: Math.round(currentChainage * 10) / 10,
      verdict: convertVerdict(data.verdict),
      score: calculateScore(data.features.combined),
      gauge: simulateGauge(calculateScore(data.features.combined)),
      latitude: data.gps.latitude,
      longitude: data.gps.longitude,
      satellites: data.gps.satellites,
      fftMagnitudes: data.fftMagnitudes || []
    };

    const animalDetectionPayload: AnimalDetectionRequest | undefined = data.animalDetection || (data.vision?.deadAnimalDetected
      ? {
          deadAnimalDetected: true,
          animalType: data.vision.animalType,
          confidence: data.vision.confidence,
          imageUrl: data.vision.imageUrl,
          notes: data.vision.notes,
          botId: data.deviceId ?? esp32DeviceId ?? undefined,
          timestamp: data.timestamp,
          source: 'esp32-vision',
          chainage: processedReading.chainage,
          latitude: data.gps.latitude,
          longitude: data.gps.longitude
        }
      : undefined);

    const animalDetectionEvent = buildAnimalDetectionEvent(
      animalDetectionPayload,
      data.gps,
      processedReading.chainage,
      'esp32-vision'
    );
    
    // Store reading
    readings.push(processedReading);
    if (readings.length > MAX_READINGS) {
      readings.shift();
    }
    
    // Broadcast to WebSocket clients
    broadcast({
      type: 'reading',
      data: processedReading
    });

    if (animalDetectionEvent) {
      const savedAnimalEvent = storeAnimalDetection(animalDetectionEvent);
      broadcast({
        type: 'animal_detection',
        data: savedAnimalEvent
      });
      console.log(
        `⚠ Dead animal detected at ${savedAnimalEvent.latitude.toFixed(6)}, ${savedAnimalEvent.longitude.toFixed(6)} | Confidence: ${Math.round(savedAnimalEvent.confidence * 100)}%`
      );
    }
    
    // Broadcast ESP32 status update
    broadcast({
      type: 'esp32_status',
      data: {
        connected: true,
        deviceId: esp32DeviceId,
        lastSeen: esp32LastSeen.toISOString()
      }
    });
    
    console.log(`✓ Received reading: ${processedReading.verdict.toUpperCase()} | Score: ${processedReading.score} | Chainage: ${processedReading.chainage} km`);
    
    res.status(200).json({
      success: true,
      message: 'Data received',
      reading: processedReading
    });
  } catch (error) {
    console.error('Error processing ESP32 data:', error);
    res.status(400).json({
      success: false,
      error: 'Invalid data format'
    });
  }
});

// Dedicated dead animal event endpoint for vision/AI pipeline integrations
app.post('/api/animal-events', (req: Request, res: Response) => {
  try {
    const payload = req.body as AnimalDetectionRequest;
    const event = buildAnimalDetectionEvent(payload, undefined, undefined, 'vision-camera');

    if (!event) {
      res.status(400).json({
        success: false,
        error: 'Valid dead animal detection with GPS coordinates is required'
      });
      return;
    }

    const savedEvent = storeAnimalDetection(event);

    broadcast({
      type: 'animal_detection',
      data: savedEvent
    });

    res.status(201).json({
      success: true,
      message: 'Dead animal detection recorded',
      event: savedEvent
    });
  } catch (error) {
    console.error('Error processing animal detection:', error);
    res.status(400).json({
      success: false,
      error: 'Invalid animal detection payload'
    });
  }
});

// Get all readings
app.get('/api/readings', (req: Request, res: Response) => {
  res.json({
    success: true,
    count: readings.length,
    readings: readings
  });
});

app.get('/api/animal-events', (req: Request, res: Response) => {
  const recentEvents = animalDetections.slice(-50).reverse();
  res.json({
    success: true,
    count: recentEvents.length,
    events: recentEvents
  });
});

// Get recent readings (for events table)
app.get('/api/readings/events', (req: Request, res: Response) => {
  const recentReadings = readings.slice(-50).reverse();
  res.json(recentReadings);
});

// Get health profile data
app.get('/api/readings/health', (req: Request, res: Response) => {
  const healthData = {
    labels: readings.map(r => r.chainage),
    scores: readings.map(r => r.score)
  };
  res.json(healthData);
});

// Get gauge profile data
app.get('/api/readings/gauge', (req: Request, res: Response) => {
  const gaugeData = {
    labels: readings.map(r => r.chainage),
    gauges: readings.map(r => r.gauge)
  };
  res.json(gaugeData);
});

// Get FFT data (latest reading)
app.get('/api/readings/fft', (req: Request, res: Response) => {
  const latestReading = readings[readings.length - 1];
  if (latestReading && latestReading.fftMagnitudes.length > 0) {
    // Reduce FFT data to manageable size (take every 10th value)
    const frequencies: number[] = [];
    const amplitudes: number[] = [];
    
    for (let i = 0; i < latestReading.fftMagnitudes.length; i += 10) {
      frequencies.push(i); // Frequency index (you can map this to actual Hz)
      amplitudes.push(latestReading.fftMagnitudes[i]);
    }
    
    res.json({ frequencies, amplitudes });
  } else {
    res.json({ frequencies: [], amplitudes: [] });
  }
});

// Get summary statistics
app.get('/api/readings/summary', (req: Request, res: Response) => {
  const totalReadings = readings.length;
  const criticalCount = readings.filter(r => r.verdict === 'red').length;
  const suspectCount = readings.filter(r => r.verdict === 'yellow').length;
  const goodCount = readings.filter(r => r.verdict === 'green').length;
  
  const avgScore = readings.length > 0
    ? readings.reduce((sum, r) => sum + r.score, 0) / readings.length
    : 0;
  
  const maxDeviation = readings.length > 0
    ? Math.max(...readings.map(r => Math.abs(r.gauge - 1676)))
    : 0;
  
  res.json({
    totalReadings,
    criticalCount,
    suspectCount,
    goodCount,
    avgScore: Math.round(avgScore * 10) / 10,
    maxDeviation: Math.round(maxDeviation)
  });
});

// Get track map data (GPS coordinates with verdict)
app.get('/api/readings/trackmap', (req: Request, res: Response) => {
  const mapData = readings.map(r => ({
    latitude: r.latitude,
    longitude: r.longitude,
    verdict: r.verdict,
    chainage: r.chainage,
    score: r.score
  }));
  res.json(mapData);
});

// Reset data (for testing)
app.post('/api/reset', (req: Request, res: Response) => {
  readings.length = 0;
  animalDetections.length = 0;
  currentChainage = 0;
  console.log('🔄 Data reset');
  res.json({ success: true, message: 'Data reset successfully' });
});

// Start server
server.listen(PORT, () => {
  console.log('\n========================================');
  console.log('🚂 Railway Track Monitoring Backend');
  console.log('========================================');
  console.log(`🌐 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket Server: ws://localhost:${PORT}/ws`);
  console.log('📡 ESP32 Endpoint: /api/esp32/data');
  console.log('========================================\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✓ Server closed');
    process.exit(0);
  });
});
