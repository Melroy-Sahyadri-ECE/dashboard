/* ========================================
   Events Table — Dynamic HTML Table
   Timestamp, chainage, verdict, scores, gauge
   ======================================== */

import { DataSource } from './datasource';
import type { DataSourceStatus, EventData } from './types';
import { API_BASE_URL } from './config';

class EventsTablePanel {
  private ds: DataSource | null = null;

  private mapVerdict(verdict: string): 'green' | 'yellow' | 'red' {
    const v = (verdict || '').toUpperCase();
    if (v === 'HEALTHY' || v === 'GREEN' || v === 'NONE') return 'green';
    if (v === 'MODERATE' || v === 'SUSPICIOUS' || v === 'YELLOW') return 'yellow';
    if (v === 'CRITICAL' || v === 'HIGH' || v === 'RED') return 'red';
    return 'green';
  }

  private renderTable(data: any[]): void {
    const tbody = document.getElementById('events-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Convert API data to EventData format
    const events: EventData[] = data.map(reading => ({
      timestamp: reading.timestamp || reading.serverTimestamp || 'N/A',
      chainage: reading.chainage || 0,
      verdict: this.mapVerdict(reading.verdict),
      score: Math.round((reading.score || 0) * 100),
      gauge: reading.gauge || 1676
    }));

    // Filter out green verdicts - only show yellow and red
    const filteredData = events.filter(row => row.verdict !== 'green');

    if (filteredData.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="5" style="text-align: center; padding: 40px; color: rgba(255, 255, 255, 0.5);">
          No events data available
        </td>
      `;
      tbody.appendChild(tr);
      return;
    }

    filteredData.forEach((row, i) => {
      const tr = document.createElement('tr');
      if (i === 0) tr.classList.add('new-row');

      const deviation = row.gauge - 1676;
      const deviationStr = (deviation >= 0 ? '+' : '') + deviation + ' mm';
      const deviationColor = Math.abs(deviation) >= 10 ? '#ef4444' : Math.abs(deviation) >= 5 ? '#eab308' : '#22c55e';

      const icon = row.verdict === 'yellow' ? '⚠' : '✕';
      const verdictBadge = `<span class="verdict-badge ${row.verdict}">${icon} ${row.verdict.charAt(0).toUpperCase() + row.verdict.slice(1)}</span>`;

      tr.innerHTML = `
        <td style="font-variant-numeric: tabular-nums; white-space: nowrap;">${row.timestamp}</td>
        <td>${row.chainage} km</td>
        <td>${verdictBadge}</td>
        <td>
          <span style="color: ${row.score >= 70 ? '#ef4444' : row.score >= 35 ? '#eab308' : '#64748b'}; font-weight: 600;">
            ${row.score}
          </span>
        </td>
        <td>
          ${row.gauge} mm
          <span style="color: ${deviationColor}; font-size: 0.78rem; margin-left: 6px;">(${deviationStr})</span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-events');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement;
    if (!text) return;
    el.className = 'panel-status' + (status === 'live' ? ' live' : status === 'error' ? ' error' : '');
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Ready';
  }

  public init(): void {
    this.ds = new DataSource('events');
    this.ds.onData = (data: any) => {
      if (Array.isArray(data)) {
        this.renderTable(data);
      }
    };
    this.ds.onStatusChange = (status) => this.updateStatus(status);

    // Set default API endpoint
    if (!this.ds.isConfigured()) {
      this.ds.saveConfig({
        apiUrl: `${API_BASE_URL}/api/readings?limit=100`,
        pollInterval: 2,
        wsUrl: '',
        dataPath: 'readings'
      });
    }

    this.ds.start();
    this.updateStatus('ready');
  }

  public restart(): void {
    if (this.ds) {
      this.ds.restart();
    }
  }
}

export const EventsTable = new EventsTablePanel();
