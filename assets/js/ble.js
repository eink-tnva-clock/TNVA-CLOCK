import { DEVICE } from './config.js';
import { normalizeCrisp213Package } from './text-size-policy.js';
import { PANEL_PROFILES } from './panel_profiles.js';
import { decodeTn42Package, TN42_MAX_PACKAGE_BYTES } from './tn42-encoder.js';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const ACK_ERRORS = {
  0: 'OK',
  1: 'Đồng hồ đang bận',
  2: 'Đồng hồ chưa sẵn sàng',
  3: 'Lệnh không hợp lệ',
  4: 'Độ dài gói không hợp lệ',
  5: 'Offset dữ liệu không hợp lệ',
  6: 'Không xóa được vùng nhớ',
  7: 'Không ghi được vùng nhớ',
  8: 'CRC không khớp',
  9: 'TNF1 không hợp lệ',
  10: 'Giao diện không đúng kích thước màn',
  11: 'Màn E-Ink bận quá thời gian',
  12: 'Chưa có nhiệt độ',
  13: 'Lỗi ADC nhiệt độ',
  14: 'Nhiệt độ ngoài phạm vi',
  15: 'Nhiệt độ chưa hiệu chỉnh',
  16: 'Bản cập nhật không hợp lệ',
  17: 'Pin quá yếu để cập nhật phần mềm, hãy sạc rồi thử lại',
  23: 'Chữ ký bản cập nhật không hợp lệ',
  24: 'Bản cập nhật không đúng kiểu thiết bị',
  25: 'Bản cập nhật vượt dung lượng cho phép',
  26: 'Nội dung bản cập nhật không khớp',
  27: 'Phiên cập nhật không còn hiệu lực',
  28: 'Không cho phép hạ phiên bản phần mềm',
  // R25.10: device-activation lock.
  29: 'Thiết bị chưa kích hoạt',
  30: 'Mã kích hoạt không đúng cho thiết bị này'
};

/* R25.11 (mục 1): mã lý do ngắt kết nối chuẩn HCI (Bluetooth Core Spec Vol
 * 2 Part D, "Error Codes") -- byte thật nhận được ở user_app_disconnect()
 * (user_peripheral.c), ghi lại qua FF01 (xem ble.js's readStatus() diag
 * field). 0x08 là supervision timeout THẬT; các mã khác nghĩa là link vẫn
 * còn "khoẻ" lúc ngắt (đóng theo yêu cầu/giao thức), không phải mất sóng.
 * Chỉ liệt kê các mã có khả năng gặp thật với thiết bị này (peripheral,
 * không phải central) -- mã lạ vẫn hiện được số hex, không rơi vào "?". */
const HCI_DISCONNECT_REASONS = {
  0x05: 'Từ chối xác thực (0x05)',
  0x08: 'Mất kết nối do quá thời gian giám sát (0x08, supervision timeout -- mất sóng/nhiễu thật, không phải phần mềm)',
  0x13: 'Người dùng ở đầu kia chủ động ngắt (0x13)',
  0x14: 'Thiết bị ở đầu kia hết tài nguyên nên ngắt (0x14)',
  0x15: 'Thiết bị ở đầu kia tắt nguồn (0x15)',
  0x16: 'Chính thiết bị này chủ động ngắt (0x16, Local Host Terminated)',
  0x1A: 'Không hỗ trợ tham số kết nối phía kia yêu cầu (0x1A)',
  0x22: 'Hết thời gian phản hồi LMP/LL -- lỗi giao thức tầng thấp (0x22)',
  0x28: 'Đổi tham số kết nối giữa chừng thất bại (0x28, Instant Passed)',
  0x2F: 'Từ chối vì thiếu bảo mật/quyền (0x2F)',
  0x3B: 'Tham số kết nối yêu cầu không được chấp nhận (0x3B)',
  0x3D: 'Lỗi xác thực MIC -- kết nối đã mã hoá bị hỏng gói (0x3D)',
  0x3E: 'Không thiết lập được kết nối trong lúc kết nối lại (0x3E)'
};

/* R25.11 (mục 1): diễn giải 6 byte chẩn đoán thành văn bản đọc được --
 * dùng khi báo cáo/ghi log, không phải khi hiển thị số thô cho người dùng
 * thường. `diag` là field mới trong readStatus()'s time object. */
export function describeBleDiagnostics(diag) {
  if (!diag) return null;
  const reason = diag.disconnectReason;
  const reasonText = reason === 0
    ? 'Chưa ghi nhận lần ngắt kết nối nào trong phiên nguồn hiện tại'
    : (HCI_DISCONNECT_REASONS[reason] || `Mã lý do lạ 0x${reason.toString(16).padStart(2, '0')}`);
  const timerNames = [
    [0x01, 'work_timer (hàng đợi vẽ/lưu flash)'], [0x02, 'epd_wait_hnd (đang chờ E-Ink hết bận)'],
    [0x04, 'face_upload_worker_timer'], [0x08, 'ota_worker_timer'],
    [0x10, 'activation_lock_hnd (cooldown kích hoạt sai)'],
    [0x20, 'pending_draw (đang chờ vẽ)'], [0x40, 'pending_save (đang chờ lưu flash)'],
    [0x80, 'work_value bận (đang xử lý DRAW/SAVE)']
  ].filter(([bit]) => (diag.timerState & bit) !== 0).map(([, name]) => name);
  const queueNames = [
    [0x01, 'gói TNF1 face đang chờ xử lý'], [0x02, 'gói OTA đang chờ xử lý'],
    [0x04, 'màn E-Ink đang bận làm mới']
  ].filter(([bit]) => (diag.queueState & bit) !== 0).map(([, name]) => name);
  const heapOk = [
    [0x01, '64B'], [0x02, '256B'], [0x04, '512B'], [0x08, '1024B']
  ].filter(([bit]) => (diag.heapProbe & bit) !== 0).map(([, name]) => name);
  return {
    reasonText,
    faceChangeCount: diag.faceChangeCount,
    timerNames, queueNames,
    epdWaitState: diag.epdWaitState,
    heapOkUpTo: heapOk.length ? heapOk[heapOk.length - 1] : 'không còn cấp được cả 64B (heap kernel gần như đã cạn)',
    summary: `Lý do ngắt gần nhất: ${reasonText}. Đã đổi face thành công ${diag.faceChangeCount} lần kể từ lúc bật nguồn. `
      + `Timer đang giữ: ${timerNames.length ? timerNames.join(', ') : 'không có'}. `
      + `Hàng đợi: ${queueNames.length ? queueNames.join(', ') : 'trống'}. `
      + `epd_wait_state=${diag.epdWaitState}. Heap kernel còn cấp được tới: ${heapOk.length ? heapOk[heapOk.length - 1] : 'KHÔNG cấp được cả 64B'}.`
  };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const CUSTOM_FACE_ID = 6;

function b64ToBytes(text) {
  const binary = atob(String(text || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}


/* R25.10: small local copy of app.js's firmwareAtLeast() -- ble.js has no
 * import of app.js (wrong direction: app.js imports ble.js, not the other
 * way around), and this one call site (the activation-flag trust gate in
 * readStatus()) is the only place ble.js itself needs a version compare. */
function firmwareAtLeastLocal(firmwareString, wanted) {
  const found = String(firmwareString || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!found) return false;
  const current = found.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] !== wanted[i]) return current[i] > wanted[i];
  }
  return true;
}

