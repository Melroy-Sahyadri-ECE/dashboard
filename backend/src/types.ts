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

export interface VisionAnimalDetectionInput {
  deadAnimalDetected?: boolean;
  animalType?: string;
  confidence?: number;
  imageUrl?: string;
  notes?: string;
}

export interface AnimalDetectionRequest {
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  lon?: number;
  timestamp?: string;
  botId?: string;
  source?: string;
  animalType?: string;
  confidence?: number;
  imageUrl?: string;
  notes?: string;
  chainage?: number;
  status?: 'active' | 'resolved';
  deadAnimalDetected?: boolean;
  detected?: boolean;
}

export interface AnimalDetectionEvent {
  id: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  animalType: string;
  confidence: number;
  status: 'active' | 'resolved';
  source: string;
  botId?: string;
  imageUrl?: string;
  notes?: string;
  chainage?: number;
}

export interface ESP32Reading {
  verdict: string;
  gps: GPSData;
  features: FeatureData;
  fftMagnitudes: number[];
  timestamp?: string;
  deviceId?: string;
  vision?: VisionAnimalDetectionInput;
  animalDetection?: AnimalDetectionRequest;
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
