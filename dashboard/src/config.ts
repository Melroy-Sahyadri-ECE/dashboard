const normalizedApiBase = (import.meta.env.VITE_API_BASE_URL || 'https://dashboard-1tg9.onrender.com').replace(/\/+$/, '');

const inferredWsBase = normalizedApiBase.startsWith('https://')
  ? normalizedApiBase.replace(/^https:\/\//, 'wss://')
  : normalizedApiBase.replace(/^http:\/\//, 'ws://');

const normalizedWsUrl = (import.meta.env.VITE_WS_URL || `${inferredWsBase}/ws`).replace(/\/+$/, '');

export const API_BASE_URL = normalizedApiBase;
export const WS_URL = normalizedWsUrl;
