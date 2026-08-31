/* R25.6 (Phase F) + R25.10: TWO independent activation mechanisms live in
 * this one module, both talking to pi_server/'s /api/v1/activation/*
 * endpoints (mirrors community.js's shape -- same serviceApiBase()
 * resolution, same fetch/throw-on-!ok convention):
 *
 * 1. Phase F, unchanged: a short HMAC code gates exactly ONE web-only
 *    feature -- publishFace() in community.js, posting a design to the
 *    public community warehouse. cachedActivation()/redeemActivationCode()
 *    below are this one. The web/device never computes this code itself
 *    (HMAC is symmetric, master_secret never leaves the Pi) -- this module
 *    only ever submits (device_id, code) for the Pi to judge.
 *
 * 2. R25.10, new: a 64-byte ECDSA signature over SHA-256(device_id) that
 *    unlocks the FIRMWARE's own device lock (every BLE write command
 *    except read-status) -- redeemActivationSignature()/
 *    decodeCliActivationCode() below. This one is asymmetric on purpose
 *    (see pi_server/activation_signing.py's docstring): the signature
 *    itself is relayed straight to the chip over BLE (ble.js's
 *    submitActivationSignature()), never typed by hand in the normal
 *    flow -- only the CLI-fallback path needs manual paste, hence the
 *    long base32 decoder, not a short code.
 *
 * One admin approval produces both artifacts (see pi_server/app.py's
 * approve_activation()) -- from the end user's side this is one "kích
 * hoạt thiết bị" action, just backed by two separate keys so a leak of
 * one mechanism's key can't forge the other's. */
import { serviceApiBase } from './config.js';
import { decodeBase32 } from './activation-base32.js';

const STORAGE_DEVICE_ID = 'tnvaActivationDeviceId';
const STORAGE_CODE = 'tnvaActivationCode';

/* fetch() rejects with a bare "Failed to fetch" TypeError when it can't
 * even REACH the server (wrong/stale IP saved in "Máy chủ Pi", Pi off,
 * different network, firewall) -- as opposed to the server responding
 * with an error, which the callers below already turn into a clear
 * Vietnamese message from `result.error`. That raw browser string used to
 * surface straight into reportError()'s toast, which just confused users
 * into thinking the Pi rejected them rather than "browser never got
 * there". Wrap only the fetch() call itself (not the .json() parsing
 * after) so real HTTP-level errors are untouched. */
async function fetchOrExplain(url, options) {
  try {
    return await fetch(url, options);
  } catch (err) {
    throw new Error(
      `Không kết nối được máy chủ Pi. Kiểm tra: Pi đã bật và cùng mạng chưa, ` +
      `địa chỉ trong "Máy chủ Pi" (bấm 7 lần vào chữ TNVA CLOCK để hiện) có đúng không. ` +
      `(${err.message})`
    );
  }
}

export function cachedActivation() {
  const deviceId = localStorage.getItem(STORAGE_DEVICE_ID);
  const code = localStorage.getItem(STORAGE_CODE);
  return deviceId && code ? { deviceId, code } : null;
}

export function cacheActivation(deviceId, code) {
  localStorage.setItem(STORAGE_DEVICE_ID, deviceId);
  localStorage.setItem(STORAGE_CODE, code);
}

export function clearCachedActivation() {
  localStorage.removeItem(STORAGE_DEVICE_ID);
  localStorage.removeItem(STORAGE_CODE);
}

/* R25.10 (mục 5o/5p): name/phone dropped -- device_id is the only
 * required field, `note` is optional free text. `name`/`phone` params
 * still accepted (undefined is fine, form.set coerces to "undefined"
 * otherwise -- guard with `|| ''`) in case any older caller still passes
 * them; the Pi no longer requires either. */
export async function requestActivation({ deviceId, note, name, phone }) {
  const base = serviceApiBase();
  const form = new FormData();
  form.set('device_id', deviceId);
  if (name) form.set('name', name);
  if (phone) form.set('phone', phone);
  if (note) form.set('reason', note);
  const response = await fetchOrExplain(`${base}/api/v1/activation/request`, { method:'POST', body:form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không gửi được yêu cầu kích hoạt');
  return result;
}

export async function checkActivationStatus(requestCode) {
  const base = serviceApiBase();
  const response = await fetchOrExplain(`${base}/api/v1/activation/status?code=${encodeURIComponent(requestCode)}`, { cache:'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không tra được trạng thái yêu cầu');
  return result;
}

/* Verifies with the Pi (not a local guess) and caches on success so
 * community.js's publishFace() can attach it to future submissions
 * without asking again. */
export async function redeemActivationCode(deviceId, code) {
  const base = serviceApiBase();
  const form = new FormData();
  form.set('device_id', deviceId);
  form.set('code', code);
  const response = await fetchOrExplain(`${base}/api/v1/activation/redeem`, { method:'POST', body:form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Mã kích hoạt không đúng hoặc thiết bị đã bị khóa');
  cacheActivation(deviceId, code.trim().toUpperCase());
  return result;
}

/* R25.10: fetches the ECDSA signature from the Pi (once the admin has
 * approved) and relays it straight to the chip over BLE -- the normal,
 * online happy path. `ble` is the connected TnvaBle instance (passed in
 * rather than imported, this module has no BLE dependency otherwise).
 * Throws with a clear message if the Pi hasn't approved yet. */
export async function redeemActivationSignature(ble, requestCode, deviceId) {
  const status = await checkActivationStatus(requestCode);
  if (status.status !== 'approved' || !status.activation_signature) {
    throw new Error(
      status.status === 'rejected'
        ? `Yêu cầu bị từ chối: ${status.rejection_reason || 'không rõ lý do'}`
        : 'Yêu cầu vẫn đang chờ duyệt -- thử lại sau.'
    );
  }
  const hex = status.activation_signature;
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) throw new Error('Chữ ký từ máy chủ không hợp lệ');
  const bytes = new Uint8Array(64);
  for (let i = 0; i < 64; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  const result = await ble.submitActivationSignature(bytes);
  /* One admin approval unlocks BOTH mechanisms (see pi_server/app.py's
   * approve_activation()) -- cache the older short HMAC code too so
   * community.js's publishFace() also just works after this, without a
   * second separate redeem step the user would have no reason to expect. */
  if (status.activation_code && deviceId) cacheActivation(deviceId, status.activation_code);
  return result;
}

/* R25.10 (mục 13, "đường lùi"): decodes a long base32 code from
 * tnva_activation_cli.py (pasted by hand when the Pi is down) and relays
 * it the same way as the online path above -- same BLE call, same
 * firmware-side verification, the only difference is where the signature
 * came from. */
export async function redeemCliActivationCode(ble, pastedCode) {
  const decoded = decodeBase32(pastedCode);
  if (decoded.length !== 65) {
    throw new Error(`Mã không đúng độ dài (cần giải mã ra 65 byte, nhận được ${decoded.length})`);
  }
  const signature = decoded.slice(0, 64);
  return ble.submitActivationSignature(signature);
}
