/*
 * R25.13 Bước 2 -- nguồn định nghĩa panel hình thức, dùng chung cho mọi nơi
 * trong weble/ thay vì hardcode 212/104/250/122/4096 rải rác.
 *
 * QUAN TRỌNG: giữ nguyên các field cũ (`width`, `height`, `deviceClass`,
 * `planes`, `maxPackageBytes`, `label`, `designOnly`, `atlasBudgetBytes`,
 * `atlasMaxGlyphs`, `panelRef`) với đúng tên/giá trị đã có trong
 * `config.js`'s `DEVICE.profiles` trước bản vá này -- hàng chục chỗ trong
 * `editor.js`/`app.js`/`ble.js` đọc thẳng các tên này
 * (`profile.width`, `profile.maxPackageBytes`, ...). Đổi tên field sẽ phá
 * luồng 2.13 hiện có. Field mới theo yêu cầu R25.13 (`id`, `w`, `h`,
 * `color_mode`, `bit_order`, `rotations`, `chunk_max`) chỉ CỘNG THÊM, là
 * alias cùng giá trị với field cũ tương ứng.
 *
 * Nguồn số đo: xem REPORTS/PANEL_AUDIT.md mục 1 (driver IC/độ phân
 * giải/thứ tự plane) và mục 3 (`TNVA42_MAX_PACKAGE_BYTES=24576` đọc thẳng
 * từ `FIRMWARE_DA14585_4.2_TN42/.../tnva42.h`, KHÔNG PHẢI 32768 như bản
 * đoán cũ trong `config.js` trước bản vá -- sửa lại đúng theo firmware
 * thật ở đây).
 */

export const PANEL_ID = {
  EINK_213: 1,   // 2.13" mono (SSD1680), mọi hướng
  EINK_42_TRI: 2, // 4.2" 3 màu đen/trắng/đỏ (SSD1680-family BWR/SSD1683), mọi hướng
};

export const COLOR_MODE = {
  MONO: 'mono',
  BWR: 'bwr',
};

/*
 * `bit_order: 'msb_first_row_major'` -- đúng cho cả hai panel: bit cao
 * (MSB) của byte đầu ứng với pixel trái nhất của hàng, hàng dựng tuần tự
 * từ trên xuống (row-major). Xác nhận ở `src/epd/epd_gui.c`'s
 * `draw_pixel()` (`bit_mask = 0x80>>(nx&7)`, `byte_pos = ny*line_bytes +
 * (nx>>3)`) cho 2.13, và `tnva42.c`'s `TNVA42_ROW_BYTES=50` cộng cách
 * `EPD_4in2.c` ghi RAM theo `0x24`/`0x26` cho 4.2 (cùng quy ước MSB-first
 * mà controller họ SSD1680 luôn dùng).
 */
const BIT_ORDER = 'msb_first_row_major';

