/* ========================================
   DataSource — Fetch layer for panels
   Handles REST polling + WebSocket
   ======================================== */

import type { DataSourceConfig, DataSourceStatus } from './types';
import { API_BASE_URL, WS_URL } from './config';

export class DataSource {
  private panelId: string;
  private config: DataSourceConfig;
  private pollTimer: number | null = null;
  private ws: WebSocket | null = null;
  public onData: ((data: any) => void) | null = null;
  public onError: ((error: Error) => void) | null = null;
  public onStatusChange: ((status: DataSourceStatus) => void) | null = null;

  constructor(panelId: string) {
    this.panelId = panelId;
    this.config = this.loadConfig();
  }

  private loadConfig(): DataSourceConfig {
    const stored = localStorage.getItem(`ds_config_${this.panelId}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as DataSourceConfig;
        const migrated: DataSourceConfig = {
          apiUrl: this.migrateLegacyUrl(parsed.apiUrl || '', 'api'),
          pollInterval: parsed.pollInterval || 5,
          wsUrl: this.migrateLegacyUrl(parsed.wsUrl || '', 'ws'),
          dataPath: parsed.dataPath || ''
        };

        if (migrated.apiUrl !== (parsed.apiUrl || '') || migrated.wsUrl !== (parsed.wsUrl || '')) {
          localStorage.setItem(`ds_config_${this.panelId}`, JSON.stringify(migrated));
        }

        return migrated;
      } catch (e) {
        // ignore parse errors
      }
    }
    return {
      apiUrl: '',
      pollInterval: 5,
      wsUrl: '',
      dataPath: ''
    };
  }

  private migrateLegacyUrl(url: string, kind: 'api' | 'ws'): string {
    if (!url) return url;

    if (kind === 'api' && /https?:\/\/localhost:5000/i.test(url)) {
      return url.replace(/https?:\/\/localhost:5000/i, API_BASE_URL);
    }

    if (kind === 'ws' && /wss?:\/\/localhost:5000\/ws/i.test(url)) {
      return url.replace(/wss?:\/\/localhost:5000\/ws/i, WS_URL);
    }

    return url;
  }

  public saveConfig(config: DataSourceConfig): void {
    this.config = config;
    localStorage.setItem(`ds_config_${this.panelId}`, JSON.stringify(config));
  }

  public isConfigured(): boolean {
    return !!(this.config.apiUrl || this.config.wsUrl);
  }

  // Extract nested value from object using dot-separated path
  private extractDataPath(data: any, path: string): any {
    if (!path) return data;
    const keys = path.split('.');
    let result = data;
    for (const key of keys) {
      if (result == null) return null;
      // Support array index like "items[0]"
      const match = key.match(/^(\w+)\[(\d+)\]$/);
      if (match) {
        result = result[match[1]];
        if (Array.isArray(result)) result = result[parseInt(match[2])];
      } else {
        result = result[key];
      }
    }
    return result;
  }

  public async fetchOnce(): Promise<any> {
    if (!this.config.apiUrl) return null;
    try {
      const response = await fetch(this.config.apiUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const extracted = this.extractDataPath(data, this.config.dataPath);
      if (this.onStatusChange) this.onStatusChange('live');
      if (this.onData) this.onData(extracted);
      return extracted;
    } catch (err) {
      if (this.onStatusChange) this.onStatusChange('error');
      if (this.onError && err instanceof Error) this.onError(err);
      return null;
    }
  }

  public startPolling(): void {
    this.stopPolling();
    if (!this.config.apiUrl) return;
    const interval = Math.max(1, this.config.pollInterval || 5) * 1000;
    this.fetchOnce(); // immediate first fetch
    this.pollTimer = window.setInterval(() => this.fetchOnce(), interval);
  }

  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public connectWebSocket(): void {
    this.disconnectWebSocket();
    if (!this.config.wsUrl) return;
    try {
      this.ws = new WebSocket(this.config.wsUrl);
      this.ws.onopen = () => {
        if (this.onStatusChange) this.onStatusChange('live');
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const extracted = this.extractDataPath(data, this.config.dataPath);
          if (this.onData) this.onData(extracted);
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };
      this.ws.onerror = () => {
        if (this.onStatusChange) this.onStatusChange('error');
        if (this.onError) this.onError(new Error('WebSocket error'));
      };
      this.ws.onclose = () => {
        if (this.onStatusChange) this.onStatusChange('ready');
      };
    } catch (err) {
      if (this.onStatusChange) this.onStatusChange('error');
      if (this.onError && err instanceof Error) this.onError(err);
    }
  }

  public disconnectWebSocket(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public restart(): void {
    this.stopPolling();
    this.disconnectWebSocket();
    if (this.config.apiUrl) {
      this.startPolling();
    }
    if (this.config.wsUrl) {
      this.connectWebSocket();
    }
  }

  public stop(): void {
    this.stopPolling();
    this.disconnectWebSocket();
    if (this.onStatusChange) this.onStatusChange('ready');
  }

  public start(): void {
    if (this.isConfigured()) {
      this.restart();
    } else {
      if (this.onStatusChange) this.onStatusChange('demo');
    }
  }
}
