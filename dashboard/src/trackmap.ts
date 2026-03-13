/* ========================================
   Track Map Panel — OpenRailwayMap with Leaflet
   GPS pins color-coded by verdict
   ======================================== */

import L from 'leaflet';
import { DataSource } from './datasource';
import type { DataSourceStatus } from './types';
import { API_BASE_URL } from './config';

interface GPSReading {
  lat: number;
  lon: number;
  verdict?: string;
  score?: number;
  chainage?: number;
  timestamp?: string;
}

class TrackMapPanel {
  private map: L.Map | null = null;
  private ds: DataSource | null = null;
  private markers: L.Marker[] = [];
  private markerLayer: L.LayerGroup | null = null;

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-trackmap');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement;
    if (!text) return;
    el.className = 'panel-status' + (status === 'live' ? ' live' : status === 'error' ? ' error' : '');
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Ready';
  }

  private getMarkerColor(verdict?: string): string {
    if (!verdict) return '#6366f1'; // default blue
    const v = verdict.toUpperCase();
    if (v === 'HEALTHY' || v === 'GOOD') return '#10b981'; // green
    if (v === 'MODERATE' || v === 'HIGH' || v === 'SUSPECT') return '#f59e0b'; // yellow/orange
    if (v === 'CRITICAL' || v === 'BAD') return '#ef4444'; // red
    return '#6366f1'; // default blue
  }

  private createCustomIcon(color: string): L.DivIcon {
    return L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        background-color: ${color};
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      "></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -11]
    });
  }

  private initMap(): void {
    const container = document.getElementById('map-container');
    if (!container || this.map) return;

    // Clear container
    container.innerHTML = '';

    // Initialize Leaflet map with default center (will auto-adjust when data loads)
    this.map = L.map('map-container', {
      center: [20.5937, 78.9629], // Central India (near Nagpur)
      zoom: 5,
      zoomControl: true
    });

    // Add OpenStreetMap base layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(this.map);

    // Add OpenRailwayMap overlay
    L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
      maxZoom: 19,
      tileSize: 256
    }).addTo(this.map);

    // Create marker layer group
    this.markerLayer = L.layerGroup().addTo(this.map);
  }

  private renderMarkers(data: GPSReading[]): void {
    if (!this.map || !this.markerLayer) return;

    // Clear existing markers
    this.markerLayer.clearLayers();
    this.markers = [];

    const validPoints: [number, number][] = [];

    // Add new markers for each GPS reading
    data.forEach((reading) => {
      if (reading.lat && reading.lon && !isNaN(reading.lat) && !isNaN(reading.lon)) {
        const color = this.getMarkerColor(reading.verdict);
        const icon = this.createCustomIcon(color);

        const marker = L.marker([reading.lat, reading.lon], { icon })
          .bindPopup(`
            <div style="font-family: Inter, sans-serif; min-width: 150px;">
              <strong style="color: ${color}; font-size: 14px;">${reading.verdict || 'Unknown'}</strong><br/>
              <span style="font-size: 12px; color: #666;">
                Score: ${reading.score?.toFixed(2) || 'N/A'}<br/>
                Chainage: ${reading.chainage?.toFixed(2) || 'N/A'} km<br/>
                Position: ${reading.lat.toFixed(6)}, ${reading.lon.toFixed(6)}<br/>
                ${reading.timestamp ? `Time: ${reading.timestamp}` : ''}
              </span>
            </div>
          `);

        if (this.markerLayer) {
          this.markerLayer.addLayer(marker);
        }
        this.markers.push(marker);
        validPoints.push([reading.lat, reading.lon]);
      }
    });

    // Auto-fit map to show all markers
    if (validPoints.length > 0) {
      const bounds = L.latLngBounds(validPoints);
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }

  public init(): void {
    if (this.map) return; // already initialized

    // Initialize the map
    this.initMap();

    // Data source for GPS tracking
    this.ds = new DataSource('trackmap');
    this.ds.onStatusChange = (status) => this.updateStatus(status);
    this.ds.onData = (data: any) => {
      if (Array.isArray(data)) {
        // Filter out readings with valid GPS coordinates and map field names
        const gpsReadings = data
          .filter((r: any) => (r.latitude || r.lat) && (r.longitude || r.lon))
          .map((r: any) => ({
            lat: r.latitude || r.lat,
            lon: r.longitude || r.lon,
            verdict: r.verdict,
            score: r.score,
            chainage: r.chainage,
            timestamp: r.timestamp
          }));
        this.renderMarkers(gpsReadings);
      } else if (data && (data.latitude || data.lat) && (data.longitude || data.lon)) {
        // Single reading
        const mapped = {
          lat: data.latitude || data.lat,
          lon: data.longitude || data.lon,
          verdict: data.verdict,
          score: data.score,
          chainage: data.chainage,
          timestamp: data.timestamp
        };
        this.renderMarkers([mapped]);
      }
    };

    // Set default API endpoint
    if (!this.ds.isConfigured()) {
      this.ds.saveConfig({
        apiUrl: `${API_BASE_URL}/api/readings?limit=50`,
        pollInterval: 2,
        wsUrl: '',
        dataPath: 'readings'
      });
    }

    this.ds.start();
    this.updateStatus('ready');
  }

  public refresh(): void {
    if (this.map) {
      this.map.invalidateSize();
    }
  }

  public restart(): void {
    if (this.ds) {
      this.ds.restart();
    }
  }
}

export const TrackMap = new TrackMapPanel();