function findPattern(target, pattern) {
  outer: for (let i = 0; i <= target.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (target[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

export class TnvaBle {
  constructor(log = () => {}) {
    this.log = log;
    this.device = null;
    this.server = null;
    this.longValue = null;
    this.adcValue = null;
    this.ctrlPoint = null;
    /* R25.13 Bước 3: handshake DEVICE_INFO -- xem attach()/readDeviceInfo()
     * bên dưới. deviceInfo=null nghĩa là "panel cũ, chưa có FF04" (fallback
     * 2.13", không phải lỗi) HOẶC "chưa kết nối". */
    this.deviceInfoChar = null;
    this.deviceInfo = null;
    this.disconnectListeners = new Set();
    this.operationListeners = new Set();
    this.activeOperation = null;
    this.gattTail = Promise.resolve();
    this.displayCooldownMs = 4200;
    this.otaCancelRequested = false;
    /* R25.10: last real activated flag from FF01 (byte 33), refreshed by
     * every readStatus(). null until the first successful read after
     * connecting -- runExclusive() below treats null as "don't know yet,
     * allow" so a race between connect() and the first status read never
     * blocks something it shouldn't; the REAL enforcement is firmware's
     * own gate regardless (see docs/BLE_PROTOCOL_TNVA.md) -- this is only
     * for a clean, immediate client-side error message instead of a round
     * trip that firmware will reject anyway. */
    this.deviceActivated = null;
  }

  /* Safe mid-transfer cancel for updateFirmware(): the chunk loop below
   * checks this flag once per chunk and, if set, throws instead of sending
   * the next 0xa1 -- which routes through the loop's existing catch block
   * and sends 0xa3 (abort) exactly like any other failure. This is always
   * safe to hit at any point: the target slot's 64-byte image header is
   * left fully erased (0xFF) until ota_finish()'s 0xa4 succeeds, so an
   * abort at any earlier point leaves the bootloader still pointed at the
   * old, already-verified slot -- see spi_flash.c's ota_begin() comment. */
  cancelFirmwareUpdate() {
    if (this.activeOperation?.name === 'firmware-update') this.otaCancelRequested = true;
  }

  get connected() {
    return Boolean(this.device?.gatt?.connected && this.longValue);
  }

  get busy() {
    return Boolean(this.activeOperation);
  }

  onDisconnect(callback) {
    this.disconnectListeners.add(callback);
    return () => this.disconnectListeners.delete(callback);
  }

  onOperationChange(callback) {
    this.operationListeners.add(callback);
    return () => this.operationListeners.delete(callback);
  }

  operationBusyError() {
    const error = new Error('Đồng hồ đang bận. Chờ một lát.');
    error.bleBusy = true;
    return error;
  }

  assertOperationAccess(token = null) {
    if (this.activeOperation && this.activeOperation.token !== token) throw this.operationBusyError();
  }

  activationRequiredError() {
    const error = new Error('Không thể thực hiện! Thiết bị chưa kích hoạt -- mở phần "Kích hoạt thiết bị" để gửi yêu cầu.');
    error.needsActivation = true;
    return error;
  }

  async runExclusive(name, task) {
    /* R25.10: client-side convenience only (fast, clear error instead of a
     * round trip firmware will reject anyway) -- 'submit-activation' is
     * exempt since submitting the signature is how a device BECOMES
     * activated. Real enforcement is firmware's own gate; see
     * deviceActivated's own comment for why null (not yet known) allows
     * through here rather than blocking. */
    if (this.deviceActivated === false && name !== 'submit-activation') {
      throw this.activationRequiredError();
    }
    if (this.activeOperation) throw this.operationBusyError();
    const token = Symbol(name);
    this.activeOperation = { name, token };
    for (const callback of this.operationListeners) {
      try { callback({ busy:true, name }); } catch { /* UI listener must not break BLE. */ }
    }
    try {
      return await task(token);
    } finally {
      if (this.activeOperation?.token === token) this.activeOperation = null;
      for (const callback of this.operationListeners) {
        try { callback({ busy:false, name:null }); } catch { /* UI listener must not break BLE. */ }
      }
    }
  }

  isGattBusyError(error) {
    return /GATT operation already in progress|operation already in progress/i.test(String(error?.message || error));
  }

  /* Windows' Web Bluetooth backend intermittently throws this exact native
   * DOMException for a write/read that the OS Bluetooth stack could not
   * complete — most often a transient hiccup, but also what a peripheral
   * write larger than the (frequently unnegotiated, 20-byte) ATT MTU looks
   * like from here. There is no MTU-negotiation API in Web Bluetooth to
   * detect which case this is, so gattCall() below retries it like a busy
   * error; uploadFaceUnlocked() additionally shrinks its chunk size if the
   * failure survives those retries, which only a too-large write would do. */
  isTransientGattError(error) {
    return /GATT operation failed for unknown reason/i.test(String(error?.message || error));
  }

  async gattCall(label, action) {
    const execute = async () => {
      let lastError;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await action();
        } catch (error) {
          lastError = error;
          const busy = this.isGattBusyError(error);
          const transient = !busy && this.isTransientGattError(error) && this.connected;
          if ((!busy && !transient) || attempt === 4) throw error;
          const reason = busy ? 'đang hoàn tất lệnh trước' : 'lỗi Bluetooth tạm thời';
          this.log(`Bluetooth ${reason}, thử lại ${attempt + 1}/4`, {operation:'gatt',step:label,retry:attempt+1});
          await delay(90 * (attempt + 1));
        }
      }
      throw lastError;
    };
    const result = this.gattTail.then(execute, execute);
    this.gattTail = result.catch(() => {});
    return result;
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error('Trình duyệt không hỗ trợ Web Bluetooth');
    this.log('Chọn thiết bị');
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: DEVICE.namePrefix }],
      optionalServices: [DEVICE.service]
    });
    if (!device.name?.startsWith(DEVICE.namePrefix)) throw new Error('Sai thiết bị');
    return this.attach(device);
  }

  async reconnectGranted() {
    if (!navigator.bluetooth?.getDevices) return null;
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find(item => item.name?.startsWith(DEVICE.namePrefix));
    if (!device) return null;
    return this.attach(device);
  }

  async attach(device) {
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => this.handleDisconnect(), { once: true });
    this.server = await device.gatt.connect();
    const service = await this.server.getPrimaryService(DEVICE.service);
    this.longValue = await service.getCharacteristic(DEVICE.characteristic);
    try { this.adcValue = await service.getCharacteristic(0xff02); } catch { this.adcValue = null; }
    try { this.ctrlPoint = await service.getCharacteristic(0xff03); } catch { this.ctrlPoint = null; }
    try { this.deviceInfoChar = await service.getCharacteristic(0xff04); } catch { this.deviceInfoChar = null; }
    await this.readDeviceInfo();
    this.log(`Đã kết nối ${device.name}`);
    return this.readStatus();
  }

  /*
   * R25.13 Bước 3: đọc DEVICE_INFO (FF04) ngay sau khi kết nối -- xem
   * docs/BLE_PROTOCOL_TNVA.md. Panel cũ (trước R25.13) không có
   * characteristic này -> getCharacteristic() ở attach() đã ném lỗi,
   * this.deviceInfoChar=null, hàm này không đọc gì và this.deviceInfo giữ
   * null -- gọi nơi dùng phải tự fallback về DEFAULT_PROFILE_KEY, KHÔNG
   * suy đoán/gửi gì thay người dùng (đúng yêu cầu "không tự gửi"). */
  async readDeviceInfo() {
    this.deviceInfo = null;
    if (!this.deviceInfoChar) return null;
    try {
      const raw = await this.gattCall('read-device-info', () => this.deviceInfoChar.readValue());
      if (raw.byteLength < 13) return null;
      this.deviceInfo = {
        protocolVer: raw.getUint8(0),
        panelId: raw.getUint8(1),
        width: raw.getUint16(2, true),
        height: raw.getUint16(4, true),
        colorMode: raw.getUint8(6) === 1 ? 'bwr' : 'mono',
        chunkMax: raw.getUint16(7, true),
        fwVersion: [raw.getUint8(9), raw.getUint8(10), raw.getUint8(11)],
      };
    } catch (error) {
      this.log('Không đọc được DEVICE_INFO, coi như panel cũ (2.13")', {operation:'device-info', error:String(error?.message || error)});
      this.deviceInfo = null;
    }
    return this.deviceInfo;
  }

  handleDisconnect() {
    this.log('Đã ngắt kết nối');
    /* R25.10 (mục 6t): "mất BLE bất thường" chỉ tính khi KHÔNG phải người
     * dùng chủ động bấm "Ngắt" -- cờ đặt ngay trước lệnh ngắt chủ động bên
     * dưới, đọc rồi xoá ở đây để lần ngắt kế tiếp (dù chủ động hay không)
     * lại được đánh giá lại từ đầu. */
    const wasUserInitiated = this.userInitiatedDisconnect;
    this.userInitiatedDisconnect = false;
    this.server = null;
    this.longValue = null;
    this.adcValue = null;
    this.ctrlPoint = null;
    this.deviceInfoChar = null;
    this.deviceInfo = null;
    for (const callback of this.disconnectListeners) callback({ userInitiated: wasUserInitiated });
  }

  disconnect() {
    this.userInitiatedDisconnect = true;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this.handleDisconnect();
  }

  async readStatus(operationToken = null) {
    this.assertOperationAccess(operationToken);
    if (!this.connected) throw new Error('Chưa kết nối');
    const rawTime = await this.gattCall('read-status', () => this.longValue.readValue());
    const bytes = new Uint8Array(rawTime.buffer, rawTime.byteOffset, rawTime.byteLength);
    const hex = data => [...data].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
    const time = {
      year: rawTime.byteLength >= 2 ? rawTime.getUint16(0, true) : 0,
      month: rawTime.byteLength >= 3 ? rawTime.getUint8(2) : 0,
      day: rawTime.byteLength >= 4 ? rawTime.getUint8(3) : 0,
      hour: rawTime.byteLength >= 5 ? rawTime.getUint8(4) : 0,
      minute: rawTime.byteLength >= 6 ? rawTime.getUint8(5) : 0,
      second: rawTime.byteLength >= 7 ? rawTime.getUint8(6) : 0,
      faceId: rawTime.byteLength >= 12 ? rawTime.getUint8(11) : 0,
      faceCount: rawTime.byteLength >= 13 ? rawTime.getUint8(12) : 0,
      customValid: rawTime.byteLength >= 14 ? rawTime.getUint8(13) : 0,
      temperature: rawTime.byteLength >= 16 && rawTime.getUint16(14, true) !== 0x8000
        ? rawTime.getInt16(14, true) / 10
        : null,
      bootState: rawTime.byteLength >= 17 ? rawTime.getUint8(16) : null,
      firmware: rawTime.byteLength >= 20
        ? `${rawTime.getUint8(17)}.${rawTime.getUint8(18)}.${rawTime.getUint8(19)}`
        : null,
      model: rawTime.byteLength >= 33
        ? new TextDecoder().decode(bytes.slice(20, 33)).replace(/\0+$/g, '')
        : null,
      deviceId: rawTime.byteLength >= 44 ? hex(bytes.slice(36, 44)) : null,
      /* R25.10: offset 33 was always-0 reserved padding before firmware
       * 2.1.11 -- a device on OLDER firmware would read back 0 here too,
       * which must NOT be mistaken for "really reports not activated"
       * (that firmware has no activation gate at all; every command
       * already just works on it). Only trust this byte once the parsed
       * firmware string itself is new enough to be the version that
       * started writing it for real -- see firmwareAtLeastLocal() below. */
      activated: rawTime.byteLength >= 34 && firmwareAtLeastLocal(
        rawTime.byteLength >= 20 ? `${rawTime.getUint8(17)}.${rawTime.getUint8(18)}.${rawTime.getUint8(19)}` : null,
        [2, 1, 11]
      ) ? rawTime.getUint8(33) !== 0 : null,
      /* R25.6 (Phase D): real, firmware-enforced capacity numbers -- not
       * the hardcoded 4096 constants (DEVICE.profiles[...].maxPackageBytes,
       * ATLAS_BUDGET_BYTES) used as fallback-only when no device is
       * connected. See docs/BLE_PROTOCOL_TNVA.md and clock_status_encode()
       * in user_custs1_impl.c. */
      /* R25.8 bug fix: a real capacity is NEVER 0 (TNVA_CUSTOM_MAX_BYTES/
       * TNVA_ATLAS_SLOT_SIZE are nonzero compile-time constants) -- but a
       * device still running pre-Phase-D firmware reports these bytes as 0
       * (they used to be reserved/memset-0 padding at this exact offset).
       * `?? fallback` in app.js's currentTnf1BudgetBytes()/
       * currentAtlasBudgetBytes() only kicks in for null/undefined, NOT for
       * 0 -- so an old-firmware device made every face register as "over
       * budget 0.0 KB" regardless of actual size (root cause of the false
       * "vượt ngưỡng RAM" block on a 2.8-2.9 KB face reported by the user).
       * Fix at the source: a reported 0 here is indistinguishable from
       * "not really reported", so treat it the same -- null, letting the
       * safe hardcoded constant win. */
      tnf1CapacityBytes: rawTime.byteLength >= 46 ? (rawTime.getUint16(44, true) || null) : null,
      atlasCapacityBytes: rawTime.byteLength >= 48 ? (rawTime.getUint16(46, true) || null) : null,
      facePackageId: rawTime.byteLength >= 52 ? rawTime.getUint32(48, true) : null,
      facePayloadCrc: rawTime.byteLength >= 56 ? rawTime.getUint32(52, true) : null,
      displayBusy: rawTime.byteLength >= 57 ? rawTime.getUint8(56) !== 0 : null,
      /* Static, build-time-measured figure (TNVA_FW_RAM_HEADROOM_BYTES),
       * not a live heap read -- see the constant's own comment in
       * face_custom.h for why. Same 0-vs-null fix as above. */
      ramHeadroomBytes: rawTime.byteLength >= 59 ? (rawTime.getUint16(57, true) || null) : null,
      /* R25.7 (Phase G): minutes since the last 0x92 clock calibration (or
       * since boot/last 0x91 time-set), -1 = never calibrated yet. MUST be
       * read signed -- -1 is written as raw bytes 0xFFFFFFFF
       * (clock_status_encode() in user_custs1_impl.c), an unsigned read
       * would come back as ~4 billion instead. See calibrateClockIfDue(). */
      calMinute: rawTime.byteLength >= 11 ? rawTime.getInt32(7, true) : null,
      /* R25.11 (mục 1): 6 byte chẩn đoán BLE thật -- xem chú thích đầy đủ ở
       * TNVA_STATUS_DISCONNECT_REASON.. (user_custs1_impl.c). 0 ở
       * disconnectReason nghĩa là "chưa ngắt kết nối lần nào trong phiên
       * nguồn hiện tại" (mã HCI 0x00 không bao giờ là lý do ngắt thật, xem
       * chú thích tại clock_status_encode()). Thiết bị chạy firmware cũ
       * hơn (chưa có 6 byte này) đọc về null cho tất cả -- không đoán số 0
       * giả. */
      diag: rawTime.byteLength >= 65 ? {
        disconnectReason: rawTime.getUint8(59),
        faceChangeCount: rawTime.getUint8(60),
        timerState: rawTime.getUint8(61),
        queueState: rawTime.getUint8(62),
        epdWaitState: rawTime.getUint8(63),
        heapProbe: rawTime.getUint8(64),
      } : null
    };
    let voltage = null;
    if (this.adcValue) {
      this.assertOperationAccess(operationToken);
      const rawVoltage = await this.gattCall('read-voltage', () => this.adcValue.readValue());
      if (rawVoltage.byteLength >= 2) voltage = rawVoltage.getUint16(0, true) / 1000;
    }
    const status = { name: this.device.name, time, voltage, temperature: time.temperature };
    /* R25.10: refresh the cached flag runExclusive() gates writes on.
     * time.activated is null when not knowable yet (old firmware or a
     * too-short read) -- leave the cache as whatever it last was rather
     * than overwriting a known state with "unknown". */
    if (time.activated !== null) this.deviceActivated = time.activated;
    return status;
  }

  /* R25.8 (mục 2): Phase G's automatic calibrateClockIfDue() (measured the
   * real drift itself and sent an 0x92 correction with no user visibility
   * or control, every ~15 min of connected time) is removed entirely per
   * explicit instruction -- replaced with a plain, user-entered, saved
   * offset (see #clockCorrectionInput in app.js) applied every time the
   * user presses "Đồng bộ giờ", not automatically in the background. The
   * 0x92 rate-based firmware engine (clock_fixup_set/clock_fixup,
   * user_peripheral.c) is untouched and still there if a future feature
   * needs it -- this class just no longer drives it on its own. */
  async syncTime(correctionSec = 0) {
    return this.runExclusive('sync-time', token => this.syncTimeUnlocked(token, correctionSec));
  }

  async syncTimeUnlocked(operationToken, correctionSec = 0) {
    if (!this.connected) throw new Error('Chưa kết nối');
    /* correctionSec: giá trị người dùng tự nhập (mục 2f), cộng thẳng vào
     * giờ thực trước khi gửi -- dương = đặt đồng hồ nhanh hơn giờ thực,
     * âm = chậm hơn. Áp dụng ở đây nghĩa là MỌI lần đồng bộ đều tự động
     * kèm hiệu chỉnh đã lưu, không cần bật lại mỗi lần. */
    const now = new Date(Date.now() + Math.round(Number(correctionSec) || 0) * 1000);
    let lunarMonth = 1;
    let lunarDay = 1;
    let lunarYear = now.getFullYear();
    try {
      let text = now.toLocaleDateString('zh-CN-u-ca-chinese', { month: 'numeric', day: 'numeric' });
      const leap = text.startsWith('闰') ? 128 : 0;
      if (leap) text = text.slice(1);
      const parsed = text.split('-').map(Number);
      lunarMonth = leap + parsed[0];
      lunarDay = parsed[1];
      lunarYear = Number.parseInt(now.toLocaleDateString('zh-CN-u-ca-chinese', { year: 'numeric' }), 10);
    } catch {
      lunarMonth = now.getMonth() + 1;
      lunarDay = now.getDate();
    }
    const packet = new Uint8Array(12);
    packet.set([
      0x91,
      now.getFullYear() & 0xff,
      now.getFullYear() >> 8,
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getDay(),
      Math.max(0, lunarYear - 2020),
      Math.max(0, lunarMonth - 1),
      lunarDay
    ]);
    await this.writeAcked(packet, 0x91, 0, 2, 3000);

    let status = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      await delay(250);
      status = await this.readStatus(operationToken);
      const deviceTime = new Date(
        status.time.year,
        status.time.month,
        status.time.day,
        status.time.hour,
        status.time.minute,
        status.time.second
      );
      if (Math.abs(deviceTime.getTime() - Date.now()) <= 5000) {
        this.log('Đã đồng bộ ngày giờ và đọc lại thành công');
        return status;
      }
    }
    throw new Error('Đồng hồ chưa xác nhận thời gian mới');
  }

  async toggleHourFormat() {
    return this.runExclusive('toggle-hour', () => this.toggleHourFormatUnlocked());
  }

  async toggleHourFormatUnlocked() {
    if (!this.connected) throw new Error('Chưa kết nối');
    await this.writePacket(new Uint8Array([0x90]));
    this.log('Đã đổi 12 / 24 giờ');
  }

  /* R25.10: submits a 64-byte ECDSA signature over SHA-256(device_id) --
   * opcode 0x98, the only write command firmware still accepts while
   * unactivated (see user_custs1_impl.c's gate). Named 'submit-activation'
   * specifically so runExclusive()'s own activation check exempts it --
   * this IS how a device becomes activated, blocking it here would be a
   * deadlock. Uses writeAcked() (unlike the old fire-and-forget 0x92):
   * 0x98 always sends a real ack now, so the caller gets a definite
   * success/failure instead of guessing from a delay. */
  async submitActivationSignature(signatureBytes) {
    return this.runExclusive('submit-activation', token => this.submitActivationSignatureUnlocked(signatureBytes, token));
  }

  async submitActivationSignatureUnlocked(signatureBytes, operationToken) {
    if (!this.connected) throw new Error('Chưa kết nối');
    if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== 64) {
      throw new Error('Chữ ký kích hoạt không hợp lệ (cần đúng 64 byte)');
    }
    const packet = new Uint8Array(65);
    packet[0] = 0x98;
    packet.set(signatureBytes, 1);
    await this.writeAcked(packet, 0x98, 0);
    this.log('Đã kích hoạt thiết bị', {operation:'activation', step:'submit', result:'ok'});
    this.deviceActivated = true;
    return this.readStatus(operationToken);
  }

  /* R25.9 (mục 11ss): đếm ngược thật thay vì delay() câm -- gọi onTick mỗi
   * giây với số giây còn lại để UI hiện "Đang cập nhật màn hình... (còn
   * ~Xs)" thay vì chỉ một thông báo tĩnh không đổi trong suốt ~3.4s. */
  async delayWithCountdown(ms, onTick) {
    if (typeof onTick !== 'function') return delay(ms);
    let remaining = ms;
    onTick(Math.ceil(remaining / 1000));
    while (remaining > 0) {
      const step = Math.min(1000, remaining);
      await delay(step);
      remaining -= step;
      onTick(Math.ceil(remaining / 1000));
    }
  }

  async selectFace(faceId, onTick = null) {
    return this.runExclusive('select-face', token => this.selectFaceUnlocked(faceId, token, onTick));
  }

  async selectFaceUnlocked(faceId, operationToken, onTick = null) {
    if (!this.connected) throw new Error('Chưa kết nối');
    const status = await this.readStatus(operationToken);
    if (faceId < 0 || faceId >= (status.time.faceCount || 0)) {
      throw new Error('Phần mềm thiết bị chưa hỗ trợ giao diện này');
    }
    const packet = new Uint8Array([
      0x99, faceId, 0x54, 0x4e, 0x56, 0x41, 0x46, 0x41, 0x43, 0x45, 0x06, 0x00
    ]);
    await this.writePacket(packet);
    await this.delayWithCountdown(3400, onTick);
    let next = await this.readStatus(operationToken);
    if (next.time.faceId !== faceId) {
      packet[0] = 0x93;
      await this.writePacket(packet);
      await this.delayWithCountdown(3400, onTick);
      next = await this.readStatus(operationToken);
    }
    if (next.time.faceId !== faceId) throw new Error('Đồng hồ chưa xác nhận đổi mặt');
    this.log(`Đã chọn mặt ${faceId + 1}`);
    return next;
  }

  async writePacket(bytes) {
    if (this.longValue.writeValueWithResponse) {
      await this.gattCall('write', () => this.longValue.writeValueWithResponse(bytes));
    } else {
      await this.gattCall('write', () => this.longValue.writeValue(bytes));
    }
  }

  async waitAck(command, expectedOffset, timeoutMs = 2500) {
    if (!this.ctrlPoint) throw new Error('Thiết bị hoặc trang điều khiển thiếu xác nhận FF03');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await this.gattCall('read-ack', () => this.ctrlPoint.readValue());
      if (value.byteLength >= 12 &&
          value.getUint8(11) === 0xa5 &&
          value.getUint8(10) === 1 &&
          value.getUint8(0) === command) {
        const code = value.getUint8(1);
        const nextOffset = value.getUint32(4, true);
        if (code !== 0) {
          const error = new Error(ACK_ERRORS[code] || `Lỗi phần mềm thiết bị ${code}`);
          error.ackCode = code;
          throw error;
        }
        if (expectedOffset == null || nextOffset === expectedOffset) {
          return { nextOffset, bootState:value.getUint8(2), displayBusy:value.getUint8(8) !== 0 };
        }
      }
      await delay(60);
    }
    const error = new Error(`Hết thời gian chờ ACK 0x${command.toString(16)}`);
    error.ackTimeout = true;
    throw error;
  }

  async writeAcked(packet, command, expectedOffset, retries = 2, timeoutMs = 2500) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.writePacket(packet);
      try {
        return await this.waitAck(command, expectedOffset, timeoutMs);
      } catch (error) {
        lastError = error;
        if (!error.ackTimeout || attempt === retries) throw error;
        this.log(`Thử lại ACK 0x${command.toString(16)} (${attempt + 1}/${retries})`, {step:'retry',retry:attempt+1,ackCode:'timeout'});
      }
    }
    throw lastError;
  }

  async beginFaceWhenReady(packet) {
    let lastError;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        return await this.writeAcked(packet, 0x94, 0);
      } catch (error) {
        lastError = error;
        if (![1, 2, 11].includes(error.ackCode) || attempt === 79) throw error;
        this.log('Đồng hồ đang hoàn tất lần làm mới trước', {operation:'face-upload',step:'wait-ready',retry:attempt+1,ackCode:error.ackCode});
        await delay(400);
      }
    }
    throw lastError;
  }

  /* Mirrors beginFaceWhenReady(): 0xa0 gets the same instant, non-blocking
   * EPD-busy reject as every other Flash-touching opcode (see the dispatcher
   * check in user_custs1_impl.c) rather than a firmware-side wait, so the
   * client is the one that retries. Without this, an OTA started while a
   * refresh happens to be running would fail outright instead of simply
   * starting a few hundred ms later once the panel goes idle. */
  async beginOtaWhenReady(packet) {
    let lastError;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        return await this.writeAcked(packet, 0xa0, 0, 1, 35000);
      } catch (error) {
        lastError = error;
        if (![1, 2, 11].includes(error.ackCode) || attempt === 79) throw error;
        this.log('Đồng hồ đang bận, chờ để bắt đầu cập nhật phần mềm', {operation:'ota',step:'wait-ready',retry:attempt+1,ackCode:error.ackCode});
        await delay(400);
      }
    }
    throw lastError;
  }

  async uploadFace(packageBytes, onProgress = () => {}) {
    return this.runExclusive('face-upload', token => this.uploadFaceUnlocked(packageBytes, onProgress, token));
  }

  async waitForDisplayReady(operationToken, minimumDelayMs = this.displayCooldownMs) {
    await delay(minimumDelayMs);
    let status = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      status = await this.readStatus(operationToken);
      if (status.time.displayBusy !== true) return status;
      await delay(400);
    }
    throw new Error('Màn E-Ink vẫn đang làm mới, chưa thể gửi giao diện kế tiếp');
  }

  async uploadFaceUnlocked(packageBytes, onProgress, operationToken) {
    /* Warehouse/community packages may have been built before the 2.13"
     * small-text fix and bypass FaceEditor.compile().  Normalize the TNF1
     * descriptor here as a final web-only safety net before validation/send. */
    packageBytes = normalizeCrisp213Package(packageBytes);
    if (!this.connected) throw new Error('Chưa kết nối');
    if (!this.ctrlPoint) throw new Error('Phần mềm thiết bị chưa hỗ trợ xác nhận FF03');
    /* TNF1 là định dạng dây cố định của riêng 2.13" -- các số dưới đây LÀ
     * đặc tả TNF1 (docs/BLE_PROTOCOL_TNVA.md), đọc từ panel_profiles.js để
     * có một nguồn duy nhất thay vì lặp lại số cứng, giá trị không đổi. */
    const p213 = PANEL_PROFILES['212x104'];
    if (packageBytes.length < 20 || packageBytes.length > p213.maxPackageBytes) {
      throw new Error('Gói TNF1 phải từ 20 byte đến 4 KB');
    }
    const packageView = new DataView(packageBytes.buffer, packageBytes.byteOffset, packageBytes.byteLength);
    if (packageView.getUint32(0, true) !== 0x31464e54) throw new Error('Gói thiếu magic TNF1');
    const version = packageBytes[4];
    if (version !== 1 && version !== 2) throw new Error('Phiên bản TNF1 không hỗ trợ');
    const headerSize = version === 2 ? 24 : 20;
    if (packageBytes.length < headerSize || packageBytes[5] !== p213.width || packageBytes[6] !== p213.height || packageBytes[7] !== 27) {
      throw new Error('Gói TNF1 không dành cho màn 212 × 104');
    }
    const bitplaneLength=packageView.getUint16(8,true);
    const descriptorCount=packageBytes[10];
    const descriptorSize=version===2?packageBytes[11]:12;
    const stringLength=version===2?packageView.getUint16(12,true):0;
    const totalSize=packageView.getUint16(version===2?14:12,true);
    if (bitplaneLength!==27*p213.height || descriptorCount>24 || descriptorSize!==(version===2?16:12) ||
        totalSize!==packageBytes.length || headerSize+bitplaneLength+descriptorCount*descriptorSize+stringLength!==totalSize) {
      throw new Error('Cấu trúc/kích thước TNF1 không hợp lệ');
    }
    const packageId = version === 2 ? packageView.getUint32(16, true) : 0;
    if (version===2 && packageId===0) throw new Error('Package ID TNF1 không hợp lệ');
    const payloadCrc = packageView.getUint32(version === 2 ? 20 : 16, true);
    if (crc32(packageBytes.slice(headerSize)) !== payloadCrc) throw new Error('CRC payload TNF1 không khớp');
    const checksum = crc32(packageBytes);
    const started = performance.now();
    let chunkSize = 64;
    const minChunkSize = 16;
    this.log('Chuẩn bị gửi giao diện', {operation:'face-upload',step:'validate',packageId,size:packageBytes.length,crc32:checksum.toString(16).padStart(8,'0'),chunkSize});
    const begin = new Uint8Array(12);
    const view = new DataView(begin.buffer);
    begin[0] = 0x94;
    view.setUint32(1, packageBytes.length, true);
    view.setUint32(5, checksum, true);
    begin[9] = 2;
    await this.beginFaceWhenReady(begin);
    for (let offset = 0; offset < packageBytes.length; ) {
      const chunk = packageBytes.slice(offset, offset + chunkSize);
      const packet = new Uint8Array(5 + chunk.length);
      const packetView = new DataView(packet.buffer);
      packet[0] = 0x95;
      packetView.setUint32(1, offset, true);
      packet.set(chunk, 5);
      try {
        await this.writeAcked(packet, 0x95, offset + chunk.length);
      } catch (error) {
        /* gattCall() already retried a transient failure several times; one
         * surviving that is a sign this connection's real ATT MTU is smaller
         * than this packet (Web Bluetooth has no API to ask what it is).
         * Halve the chunk size and resend the same offset instead of
         * failing the whole upload. */
        if (this.isTransientGattError(error) && chunkSize > minChunkSize) {
          chunkSize = Math.max(minChunkSize, Math.floor(chunkSize / 2));
          this.log(`Gói vượt quá MTU kết nối hiện tại, giảm còn ${chunkSize} byte/lần và gửi lại`, {operation:'face-upload',step:'shrink-chunk',packageId,offset,chunkSize});
          continue;
        }
        throw error;
      }
      /* Yield between Flash writes so the DA14585 can service connection
       * events even on slower phones/adapters. */
      await delay(12);
      offset += chunk.length;
      const percent=Math.min(100, Math.round((offset / packageBytes.length) * 100));
      onProgress(percent);
      if(percent===100 || percent%10===0) this.log('Đang gửi giao diện', {operation:'face-upload',step:'send-chunk',packageId,bytesSent:offset,bytesTotal:packageBytes.length,percent,chunkSize});
    }
    let status = null;
    try {
      await this.writeAcked(new Uint8Array([0x96]), 0x96, packageBytes.length, 0);
    } catch (error) {
      if (!error.ackTimeout) throw error;
      status = await this.waitForDisplayReady(operationToken);
      if (!status.time.customValid || status.time.faceId !== CUSTOM_FACE_ID) throw error;
      this.log('Mất ACK 0x96 nhưng FF01 xác nhận TNF1 đã lưu');
    }
    if (!status) {
      this.log('Đang chờ màn E-Ink làm mới an toàn', {operation:'face-upload',step:'display-refresh',packageId});
      status = await this.waitForDisplayReady(operationToken);
    }
    for (let retry = 0; retry < 5 && (!status.time.customValid || status.time.faceId !== CUSTOM_FACE_ID); retry++) {
      await delay(250);
      status = await this.readStatus(operationToken);
    }
    if (!status.time.customValid || status.time.faceId !== CUSTOM_FACE_ID) throw new Error('Đồng hồ không xác nhận giao diện đã lưu');
    if (status.time.facePayloadCrc == null) throw new Error('Firmware chưa trả CRC giao diện thật');
    if ((status.time.facePackageId >>> 0) !== (packageId >>> 0) ||
        (status.time.facePayloadCrc >>> 0) !== (payloadCrc >>> 0)) {
      throw new Error('ID/CRC đọc lại từ đồng hồ không khớp gói vừa gửi');
    }
    this.log('Đã xác minh và lưu giao diện', {operation:'face-upload',step:'verify',packageId,size:packageBytes.length,crc32:payloadCrc.toString(16).padStart(8,'0'),durationMs:Math.round(performance.now()-started),result:'ok'});
    return status;
  }

  /* R25.13 Bước 5 -- gói TN42 thật cho firmware 4.2" (FaceEditor.compileTn42()
   * trong editor.js). Mirror uploadFaceUnlocked() ở trên: dùng lại đúng cơ
   * chế writeAcked()/beginFaceWhenReady()/waitForDisplayReady() -- cùng
   * opcode 0x94/0x95/0x96, cùng cách chờ busy/ACK mất/xác minh lại bằng FF01
   * như bản 2.13 -- chỉ khác sentinel byte (0x42 thay vì version byte 0x02)
   * và cấu trúc gói (TN42 thay TNF1). Không tạo cơ chế timeout/retry riêng. */
  async uploadTn42Unlocked(packageBytes, onProgress, operationToken) {
    if (!this.connected) throw new Error('Chưa kết nối');
    if (!this.ctrlPoint) throw new Error('Phần mềm thiết bị chưa hỗ trợ xác nhận FF03');
    if (packageBytes.length > TN42_MAX_PACKAGE_BYTES) {
      throw new Error(`Gói TN42 vượt quá ${TN42_MAX_PACKAGE_BYTES} byte cho phép`);
    }
    /* decodeTn42Package() tự kiểm magic/header/2 CRC32 plane/CRC32 payload
     * -- validate ở đây trước khi tốn sóng BLE gửi một gói hỏng. */
    const decoded = decodeTn42Package(packageBytes);
    const transportCrc = crc32(packageBytes);
    const started = performance.now();
    let chunkSize = 64;
    const minChunkSize = 16;
    this.log('Chuẩn bị gửi giao diện 4.2"', {operation:'tn42-upload',step:'validate',packageId:decoded.packageId,size:packageBytes.length,crc32:transportCrc.toString(16).padStart(8,'0'),chunkSize});
    const begin = new Uint8Array(10);
    const beginView = new DataView(begin.buffer);
    begin[0] = 0x94;
    beginView.setUint32(1, packageBytes.length, true);
    beginView.setUint32(5, transportCrc, true);
    begin[9] = 0x42;
    await this.beginFaceWhenReady(begin);
    for (let offset = 0; offset < packageBytes.length; ) {
      const chunk = packageBytes.slice(offset, offset + chunkSize);
      const packet = new Uint8Array(5 + chunk.length);
      const packetView = new DataView(packet.buffer);
      packet[0] = 0x95;
      packetView.setUint32(1, offset, true);
      packet.set(chunk, 5);
      try {
        await this.writeAcked(packet, 0x95, offset + chunk.length);
      } catch (error) {
        if (this.isTransientGattError(error) && chunkSize > minChunkSize) {
          chunkSize = Math.max(minChunkSize, Math.floor(chunkSize / 2));
          this.log(`Gói vượt quá MTU kết nối hiện tại, giảm còn ${chunkSize} byte/lần và gửi lại`, {operation:'tn42-upload',step:'shrink-chunk',offset,chunkSize});
          continue;
        }
        throw error;
      }
      await delay(12);
      offset += chunk.length;
      const percent = Math.min(100, Math.round((offset / packageBytes.length) * 100));
      onProgress(percent);
      if (percent === 100 || percent % 10 === 0) this.log('Đang gửi giao diện 4.2"', {operation:'tn42-upload',step:'send-chunk',bytesSent:offset,bytesTotal:packageBytes.length,percent,chunkSize});
    }
    let status = null;
    try {
      await this.writeAcked(new Uint8Array([0x96]), 0x96, packageBytes.length, 0);
    } catch (error) {
      if (!error.ackTimeout) throw error;
      status = await this.waitForDisplayReady(operationToken);
      if (!status.time.customValid || status.time.faceId !== CUSTOM_FACE_ID) throw error;
      this.log('Mất ACK 0x96 nhưng FF01 xác nhận TN42 đã lưu');
    }
    if (!status) {
      this.log('Đang chờ màn E-Ink làm mới an toàn', {operation:'tn42-upload',step:'display-refresh'});
      status = await this.waitForDisplayReady(operationToken);
    }
    for (let retry = 0; retry < 5 && (!status.time.customValid || status.time.faceId !== CUSTOM_FACE_ID); retry++) {
      await delay(250);
      status = await this.readStatus(operationToken);
    }
    if (!status.time.customValid || status.time.faceId !== CUSTOM_FACE_ID) throw new Error('Đồng hồ không xác nhận giao diện 4.2" đã lưu');
    if (status.time.facePayloadCrc == null) throw new Error('Firmware chưa trả CRC giao diện thật');
    if ((status.time.facePackageId >>> 0) !== (decoded.packageId >>> 0) ||
        (status.time.facePayloadCrc >>> 0) !== (decoded.payloadCrc >>> 0)) {
      throw new Error('ID/CRC đọc lại từ đồng hồ không khớp gói vừa gửi');
    }
    this.log('Đã xác minh và lưu giao diện 4.2"', {operation:'tn42-upload',step:'verify',packageId:decoded.packageId,size:packageBytes.length,crc32:decoded.payloadCrc.toString(16).padStart(8,'0'),durationMs:Math.round(performance.now()-started),result:'ok'});
    return status;
  }

  async uploadTn42Package(packageBytes, onProgress = () => {}) {
    return this.runExclusive('tn42-upload', token => this.uploadTn42Unlocked(packageBytes, onProgress, token));
  }

  /* R23: uploads a flash glyph atlas (opcodes 0x9A begin / 0x9B chunk /
   * 0x9C finish) -- see docs/FONT_ATLAS_TNVA.md. Deliberately separate
   * from uploadFace(): the atlas is cached on-device and only needs
   * resending when its own bytes actually change, not on every face
   * re-upload -- callers should skip calling this at all when the atlas
   * crc32 matches what was last confirmed uploaded (see
   * atlasNeedsUpload() in app.js). */
  async uploadAtlas(atlasBytes, onProgress = () => {}) {
    return this.runExclusive('atlas-upload', token => this.uploadAtlasUnlocked(atlasBytes, onProgress, token));
  }

  /* R23 (fixed after real-hardware testing): every atlas opcode
   * (0x9A/0x9B/0x9C) does an instant, non-blocking EPD-busy check on the
   * firmware side and rejects (ackCode 11) rather than waiting -- a real
   * synchronous wait there would stall this cooperative firmware's whole
   * main loop, BLE stack included, for as long as an EPD refresh takes
   * (seconds). "Waiting for busy-clear" happens here instead: retry every
   * 400ms. Originally only wrapped the begin call -- a periodic redraw can
   * start partway through a multi-second chunk transfer just as easily as
   * at the start, so every write in uploadAtlasUnlocked() goes through
   * this now, not just 0x9A. */
  async writeAckedWaitingForDisplay(packet, command, expectedOffset, timeoutMs = 2500) {
    let lastError;
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        return await this.writeAcked(packet, command, expectedOffset, 0, timeoutMs);
      } catch (error) {
        lastError = error;
        if (![1, 2, 11].includes(error.ackCode) || attempt === 79) throw error;
        this.log('Đồng hồ đang bận (màn hình đang làm mới), đợi rồi thử lại', {operation:'atlas-upload',step:'wait-ready',command:`0x${command.toString(16)}`,retry:attempt+1,ackCode:error.ackCode});
        await delay(400);
      }
    }
    throw lastError;
  }

  async uploadAtlasUnlocked(atlasBytes, onProgress, operationToken) {
    if (!this.connected) throw new Error('Chưa kết nối');
    if (!this.ctrlPoint) throw new Error('Phần mềm thiết bị chưa hỗ trợ xác nhận FF03');
    /* Atlas glyph chỉ tồn tại cho 2.13" (xem atlas-generator.js) -- ngân
     * sách đọc từ cùng profile dùng cho TNF1 ở trên. */
    if (atlasBytes.length < 16 || atlasBytes.length > PANEL_PROFILES['212x104'].atlasBudgetBytes) {
      throw new Error('Atlas phải từ 16 byte đến 4 KB');
    }
    if (String.fromCharCode(...atlasBytes.slice(0, 4)) !== 'TNVA') throw new Error('Atlas thiếu magic TNVA');
    const checksum = crc32(atlasBytes);
    const started = performance.now();
    let chunkSize = 64;
    const minChunkSize = 16;
    this.log('Chuẩn bị gửi atlas font', {operation:'atlas-upload',step:'validate',size:atlasBytes.length,crc32:checksum.toString(16).padStart(8,'0'),chunkSize});

    const begin = new Uint8Array(9);
    const beginView = new DataView(begin.buffer);
    begin[0] = 0x9a;
    beginView.setUint32(1, atlasBytes.length, true);
    beginView.setUint32(5, checksum, true);
    await this.writeAckedWaitingForDisplay(begin, 0x9a, 0);

    for (let offset = 0; offset < atlasBytes.length; ) {
      const chunk = atlasBytes.slice(offset, offset + chunkSize);
      const packet = new Uint8Array(5 + chunk.length);
      const packetView = new DataView(packet.buffer);
      packet[0] = 0x9b;
      packetView.setUint32(1, offset, true);
      packet.set(chunk, 5);
      try {
        await this.writeAckedWaitingForDisplay(packet, 0x9b, offset + chunk.length);
      } catch (error) {
        if (this.isTransientGattError(error) && chunkSize > minChunkSize) {
          chunkSize = Math.max(minChunkSize, Math.floor(chunkSize / 2));
          this.log(`Gói vượt quá MTU kết nối hiện tại, giảm còn ${chunkSize} byte/lần và gửi lại`, {operation:'atlas-upload',step:'shrink-chunk',offset,chunkSize});
          continue;
        }
        throw error;
      }
      await delay(12);
      offset += chunk.length;
      /* Capped at 99% while sending -- 100% only fires after 0x9C's
       * finish+verify ACK succeeds below, not when the last byte merely
       * lands (see docs/FONT_ATLAS_TNVA.md requirement 10; this is the bug
       * uploadFaceUnlocked() above still has for the face package, which
       * was left alone since face upload progress wasn't in scope here). */
      const percent = Math.min(99, Math.round((offset / atlasBytes.length) * 99));
      onProgress(percent);
      if (percent === 99 || percent % 10 === 0) this.log('Đang gửi atlas font', {operation:'atlas-upload',step:'send-chunk',bytesSent:offset,bytesTotal:atlasBytes.length,percent,chunkSize});
    }

    this.log('Đang xác minh atlas trên thiết bị', {operation:'atlas-upload',step:'verify'});
    await this.writeAckedWaitingForDisplay(new Uint8Array([0x9c]), 0x9c, atlasBytes.length, 6000);
    onProgress(100);
    this.log('Đã ghi và xác minh atlas font', {operation:'atlas-upload',step:'commit',size:atlasBytes.length,crc32:checksum.toString(16).padStart(8,'0'),durationMs:Math.round(performance.now()-started),result:'ok'});
    return true;
  }

  async updateFirmware(release, onProgress = () => {}) {
    return this.runExclusive('firmware-update', token => this.updateFirmwareUnlocked(release, onProgress, token));
  }

  async updateFirmwareUnlocked(release, onProgress, operationToken) {
    if (!this.connected) throw new Error('Chưa kết nối');
    if (!this.ctrlPoint) throw new Error('Phần mềm thiết bị chưa hỗ trợ xác nhận cập nhật');
    if (!release?.download_url || !release?.manifest_b64 || !release?.signature_b64) {
      throw new Error('Thông tin bản cập nhật không đầy đủ');
    }

    const started=performance.now();
    const currentStatus=await this.readStatus(operationToken);
    this.log('Chuẩn bị cập nhật phần mềm', {operation:'ota',step:'download',version:release.version,device:currentStatus.name,deviceId:currentStatus.time.deviceId});
    const response = await fetch(release.download_url, { cache:'no-store' });
    if (!response.ok) throw new Error('Không tải được bản cập nhật');
    const firmware = new Uint8Array(await response.arrayBuffer());
    if (!firmware.length || firmware.length > 102336) throw new Error('Dung lượng bản cập nhật không hợp lệ');
    if (release.size_bytes && Number(release.size_bytes) !== firmware.length) throw new Error('Dung lượng tải về không khớp');

    const vectorView=new DataView(firmware.buffer,firmware.byteOffset,firmware.byteLength);
    const initialSp=vectorView.getUint32(0,true), resetVector=vectorView.getUint32(4,true), resetAddress=resetVector&0xfffffffe;
    if ((initialSp&3)!==0 || initialSp<0x07fc0000 || initialSp>=0x08000000 || (resetVector&1)!==1 || resetAddress<0x07fc0000 || resetAddress>=0x08000000) {
      throw new Error('Tệp không phải ứng dụng DA14585 thô');
    }
    const modelMarker=new TextEncoder().encode('TNVA-EINK-213');
    if (findPattern(firmware,modelMarker)<0) throw new Error('Tệp cập nhật thiếu nhận dạng TNVA-EINK-213');

    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', firmware));
    const digestHex = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
    if (release.sha256 && digestHex.toLowerCase() !== String(release.sha256).toLowerCase()) {
      throw new Error('SHA-256 của bản cập nhật không khớp');
    }

    const manifest = b64ToBytes(release.manifest_b64);
    const signature = b64ToBytes(release.signature_b64);
    if (manifest.length !== 52 || signature.length !== 64) throw new Error('Chữ ký bản cập nhật sai định dạng');
    const manifestView = new DataView(manifest.buffer, manifest.byteOffset, manifest.byteLength);
    if (String.fromCharCode(...manifest.slice(0, 4)) !== 'TNO1' || manifest[4] !== 1 || manifest[5] !== 0x85 || manifest[9] !== 0 || manifest[50] !== 0 || manifest[51] !== 0) {
      throw new Error('Bản cập nhật không dành cho TNVA-EINK-213');
    }
    if (manifestView.getUint32(10, true) !== firmware.length) throw new Error('Manifest sai dung lượng');
    const firmwareCrc=crc32(firmware);
    if (manifestView.getUint32(14,true)!==firmwareCrc) throw new Error('CRC32 trong manifest không khớp');
    const manifestSha = [...manifest.slice(18, 50)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (manifestSha !== digestHex) throw new Error('Manifest không khớp dữ liệu tải về');
    const manifestVersion=`${manifest[6]}.${manifest[7]}.${manifest[8]}`;
    if (release.version && String(release.version)!==manifestVersion) throw new Error('Phiên bản manifest không khớp bản phát hành');
    const versionParts=value=>String(value||'0.0.0').split('.').map(Number);
    const next=versionParts(manifestVersion), current=versionParts(currentStatus.time.firmware);
    if (next[0]<current[0] || (next[0]===current[0] && next[1]<current[1]) || (next[0]===current[0] && next[1]===current[1] && next[2]<=current[2])) throw new Error('Bản cập nhật phải mới hơn firmware đang chạy');
    this.log('Manifest OTA hợp lệ', {operation:'ota',step:'validate',version:manifestVersion,size:firmware.length,crc32:firmwareCrc.toString(16).padStart(8,'0'),sha256:digestHex,chunkSize:128});

    this.otaCancelRequested = false;
    const begin = new Uint8Array(1 + manifest.length + signature.length);
    begin[0] = 0xa0;
    begin.set(manifest, 1);
    begin.set(signature, 1 + manifest.length);
    await this.beginOtaWhenReady(begin);
    this.log('Đã xóa slot đích và nhận ACK', {operation:'ota',step:'erase',version:manifestVersion,ackCode:0});
    onProgress(1);

    const chunkSize = 128;
    try {
      for (let offset = 0; offset < firmware.length; offset += chunkSize) {
        if (this.otaCancelRequested) {
          const cancelError = new Error('Đã huỷ cập nhật theo yêu cầu');
          cancelError.otaCancelled = true;
          throw cancelError;
        }
        const chunk = firmware.slice(offset, offset + chunkSize);
        const packet = new Uint8Array(6 + chunk.length);
        const view = new DataView(packet.buffer);
        packet[0] = 0xa1;
        view.setUint32(1, offset, true);
        packet[5] = chunk.length;
        packet.set(chunk, 6);
        await this.writeAcked(packet, 0xa1, offset + chunk.length, 3, 6000);
        const percent=Math.min(99, Math.max(1, Math.round(((offset + chunk.length) / firmware.length) * 98)));
        onProgress(percent);
        if(percent%10===0 || offset+chunk.length===firmware.length) this.log('Đang gửi firmware', {operation:'ota',step:'send-chunk',version:manifestVersion,bytesSent:offset+chunk.length,bytesTotal:firmware.length,percent,chunkSize});
      }
      await this.writeAcked(new Uint8Array([0xa4]), 0xa4, 0, 0, 45000);
      onProgress(100);
      this.log(`Đã ghi và xác minh phần mềm ${release.version || ''}`.trim(), {operation:'ota',step:'commit',version:manifestVersion,size:firmware.length,crc32:firmwareCrc.toString(16).padStart(8,'0'),sha256:digestHex,durationMs:Math.round(performance.now()-started),result:'ok'});
      return { manifestVersion };
    } catch (error) {
      try { await this.writeAcked(new Uint8Array([0xa3]), 0xa3, 0, 0, 3000); } catch { /* Thiết bị có thể đã khởi động lại. */ }
      if (error.otaCancelled) {
        this.log('Đã huỷ cập nhật firmware theo yêu cầu, ảnh cũ vẫn giữ nguyên', {operation:'ota',step:'abort',version:release.version,durationMs:Math.round(performance.now()-started),result:'cancelled'});
      } else {
        this.log('Cập nhật firmware thất bại', {operation:'ota',step:'abort',version:release.version,error:error.message,ackCode:error.ackCode,durationMs:Math.round(performance.now()-started),result:'error'});
      }
      throw error;
    } finally {
      this.otaCancelRequested = false;
    }
  }

}

export { crc32 };
