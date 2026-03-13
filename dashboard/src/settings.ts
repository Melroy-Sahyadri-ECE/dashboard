/* ========================================
   Settings Panel — Data Source Configuration
   Map each panel to API/WebSocket endpoint
   ======================================== */

import { DataSource } from './datasource';
import type { DataSourceConfig } from './types';
import { TrackMap } from './trackmap';
import { HealthProfile } from './health';
import { GaugeProfile } from './gauge';
import { LiveFFT } from './fft';
import { EventsTable } from './events';
import { SummaryStats } from './summary';
import { API_BASE_URL, WS_URL } from './config';

interface PanelInfo {
  id: string;
  name: string;
  description: string;
}

const panels: PanelInfo[] = [
  { id: 'trackmap', name: 'Track Map', description: 'GPS pins color-coded by verdict' },
  { id: 'health', name: 'Health Profile', description: 'Vibration score vs chainage line chart' },
  { id: 'gauge', name: 'Gauge Profile', description: 'Gauge deviation from 1676mm nominal' },
  { id: 'fft', name: 'Live FFT', description: 'Real-time frequency spectrum' },
  { id: 'events', name: 'Events Table', description: 'Timestamp, chainage, verdict, scores' },
  { id: 'summary', name: 'Summary Stats', description: 'Total readings, critical & suspect counts' }
];

function getConfig(panelId: string): DataSourceConfig {
  const stored = localStorage.getItem(`ds_config_${panelId}`);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      // ignore
    }
  }
  return { apiUrl: '', pollInterval: 5, wsUrl: '', dataPath: '' };
}

function saveConfig(panelId: string, config: DataSourceConfig): void {
  localStorage.setItem(`ds_config_${panelId}`, JSON.stringify(config));
}

