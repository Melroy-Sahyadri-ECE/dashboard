/* ========================================
   Track Map Panel — Bot Ops + Live Map
   ======================================== */

import L from 'leaflet';
import { DataSource } from './datasource';
import type { DataSourceStatus } from './types';
import { API_BASE_URL, WS_URL } from './config';

type BotStatus = 'active_running' | 'stalled' | 'non_operational';
type BotSource = 'real' | 'demo';

interface TelemetryReading {
  bot_id?: string;
  botId?: string;
  lat?: number;
  latitude?: number;
  lng?: number;
  lon?: number;
  longitude?: number;
  speed?: number;
  velocity?: number;
  heading?: number;
  bearing?: number;
  battery?: number;
  battery_pct?: number;
  timestamp?: string | number;
  ts?: string | number;
  time?: string | number;
  source?: BotSource;
}

interface BotState {
  botId: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  battery: number | null;
  source: BotSource;
  lastSeen: number;
  lastMovedAt: number;
  status: BotStatus;
}

interface DemoBotConfig {
  botId: string;
  source: BotSource;
  moving: boolean;
  nonOperational?: boolean;
  path: [number, number][];
  index: number;
  direction?: 1 | -1;
  moveTicksInPhase?: number;
  stallTicksInPhase?: number;
  moveTicksRemaining?: number;
  stallTicksRemaining?: number;
}

class TrackMapPanel {
  private readonly REAL_BOT_ID = 'ESP32-REAL-001';
  private readonly MOVE_THRESHOLD_METERS = 3;
  private readonly STALLED_MS = 2 * 60 * 1000;
  private readonly NON_OPERATIONAL_MS = 10 * 60 * 1000;
  private readonly DEMO_TICK_MS = 2000;
  private readonly DEFAULT_DEMO_MOVE_TICKS = 10;
  private readonly DEFAULT_DEMO_STALL_TICKS = 3;

  private map: L.Map | null = null;
  private ds: DataSource | null = null;
  private markersLayer: L.LayerGroup | null = null;
  private markers = new Map<string, L.CircleMarker>();
  private arrowMarkers = new Map<string, L.Marker>();
  private bots = new Map<string, Omit<BotState, 'status'>>();
  private demoTimer: number | null = null;
  private didAutoFit = false;
  private esp32Connected = false;
  private readonly REAL_BOT_FALLBACK: [number, number] = [17.41760, 78.49290];

  private demoBots: DemoBotConfig[] = [
    {
      botId: 'DEMO-RUN-01',
      source: 'demo',
      moving: true,
      direction: 1,
      moveTicksInPhase: 10,
      stallTicksInPhase: 3,
      path: [
        [17.45090, 78.37990],
        [17.44810, 78.40180],
        [17.44620, 78.42090],
        [17.44380, 78.45180],
        [17.44120, 78.47680],
        [17.43980, 78.49830],
        [17.45070, 78.52380],
        [17.46320, 78.54520]
      ],
      index: 0
    },
    {
      botId: 'DEMO-RUN-02',
      source: 'demo',
      moving: true,
      direction: 1,
      moveTicksInPhase: 8,
      stallTicksInPhase: 4,
      path: [
        [17.37090, 78.49740],
        [17.38170, 78.48940],
        [17.39330, 78.48260],
        [17.40420, 78.48600],
        [17.41510, 78.49270],
        [17.42830, 78.50190],
        [17.43890, 78.49860]
      ],
      index: 0
    },
    {
      botId: 'DEMO-STALL-01',
      source: 'demo',
      moving: false,
      path: [
        [17.45100, 78.52390],
        [17.45100, 78.52390]
      ],
      index: 0
    },
    {
      botId: 'DEMO-NONOP-01',
      source: 'demo',
      moving: false,
      nonOperational: true,
      path: [
        [17.44620, 78.42100],
        [17.44620, 78.42100]
      ],
      index: 0
    }
  ];

