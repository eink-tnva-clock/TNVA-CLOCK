/* R25.10 (mục 6): reports EXACTLY 6 severe error types to the Pi -- never
 * routine operations, never debug logs, and never face/image content (the
 * log tail passed in is pre-filtered by the caller to activity-log
 * message/level/time strings only, see app.js's telemetryLogTail()).
 *
 * Off by default until the user has seen the one-time explainer (mục v)
 * and opted in; the manual "Gửi báo cáo thủ công" button (index.html)
 * bypasses the toggle on purpose -- mục v: "tắt rồi vẫn giữ nút gửi thủ
 * công". Pi unreachable/down never blocks the caller (mục x: "Pi sập ->
 * web vẫn chạy bình thường") -- every send is fire-and-forget with a
 * local queue for retry, never awaited by anything that matters to the
 * user's current action. */
import { serviceApiBase } from './config.js';

/* Mirrors pi_server/app.py's TELEMETRY_TYPES exactly -- the server has its
 * own independent copy of this allowlist too (never trust the client
 * alone), this one just avoids queuing something doomed to be rejected. */
export const TELEMETRY_TYPES = new Set([
  'ble-disconnect', 'flash-error', 'ota-failure',
  'face-rejected', 'atlas-error', 'js-error',
]);

const ENABLED_KEY = 'tnvaTelemetryEnabled';
const EXPLAINER_SEEN_KEY = 'tnvaTelemetryExplainerSeen';
const QUEUE_KEY = 'tnvaTelemetryQueue';
const DAILY_COUNT_KEY = 'tnvaTelemetryDailyCount';
const MAX_PER_DAY = 20;
const MAX_QUEUE_LENGTH = 40;

export function isTelemetryEnabled() {
  return localStorage.getItem(ENABLED_KEY) === '1';
}

export function setTelemetryEnabled(on) {
  if (on) localStorage.setItem(ENABLED_KEY, '1');
  else localStorage.removeItem(ENABLED_KEY);
}

export function hasSeenTelemetryExplainer() {
  return localStorage.getItem(EXPLAINER_SEEN_KEY) === '1';
}

export function markTelemetryExplainerSeen() {
  localStorage.setItem(EXPLAINER_SEEN_KEY, '1');
}

function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}
function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_LENGTH)));
}

/* mục w: tối đa 20 báo cáo/thiết bị/ngày -- đếm cục bộ trước khi gửi
 * (Pi cũng tự đếm lại phía nó, đây chỉ tránh phí một vòng mạng vô ích). */
function withinDailyCap() {
  const today = new Date().toISOString().slice(0, 10);
  let record;
  try { record = JSON.parse(localStorage.getItem(DAILY_COUNT_KEY) || '{}'); }
  catch { record = {}; }
  if (record.day !== today) record = { day: today, count: 0 };
  if (record.count >= MAX_PER_DAY) return false;
  record.count += 1;
  localStorage.setItem(DAILY_COUNT_KEY, JSON.stringify(record));
  return true;
}

async function send(base, entry) {
  const form = new FormData();
  form.set('type', entry.type);
  form.set('code', entry.code || '');
  form.set('message', entry.message || '');
  form.set('device_id', entry.deviceId || '');
  form.set('fw_version', entry.fwVersion || '');
  form.set('web_version', entry.webVersion || '');
  form.set('log_tail', entry.logTail || '');
  const response = await fetch(`${base}/api/v1/telemetry`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

/* Queues then immediately tries to flush -- never throws, never awaited by
 * callers for anything user-visible (fire-and-forget by design). */
export function reportTelemetry(entry) {
  if (!TELEMETRY_TYPES.has(entry?.type)) return;
  if (!isTelemetryEnabled()) return;
  if (!withinDailyCap()) return;
  const queue = readQueue();
  queue.push({ ...entry, queuedAt: Date.now() });
  writeQueue(queue);
  flushTelemetryQueue().catch(() => { /* stays queued, retried later */ });
}

/* Manual report (mục v: luôn có nút gửi thủ công bất kể công tắc) --
 * bypasses isTelemetryEnabled()/the daily cap (a deliberate one-off action
 * the user just clicked, not automated background noise) but still queues
 * through the same retry path if the Pi is unreachable right now. */
export function reportTelemetryManually(entry) {
  if (!TELEMETRY_TYPES.has(entry?.type)) return Promise.reject(new Error('Loại lỗi không hợp lệ'));
  const queue = readQueue();
  queue.push({ ...entry, queuedAt: Date.now() });
  writeQueue(queue);
  return flushTelemetryQueue();
}

/* R25.12 (mục 6): báo cáo THIẾT BỊ (không phải lỗi) mỗi lần kết nối BLE
 * thành công -- CHỈ device_id + fw_version, KHÔNG BAO GIỜ nội dung mặt/dữ
 * liệu cá nhân (đúng yêu cầu). Dùng CHUNG công tắc isTelemetryEnabled()
 * với báo lỗi (yêu cầu: "respecting the existing telemetry on/off toggle")
 * -- KHÔNG có công tắc riêng, KHÔNG bypass như nút gửi thủ công (đây là
 * ping tự động mỗi lần kết nối, không phải hành động người dùng chủ ý
 * bấm). Fire-and-forget, không hàng đợi/thử lại riêng -- chỉ là một lần
 * "đã thấy thiết bị này", lần kết nối sau sẽ tự cập nhật lại nếu lần này
 * thất bại (Pi sập/không tới được không được chặn bất cứ gì người dùng
 * đang làm, đúng triết lý chung của module này). */
export async function reportDeviceCheckin(deviceId, fwVersion) {
  if (!isTelemetryEnabled() || !deviceId) return;
  let base;
  try { base = serviceApiBase({ required: false }); }
  catch { base = null; }
  if (!base) return;
  const form = new FormData();
  form.set('device_id', deviceId);
  form.set('fw_version', fwVersion || '');
  try { await fetch(`${base}/api/v1/device/checkin`, { method: 'POST', body: form }); }
  catch { /* Pi không tới được -- im lặng, lần kết nối sau tự thử lại */ }
}

export async function flushTelemetryQueue() {
  let base;
  try { base = serviceApiBase({ required: false }); }
  catch { base = null; }
  if (!base) return; // mục x: Pi chưa cấu hình/không tới được -> im lặng, giữ hàng đợi.
  const queue = readQueue();
  if (queue.length === 0) return;
  const remaining = [];
  for (const entry of queue) {
    try { await send(base, entry); }
    catch { remaining.push(entry); } // Pi sập giữa chừng -- giữ lại, thử lại lần sau.
  }
  writeQueue(remaining);
}
