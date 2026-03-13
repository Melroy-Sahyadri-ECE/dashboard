/* ========================================
   Gauge Profile — Chart.js Line Chart
   Deviation from 1676mm nominal vs chainage
   ======================================== */

import { Chart, ChartConfiguration } from 'chart.js/auto';
import { DataSource } from './datasource';
import type { DataSourceStatus } from './types';
import { API_BASE_URL } from './config';

class GaugeProfilePanel {
  private chart: Chart | null = null;
  private ds: DataSource | null = null;
  private readings: any[] = [];

  private getDeviations(gauges: number[]): number[] {
    return gauges.map(g => g - 1676);
  }

  private getGradient(ctx: CanvasRenderingContext2D, chartArea: any): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
    gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.05)');
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.3)');
    return gradient;
  }

  private createChart(labels: number[], gauges: number[]): void {
    const canvas = document.getElementById('gauge-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const deviations = this.getDeviations(gauges);

    if (this.chart) this.chart.destroy();

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Gauge Deviation (mm)',
          data: deviations,
          borderColor: '#8b5cf6',
          borderWidth: 2.5,
          pointBackgroundColor: deviations.map(d => Math.abs(d) >= 10 ? '#ef4444' : Math.abs(d) >= 5 ? '#eab308' : '#22c55e'),
          pointBorderColor: deviations.map(d => Math.abs(d) >= 10 ? '#ef4444' : Math.abs(d) >= 5 ? '#eab308' : '#22c55e'),
          pointRadius: 5,
          pointHoverRadius: 8,
          tension: 0.35,
          fill: true,
          backgroundColor: (context: any) => {
            const chart = context.chart;
            const { ctx, chartArea } = chart;
            if (!chartArea) return 'transparent';
            return this.getGradient(ctx, chartArea);
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: {
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: 500 as any },
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 22, 41, 0.95)',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(139, 92, 246, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            titleFont: { family: 'Inter', weight: 600 },
            bodyFont: { family: 'Inter' },
            callbacks: {
              title: (items) => `Chainage: ${items[0].label} km`,
              label: (item) => {
                const d = item.parsed.y;
                if (d === null) return '';
                const actual = d + 1676;
                const status = Math.abs(d) >= 10 ? '🔴 Critical' : Math.abs(d) >= 5 ? '🟡 Warning' : '🟢 Normal';
                return [`Deviation: ${d > 0 ? '+' : ''}${d} mm`, `Actual: ${actual} mm — ${status}`];
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Chainage (km)',
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: 500 as any }
            },
            grid: { color: 'rgba(139, 92, 246, 0.06)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
          },
          y: {
            title: {
              display: true,
              text: 'Gauge Deviation (mm)',
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: 500 as any }
            },
            grid: { color: 'rgba(139, 92, 246, 0.06)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
          }
        }
      }
    };

    this.chart = new Chart(ctx, config);
  }

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-gauge');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement;
    if (!text) return;
    el.className = 'panel-status' + (status === 'live' ? ' live' : status === 'error' ? ' error' : '');
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Demo';
  }

  public init(): void {
    // Initialize with empty chart
    this.createChart([], []);

    this.ds = new DataSource('gauge');
    this.ds.onStatusChange = (status) => this.updateStatus(status);
    this.ds.onData = (data: any) => {
      // Handle array of readings from API
      if (Array.isArray(data)) {
        this.readings = data;
        this.updateChart();
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

  private updateChart(): void {
    const labels: number[] = [];
    const gauges: number[] = [];
    
    this.readings.forEach(reading => {
      if (reading.chainage !== undefined && reading.gauge !== undefined) {
        labels.push(reading.chainage);
        gauges.push(reading.gauge);
      }
    });
    
    if (labels.length > 0) {
      this.createChart(labels, gauges);
    }
  }

  public restart(): void {
    if (this.ds) {
      this.ds.restart();
    }
  }
}

export const GaugeProfile = new GaugeProfilePanel();
