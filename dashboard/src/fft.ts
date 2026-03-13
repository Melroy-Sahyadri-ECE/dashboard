/* ========================================
   Live FFT — Enhanced Spectrum Analyzer
   Real-time frequency spectrum with peak detection
   Supports ESP32 data and live microphone input
   ======================================== */

import { Chart, ChartConfiguration } from 'chart.js/auto';
import { DataSource } from './datasource';
import type { DataSourceStatus, FFTData } from './types';
import { API_BASE_URL } from './config';

interface FrequencyBands {
  low: number;    // 0-50 Hz
  mid: number;    // 50-150 Hz
  high: number;   // 150-500 Hz
}

type FFTMode = 'esp32' | 'microphone';

class LiveFFTPanel {
  private chart: Chart | null = null;
  private ds: DataSource | null = null;
  private peakFrequency: number = 0;
  private peakAmplitude: number = 0;
  private bands: FrequencyBands = { low: 0, mid: 0, high: 0 };
  
  // Microphone audio capture
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private micAnimationId: number | null = null;
  private currentMode: FFTMode = 'esp32';

  private processFFTData(magnitudes: number[]): FFTData {
    const frequencies: number[] = [];
    const amplitudes: number[] = [];
    
    // Assuming 8000 Hz sample rate and FFT size from data
    const numBins = magnitudes.length;
    const sampleRate = 8000; // Default, should come from data
    
    // Reset peak tracking
    this.peakFrequency = 0;
    this.peakAmplitude = 0;
    
    // Reset band energy
    this.bands = { low: 0, mid: 0, high: 0 };
    let lowCount = 0, midCount = 0, highCount = 0;
    
    for (let i = 0; i < numBins; i++) {
      const freq = (i * sampleRate) / (2 * numBins);
      if (freq <= 500) { // Only show up to 500Hz
        frequencies.push(Math.round(freq));
        const amp = magnitudes[i];
        amplitudes.push(amp);
        
        // Track peak frequency
        if (amp > this.peakAmplitude) {
          this.peakAmplitude = amp;
          this.peakFrequency = Math.round(freq);
        }
        
        // Calculate band energy
        if (freq <= 50) {
          this.bands.low += amp;
          lowCount++;
        } else if (freq <= 150) {
          this.bands.mid += amp;
          midCount++;
        } else {
          this.bands.high += amp;
          highCount++;
        }
      }
    }
    
    // Average band energy
    if (lowCount > 0) this.bands.low /= lowCount;
    if (midCount > 0) this.bands.mid /= midCount;
    if (highCount > 0) this.bands.high /= highCount;
    
    // Update stats display
    this.updateStats();
    
    return { frequencies, amplitudes };
  }

  private updateStats(): void {
    // Update peak frequency display
    const peakEl = document.getElementById('fft-peak-freq');
    if (peakEl) {
      peakEl.textContent = `${this.peakFrequency} Hz`;
    }
    
    const peakAmpEl = document.getElementById('fft-peak-amp');
    if (peakAmpEl) {
      peakAmpEl.textContent = `${this.peakAmplitude.toFixed(1)}`;
    }
    
    // Update frequency bands
    const lowEl = document.getElementById('fft-band-low');
    if (lowEl) {
      lowEl.textContent = `${this.bands.low.toFixed(1)}`;
      lowEl.style.color = this.getBandColor(this.bands.low);
    }
    
    const midEl = document.getElementById('fft-band-mid');
    if (midEl) {
      midEl.textContent = `${this.bands.mid.toFixed(1)}`;
      midEl.style.color = this.getBandColor(this.bands.mid);
    }
    
    const highEl = document.getElementById('fft-band-high');
    if (highEl) {
      highEl.textContent = `${this.bands.high.toFixed(1)}`;
      highEl.style.color = this.getBandColor(this.bands.high);
    }
  }

  private getBandColor(value: number): string {
    if (value >= 30) return '#ef4444';
    if (value >= 20) return '#f59e0b';
    if (value >= 10) return '#6366f1';
    return '#10b981';
  }

  private getGradientBarColors(frequencies: number[], amplitudes: number[]): string[] {
    return amplitudes.map((amp, i) => {
      const freq = frequencies[i];
      
      // Color based on both amplitude and frequency
      const hue = Math.max(0, 240 - (freq / 500) * 120); // Blue to red gradient
      const saturation = 70 + (amp / 50) * 30; // More saturated for higher amplitude
      const lightness = Math.min(70, 30 + (amp / 50) * 40); // Brighter for higher amplitude
      
      return `hsla(${hue}, ${saturation}%, ${lightness}%, 0.85)`;
    });
  }

