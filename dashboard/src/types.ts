// Type definitions for the dashboard

export interface EventData {
  timestamp: string;
  chainage: number;
  verdict: 'green' | 'yellow' | 'red';
  score: number;
  gauge: number;
}

export interface AnimalDetection {
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
  chainage?: number | null;
}

export interface FFTData {
  frequencies: number[];
  amplitudes: number[];
}

export interface ProfileData {
  labels: number[];
  scores?: number[];
  gauges?: number[];
}

export interface SummaryData {
  totalReadings: number;
  criticalCount: number;
  suspectCount: number;
  goodCount: number;
  avgScore: number;
  maxDeviation: number;
}

export interface DataSourceConfig {
  apiUrl: string;
  pollInterval: number;
  wsUrl: string;
  dataPath: string;
}

export type DataSourceStatus = 'demo' | 'live' | 'error' | 'ready';

export type PanelId = 'trackmap' | 'health' | 'gauge' | 'fft' | 'events' | 'summary' | 'settings';
