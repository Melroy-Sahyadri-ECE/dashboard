/* ========================================
   Summary Stats — Plain HTML Stat Cards + Circular Chart
   Total readings, critical, suspect counts
   ======================================== */

import { Chart, ChartConfiguration } from 'chart.js/auto';
import { DataSource } from './datasource';
import type { DataSourceStatus, SummaryData } from './types';
import { API_BASE_URL } from './config';

interface CardConfig {
  key: keyof SummaryData;
  label: string;
  icon: string;
  colorClass: string;
  format: (v: number) => string | number;
}

class SummaryStatsPanel {
  private ds: DataSource | null = null;
  private chart: Chart | null = null;
  private readings: any[] = [];

  private calculateSummary(): SummaryData {
    if (this.readings.length === 0) {
      return {
        totalReadings: 0,
        criticalCount: 0,
        suspectCount: 0,
        goodCount: 0,
        avgScore: 0,
        maxDeviation: 0
      };
    }

    let criticalCount = 0;
    let suspectCount = 0;
    let goodCount = 0;
    let totalScore = 0;
    let maxDev = 0;

    this.readings.forEach(reading => {
      const score = reading.score || 0;  // Score is already in 0-100 scale
      totalScore += score;
      
      const verdict = (reading.verdict || '').toUpperCase();
      if (verdict === 'CRITICAL' || verdict === 'HIGH' || verdict === 'RED') {
        criticalCount++;
      } else if (verdict === 'MODERATE' || verdict === 'SUSPICIOUS' || verdict === 'YELLOW') {
        suspectCount++;
      } else {
        goodCount++;
      }

      const gaugeDev = Math.abs((reading.gauge || 1676) - 1676);
      if (gaugeDev > maxDev) maxDev = gaugeDev;
    });

    return {
      totalReadings: this.readings.length,
      criticalCount,
      suspectCount,
      goodCount,
      avgScore: totalScore / this.readings.length,
      maxDeviation: maxDev
    };
  }

  private readonly cardConfigs: CardConfig[] = [
    {
      key: 'totalReadings',
      label: 'Total Readings',
      icon: '📊',
      colorClass: 'blue',
      format: (v) => v.toLocaleString()
    },
    {
      key: 'suspectCount',
      label: 'Suspect (Yellow)',
      icon: '⚠️',
      colorClass: 'yellow',
      format: (v) => v.toLocaleString()
    },
    {
      key: 'criticalCount',
      label: 'Critical (Red)',
      icon: '🔴',
      colorClass: 'red',
      format: (v) => v.toLocaleString()
    },
    {
      key: 'avgScore',
      label: 'Avg Vibration Score',
      icon: '📈',
      colorClass: 'purple',
      format: (v) => v.toFixed(1)
    },
    {
      key: 'maxDeviation',
      label: 'Max Gauge Deviation',
      icon: '📐',
      colorClass: 'red',
      format: (v) => `±${v} mm`
    }
  ];

  private animateCounter(el: HTMLElement, targetValue: number | string, duration = 800): void {
    const start = parseInt(el.textContent || '0') || 0;
    const startTime = performance.now();

    const update = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      if (typeof targetValue === 'number' && !isNaN(targetValue)) {
        const current = start + (targetValue - start) * eased;
        el.textContent = Number.isInteger(targetValue) 
          ? Math.round(current).toLocaleString() 
          : current.toFixed(1);
      }

      if (progress < 1) {
        requestAnimationFrame(update);
      }
    };