  private createChart(frequencies: number[], amplitudes: number[]): void {
    const canvas = document.getElementById('fft-chart') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.chart) {
      // Update existing chart data
      this.chart.data.labels = frequencies;
      this.chart.data.datasets[0].data = amplitudes;
      this.chart.data.datasets[0].backgroundColor = this.getGradientBarColors(frequencies, amplitudes);
      this.chart.update('none'); // No animation for smoother updates
      return;
    }

    const config: ChartConfiguration = {
      type: 'bar',
      data: {
        labels: frequencies,
        datasets: [{
          label: 'Amplitude',
          data: amplitudes,
          backgroundColor: this.getGradientBarColors(frequencies, amplitudes),
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: 1,
          barPercentage: 1.0,
          categoryPercentage: 1.0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, // Disable animation for real-time performance
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: false // Hide legend for cleaner look
          },
          tooltip: {
            backgroundColor: 'rgba(15, 22, 41, 0.95)',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(99, 102, 241, 0.3)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 12,
            titleFont: { family: 'Inter', weight: 600 as any },
            bodyFont: { family: 'Inter' },
            callbacks: {
              title: (items) => `${items[0].label} Hz`,
              label: (item) => {
                const amp = item.parsed.y;
                if (amp === null || amp === undefined) return 'N/A';
                const isPeak = parseInt(item.label as string) === this.peakFrequency;
                return `Amplitude: ${amp.toFixed(1)}${isPeak ? ' ⭐ PEAK' : ''}`;
              }
            }
          }
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Frequency (Hz)',
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: 500 as any }
            },
            grid: { display: false },
            ticks: {
              color: '#64748b',
              font: { family: 'Inter', size: 10 },
              maxTicksLimit: 10,
              callback: function(value, index) {
                // Show fewer labels for cleaner display
                return index % 10 === 0 ? this.getLabelForValue(value as number) : '';
              }
            }
          },
          y: {
            title: {
              display: true,
              text: 'Amplitude',
              color: '#94a3b8',
              font: { family: 'Inter', size: 12, weight: 500 as any }
            },
            grid: { color: 'rgba(99, 102, 241, 0.08)' },
            ticks: { color: '#64748b', font: { family: 'Inter', size: 10 } },
            beginAtZero: true
          }
        }
      }
    };

    this.chart = new Chart(ctx, config);
  }

  // ========== Microphone FFT Methods ==========
  
  private async startMicrophoneFFT(): Promise<void> {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        } 
      });
      
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.3;
      
      // Connect microphone to analyser
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);
      
      // Start FFT processing loop
      this.processMicrophoneFFT();
      
      // Update UI
      this.updateStatus('live');
      const modeBtn = document.getElementById('fft-mode-toggle');
      if (modeBtn) {
        modeBtn.textContent = '🔴 Stop Microphone';
        modeBtn.style.background = 'rgba(239, 68, 68, 0.15)';
        modeBtn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
      }
      
      console.log('✓ Microphone FFT started');
    } catch (error) {
      console.error('Microphone access error:', error);
      alert('Could not access microphone. Please grant permission and try again.');
      this.currentMode = 'esp32';
      this.updateStatus('error');
    }
  }
  
  private stopMicrophoneFFT(): void {
    // Stop animation loop
    if (this.micAnimationId !== null) {
      cancelAnimationFrame(this.micAnimationId);
      this.micAnimationId = null;
    }
    
    // Disconnect and cleanup audio nodes
    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }
    
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Update UI
    const modeBtn = document.getElementById('fft-mode-toggle');
    if (modeBtn) {
      modeBtn.textContent = '🎤 Use Microphone';
      modeBtn.style.background = 'rgba(99, 102, 241, 0.1)';
      modeBtn.style.borderColor = 'rgba(99, 102, 241, 0.2)';
    }
    
    console.log('✓ Microphone FFT stopped');
  }
  
  private processMicrophoneFFT(): void {
    if (!this.analyser) return;
    
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const update = () => {
      if (!this.analyser) return;
      
      this.analyser.getByteFrequencyData(dataArray);
      
      // Convert to amplitude values (0-255 to 0-50 scale for consistency)
      const magnitudes: number[] = [];
      const sampleRate = this.audioContext?.sampleRate || 48000;
      
      for (let i = 0; i < bufferLength; i++) {
        magnitudes.push(dataArray[i] / 5.1); // Scale 0-255 to ~0-50
      }
      
      // Process with existing FFT handler
      const fftData = this.processMicrophoneFFTData(magnitudes, sampleRate);
      this.createChart(fftData.frequencies, fftData.amplitudes);
      
      this.micAnimationId = requestAnimationFrame(update);
    };
    
    update();
  }
  
  private processMicrophoneFFTData(magnitudes: number[], sampleRate: number): FFTData {
    const frequencies: number[] = [];
    const amplitudes: number[] = [];
    
    const numBins = magnitudes.length;
    
    // Reset peak tracking
    this.peakFrequency = 0;
    this.peakAmplitude = 0;
    
    // Reset band energy
    this.bands = { low: 0, mid: 0, high: 0 };
    let lowCount = 0, midCount = 0, highCount = 0;
    
    for (let i = 0; i < numBins; i++) {
      const freq = (i * sampleRate) / (2 * numBins);
      if (freq <= 500) { // Only show up to 500Hz
        frequencies.push(Math.round(freq));
        const amp = magnitudes[i];
        amplitudes.push(amp);
        
        // Track peak frequency
        if (amp > this.peakAmplitude) {
          this.peakAmplitude = amp;
          this.peakFrequency = Math.round(freq);
        }
        
        // Calculate band energy
        if (freq <= 50) {
          this.bands.low += amp;
          lowCount++;
        } else if (freq <= 150) {
          this.bands.mid += amp;
          midCount++;
        } else {
          this.bands.high += amp;
          highCount++;
        }
      }
    }
    
    // Average band energy
    if (lowCount > 0) this.bands.low /= lowCount;
    if (midCount > 0) this.bands.mid /= midCount;
    if (highCount > 0) this.bands.high /= highCount;
    
    // Update stats display
    this.updateStats();
    
    return { frequencies, amplitudes };
  }

  private updateStatus(status: DataSourceStatus): void {
    const el = document.getElementById('status-fft');
    if (!el) return;
    const text = el.querySelector('.status-text') as HTMLElement;
    if (!text) return;
    el.className = 'panel-status' + (status === 'live' ? ' live' : status === 'error' ? ' error' : '');
    text.textContent = status === 'live' ? 'Live' : status === 'error' ? 'Error' : 'Ready';
  }

  public init(): void {
    // Initialize with empty chart
    this.createChart([], []);

    // Setup mode toggle button
    const modeBtn = document.getElementById('fft-mode-toggle');
    if (modeBtn) {
      modeBtn.addEventListener('click', () => this.toggleMode());
    }

    // Setup ESP32 data source
    this.ds = new DataSource('fft');
    this.ds.onStatusChange = (status) => {
      if (this.currentMode === 'esp32') {
        this.updateStatus(status);
      }
    };
    this.ds.onData = (data: any) => {
      if (this.currentMode !== 'esp32') return; // Only process if in ESP32 mode
      
      // Get latest reading's FFT data
      if (Array.isArray(data) && data.length > 0) {
        const latest = data[data.length - 1];
        if (latest.fftMagnitudes && Array.isArray(latest.fftMagnitudes)) {
          const fftData = this.processFFTData(latest.fftMagnitudes);
          this.createChart(fftData.frequencies, fftData.amplitudes);
        }
      } else if (data.fftMagnitudes && Array.isArray(data.fftMagnitudes)) {
        // Single reading
        const fftData = this.processFFTData(data.fftMagnitudes);
        this.createChart(fftData.frequencies, fftData.amplitudes);
      }
    };
    
    // Set default API endpoint
    if (!this.ds.isConfigured()) {
      this.ds.saveConfig({
          apiUrl: `${API_BASE_URL}/api/readings/fft`,
        pollInterval: 1,
        wsUrl: '',
        dataPath: ''
      });
    }
    
    this.ds.start();
    this.updateStatus('ready');
  }

  private async toggleMode(): Promise<void> {
    if (this.currentMode === 'esp32') {
      // Switch to microphone mode
      this.currentMode = 'microphone';
      if (this.ds) {
        this.ds.stop();
      }
      await this.startMicrophoneFFT();
    } else {
      // Switch to ESP32 mode
      this.currentMode = 'esp32';
      this.stopMicrophoneFFT();
      if (this.ds) {
        this.ds.start();
        this.updateStatus('ready');
      }
    }
  }

  public restart(): void {
    if (this.currentMode === 'esp32' && this.ds) {
      this.ds.restart();
    }
  }
}

export const LiveFFT = new LiveFFTPanel();
