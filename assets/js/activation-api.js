import { ACTIVATION_API_BASE } from './config.js';

function cleanBase() {
  return String(ACTIVATION_API_BASE || '').trim().replace(/\/+$/, '');
}

export function activationApiConfigured() {
  const base = cleanBase();
  return Boolean(base) && !/example\.com|change-me|your-domain/i.test(base);
}

export function activationApiBase() { return cleanBase(); }

async function readJson(response) {
  let data = null;
  try { data = await response.json(); } catch { /* plain-text/network proxy errors */ }
  if (!response.ok || !data?.ok) {
    const message = data?.error || `Máy chủ kích hoạt trả lỗi HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

export async function requestDeviceActivation(deviceId, note = '') {
  if (!activationApiConfigured()) throw new Error('Máy chủ kích hoạt chưa được cấu hình trên web');
  const body = new FormData();
  body.append('device_id', String(deviceId || '').trim());
  if (note.trim()) body.append('reason', note.trim().slice(0, 500));
  const response = await fetch(`${cleanBase()}/api/v1/activation/request`, {
    method: 'POST', body, mode: 'cors', cache: 'no-store',
  });
  return readJson(response);
}

export async function getDeviceActivationStatus(requestCode) {
  if (!activationApiConfigured()) throw new Error('Máy chủ kích hoạt chưa được cấu hình trên web');
  const code = encodeURIComponent(String(requestCode || '').trim());
  const response = await fetch(`${cleanBase()}/api/v1/activation/status?code=${code}`, {
    method: 'GET', mode: 'cors', cache: 'no-store',
  });
  return readJson(response);
}

export function signatureHexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (!/^[0-9a-fA-F]{128}$/.test(clean)) throw new Error('Chữ ký kích hoạt từ máy chủ không hợp lệ');
  const out = new Uint8Array(64);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