  private readonly demoBotIds = new Set(this.demoBots.map((bot) => bot.botId));

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-trackmap');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement | null;
    if (!text) return;

    el.className = `panel-status${status === 'live' ? ' live' : status === 'error' ? ' error' : ''}`;
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Demo Data';
  }

  private toRad(value: number): number {
    return (value * Math.PI) / 180;
  }

  private haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const earthRadius = 6371000;
    const dLat = this.toRad(b.lat - a.lat);
    const dLng = this.toRad(b.lng - a.lng);
    const lat1 = this.toRad(a.lat);
    const lat2 = this.toRad(b.lat);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    return 2 * earthRadius * Math.asin(Math.sqrt(h));
  }

  private normalizeTimestamp(input: unknown): number {
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') {
      const parsed = new Date(input).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  private statusForBot(bot: Omit<BotState, 'status'>): BotStatus {
    if (bot.botId === this.REAL_BOT_ID && !this.esp32Connected) {
      return 'non_operational';
    }

    const now = Date.now();
    const age = now - bot.lastSeen;
    const noMoveAge = now - bot.lastMovedAt;

    if (age > this.NON_OPERATIONAL_MS) return 'non_operational';
    if (noMoveAge > this.STALLED_MS) return 'stalled';
    return 'active_running';
  }

  private parseIncoming(payload: unknown): TelemetryReading[] {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload as TelemetryReading[];

    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.bots)) return obj.bots as TelemetryReading[];
    if (Array.isArray(obj.data)) return obj.data as TelemetryReading[];
    if (Array.isArray(obj.readings)) return obj.readings as TelemetryReading[];

    if ('bot_id' in obj || 'botId' in obj) return [obj as TelemetryReading];
    return [];
  }

  private ingestReading(reading: TelemetryReading, sourceOverride?: BotSource): void {
    const botId = reading.bot_id || reading.botId;
    if (!botId) return;

    const lat = Number(reading.lat ?? reading.latitude);
    const lng = Number(reading.lng ?? reading.lon ?? reading.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const source: BotSource = botId === this.REAL_BOT_ID ? 'real' : (sourceOverride || reading.source || 'demo');
    const lastSeen = this.normalizeTimestamp(reading.timestamp ?? reading.ts ?? reading.time);
    const previous = this.bots.get(botId);

    let lastMovedAt = previous ? previous.lastMovedAt : lastSeen;
    let heading = Number(reading.heading ?? reading.bearing ?? 0);
    
    if (!previous) {
      lastMovedAt = lastSeen;
    } else {
      const moved = this.haversineMeters(previous, { lat, lng }) > this.MOVE_THRESHOLD_METERS;
      const speed = Number(reading.speed ?? reading.velocity ?? 0);
      if (moved || speed > 0.5) lastMovedAt = lastSeen;
      
      // Calculate heading from movement if not provided
      if (!reading.heading && !reading.bearing && moved) {
        heading = this.calculateHeading(previous.lat, previous.lng, lat, lng);
      }
    }

    this.bots.set(botId, {
      botId,
      lat,
      lng,
      speed: Number(reading.speed ?? reading.velocity ?? 0),
      heading,
      battery: reading.battery ?? reading.battery_pct ?? null,
      source,
      lastSeen,
      lastMovedAt
    });
  }

  private calculateHeading(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = this.toRad(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(this.toRad(lat2));
    const x = Math.cos(this.toRad(lat1)) * Math.sin(this.toRad(lat2)) -
              Math.sin(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.cos(dLng);
    const bearing = Math.atan2(y, x);
    return (bearing * 180 / Math.PI + 360) % 360;
  }

  private createArrowIcon(heading: number, color: string): L.DivIcon {
    return L.divIcon({
      html: `<div style="transform: rotate(${heading}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">
               <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                 <path d="M16 4 L26 28 L16 23 L6 28 Z" fill="${color}" stroke="#ffffff" stroke-width="2" opacity="0.9"/>
               </svg>
             </div>`,
      className: 'arrow-marker',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });
  }

  private getAllBots(): BotState[] {
    return Array.from(this.bots.values())
      .map((bot) => ({ ...bot, status: this.statusForBot(bot) }))
      .sort((a, b) => a.botId.localeCompare(b.botId));
  }

  private getFilters(): { status: string; source: string; search: string } {
    const status = (document.getElementById('track-filter-status') as HTMLSelectElement | null)?.value || 'all';
    const source = (document.getElementById('track-filter-source') as HTMLSelectElement | null)?.value || 'all';
    const search = ((document.getElementById('track-filter-search') as HTMLInputElement | null)?.value || '').trim().toLowerCase();
    return { status, source, search };
  }

  private applyFilters(allBots: BotState[]): BotState[] {
    const filters = this.getFilters();
    return allBots.filter((bot) => {
      if (filters.status !== 'all' && bot.status !== filters.status) return false;
      if (filters.source !== 'all' && bot.source !== filters.source) return false;
      if (filters.search && !bot.botId.toLowerCase().includes(filters.search)) return false;
      return true;
    });
  }

  private statusLabel(status: BotStatus): string {
    return status.replace('_', ' ');
  }

  private formatTime(ts: number): string {
    const dt = new Date(ts);
    if (!Number.isFinite(dt.getTime())) return '-';
    return dt.toLocaleTimeString();
  }

  private renderCounters(allBots: BotState[]): void {
    const counts: Record<BotStatus, number> = {
      active_running: 0,
      stalled: 0,
      non_operational: 0
    };

    allBots.forEach((bot) => {
      counts[bot.status] += 1;
    });

    const activeEl = document.getElementById('count-active-running');
    const stalledEl = document.getElementById('count-stalled');
    const nonOpEl = document.getElementById('count-non-operational');

    if (activeEl) activeEl.textContent = String(counts.active_running);
    if (stalledEl) stalledEl.textContent = String(counts.stalled);
    if (nonOpEl) nonOpEl.textContent = String(counts.non_operational);
  }

  private renderTable(filteredBots: BotState[]): void {
    const tbody = document.getElementById('track-botlist-body') as HTMLTableSectionElement | null;
    if (!tbody) return;

    if (!filteredBots.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="color: var(--text-muted);">No bots match current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = filteredBots.map((bot) => {
      const isReal = bot.botId === this.REAL_BOT_ID;
      return `
        <tr class="${isReal ? 'track-real-bot-row' : ''}">
          <td>${bot.botId}${isReal ? ' <span class="track-source-pill real">Primary</span>' : ''}</td>
          <td><span class="track-status-pill ${bot.status}">${this.statusLabel(bot.status)}</span></td>
          <td><span class="track-source-pill ${bot.source}">${bot.source}</span></td>
          <td>${this.formatTime(bot.lastSeen)}</td>
        </tr>
      `;
    }).join('');
  }

  private markerStyle(bot: BotState): L.CircleMarkerOptions {
    if (bot.botId === this.REAL_BOT_ID) {
      return { radius: 9, color: '#3b82f6', fillColor: '#3b82f6', weight: 2, fillOpacity: 0.9 };
    }
    if (bot.status === 'active_running') {
      return { radius: 7, color: '#22c55e', fillColor: '#22c55e', weight: 2, fillOpacity: 0.85 };
    }
    if (bot.status === 'stalled') {
      return { radius: 7, color: '#eab308', fillColor: '#eab308', weight: 2, fillOpacity: 0.85 };
    }
    return { radius: 7, color: '#ef4444', fillColor: '#ef4444', weight: 2, fillOpacity: 0.85 };
  }

  private popupHtml(bot: BotState): string {
    return `
      <div class="popup-content">
        <strong>${bot.botId}</strong><br>
        Status: ${this.statusLabel(bot.status)}<br>
        Source: ${bot.source}<br>
        Last Seen: ${this.formatTime(bot.lastSeen)}<br>
        Speed: ${bot.speed.toFixed(1)}
      </div>
    `;
  }

  private renderMarkers(allBots: BotState[], filteredBots: BotState[]): void {
    if (!this.markersLayer) return;

    const visibleSet = new Set(filteredBots.map((bot) => bot.botId));

    allBots.forEach((bot) => {
      const marker = this.markers.get(bot.botId);
      if (!marker) {
        const created = L.circleMarker([bot.lat, bot.lng], this.markerStyle(bot))
          .bindPopup(this.popupHtml(bot), { className: 'custom-popup' })
          .addTo(this.markersLayer as L.LayerGroup);
        this.markers.set(bot.botId, created);
      } else {
        marker.setLatLng([bot.lat, bot.lng]);
        marker.setStyle(this.markerStyle(bot));
        marker.setPopupContent(this.popupHtml(bot));
      }

      // Add arrow marker for demo bots only when they're moving
      if (bot.source === 'demo' && bot.status === 'active_running' && bot.speed > 0.5) {
        const arrowMarker = this.arrowMarkers.get(bot.botId);
        const style = this.markerStyle(bot);
        const arrowColor = style.fillColor || '#22c55e';
        
        if (!arrowMarker) {
          const created = L.marker([bot.lat, bot.lng], {
            icon: this.createArrowIcon(bot.heading, arrowColor),
            zIndexOffset: 1000
          }).addTo(this.markersLayer as L.LayerGroup);
          this.arrowMarkers.set(bot.botId, created);
        } else {
          arrowMarker.setLatLng([bot.lat, bot.lng]);
          arrowMarker.setIcon(this.createArrowIcon(bot.heading, arrowColor));
          if (!this.markersLayer?.hasLayer(arrowMarker)) {
            arrowMarker.addTo(this.markersLayer as L.LayerGroup);
          }
        }
      } else {
        // Remove arrow if bot is not demo or not moving
        const arrowMarker = this.arrowMarkers.get(bot.botId);
        if (arrowMarker && this.markersLayer?.hasLayer(arrowMarker)) {
          this.markersLayer.removeLayer(arrowMarker);
        }
      }
    });

    this.markers.forEach((marker, botId) => {
      if (visibleSet.has(botId)) {
        if (!this.markersLayer?.hasLayer(marker)) marker.addTo(this.markersLayer as L.LayerGroup);
      } else {
        if (this.markersLayer?.hasLayer(marker)) this.markersLayer.removeLayer(marker);
      }
    });

    this.arrowMarkers.forEach((arrow, botId) => {
      const bot = this.bots.get(botId);
      const shouldShow = bot && visibleSet.has(botId) && bot.source === 'demo';
      if (shouldShow) {
        if (!this.markersLayer?.hasLayer(arrow)) arrow.addTo(this.markersLayer as L.LayerGroup);
      } else {
        if (this.markersLayer?.hasLayer(arrow)) this.markersLayer.removeLayer(arrow);
      }
    });

    if (!this.didAutoFit && filteredBots.length && this.map) {
      const points = filteredBots.map((bot) => [bot.lat, bot.lng] as [number, number]);
      this.map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
      this.didAutoFit = true;
    }
  }

  private render(): void {
    const allBots = this.getAllBots();
    const filtered = this.applyFilters(allBots);
    this.renderCounters(allBots);
    this.renderTable(filtered);
    this.renderMarkers(allBots, filtered);
  }

  private processPayload(payload: unknown, sourceOverride?: BotSource): void {
    const incoming = this.parseIncoming(payload).filter((reading) => {
      const botId = reading.bot_id || reading.botId;
      if (!botId) return false;
      return !this.demoBotIds.has(botId);
    });
    incoming.forEach((reading) => this.ingestReading(reading, sourceOverride));
    if (incoming.length) this.render();
  }

  private ensureDemoBotPhase(bot: DemoBotConfig): void {
    if (bot.nonOperational || bot.path.length < 2) return;

    if (typeof bot.direction !== 'number') {
      bot.direction = 1;
    }
    if (typeof bot.moveTicksInPhase !== 'number') {
      bot.moveTicksInPhase = this.DEFAULT_DEMO_MOVE_TICKS;
    }
    if (typeof bot.stallTicksInPhase !== 'number') {
      bot.stallTicksInPhase = this.DEFAULT_DEMO_STALL_TICKS;
    }

    if (bot.moving && typeof bot.moveTicksRemaining !== 'number') {
      bot.moveTicksRemaining = bot.moveTicksInPhase;
    }
    if (!bot.moving && typeof bot.stallTicksRemaining !== 'number') {
      bot.stallTicksRemaining = bot.stallTicksInPhase;
    }
  }

  private getNextDemoIndex(bot: DemoBotConfig): number {
    const direction = bot.direction ?? 1;
    let nextDirection: 1 | -1 = direction;
    let nextIndex = bot.index + direction;

    if (nextIndex >= bot.path.length || nextIndex < 0) {
      nextDirection = direction === 1 ? -1 : 1;
      nextIndex = bot.index + nextDirection;
    }

    if (nextIndex >= bot.path.length || nextIndex < 0) {
      nextIndex = bot.index;
    }

    bot.direction = nextDirection;
    return nextIndex;
  }

  private startDemo(): void {
    this.stopDemo();

    this.demoBots.forEach((bot) => {
      this.ensureDemoBotPhase(bot);

      const [lat, lng] = bot.path[bot.index];
      const ts = bot.nonOperational ? Date.now() - (11 * 60 * 1000) : Date.now();

      let heading = 0;
      if (bot.moving && bot.path.length > 1) {
        const nextIndex = this.getNextDemoIndex(bot);
        const [nextLat, nextLng] = bot.path[nextIndex];
        heading = this.calculateHeading(lat, lng, nextLat, nextLng);
      }

      this.ingestReading({
        bot_id: bot.botId,
        lat,
        lng,
        speed: bot.moving ? 8 : 0,
        heading: heading,
        timestamp: ts,
        source: bot.source
      }, 'demo');
    });

    this.render();

    this.demoTimer = window.setInterval(() => {
      this.demoBots.forEach((bot) => {
        this.ensureDemoBotPhase(bot);

        if (bot.nonOperational) {
          const [lat, lng] = bot.path[bot.index];
          this.ingestReading({
            bot_id: bot.botId,
            lat,
            lng,
            speed: 0,
            timestamp: Date.now() - (11 * 60 * 1000),
            source: 'demo'
          }, 'demo');
          return;
        }

        let heading = this.bots.get(bot.botId)?.heading ?? 0;

        if (bot.moving) {
          const [fromLat, fromLng] = bot.path[bot.index];
          bot.index = this.getNextDemoIndex(bot);
          const [toLat, toLng] = bot.path[bot.index];
          heading = this.calculateHeading(fromLat, fromLng, toLat, toLng);

          bot.moveTicksRemaining = Math.max(0, (bot.moveTicksRemaining ?? 0) - 1);
          if ((bot.moveTicksRemaining ?? 0) === 0) {
            bot.moving = false;
            bot.stallTicksRemaining = bot.stallTicksInPhase ?? this.DEFAULT_DEMO_STALL_TICKS;
          }
        } else {
          bot.stallTicksRemaining = Math.max(0, (bot.stallTicksRemaining ?? 0) - 1);
          if ((bot.stallTicksRemaining ?? 0) === 0) {
            bot.moving = true;
            bot.moveTicksRemaining = bot.moveTicksInPhase ?? this.DEFAULT_DEMO_MOVE_TICKS;
          }
        }

        const [lat, lng] = bot.path[bot.index];

        this.ingestReading({
          bot_id: bot.botId,
          lat,
          lng,
          speed: bot.moving ? 7 + Math.random() * 4 : 0,
          heading: heading,
          timestamp: Date.now(),
          source: 'demo'
        }, 'demo');
      });

      this.render();
    }, this.DEMO_TICK_MS);
  }

  private stopDemo(): void {
    if (this.demoTimer != null) {
      window.clearInterval(this.demoTimer);
      this.demoTimer = null;
    }
  }

  private bindFilterEvents(): void {
    const statusFilter = document.getElementById('track-filter-status');
    const sourceFilter = document.getElementById('track-filter-source');
    const searchFilter = document.getElementById('track-filter-search');

    [statusFilter, sourceFilter].forEach((el) => {
      el?.addEventListener('change', () => this.render());
    });

    searchFilter?.addEventListener('input', () => this.render());
  }

  private bindESP32Events(): void {
    window.addEventListener('esp32-status', (event: Event) => {
      const customEvent = event as CustomEvent<{ connected?: boolean }>;
      this.esp32Connected = Boolean(customEvent.detail?.connected);

      if (!this.esp32Connected && !this.bots.has(this.REAL_BOT_ID)) {
        const now = Date.now();
        const existing = this.bots.get(this.REAL_BOT_ID);
        const lat = existing?.lat ?? this.REAL_BOT_FALLBACK[0];
        const lng = existing?.lng ?? this.REAL_BOT_FALLBACK[1];

        this.bots.set(this.REAL_BOT_ID, {
          botId: this.REAL_BOT_ID,
          lat,
          lng,
          speed: 0,
          heading: 0,
          battery: null,
          source: 'real',
          lastSeen: now - (this.NON_OPERATIONAL_MS + 1000),
          lastMovedAt: now - (this.STALLED_MS + 1000)
        });
      }

      this.render();
    });
  }

  private initMap(): void {
    const container = document.getElementById('map-container');
    if (!container || this.map) return;

    container.innerHTML = '';

    this.map = L.map('map-container', {
      center: [17.4070, 78.4867],
      zoom: 12,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(this.map);

    L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenRailwayMap',
      maxZoom: 19
    }).addTo(this.map);

    this.markersLayer = L.layerGroup().addTo(this.map);

    this.demoBots.forEach((bot) => {
      L.polyline(bot.path, {
        color: '#6366f1',
        weight: 2,
        dashArray: '4 6',
        opacity: 0.45
      }).addTo(this.map as L.Map);
    });
  }

  private initDataSource(): void {
    this.ds = new DataSource('trackmap');

    if (!this.ds.isConfigured()) {
      this.ds.saveConfig({
        apiUrl: `${API_BASE_URL}/api/bots/current`,
        pollInterval: 2,
        wsUrl: WS_URL,
        dataPath: 'bots'
      });
    }

    this.ds.onStatusChange = (status) => {
      this.updateStatus(status);
      if (status !== 'live') {
        this.startDemo();
      }
    };

    this.ds.onData = (payload) => {
      this.processPayload(payload);
      this.updateStatus('live');
    };

    this.ds.onError = () => {
      this.updateStatus('error');
      this.startDemo();
    };

    this.ds.start();
  }

  public init(): void {
    if (this.map) return;
    this.initMap();
    this.bindFilterEvents();
    this.bindESP32Events();
    this.initDataSource();
    this.updateStatus('demo');
    this.startDemo();
  }

  public refresh(): void {
    if (!this.map) return;
    window.setTimeout(() => this.map?.invalidateSize(), 150);
  }

  public restart(): void {
    if (!this.ds) return;
    this.ds.restart();
    if (!this.ds.isConfigured()) {
      this.updateStatus('demo');
      this.startDemo();
    }
  }
}

export const TrackMap = new TrackMapPanel();
