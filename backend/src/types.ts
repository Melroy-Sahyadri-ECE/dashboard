// Type definitions for the backend

export interface GPSData {
  latitude: number;
  longitude: number;
  satellites: number;
}

export interface FeatureData {
  mpu: number;
  sw420: number;
  combined: number;
}

export interface ESP32Reading {
  verdict: string;
  gps: GPSData;
  features: FeatureData;
  fftMagnitudes: number[];
  timestamp?: string;
}

export interface ProcessedReading {
  timestamp: string;
  chainage: number;
  verdict: 'green' | 'yellow' | 'red';
  score: number;
  gauge: number;
  latitude: number;
  longitude: number;
  satellites: number;
  fftMagnitudes: number[];
}