function isConfigured(panelId: string): boolean {
  const cfg = getConfig(panelId);
  return !!(cfg.apiUrl || cfg.wsUrl);
}

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function renderSettings(): void {
  const container = document.getElementById('settings-container');
  if (!container) return;

  container.innerHTML = `
    <div style="margin-bottom: 8px;">
      <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.6;">
        Configure each panel's data source below. Panels without a configured endpoint will show <strong style="color: var(--color-blue);">demo data</strong>.
        Settings are saved in your browser and persist across sessions.
      </p>
    </div>
  ` + panels.map(panel => {
    const cfg = getConfig(panel.id);
    const configured = isConfigured(panel.id);
    return `
      <div class="settings-card" id="settings-card-${panel.id}">
        <div class="settings-card-header" onclick="window.Settings.toggleCard('${panel.id}')">
          <div class="settings-card-title">
            <span class="dot ${configured ? 'configured' : ''}"></span>
            <span>${panel.name}</span>
            <span style="color: var(--text-muted); font-weight: 400; font-size: 0.82rem; margin-left: 4px;">— ${panel.description}</span>
          </div>
          <svg class="settings-card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="settings-card-body">
          <div class="settings-field">
            <label for="cfg-${panel.id}-api">API Endpoint URL</label>
            <input type="url" id="cfg-${panel.id}-api" placeholder="${API_BASE_URL}/api/readings" value="${cfg.apiUrl}">
          </div>
          <div class="settings-field">
            <label for="cfg-${panel.id}-poll">Poll Interval (seconds)</label>
            <input type="number" id="cfg-${panel.id}-poll" min="1" max="3600" placeholder="5" value="${cfg.pollInterval || 5}">
          </div>
          <div class="settings-field">
            <label for="cfg-${panel.id}-ws">WebSocket URL (optional)</label>
            <input type="url" id="cfg-${panel.id}-ws" placeholder="${WS_URL}" value="${cfg.wsUrl}">
          </div>
          <div class="settings-field">
            <label for="cfg-${panel.id}-path">Data Path (JSON key path)</label>
            <input type="text" id="cfg-${panel.id}-path" placeholder="data.readings" value="${cfg.dataPath}">
          </div>
          <div class="settings-actions">
            <button class="btn btn-primary" onclick="window.Settings.save('${panel.id}')">
              Save & Apply
            </button>
            <button class="btn btn-danger" onclick="window.Settings.clear('${panel.id}')">
              Clear
            </button>
            <button class="btn btn-secondary" onclick="window.Settings.test('${panel.id}')">
              Test Connection
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleCard(panelId: string): void {
  const card = document.getElementById(`settings-card-${panelId}`);
  if (card) card.classList.toggle('open');
}

function save(panelId: string): void {
  const apiInput = document.getElementById(`cfg-${panelId}-api`) as HTMLInputElement;
  const pollInput = document.getElementById(`cfg-${panelId}-poll`) as HTMLInputElement;
  const wsInput = document.getElementById(`cfg-${panelId}-ws`) as HTMLInputElement;
  const pathInput = document.getElementById(`cfg-${panelId}-path`) as HTMLInputElement;

  const config: DataSourceConfig = {
    apiUrl: apiInput.value.trim(),
    pollInterval: parseInt(pollInput.value) || 5,
    wsUrl: wsInput.value.trim(),
    dataPath: pathInput.value.trim()
  };

  saveConfig(panelId, config);

  // Update dot indicator
  const dot = document.querySelector(`#settings-card-${panelId} .dot`);
  if (dot) {
    dot.className = 'dot' + (config.apiUrl || config.wsUrl ? ' configured' : '');
  }

  // Restart the panel's data source
  restartPanel(panelId);

  const panelName = panels.find(p => p.id === panelId)?.name || panelId;
  showToast(`✓ ${panelName} settings saved!`);
}

function clear(panelId: string): void {
  localStorage.removeItem(`ds_config_${panelId}`);

  // Reset form inputs
  const apiInput = document.getElementById(`cfg-${panelId}-api`) as HTMLInputElement;
  const pollInput = document.getElementById(`cfg-${panelId}-poll`) as HTMLInputElement;
  const wsInput = document.getElementById(`cfg-${panelId}-ws`) as HTMLInputElement;
  const pathInput = document.getElementById(`cfg-${panelId}-path`) as HTMLInputElement;

  if (apiInput) apiInput.value = '';
  if (pollInput) pollInput.value = '5';
  if (wsInput) wsInput.value = '';
  if (pathInput) pathInput.value = '';

  // Update dot indicator
  const dot = document.querySelector(`#settings-card-${panelId} .dot`);
  if (dot) dot.className = 'dot';

  // Restart to demo mode
  restartPanel(panelId);

  const panelName = panels.find(p => p.id === panelId)?.name || panelId;
  showToast(`${panelName} reset to demo data`, 'success');
}

async function test(panelId: string): Promise<void> {
  const apiInput = document.getElementById(`cfg-${panelId}-api`) as HTMLInputElement;
  const apiUrl = apiInput.value.trim();
  
  if (!apiUrl) {
    showToast('Please enter an API URL first', 'error');
    return;
  }

  try {
    showToast('Testing connection...', 'success');
    const response = await fetch(apiUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json();
      const pathInput = document.getElementById(`cfg-${panelId}-path`) as HTMLInputElement;
      const dataPath = pathInput.value.trim();
      
      if (dataPath) {
        // Try extracting with path
        const ds = new DataSource(panelId);
        const extracted = (ds as any).extractDataPath(data, dataPath);
        showToast(`✓ Connected! Data path resolved ${extracted ? 'successfully' : '(null result — check path)'}`, extracted ? 'success' : 'error');
      } else {
        showToast(`✓ Connected! Received ${JSON.stringify(data).length} bytes`, 'success');
      }
    } else {
      showToast(`✕ HTTP ${response.status}: ${response.statusText}`, 'error');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    showToast(`✕ Connection failed: ${message}`, 'error');
  }
}

function restartPanel(panelId: string): void {
  const panelMap: Record<string, () => void> = {
    trackmap: () => TrackMap.restart(),
    health: () => HealthProfile.restart(),
    gauge: () => GaugeProfile.restart(),
    fft: () => LiveFFT.restart(),
    events: () => EventsTable.restart(),
    summary: () => SummaryStats.restart()
  };
  
  if (panelMap[panelId]) panelMap[panelId]();
}

// Export functions to be used globally
export const Settings = {
  renderSettings,
  toggleCard,
  save,
  clear,
  test
};

// Make Settings available globally for onclick handlers
(window as any).Settings = Settings;
