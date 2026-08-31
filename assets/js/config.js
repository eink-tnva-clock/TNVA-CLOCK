export const SERVICE = {
  // Điền địa chỉ HTTPS khi phát hành web. Có thể tạm truyền ?service=http://192.168.1.200:8080 khi thử nội bộ.
  apiBase: ''
};

export function normalizeServiceUrl(rawValue) {
  const text = String(rawValue || '').trim();
  if (!text) return '';
  const url = new URL(text);
  url.hash = '';
  url.search = '';
  const path = url.pathname.replace(/\/+$/, '');
  if (/\/admin$/i.test(path)) url.pathname = path.slice(0, -6) || '/';
  else if (/\/api\/health$/i.test(path)) url.pathname = path.slice(0, -11) || '/';
  else url.pathname = path || '/';
  return url.toString().replace(/\/+$/, '');
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

export function isLocalServiceUrl(value) {
  const url = value instanceof URL ? value : new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return url.protocol === 'http:' && (
    hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local') ||
    hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:') ||
    isPrivateIpv4(hostname)
  );
}

export function serviceApiBase({ required = true } = {}) {
  const params = new URLSearchParams(location.search);
  const queryValue = params.get('service') || params.get('api') || '';
  const rawValue = queryValue || localStorage.getItem('tnvaServiceApi') || SERVICE.apiBase || '';
  if (!rawValue.trim()) {
    if (required) throw new Error('Dịch vụ TNVA chưa được cấu hình');
    return '';
  }
  let value;
  let parsed;
  try {
    value = normalizeServiceUrl(rawValue);
    parsed = new URL(value);
  } catch {
    throw new Error('Địa chỉ dịch vụ TNVA không hợp lệ');
  }
  if (location.protocol === 'https:' && parsed.protocol === 'http:' && !isLocalServiceUrl(parsed)) {
    throw new Error('Trang HTTPS chỉ kết nối được với dịch vụ HTTPS');
  }
  localStorage.setItem('tnvaServiceApi', value);
  return value;
}

/*
 * R25.13 Bước 2: định nghĩa panel chuyển hẳn sang panel_profiles.js (nguồn
 * duy nhất, đọc từ firmware thật -- xem REPORTS/PANEL_AUDIT.md). DEVICE.profiles
 * giữ lại như alias mỏng để không phá hàng chục chỗ đang `import { DEVICE }
 * from './config.js'` rồi đọc `DEVICE.profiles[key]`.
 */
import { PANEL_PROFILES } from './panel_profiles.js';

export const DEVICE = {
  namePrefix: 'TNVA-CLOCK',
  service: 0xff00,
  characteristic: 0xff01,
  profiles: PANEL_PROFILES,
};