export const PANEL_PROFILES = {
  '212x104': {
    id: PANEL_ID.EINK_213, name: '2.13" mono · Ngang',
    width: 212, height: 104, w: 212, h: 104,
    deviceClass: 'eink213', color_mode: COLOR_MODE.MONO, planes: 1,
    bit_order: BIT_ORDER, rotations: [0, 90],
    maxPackageBytes: 4096, chunk_max: 4096,
    atlasBudgetBytes: 4096,
    /* R25.14 mục 3: SSD1680 mono full-update thật (~1-2s, epd.c's
     * epd_update()/UPDATE_FULL) -- KHÔNG dùng chung số với BWR (chậm hơn
     * nhiều vì 2 lượt quét, xem '400x300' bên dưới). */
    refreshTimeoutMs: 2000,
    label: '2.13" 1-bit · Ngang',
  },
  '104x212': {
    id: PANEL_ID.EINK_213, name: '2.13" mono · Dọc',
    width: 104, height: 212, w: 104, h: 212,
    deviceClass: 'eink213', color_mode: COLOR_MODE.MONO, planes: 1,
    bit_order: BIT_ORDER, rotations: [0, 90],
    maxPackageBytes: 4096, chunk_max: 4096,
    atlasBudgetBytes: 4096,
    refreshTimeoutMs: 2000,
    label: '2.13" 1-bit · Dọc',
  },
  /*
   * R25.13: firmware thật đã có ở FIRMWARE_DA14585_4.2_TN42 (xem
   * PANEL_AUDIT.md) -- panelRef sửa lại đúng driver thật (SSD1680-family
   * BWR/SSD1683 qua EPD_4in2.c, KHÔNG PHẢI UC8276 như bản đoán cũ).
   * maxPackageBytes/chunk_max sửa về đúng TNVA42_MAX_PACKAGE_BYTES=24576
   * đọc từ firmware (bản cũ đoán 32768). designOnly TẮT từ Bước 6 -- bộ mã
   * hoá TN42 thật (tn42-encoder.js + editor.js's compileTn42()) và đường
   * truyền BLE (ble.js's uploadTn42Package()) đã xây xong Bước 5, kiểm
   * chứng byte-for-byte + preview PNG xong Bước 7 (tests/test_tn42_encoder.py,
   * tools/build_tn42_samples.mjs). Gửi thật vẫn cần đang kết nối ĐÚNG
   * panel_id=2 (DEVICE_INFO, Bước 3) -- app.js's checkPanelMatch() cảnh
   * báo/khoá nút "Cài đặt" khi lệch, không đụng gì tới designOnly nữa.
   */
  '400x300': {
    id: PANEL_ID.EINK_42_TRI, name: '4.2" 3 màu · Ngang',
    width: 400, height: 300, w: 400, h: 300,
    deviceClass: 'eink42tri', color_mode: COLOR_MODE.BWR, planes: 2,
    bit_order: BIT_ORDER, rotations: [0, 90],
    maxPackageBytes: 24576, chunk_max: 24576,
    atlasBudgetBytes: 16384, atlasMaxGlyphs: 96,
    /* R25.14 mục 3: BWR quét 2 lượt (đen rồi đỏ, EPD_4in2.c's display()
     * state machine) -- chậm hơn hẳn mono, khớp editor.js's
     * estimateRefreshSeconds() đã ước tính 15s cho thiết kế có đỏ. Dư biên
     * lên 18s vì đây là NGƯỠNG CHỜ (timeout), không phải số hiển thị cho
     * người dùng. */
    refreshTimeoutMs: 18000,
    label: '4.2" 3 màu (đen/trắng/đỏ) · Ngang',
    panelRef: 'SSD1680-family BWR (lớp SSD1683), driver thật trong FIRMWARE_DA14585_4.2_TN42/.../EPD_4in2.c -- xem REPORTS/PANEL_AUDIT.md mục 1',
  },
  '300x400': {
    id: PANEL_ID.EINK_42_TRI, name: '4.2" 3 màu · Dọc',
    width: 300, height: 400, w: 300, h: 400,
    deviceClass: 'eink42tri', color_mode: COLOR_MODE.BWR, planes: 2,
    bit_order: BIT_ORDER, rotations: [0, 90],
    maxPackageBytes: 24576, chunk_max: 24576,
    atlasBudgetBytes: 16384, atlasMaxGlyphs: 96,
    refreshTimeoutMs: 18000,
    label: '4.2" 3 màu (đen/trắng/đỏ) · Dọc',
    panelRef: 'SSD1680-family BWR (lớp SSD1683), driver thật trong FIRMWARE_DA14585_4.2_TN42/.../EPD_4in2.c -- xem REPORTS/PANEL_AUDIT.md mục 1',
  },
};

/* Profile mặc định khi chưa kết nối / panel không trả DEVICE_INFO. */
export const DEFAULT_PROFILE_KEY = '212x104';

/*
 * Bước 3 (handshake): map panel_id đọc từ characteristic DEVICE_INFO +
 * chiều rộng/cao vật lý -> đúng key trong PANEL_PROFILES. Trả về null nếu
 * không khớp profile nào đã biết (panel lạ) -- gọi nơi dùng phải tự
 * fallback về DEFAULT_PROFILE_KEY, không đoán mù.
 */
export function profileKeyForDeviceInfo(panelId, width, height) {
  for (const [key, profile] of Object.entries(PANEL_PROFILES)) {
    if (profile.id === panelId && profile.w === width && profile.h === height) return key;
  }
  return null;
}

export function profileById(panelId) {
  return Object.values(PANEL_PROFILES).find(profile => profile.id === panelId) || null;
}

/*
 * Web-tu-thich-ung-theo-panel: store toan-app DUY NHAT cho panel dang ket
 * noi (yeu cau muc 1 "Nguon su that DUY NHAT la DEVICE_INFO doc luc
 * connect"). null = chua ket noi -- app.js's refreshUiForActivePanel() la
 * noi DUY NHAT goi setActivePanel(), tai dung 2 diem da co san
 * (openConnectedApp()/setDeviceOffline()). Quyet dinh da chot voi nguoi
 * dung (xem plan): khi null, KHONG khoa editor -- giu nguyen luong nhap
 * offline hien co (mac dinh ho so 2.13").
 */
let activePanel = null;
export function setActivePanel(profile) {
  activePanel = profile || null;
  return activePanel;
}
export function getActivePanel() {
  return activePanel;
}

/*
 * Suy panel_id tu kich thuoc vat ly (khong phan biet huong ngang/doc cua
 * CUNG mot panel) -- dung de loc thu vien face theo panel dang ket noi
 * (muc 2) khi item chi co san width/height, khong co san field panelId
 * rieng. Tra ve null neu kich thuoc khong khop profile nao da biet.
 */
export function panelIdForSize(width, height) {
  const hit = Object.values(PANEL_PROFILES).find(profile => profile.w === width && profile.h === height);
  return hit ? hit.id : null;
}

/* Tim lai key (vd '212x104') cho MOT profile object da co (vd tra ve tu
 * profileById()/getActivePanel()) -- dung khi can goi editor.newProject()/
 * setProfile() (nhan key chuoi, khong nhan object). */
export function keyForProfile(profile) {
  if (!profile) return null;
  return Object.keys(PANEL_PROFILES).find(key => PANEL_PROFILES[key] === profile) || null;
}
