/* ========================================
   Health Profile — Chart.js Line Chart
   Vibration score vs chainage (km)
   ======================================== */

import { Chart, ChartConfiguration } from 'chart.js/auto';
import { DataSource } from './datasource';
import type { DataSourceStatus } from './types';
import { API_BASE_URL } from './config';

class HealthProfilePanel {
  private chart: Chart | null = null;
  private ds: DataSource | null = null;
  private readings: any[] = [];

  private getGradient(ctx: CanvasRenderingContext2D, chartArea: any): CanvasGradient {
    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
    gradient.addColorStop(1, 'rgba(99, 102, 241, 0.02)');
    return gradient;
  }

  private createChart(labels: number[], scores: number[]): void {
    const canvas = document.getElementById('health-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.chart) this.chart.destroy();

    const config: ChartConfiguration = {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Vibration Score',
          data: scores,
          borderColor: '#6366f1',
          borderWidth: 2.5,
          pointBackgroundColor: scores.map(v => v >= 70 ? '#ef4444' : v >= 35 ? '#eab308' : '#22c55e'),
          pointBorderColor: scores.map(v => v >= 70 ? '#ef4444' : v >= 35 ? '#eab308' : '#22c55e'),
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
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
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
            borderColor: 'rgba(99, 102, 241, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            titleFont: { family: 'Inter', weight: 600 },
            bodyFont: { family: 'Inter' },
            callbacks: {
              title: (items) => `Chainage: ${items[0].label} km`,
              label: (item) => {
                const v = item.parsed.y;
                if (v === null) return '';
                const verdict = v >= 70 ? '🔴 Critical' : v >= 35 ? '🟡 Suspect' : '🟢 Good';
                return `Score: ${v} — ${verdict}`;
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
            grid: { color: 'rgba(99, 102, 241, 0.06)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
          },
          y: {
            title: {
              display: true,
              text: 'Vibration Score',
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: 500 as any }
            },
            grid: { color: 'rgba(99, 102, 241, 0.06)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } }
          }
        }
      }
    };

    this.chart = new Chart(ctx, config);
  }

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-health');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement;
    if (!text) return;
    el.className = 'panel-status' + (status === 'live' ? ' live' : status === 'error' ? ' error' : '');
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Demo';
  }

  public init(): void {
    // Initialize with empty chart
    this.createChart([], []);

    this.ds = new DataSource('health');
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
    const scores: number[] = [];
    
    this.readings.forEach(reading => {
      if (reading.chainage !== undefined && reading.score !== undefined) {
        labels.push(reading.chainage);
        // Score is already in 0-100 scale from backend
        scores.push(reading.score);
      }
    });
    
    if (labels.length > 0) {
      this.createChart(labels, scores);
    }
  }

  public restart(): void {
    if (this.ds) {
      this.ds.restart();
    }
  }
}

export const HealthProfile = new HealthProfilePanel();
