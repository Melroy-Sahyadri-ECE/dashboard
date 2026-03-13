/* ========================================
   ESP32 Status Monitor
   Displays real-time ESP32 connection status
   ======================================== */

import { API_BASE_URL, WS_URL } from './config';

const CHECK_INTERVAL = 3000; // Check status every 3 seconds

let ws: WebSocket | null = null;
let checkTimer: number | null = null;

interface ESP32Status {
  connected: boolean;
  deviceId: string | null;
  lastSeen: string | null;
  lastSeenAgo: number | null;
}

function updateStatusUI(status: ESP32Status): void {
  const statusContainer = document.getElementById('esp32-status');
  if (!statusContainer) return;

  const text = statusContainer.querySelector('.esp32-status-text') as HTMLElement;

  if (status.connected) {
    statusContainer.className = 'esp32-status connected';
    if (text) {
      text.textContent = `ESP32 Connected`;
    }
  } else {
    statusContainer.className = 'esp32-status disconnected';
    if (text) {
      if (status.lastSeen) {
        const ago = formatTimeAgo(status.lastSeenAgo || 0);
        text.textContent = `ESP32 Disconnected (${ago})`;
      } else {
        text.textContent = 'ESP32 Disconnected';
      }
    }
  }
}

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

async function checkStatus(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/esp32/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const status: ESP32Status = await response.json();
    updateStatusUI(status);
  } catch (error) {
    console.error('Failed to check ESP32 status:', error);
    // Show disconnected on error
    updateStatusUI({
      connected: false,
      deviceId: null,
      lastSeen: null,
      lastSeenAgo: null
    });
  }
}

function connectWebSocket(): void {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('✓ ESP32 status WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'esp32_status') {
          updateStatusUI(message.data);
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onerror = (error) => {
      console.error('ESP32 status WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('✗ ESP32 status WebSocket disconnected, reconnecting...');
      // Reconnect after 3 seconds
      setTimeout(connectWebSocket, 3000);
    };
  } catch (error) {
    console.error('Failed to create ESP32 status WebSocket:', error);
    setTimeout(connectWebSocket, 3000);
  }
}

export function initESP32Status(): void {
  console.log('Initializing ESP32 status monitor...');
  
  // Initial status check
  checkStatus();
  
  // Start periodic status checks (fallback if WebSocket fails)
  checkTimer = window.setInterval(checkStatus, CHECK_INTERVAL);
  
  // Connect WebSocket for real-time updates
  connectWebSocket();
}

export function destroyESP32Status(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}
