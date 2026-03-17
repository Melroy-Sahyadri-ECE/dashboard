/* ========================================
   App — Main Router & Initialization
   Handles sidebar nav, panel switching
   ======================================== */

import { TrackMap } from './trackmap';
import { HealthProfile } from './health';
import { GaugeProfile } from './gauge';
import { LiveFFT } from './fft';
import { EventsTable } from './events';
import { SummaryStats } from './summary';
import { Settings } from './settings';
import { initESP32Status } from './esp32status';
import type { PanelId } from './types';

// Panel modules registry
const panelModules = {
  trackmap: TrackMap,
  health: HealthProfile,
  gauge: GaugeProfile,
  fft: LiveFFT,
  events: EventsTable,
  summary: SummaryStats
};

let initializedPanels = new Set<string>();
let currentPanel: PanelId = 'trackmap';

// ========== Navigation ==========

function switchPanel(panelId: PanelId): void {
  // Deactivate all panels
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('active');
  });

  // Deactivate all nav links
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.remove('active');
  });

  // Activate target
  const panel = document.getElementById(`panel-${panelId}`);
  const navLink = document.querySelector(`[data-panel="${panelId}"]`);

  if (panel) panel.classList.add('active');
  if (navLink) navLink.classList.add('active');

  // Initialize panel if first time
  if (!initializedPanels.has(panelId)) {
    if (panelId === 'settings') {
      Settings.renderSettings();
    } else if (panelModules[panelId]) {
      panelModules[panelId].init();
    }
    initializedPanels.add(panelId);
  }

  // Special handling for map resize
  if (panelId === 'trackmap') {
    TrackMap.refresh();
  }

  currentPanel = panelId;

  // Close mobile sidebar
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');
}

// ========== Event Listeners ==========

function initializeApp(): void {
  // Nav link clicks
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const panelId = (link as HTMLElement).dataset.panel as PanelId;
      if (panelId) switchPanel(panelId);
    });
  });

  // Mobile menu toggle
  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    });
  }

  // Close sidebar on outside click (mobile)
  document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('menu-toggle');
    if (sidebar && toggle && 
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target as Node) &&
        !toggle.contains(e.target as Node)) {
      sidebar.classList.remove('open');
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.remove('open');
    }
  });

  // ========== Initialize ==========
  // Load the first panel on page load
  switchPanel(currentPanel);
  
  // Initialize ESP32 status monitor
  initESP32Status();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