    if (typeof targetValue === 'string') {
      el.textContent = targetValue;
    } else {
      requestAnimationFrame(update);
    }
  }

  private renderCards(data: SummaryData): void {
    const grid = document.getElementById('stats-grid');
    if (!grid) return;

    // If cards don't exist yet, create them
    if (grid.children.length === 0) {
      grid.innerHTML = `
        <div class="chart-card">
          <canvas id="summary-chart"></canvas>
        </div>
      ` + this.cardConfigs.map(cfg => `
        <div class="stat-card" id="stat-${cfg.key}">
          <div class="stat-card-icon ${cfg.colorClass}">${cfg.icon}</div>
          <div class="stat-card-label">${cfg.label}</div>
          <div class="stat-card-value" id="stat-value-${cfg.key}">0</div>
          <div class="stat-card-change neutral" id="stat-change-${cfg.key}"></div>
        </div>
      `).join('');
    }

    // Update circular chart
    this.renderChart(data);

    // Update values with animation
    this.cardConfigs.forEach(cfg => {
      const el = document.getElementById(`stat-value-${cfg.key}`);
      if (!el || data[cfg.key] === undefined) return;

      const formatted = cfg.format(data[cfg.key]);
      if (typeof formatted === 'string' && isNaN(data[cfg.key])) {
        el.textContent = formatted;
      } else {
        this.animateCounter(el, data[cfg.key]);
        // For special format like ±19 mm
        if (cfg.key === 'maxDeviation') {
          setTimeout(() => { el.textContent = String(formatted); }, 850);
        }
      }
    });

    // Update change indicators
    const total = data.totalReadings || 1;
    const critPct = ((data.criticalCount / total) * 100).toFixed(1);
    const suspPct = ((data.suspectCount / total) * 100).toFixed(1);

    this.setChange('criticalCount', `${critPct}% of total`, parseFloat(critPct) > 10 ? 'negative' : 'neutral');
    this.setChange('suspectCount', `${suspPct}% of total`, parseFloat(suspPct) > 20 ? 'negative' : 'neutral');
    this.setChange('totalReadings', 'All measurements', 'neutral');
    this.setChange('avgScore', data.avgScore < 35 ? 'Within normal range' : 'Above warning level', data.avgScore < 35 ? 'positive' : 'negative');
    this.setChange('maxDeviation', data.maxDeviation <= 5 ? 'Within tolerance' : 'Exceeds tolerance', data.maxDeviation <= 5 ? 'positive' : 'negative');
  }

  private renderChart(data: SummaryData): void {
    const canvas = document.getElementById('summary-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.chart) {
      this.chart.data.datasets[0].data = [data.suspectCount, data.criticalCount];
      this.chart.update();
      return;
    }

    const config: ChartConfiguration = {
      type: 'doughnut',
      data: {
        labels: ['Suspicious', 'Critical'],
        datasets: [{
          data: [data.suspectCount, data.criticalCount],
          backgroundColor: [
            '#eab308',
            '#ef4444'
          ],
          borderColor: '#1a1d29',
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: 'rgba(255, 255, 255, 0.8)',
              padding: 15,
              font: {
                size: 13,
                family: 'Inter, sans-serif'
              }
            }
          },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12,
            titleFont: {
              size: 14,
              family: 'Inter, sans-serif'
            },
            bodyFont: {
              size: 13,
              family: 'Inter, sans-serif'
            },
            callbacks: {
              label: function(context: any) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const dataset = context.dataset as any;
                const total = dataset.data.reduce((a: number, b: number) => a + b, 0);
                const percentage = ((value / total) * 100).toFixed(1);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          }
        }
      }
    };

    this.chart = new Chart(ctx, config);
  }

  private setChange(key: string, text: string, cls: string): void {
    const el = document.getElementById(`stat-change-${key}`);
    if (el) {
      el.textContent = text;
      el.className = `stat-card-change ${cls}`;
    }
  }

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-summary');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement;
    if (!text) return;
    el.className = 'panel-status' + (status === 'live' ? ' live' : status === 'error' ? ' error' : '');
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Ready';
  }

  public init(): void {
    this.ds = new DataSource('summary');
    this.ds.onData = (data: any) => {
      if (Array.isArray(data)) {
        this.readings = data;
        const summary = this.calculateSummary();
        this.renderCards(summary);
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

export const SummaryStats = new SummaryStatsPanel();
