const normalizedApiBase = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/+$/, '');

const inferredWsBase = normalizedApiBase.startsWith('https://')
  ? normalizedApiBase.replace(/^https:\/\//, 'wss://')
  : normalizedApiBase.replace(/^http:\/\//, 'ws://');

const normalizedWsUrl = (import.meta.env.VITE_WS_URL || `${inferredWsBase}/ws`).replace(/\/+$/, '');

export const API_BASE_URL = normalizedApiBase;
export const WS_URL = normalizedWsUrl;
