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

/*
 * ==== FEATURE FLAGS ====
 * Nguồn DUY NHẤT cho các cờ ẩn/hiện UI Studio -- mọi nơi khác import từ đây,
 * không hard-code true/false rải rác. Đổi false -> true để bật lại, không
 * xoá code phía dùng cờ.
 */
export const FEATURES = {
  // Cho phép người dùng tự chọn file .bin (+ .ota-sig.bin) từ máy để OTA.
  // false = ẩn hoàn toàn, chỉ cập nhật qua kênh GitHub chính thức (xem
  // OTA_GITHUB_CHANNEL bên dưới). Không đụng ble.updateFirmware() -- vẫn là
  // đường truyền dùng chung cho cả hai luồng.
  OTA_MANUAL_FILE: false,

  // Kênh firmware chính thức đọc manifest.json từ GitHub (FW_MANIFEST_URL/
  // FW_BASE_URL bên dưới).
  OTA_GITHUB_CHANNEL: true,

  // Panel 4.2" BWR (400x300/300x400) -- có sẵn trong PANEL_PROFILES và đã
  // chạy được (xem panel_profiles.js), nhưng CHƯA công bố ra ngoài. false =
  // ẩn toàn bộ UI liên quan (bộ chọn panel, thư viện face, nút "Mẫu 4.2",
  // kênh firmware panel 420). KHÔNG xoá entry khỏi PANEL_PROFILES.
  PANEL_420: false,
};

/*
 * Kênh firmware chính thức: manifest.json trên raw.githubusercontent.com
 * (KHÔNG dùng GitHub Releases API -- API không đăng nhập giới hạn 60
 * request/giờ/IP, còn raw.githubusercontent.com CORS mở, không giới hạn
 * kiểu đó, và tải .bin trực tiếp được từ browser). Điền <OWNER>/<REPO> thật
 * trước khi bật OTA_GITHUB_CHANNEL trong sản xuất.
 */

/*
 * Máy chủ kích hoạt TNVA (R27 mobile/admin). Trang GitHub Pages là HTTPS,
 * vì vậy URL dùng thật cũng phải là HTTPS (khuyến nghị Cloudflare Tunnel
 * trỏ về Pi:8080). Không đặt private key hay service-role secret trong web.
 * Chỉ thay đúng URL công khai ở đây sau khi tunnel/domain đã sẵn sàng.
 */
export const ACTIVATION_API_BASE =
  'https://enquiries-organizing-ferry-fridge.trycloudflare.com';

export const FW_MANIFEST_URL =
  'https://raw.githubusercontent.com/<OWNER>/<REPO>/main/firmware/manifest.json';
export const FW_BASE_URL =
  'https://raw.githubusercontent.com/<OWNER>/<REPO>/main/firmware/';
if (FW_MANIFEST_URL.includes('<OWNER>') || FW_MANIFEST_URL.includes('<REPO>')) {
  console.warn('[TNVA] FW_MANIFEST_URL/FW_BASE_URL trong config.js chưa được điền OWNER/REPO thật -- kênh Firmware sẽ không tải được manifest.');
}
