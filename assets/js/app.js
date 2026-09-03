/* R25.12 (mục 1/4): DYNAMIC_TYPES thiếu import -- isScalableDynamic() dùng
 * nó ở renderInspector() (sàn 7px thật cho mọi đối tượng động) từ đợt sửa
 * root-cause resize, nhưng chưa từng được import vào app.js -- ReferenceError
 * lúc chạy thật (không phải lỗi cú pháp, node --check không bắt được, môi
 * trường này không có trình duyệt để chạy thử) mỗi khi mở bảng thuộc tính
 * cho bất kỳ đối tượng chữ động nào. Phát hiện khi nối dayOnly/monthOnly/
 * yearOnly vào cùng đường dùng chung này. */
import { FaceEditor, TYPE_LABELS, DYNAMIC_TYPES, download, calendarGeometry, elementPlane, redUsageWarning, dynamicSample } from './editor.js';
import { normalizeVietnameseText } from './editor.js';
import { TnvaBle, crc32, describeBleDiagnostics } from './ble.js';
import { saveProject, listProjects, deleteProject } from './storage.js';
import { redeemCliActivationCode } from './activation.js';
import { DEVICE, FEATURES, FW_MANIFEST_URL, FW_BASE_URL } from './config.js';
import {
  PANEL_PROFILES, DEFAULT_PROFILE_KEY, profileById, COLOR_MODE,
  setActivePanel, getActivePanel, panelIdForSize, keyForProfile,
} from './panel_profiles.js';
import {
  alignedX, bitmapTextWidth, drawBitmapAligned, drawBitmapText,
  drawTinyText, tinyTextWidth, isClockBitmapFont
} from './device-fonts.js';
import {
  estimateFaceAtlas, collectFaceAtlasNeed, ATLAS_BUDGET_BYTES,
  ATLAS_FONT_HAS_VIETNAMESE, containsNonAsciiText, DIGIT_EFFECT_DIRS,
  atlasFontMinPx, packBitplaneRowMajor, ATLAS_FONTS, FONT_FAMILY_CSS
} from './atlas-generator.js';
import { normalizeCrisp213Package } from './text-size-policy.js';
import { TET_DECORATIONS, tetDecorationById } from './tet-decorations.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const connectGate = $('#connectGate');
const appShell = $('#appShell');
const logWindow = $('#logWindow');
const ACTIVITY_LOG_KEY = 'tnvaActivityLogV2';
const ACTIVITY_LOG_LIMIT = 250;
let activityEntries = [];
try {
  const stored = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY) || '[]');
  if (Array.isArray(stored)) activityEntries = stored.slice(-ACTIVITY_LOG_LIMIT);
} catch { activityEntries = []; }
let deviceTimer = null;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
}

function safeLogDetails(details = {}) {
  const allowed = ['operation','step','device','deviceId','packageId','title','version','size','crc32','sha256','orientation','bytesSent','bytesTotal','percent','chunkSize','retry','ackCode','durationMs','result','error','level','diffSec','calMinute'];
  return Object.fromEntries(allowed.filter(key => details[key] !== undefined).map(key => [key, details[key]]));
}

/* R25.6 (Phase E): entries persisted before this change have no `level` --
 * derive it the same way at render time instead of migrating localStorage,
 * so old log history doesn't silently disappear or need a version bump. */
function entryLevel(entry) {
  if (entry.level) return entry.level;
  const result = entry.details?.result;
  if (result === 'error') return 'error';
  if (result === 'cancelled') return 'warn';
  return 'ok';
}

const SEVERITY_LABEL = { ok: 'OK', warn: 'CẢNH BÁO', error: 'LỖI' };
const SEVERITY_CLASS = { ok: 'log-ok', warn: 'log-warn', error: 'log-error' };

/* Actionable guidance keyed by the numeric TNVA_ERROR_* ackCode
 * (src/clock_faces/face_custom.h, "keep in sync with the TNVA web") --
 * a full sentence, not a raw code, plus a concrete next step. Mirrors
 * ble.js's ACK_ERRORS (same codes, shorter labels used for thrown
 * Error messages) but adds the "what to do about it" half. */
const ERROR_GUIDANCE = {
  1: 'Đồng hồ đang bận xử lý lệnh trước đó -- đợi vài giây rồi thử lại.',
  2: 'Đồng hồ chưa sẵn sàng nhận lệnh này (đang khởi động) -- đợi vài giây rồi thử lại.',
  3: 'Lệnh không hợp lệ -- thử tải lại trang web (có thể phiên bản web/firmware lệch nhau).',
  4: 'Độ dài gói dữ liệu sai -- thử gửi lại; nếu lặp lại, tải lại trang.',
  5: 'Thứ tự dữ liệu bị lệch giữa lúc gửi -- thử gửi lại từ đầu.',
  6: 'Không xoá được vùng nhớ flash -- thử lại; nếu lặp lại nhiều lần, có thể flash lỗi phần cứng.',
  7: 'Không ghi được vào flash -- thử lại; nếu lặp lại, kiểm tra pin đủ không.',
  8: 'Dữ liệu bị lỗi trên đường truyền (CRC không khớp) -- thử gửi lại.',
  9: 'Gói giao diện (TNF1) sai định dạng -- thiết kế lại hoặc tải lại trang web.',
  10: 'Giao diện không đúng kích thước màn (212×104 hoặc 104×212) -- kiểm tra hướng màn khi thiết kế.',
  11: 'Màn E-Ink đang bận làm mới quá lâu -- đợi rồi thử lại; nếu lặp lại, khởi động lại đồng hồ.',
  12: 'Chưa đọc được nhiệt độ -- đợi vài giây để cảm biến ổn định.',
  13: 'Lỗi đọc ADC nhiệt độ -- thử lại; nếu lặp lại, có thể lỗi phần cứng.',
  14: 'Nhiệt độ đọc được nằm ngoài phạm vi hợp lệ -- bỏ qua, không phải lỗi nghiêm trọng.',
  15: 'Cảm biến nhiệt độ chưa hiệu chỉnh -- bỏ qua, không phải lỗi nghiêm trọng.',
  16: 'Bản cập nhật phần mềm không hợp lệ (chữ ký/định dạng sai) -- tải lại bản cập nhật.',
  17: 'Pin quá yếu để cập nhật phần mềm -- sạc pin trên 20% rồi thử lại.',
  23: 'Chữ ký bản cập nhật không hợp lệ -- tải lại bản cập nhật từ nguồn chính thức.',
  24: 'Bản cập nhật không đúng loại thiết bị -- kiểm tra lại file cập nhật.',
  25: 'Bản cập nhật vượt dung lượng cho phép -- liên hệ nơi phát hành bản cập nhật.',
  26: 'Nội dung bản cập nhật không khớp thông tin đã khai báo -- tải lại bản cập nhật.',
  27: 'Phiên cập nhật đã hết hiệu lực -- bắt đầu lại từ đầu.',
  28: 'Không cho phép hạ phiên bản phần mềm xuống bản cũ hơn.'
};

function activityLine(entry) {
  const fields = Object.entries(entry.details || {}).map(([key,value]) => `${key}=${value}`).join(' · ');
  return `[${entry.timestamp}] ${entry.message}${fields ? ` · ${fields}` : ''}`;
}

/* On-screen rendering only -- activityLine() above stays the flat format
 * used for clipboard copy and the .txt export, so nothing downstream that
 * parses the exported log breaks. */
function activityLineDetailed(entry) {
  const level = entryLevel(entry);
  const time = entry.timestamp.slice(11, 19);
  const guidance = level === 'error' && entry.details?.ackCode != null
    ? ERROR_GUIDANCE[entry.details.ackCode]
    : null;
  const fields = Object.entries(entry.details || {})
    .filter(([key]) => key !== 'result' && key !== 'level')
    .map(([key,value]) => `${key}=${value}`).join(' · ');
  let line = `${time} · ${SEVERITY_LABEL[level]} · ${escapeHtml(entry.message)}`;
  if (fields) line += ` · ${escapeHtml(fields)}`;
  if (guidance) line += `<br><span class="log-guidance">→ ${escapeHtml(guidance)}</span>`;
  return `<div class="log-entry ${SEVERITY_CLASS[level]}">${line}</div>`;
}

function renderActivityLog() {
  const filter = $('#logSeverityFilter')?.value || 'all';
  const filtered = activityEntries.filter(entry => filter === 'all' || entryLevel(entry) === filter);
  /* Errors float to the top of the filtered view -- stable sort, so a rare
   * error isn't buried under routine OK traffic, while ties keep their
   * original chronological order. */
  const rank = { error: 0, warn: 1, ok: 2 };
  const sorted = filtered
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (rank[entryLevel(a.entry)] - rank[entryLevel(b.entry)]) || (b.index - a.index))
    .map(item => item.entry);
  logWindow.innerHTML = sorted.length
    ? sorted.map(activityLineDetailed).join('')
    : '<div class="log-entry log-ok">Chưa có hoạt động nào.</div>';
  logWindow.scrollTop = 0;
  $('#logCount').textContent = String(activityEntries.length);
}

function log(message, details = {}) {
  /* Web-tu-thich-ung-theo-panel muc 4 "ep mau do->den khi mono ... ghi log
   * canh bao": entryLevel() truoc day chi tu suy level tu
   * details.result ('error'/'cancelled'), khong co cach nao cac call site
   * MOI (khong phai loi/khong bi huy) tu xin muc 'warn' tuong minh. Them
   * `level` rieng, KHONG dua vao spread details (tranh lan voi
   * safeLogDetails) -- 20+ call site cu khong truyen field nay nen hanh vi
   * cu (entryLevel() tu suy) giu nguyen y het. */
  const { level: explicitLevel, ...restDetails } = details;
  const entry = {
    timestamp: new Date().toISOString(),
    message: String(message),
    details: safeLogDetails({
      device: lastDeviceStatus?.name,
      deviceId: lastDeviceStatus?.time?.deviceId,
      ...restDetails
    })
  };
  entry.level = explicitLevel || entryLevel(entry);
  activityEntries.push(entry);
  if (activityEntries.length > ACTIVITY_LOG_LIMIT) activityEntries.splice(0, activityEntries.length - ACTIVITY_LOG_LIMIT);
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityEntries));
  renderActivityLog();
  const live = $('#liveActivity');
  if (live) live.textContent = message;
  return entry;
}

let toastTimer;
function toast(message, type = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast ${type}`.trim();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 2600);
}

function showModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBackdrop').classList.remove('hidden');
}
function closeModal() { $('#modalBackdrop').classList.add('hidden'); }

/* R25.10: every `catch (error) { reportError(error) }` in this
 * file (20 call sites -- sync time, select face, upload face/atlas, OTA,
 * ...) now goes through this instead. Ordinary errors still just toast,
 * unchanged. ble.js's activationRequiredError() (thrown by
 * runExclusive() for any write while the device reports unactivated)
 * carries needsActivation=true -- for that one case, a modal with a
 * direct link into the activation panel instead of a toast that
 * disappears in 2.6s (mục "Bấm vào -> hiện 'Không thể thực hiện!' kèm 1
 * dòng giải thích ngắn và nút dẫn tới phần kích hoạt"). */
function reportError(error) {
  if (error?.needsActivation) {
    showModal(`<h2>Không thể thực hiện!</h2><p class="prop-help">${escapeHtml(error.message)}</p><div class="modal-actions"><button class="btn" id="modalCancel">Đóng</button><button class="btn primary" id="modalGoActivate">Đi tới phần kích hoạt</button></div>`);
    $('#modalCancel').onclick = closeModal;
    $('#modalGoActivate').onclick = () => {
      closeModal();
      const panel = $('#activationPanel');
      if (panel) { panel.open = true; panel.scrollIntoView({ behavior:'smooth', block:'center' }); }
    };
    return;
  }
  toast(error.message, 'error');
}
$('#modalBackdrop').addEventListener('pointerdown', event => { if (event.target === $('#modalBackdrop')) closeModal(); });

/* Phần B (lệnh popover font/size, mục B1/B3): <details class="prop-popover">
 * (fontPickerHtml()/textSizePickerHtml() ở trên) không tự đóng khi bấm ra
 * ngoài hay Esc -- 3 listener dưới đây gắn 1 LẦN trên document (không gắn
 * lại trong renderInspector(), vì #propertyForm bị thay toàn bộ innerHTML
 * mỗi lần render -- gắn lại sẽ chồng listener theo mỗi lần rebuild). */
document.addEventListener('pointerdown', event => {
  $$('.prop-popover[open]').forEach(details => { if (!details.contains(event.target)) details.open = false; });
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  $$('.prop-popover[open]').forEach(details => { details.open = false; });
});
/* 'toggle' không bubble nhưng vẫn bắt được ở pha capture (tham số `true`) --
 * đóng các popover khác khi 1 popover vừa mở, tránh 2 lưới cùng xoè ra. */
document.addEventListener('toggle', event => {
  const details = event.target;
  if (!(details instanceof HTMLElement) || !details.classList.contains('prop-popover') || !details.open) return;
  $$('.prop-popover[open]').forEach(other => { if (other !== details) other.open = false; });
}, true);

let bleOperationBusy = false;
const ble = new TnvaBle(log);
ble.onDisconnect(() => setDeviceOffline());
let lastDeviceStatus = null;
ble.onOperationChange(({busy,name}) => setBleOperationBusy(busy, name));

/* Task 2 (tab Firmware) định nghĩa renderFirmwareTab() ở cuối file, sau
 * showView()/updateDeviceStatus()/setDeviceOffline() -- 3 chỗ đó gọi qua
 * biến này thay vì tên hàm trực tiếp. Mặc định no-op: khi
 * FEATURES.OTA_GITHUB_CHANNEL tắt, biến này không bao giờ được gán lại nên
 * mọi lời gọi là vô hại. Trả về Promise (như bản thật, async) để mọi nơi
 * gọi `.catch()`/`await` được luôn, không cần if FEATURES ở từng chỗ gọi. */
let refreshFirmwareTab = () => Promise.resolve();

renderActivityLog();

/* R23: atlas size depends on rasterizing every glyph a face needs, which
 * is too slow to redo on every keystroke/drag -- debounce and only bother
 * when the face actually uses an atlas font at all. */
let atlasEstimateTimer = null;
function scheduleAtlasEstimate() {
  if (atlasEstimateTimer) clearTimeout(atlasEstimateTimer);
  atlasEstimateTimer = setTimeout(updateAtlasBudgetBar, 350);
}
/* R25.6 (Phase D): real, firmware-reported capacity when a device is
 * connected (ble.js readStatus()'s time.tnf1CapacityBytes/atlasCapacityBytes,
 * sourced from clock_status_encode() in user_custs1_impl.c -- exactly what
 * validate_header()/tnva_atlas_handle_upload() enforce). The hardcoded
 * DEVICE.profiles[...].maxPackageBytes / ATLAS_BUDGET_BYTES constants are
 * fallback-only, used while the editor is open with nothing connected yet. */
function currentTnf1BudgetBytes() {
  const profile = DEVICE.profiles[`${editor.project.width}x${editor.project.height}`];
  return lastDeviceStatus?.time?.tnf1CapacityBytes ?? profile?.maxPackageBytes ?? PANEL_PROFILES[DEFAULT_PROFILE_KEY].maxPackageBytes;
}
/* R25.12 (Phần B mục 7): 4.2" (planes===2) chưa có thiết bị thật báo dung
 * lượng atlas về -- dùng ƯỚC TÍNH profile-specific (atlasBudgetBytes, lớn
 * hơn 2.13" vì diện tích gấp ~5 lần, xem config.js) thay vì hằng số
 * ATLAS_BUDGET_BYTES 4KB vốn chỉ đúng cho 2.13". lastDeviceStatus vẫn ưu
 * tiên cao nhất khi thật sự có thiết bị kết nối báo dung lượng thật về. */
function currentAtlasBudgetBytes() {
  const profile = DEVICE.profiles[editor.project.profileKey] || DEVICE.profiles[`${editor.project.width}x${editor.project.height}`];
  return lastDeviceStatus?.time?.atlasCapacityBytes ?? profile?.atlasBudgetBytes ?? ATLAS_BUDGET_BYTES;
}

async function updateAtlasBudgetBar() {
  const row = $('#atlasInfoRow');
  const label = $('#atlasInfo');
  if (!row || !label) return;
  if (!collectFaceAtlasNeed(editor.project)) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  label.textContent = 'đang tính…';
  label.style.color = '';
  try {
    const budgetBytes = currentAtlasBudgetBytes();
    const estimate = await estimateFaceAtlas(editor.project, currentAtlasEffect(), budgetBytes);
    if (!estimate) { row.classList.add('hidden'); return; }
    const used = (estimate.totalBytes / 1024).toFixed(1);
    const budget = (budgetBytes / 1024).toFixed(budgetBytes % 1024 === 0 ? 0 : 1);
    label.textContent = `${used} / ${budget} KB (${estimate.glyphCount} glyph, ${estimate.cellPx}px)`;
    label.style.color = estimate.overBudget ? 'var(--danger)' : '';
  } catch (error) {
    label.textContent = 'lỗi tính atlas';
    label.style.color = 'var(--danger)';
  }
}

/* R24 bug fix: every editor.updateSelected() call -- including every single
 * `input` event from typing in "Tên lớp" or the text-content textarea --
 * flowed through changed() -> onSelection() -> renderInspector(), which
 * unconditionally does form.innerHTML = html. That destroys and recreates
 * the very <input>/<textarea> the user is typing into, so the DOM node
 * holding focus and cursor position disappears on every keystroke.
 * Emptying a field made this obvious (nothing left to visually mask the
 * jump) but the destructive rebuild happens for any edit, on any inspector
 * text field, not just when the value goes empty -- see item (j)/(k) in the
 * task notes: fixed structurally here, not with an empty-string special
 * case, and it therefore also covers every OTHER inspector field with the
 * same shape of bug (name, number inputs, ...), not just text content.
 * Tracks which element id the inspector form was last actually built for;
 * while focus is still inside that same form for that same element,
 * onSelection() only needs to refresh the cheap side panels (layers list,
 * title, selection readout) -- the field's own live DOM value is already
 * correct because the user just typed it, nothing there needs rebuilding.
 * Switching elements, or any programmatic change made while nothing in the
 * form is focused, still gets the normal full rebuild. */
let inspectorBuiltForId = null;
const editor = new FaceEditor($('#designCanvas'), {
  onChange: project => {
    $('#designTitle').value = project.title || '';
    $('#designAuthor').value = project.author || '';
    $('#screenProfile').value = project.profileKey || `${project.width}x${project.height}`;
    const title = $('#designerDeviceTitle');
    if (title) title.textContent = `Thiết kế ${project.width} × ${project.height}${project.planes === 2 ? ' · 3 màu' : ''}`;
    renderLayers();
    renderMobileLayers();
    scheduleAtlasEstimate();
    updateDeviceCapabilityUI();
    checkPanelMatch();
  },
  onSelection: (_id, element, options = {}) => {
    const form = $('#propertyForm');
    const active = document.activeElement;
    /* Scoped to free-text controls specifically (textarea, input[type=text])
     * -- selects/checkboxes/range/number keep rebuilding on every change as
     * before, since other parts of the form (digit-effect buttons, the
     * Vietnamese-font warning, ...) legitimately depend on those values and
     * changing them isn't continuous keystroke-by-keystroke typing. */
    const isFreeTextControl = active && form?.contains(active) &&
      (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type === 'text'));
    const editingInPlace = element && element.id === inspectorBuiltForId && isFreeTextControl;
    if (!editingInPlace) {
      renderInspector(element);
      inspectorBuiltForId = element ? element.id : null;
    }
    renderLayers();
    renderMobileLayers();
    const posPanel=$('#positionPanel'); if(posPanel) posPanel.classList.toggle('hidden', !element);
    const title=$('#inspectorTitle'); if(title) title.textContent=element ? (element.name || TYPE_LABELS[element.type] || element.type) : 'Chưa chọn đối tượng';
    $('#selectionInfo').textContent = element ? `${element.name} · ${Math.round(element.x)},${Math.round(element.y)} · ${Math.round(element.w)}×${Math.round(element.h)}` : 'Không chọn';
    if (options.editText && element?.type === 'text') requestAnimationFrame(() => $('#propText')?.focus());
  },
  onPackage: (bytes) => {
    /* R25.8 bug fix: editor.reportPackage() used to pass its own `max`
     * computed from the hardcoded DEVICE.profiles[...].maxPackageBytes --
     * a second, independent threshold that could silently disagree with
     * currentTnf1BudgetBytes() (the one #installBtn actually enforces).
     * Ignore that argument and always read the same single real source of
     * truth here, so the live label while designing never contradicts
     * what sending will actually check. */
    const max = currentTnf1BudgetBytes();
    const used = bytes / 1024;
    $('#packageInfo').textContent = max ? `${used.toFixed(1)} / ${(max/1024).toFixed(1)} KB` : `${used.toFixed(1)} KB`;
    $('#packageInfo').style.color = max && bytes > max ? 'var(--danger)' : '';
  }
});
if (document.fonts?.ready) {
  document.fonts.ready.then(() => editor.render());
}
updateDeviceCapabilityUI();

/* R25.12 (Phần B mục 9/16): thiết bị 4.2" 3 màu (planes===2) hiện CHỈ HỖ
 * TRỢ THIẾT KẾ -- ẩn banner + khoá "Gửi vào đồng hồ"/"Đăng kho" (cả hai
 * đều ngụ ý có thiết bị/kho THẬT tương thích, chưa đúng), và hiện ước tính
 * thời gian refresh (mục 16: chỉ đen (nhanh) vs có đỏ (chậm)). Gọi lại mỗi
 * khi project đổi (onChange) -- đổi thiết bị, thêm/xoá đối tượng đỏ, v.v. */
/*
 * R25.13 Bước 3: DEVICE_INFO đã đọc được (ble.deviceInfo, xem ble.js's
 * attach()/readDeviceInfo()) hay chưa (panel cũ, coi như 2.13") -> so với
 * deviceClass của project ĐANG MỞ trên canvas. Lệch thì CHỈ cảnh báo --
 * không tự chuyển profile, không tự chặn, không tự gửi gì. Gọi lại mỗi khi
 * project đổi (onChange) hoặc vừa kết nối/ngắt kết nối. */
/* Dùng chung bởi checkPanelMatch() (banner) và updateDeviceCapabilityUI()
 * (khoá nút "Cài đặt") -- một nguồn duy nhất cho "panel đang kết nối có
 * đúng loại project đang mở không". null khi chưa kết nối (không phải
 * mismatch -- chỉ đơn giản chưa biết/chưa cần biết). */
function connectedProfileInfo() {
  if (!ble.connected) return null;
  const profile = ble.deviceInfo ? profileById(ble.deviceInfo.panelId) : PANEL_PROFILES[DEFAULT_PROFILE_KEY];
  return profile || PANEL_PROFILES[DEFAULT_PROFILE_KEY];
}
function isPanelMismatched() {
  const connected = connectedProfileInfo();
  if (!connected) return false;
  return (connected.deviceClass || 'eink213') !== (editor.project.deviceClass || 'eink213');
}

function checkPanelMatch() {
  const banner = $('#panelMismatchBanner');
  if (!banner) return;
  if (!isPanelMismatched()) { banner.classList.add('hidden'); return; }
  const connectedProfile = connectedProfileInfo();
  const openClass = editor.project.deviceClass || 'eink213';
  banner.textContent = `⚠ Đồng hồ đang kết nối là ${connectedProfile?.name || connectedProfile?.deviceClass} nhưng giao diện đang mở là cho ${PANEL_PROFILES[editor.project.profileKey]?.name || openClass} -- KHÔNG gửi được cho tới khi mở đúng giao diện cho panel này.`;
  banner.classList.remove('hidden');
}

function updateDeviceCapabilityUI() {
  /* R25.13 Bước 6: designOnly giờ đọc THẲNG từ profile (panel_profiles.js)
   * thay vì suy từ planes===2 -- 4.2" đã tắt designOnly (firmware/pipeline
   * thật xong Bước 4/5/6, xem REPORTS/PANEL_AUDIT.md), banner "chỉ thiết
   * kế" chỉ còn hiện nếu MỘT profile khác trong tương lai tự đặt cờ này.
   * `tricolor` (planes===2) vẫn là điều kiện riêng cho UI 2-mặt-phẳng
   * (nút mẫu 4.2", chọn xem đen/đỏ) -- không đổi. */
  const profile = PANEL_PROFILES[editor.project.profileKey] || PANEL_PROFILES[DEFAULT_PROFILE_KEY];
  const designOnly = Boolean(profile.designOnly);
  /* R26.1 (Task 3 offline-activation): FEATURES.PANEL_420 -- 4.2" đã chạy
   * được thật (xem comment R25.13 Bước 6 ngay trên), nhưng CHƯA công bố ra
   * ngoài (quyết định kinh doanh, không phải lỗi kỹ thuật). Cộng thêm điều
   * kiện cờ vào đây là đủ tắt open42SamplesBtn/planePreview bên dưới --
   * không đụng gì tới designOnly/PANEL_PROFILES. */
  const tricolor = editor.project.planes === 2 && FEATURES.PANEL_420;
  $('#designOnlyBanner')?.classList.toggle('hidden', !designOnly);
  $('#open42SamplesBtn')?.classList.toggle('hidden', !tricolor);
  $('#planePreview')?.classList.toggle('hidden', !tricolor);
  if (!tricolor && editor.previewPlane !== 'combined') {
    editor.previewPlane = 'combined';
    const selector = $('#planePreview'); if (selector) selector.value = 'combined';
  }
  /* installBtn: designOnly HOẶC panel đang kết nối không khớp (xem
   * isPanelMismatched()/checkPanelMatch() -- banner đã cảnh báo) -> khoá.
   * Ngược lại trả về ĐÚNG điều kiện setDeviceAccess() dùng
   * (bleOperationBusy||!connected) thay vì bật lại vô điều kiện -- không
   * giẫm lên logic khoá nút lúc đang bận BLE/chưa kết nối quản lý ở nơi
   * khác. */
  const mismatch = isPanelMismatched();
  const installBtn = $('#installBtn');
  if (installBtn) {
    installBtn.disabled = designOnly || (tricolor && mismatch) || bleOperationBusy || !ble.connected;
    installBtn.title = designOnly ? 'Thiết bị 4.2" chưa có firmware/driver thật -- chưa gửi lên máy được.'
      : (tricolor && mismatch) ? 'Panel đang kết nối không khớp thiết bị đang thiết kế.' : '';
  }
  const refreshRow = $('#refreshInfoRow'), refreshLabel = $('#refreshInfo');
  if (refreshRow && refreshLabel) {
    refreshRow.classList.toggle('hidden', editor.project.planes !== 2);
    if (editor.project.planes === 2) {
      const seconds = editor.estimateRefreshSeconds();
      refreshLabel.textContent = `~${seconds}s ${seconds > 5 ? '(có đỏ, chậm)' : '(chỉ đen, nhanh)'}`;
      refreshLabel.style.color = seconds > 5 ? 'var(--danger)' : '';
    }
  }
}

/*
 * Web-tu-thich-ung-theo-panel muc 1-6: nguon DUY NHAT dieu phoi UI theo
 * panel dang ket noi. Goi tu DUNG 2 diem thay doi trang thai ket noi da co
 * san (openConnectedApp() sau khi doc ble.deviceInfo, va setDeviceOffline()
 * luc mat ket noi) -- KHONG goi tu onChange cua editor (project doi khi
 * dang thiet ke KHONG phai luc panel doi, dialog chuyen panel/ep mau chi
 * kich hoat dung 1 lan luc activePanel THAT SU doi).
 */
function refreshUiForActivePanel() {
  const previous = getActivePanel();
  const next = connectedProfileInfo(); // null neu chua ket noi -- xem quyet dinh da chot: KHONG khoa editor khi null
  const panelChanged = (previous?.id ?? null) !== (next?.id ?? null);
  setActivePanel(next);

  /* muc 2: o chon panel thu cong CHI con y nghia khi dang o che do nhap
   * offline (chua ket noi) -- da ket noi thi DEVICE_INFO la nguon duy nhat,
   * an han o chon, khong xam. */
  $('#screenProfile')?.classList.toggle('hidden', ble.connected);

  checkPanelMatch();
  updateDeviceCapabilityUI();
  applyMonoColorForcing(next);
  renderActiveLibrary().catch(() => {}); // muc 2: loc lai thu vien theo panel_id moi

  /* muc 2: dialog xac nhan CHI hien khi activePanel THAT SU doi (khong
   * phai moi lan refresh) va thiet ke dang mo khong tuong thich -- khong tu
   * xoa/tu chuyen gi neu nguoi dung tu choi. */
  if (panelChanged && next && isPanelMismatched()) promptPanelSwitchDialog(next);
}

/* muc 4: ep widget mau do -> den khi panel moi la mono (2.13"), KHONG xoa
 * widget, ghi log canh bao ro rang -- editor.forceRedElementsToBlack() tu
 * lam commit()/changed() dung khuon mau setProfile() da co, chi mutate MOT
 * lan neu that su co phan tu do can doi. */
function applyMonoColorForcing(activePanel) {
  if (!activePanel || activePanel.color_mode !== COLOR_MODE.MONO) return;
  const changedIds = editor.forceRedElementsToBlack();
  if (!changedIds.length) return;
  log(`Panel mono (${activePanel.name}) đang kết nối -- đã ép ${changedIds.length} đối tượng màu đỏ về đen (không xoá)`, {
    operation: 'panel-switch', step: 'force-mono-color', level: 'warn', count: changedIds.length, elementIds: changedIds,
  });
  toast(`Đã đổi ${changedIds.length} đối tượng màu đỏ sang đen cho panel mono`, 'error');
}

/* muc 2: "Face này dành cho màn X, mở face mặc định của màn Y? -> có/không"
 * -- tai dung dung showModal()/khuon mau dialog da co cho truong hop doi
 * profile thu cong (xem #screenProfile's change handler ben duoi), chi doi
 * diem kich hoat + noi dung sang tinh huong doi PANEL THAT. */
function promptPanelSwitchDialog(nextProfile) {
  const openProfile = PANEL_PROFILES[editor.project.profileKey] || PANEL_PROFILES[DEFAULT_PROFILE_KEY];
  showModal(`<h2>Panel kết nối khác thiết kế đang mở</h2><p class="prop-help">Đồng hồ đang kết nối là <b>${escapeHtml(nextProfile.name)}</b> nhưng giao diện đang mở trên canvas là cho <b>${escapeHtml(openProfile.name)}</b>. Mở giao diện MẶC ĐỊNH cho ${escapeHtml(nextProfile.name)}?</p>
    <div class="modal-actions"><button class="btn" id="modalCancel">Không, giữ thiết kế đang mở</button><button class="btn primary" id="modalConfirm">Có, mở mặc định ${escapeHtml(nextProfile.name)}</button></div>`);
  $('#modalCancel').onclick = closeModal;
  $('#modalConfirm').onclick = () => {
    const targetKey = keyForProfile(nextProfile) || DEFAULT_PROFILE_KEY;
    editor.newProject(targetKey);
    closeModal();
  };
}

function setDeviceAccess(status = null) {
  const connected = ble.connected;
  $$('.tab').forEach(tab => {
    tab.disabled = false;
  });

  $('#syncTimeBtn').disabled = !connected || bleOperationBusy;
  $$('.apply-face').forEach(button => {
    const faceCount = Number(status?.time?.faceCount || 0);
    const supported = connected && Number(button.dataset.face) < faceCount;
    button.disabled = bleOperationBusy || !supported;
  });
  ['#installBtn','#photoUpload','#countdownUpload','#autoRotateSaveBtn'].forEach(selector => {
    const node = $(selector);
    if (node) node.disabled = bleOperationBusy || !connected;
  });
}

function setBleOperationBusy(busy, name = null) {
  bleOperationBusy = Boolean(busy);
  if (busy) {
    ['#syncTimeBtn','#installBtn','#photoUpload','#countdownUpload','#installFirmwareBtn','#autoRotateSaveBtn'].forEach(selector => {
      const node = $(selector); if (node) node.disabled = true;
    });
    $$('.apply-face').forEach(button => { button.disabled = true; });
    if (name === 'face-upload') $('#liveActivity').textContent = 'Đang truyền và chờ màn E-Ink hoàn tất';
    else if (name === 'select-face') $('#liveActivity').textContent = 'Đang cập nhật màn hình…';
    return;
  }
  if (ble.connected && lastDeviceStatus) updateDeviceStatus(lastDeviceStatus);
  else setDeviceAccess(null);
}

/* R25.10 (mục 4): panel visibility follows the REAL firmware flag
 * (status.time.activated, FF01 byte 33), never a browser-local cache --
 * only the chip itself knows whether it's unlocked. null (unknown -- not
 * connected yet, or old firmware) keeps the panel visible: better to show
 * it unnecessarily than hide it while a real lock is in effect. */
function setActivationPanelVisibility(status) {
  const panel = $('#activationPanel');
  if (!panel) return;
  /* Lệnh Studio (mục E1, 2026-08-26): điều kiện hiện đủ 2 vế -- đang kết
   * nối VÀ chưa kích hoạt. `status` falsy (gọi từ setDeviceOffline() khi
   * mất kết nối) trước bản này rơi vào `undefined === true` -> false ->
   * toggle('hidden', false) LẠI HIỆN panel (ngược hoàn toàn ý muốn) --
   * sửa bằng cách coi "không có status" là một lý do ẩn riêng, không chỉ
   * dựa vào cờ activated. */
  const hide = !status || status?.time?.activated === true;
  panel.classList.toggle('hidden', hide);
  const idNode = $('#activationDeviceId');
  const copyBtn = $('#activationCopyDeviceIdBtn');
  const deviceId = status?.time?.deviceId || null;
  if (idNode) idNode.textContent = deviceId || '-- (kết nối đồng hồ để lấy mã)';
  if (copyBtn) copyBtn.disabled = !deviceId;
}

$('#activationCopyDeviceIdBtn')?.addEventListener('click', async () => {
  const deviceId = lastDeviceStatus?.time?.deviceId;
  if (!deviceId) return;
  try { await navigator.clipboard.writeText(deviceId); toast('Đã sao chép mã thiết bị', 'success'); }
  catch { toast('Không sao chép được -- tự chọn và copy thủ công', 'error'); }
});

$('#activationPasteBtn')?.addEventListener('click', async () => {
  const input = $('#activationCliCode');
  try {
    const text = await navigator.clipboard.readText();
    if (input) input.value = text.trim();
  } catch {
    toast('Không đọc được clipboard -- tự dán bằng Ctrl+V vào ô bên dưới', 'error');
  }
});

$('#activationCliApplyBtn')?.addEventListener('click', async () => {
  const button = $('#activationCliApplyBtn');
  const input = $('#activationCliCode');
  const code = input.value.trim();
  if (!code) { toast('Dán mã kích hoạt trước', 'error'); return; }
  button.disabled = true;
  try {
    const next = await redeemCliActivationCode(ble, code);
    updateDeviceStatus(next);
    input.value = '';
    toast('Đã kích hoạt thiết bị', 'success');
  } catch (error) { reportError(error); }
  finally { button.disabled = false; }
});

function openStudioOffline() {
  connectGate.classList.add('hidden');
  appShell.classList.remove('hidden');
  setDeviceOffline();
  editor.setZoom(window.innerWidth <= 900 ? Math.max(1.45, Math.min(3.25, (window.innerWidth - 58) / editor.project.width)) : 4); updateZoom();
  renderLocalLibrary();
}

function setDeviceOffline() {
  clearInterval(deviceTimer);
  deviceTimer = null;
  $('#deviceLabel').textContent = 'Chưa kết nối';
  $('#deviceName').textContent = 'Chưa kết nối';
  $('#deviceVoltage').textContent = '--';
  $('#deviceTemperature').textContent = '--.-°C';
  $('#deviceTime').textContent = '--';
  $('#deviceState').textContent = 'Chưa kết nối';
  document.querySelector('.device-pill')?.classList.remove('connected');
  $('#connectDeviceBtn').disabled = false;
  $('#connectDeviceBtn').textContent = 'Kết nối';
  $('#disconnectBtn').disabled = true;
  setDeviceAccess(null);
  $$('.apply-face').forEach(button => { button.disabled = true; });
  $('#firmwareUpdatePanel')?.classList.add('hidden');
  selectedFirmwareBin = null;
  selectedFirmwareSig = null;
  if ($('#firmwareBinFile')) $('#firmwareBinFile').value = '';
  if ($('#firmwareSigFile')) $('#firmwareSigFile').value = '';
  updateInstallFirmwareBtnState();
  refreshUiForActivePanel(); // activePanel -> null, giu nguyen editor.project (khong xoa)
  /* Lệnh Studio (mục E1, 2026-08-26): "chưa kết nối -> ẩn hoàn toàn" áp
   * dụng ngay khi mất kết nối, không đợi lần đọc trạng thái kế tiếp --
   * trước bản này #activationPanel giữ nguyên trạng thái hiển thị cũ (có
   * thể vẫn đang mở với device_id/thông tin của lần kết nối trước) cho
   * tới khi ai đó kết nối lại. setActivationPanelVisibility(null) tự hiểu
   * status?.time?.activated là undefined (!== true) -> ẩn, và devices Id
   * rỗng -> khoá nút Sao chép, xoá mã cũ khỏi màn hình. */
  setActivationPanelVisibility(null);
  if ($('#firmwareView')?.classList.contains('active')) refreshFirmwareTab().catch(() => {});
}

async function openConnectedApp(status) {
  if (!status.name?.startsWith(DEVICE.namePrefix)) throw new Error('Sai thiết bị');
  connectGate.classList.add('hidden');
  appShell.classList.remove('hidden');
  $('#deviceLabel').textContent = 'Đã kết nối';
  $('#deviceName').textContent = status.name;
  document.querySelector('.device-pill')?.classList.add('connected');
  $('#connectDeviceBtn').disabled = true;
  $('#connectDeviceBtn').textContent = 'Đã kết nối';
  $('#disconnectBtn').disabled = false;
  updateDeviceStatus(status);
  refreshUiForActivePanel(); // doc ble.deviceInfo -> setActivePanel() -> toan app re-render theo profile (muc 1)
  clearInterval(deviceTimer);
  deviceTimer = setInterval(async () => {
    if (ble.busy) return;
    try { updateDeviceStatus(await ble.readStatus()); } catch { /* disconnected handler */ }
  }, 5000);
  editor.setZoom(window.innerWidth <= 900 ? Math.max(1.45, Math.min(3.25, (window.innerWidth - 58) / editor.project.width)) : 4); updateZoom();
  await renderLocalLibrary();
  if (FEATURES.OTA_MANUAL_FILE) $('#firmwareUpdatePanel')?.classList.remove('hidden');
}

function updateDeviceStatus(status) {
  const time = status.time;
  const bootNames = ['ĐANG KHỞI ĐỘNG','BLUETOOTH SẴN SÀNG','BỘ NHỚ SẴN SÀNG','CẢM BIẾN SẴN SÀNG','MÀN HÌNH SẴN SÀNG','SẴN SÀNG','LỖI MÀN HÌNH','LỖI CẢM BIẾN'];
  $('#deviceName').textContent = status.name || '--';
  $('#deviceVoltage').textContent = status.voltage == null ? '--' : `${status.voltage.toFixed(2)} V`;
  $('#deviceTemperature').textContent = status.temperature == null ? '--.-°C' : `${status.temperature.toFixed(1)}°C`;
  $('#deviceTime').textContent = time?.year ? `${String(time.day).padStart(2,'0')}/${String((time.month ?? 0)+1).padStart(2,'0')}/${time.year} ${String(time.hour).padStart(2,'0')}:${String(time.minute).padStart(2,'0')}:${String(time.second).padStart(2,'0')}` : '--';
  const faceInfo = time?.faceCount ? ` · ${time.faceCount} mặt` : '';
  const bootInfo = time?.bootState == null ? '' : ` · ${bootNames[time.bootState] || `STATE_${time.bootState}`}`;
  const firmwareInfo = time?.firmware ? ` · PHIÊN BẢN ${time.firmware}` : '';
  $('#deviceState').textContent = `Đã kết nối${faceInfo}${bootInfo}${firmwareInfo}`;
  lastDeviceStatus = status;
  markBuiltinFace(time?.faceId ?? 0);
  setDeviceAccess(status);
  setActivationPanelVisibility(status);
  $$('.apply-face').forEach(button => {
    button.disabled = bleOperationBusy || !ble.connected || Number(button.dataset.face) >= (time?.faceCount || 0);
  });
  /* R25.8 (mục 1c): con số RAM dư firmware -- tách riêng, không gộp vào
   * ngưỡng gói/atlas nào cả (đây thuần tuý là số đo tĩnh lúc build, không
   * dùng để chặn gửi gì hết). Chỉ hiện khi thiết bị thật báo về được (đã
   * lên firmware R25.6+); thiết bị cũ hơn thì ẩn hàng này thay vì hiện số
   * sai/0. */
  const ramRow = $('#ramInfoRow');
  if (ramRow) {
    const ram = time?.ramHeadroomBytes;
    ramRow.classList.toggle('hidden', ram == null);
    if (ram != null) $('#ramInfo').textContent = `${(ram/1024).toFixed(2)} KB dư`;
  }
  /* Ngưỡng gói (mục 1a/1b) phụ thuộc lastDeviceStatus -- kết nối xong (hoặc
   * status vừa đổi) phải vẽ lại nhãn ngay, không đợi người dùng sửa gì đó
   * trên canvas mới trigger reportPackage() lần kế tiếp. */
  editor.reportPackage();
  checkBleDiagnostics(time);
  syncAutoRotateFromStatus(time);
  if ($('#firmwareView')?.classList.contains('active')) refreshFirmwareTab().catch(() => {});
}

/* R25.11 (mục 1): chỉ ghi log khi bản ghi chẩn đoán trong FF01 THỰC SỰ
 * thay đổi so với lần đọc trước (so cả reason lẫn faceChangeCount, vì máy
 * có thể ngắt nhiều lần với cùng reason) -- không lặp lại mỗi lần poll.
 * Lưu vào localStorage để còn phân biệt được sau khi tải lại trang. */
const DIAG_SEEN_KEY = 'tnvaLastSeenBleDiag';
function checkBleDiagnostics(time) {
  const diag = time?.diag;
  if (!diag) return;
  const marker = `${diag.disconnectReason}:${diag.faceChangeCount}`;
  const seen = localStorage.getItem(DIAG_SEEN_KEY);
  if (seen === marker) return;
  localStorage.setItem(DIAG_SEEN_KEY, marker);
  if (seen === null) return; // Lần đọc đầu tiên của phiên trình duyệt này -- chỉ ghi mốc, không log (không phải phát hiện mới).
  if (diag.disconnectReason === 0) return; // Đổi chỉ vì faceChangeCount tăng, chưa từng ngắt kết nối -- không phải sự kiện cần báo.
  const described = describeBleDiagnostics(diag);
  /* result:'cancelled' -> entryLevel() đọc thành 'warn' (CẢNH BÁO, vàng) --
   * đúng quy ước log() hiện có (xem entryLevel()): đây là bản ghi CHẨN ĐOÁN
   * đọc lại được, không phải một lỗi thật cần cảnh báo đỏ. */
  log(`Phát hiện bản ghi ngắt BLE mới: ${described.summary}`, {
    operation: 'ble-diag', result: 'cancelled', reason: diag.disconnectReason,
    faceChangeCount: diag.faceChangeCount, timerState: diag.timerState,
    queueState: diag.queueState, epdWaitState: diag.epdWaitState, heapProbe: diag.heapProbe
  });
}

async function connect(sourceButton = $('#connectGateBtn')) {
  const button = sourceButton;
  button.disabled = true;
  button.textContent = 'Đang kết nối';
  $('#gateStatus').textContent = 'Đang tìm thiết bị';
  try {
    const status = await ble.connect();
    await openConnectedApp(status);
    toast('Đã kết nối', 'success');
  } catch (error) {
    if ($('#gateStatus')) $('#gateStatus').textContent = error.message;
    reportError(error);
  } finally {
    if (ble.connected) {
      button.disabled = true;
      button.textContent = 'Đã kết nối';
    } else {
      button.disabled = false;
      button.textContent = 'Kết nối đồng hồ';
    }
  }
}
$('#connectGateBtn').addEventListener('click', event => connect(event.currentTarget));
$('#connectDeviceBtn').addEventListener('click', event => connect(event.currentTarget));
$('#disconnectBtn').addEventListener('click', () => ble.disconnect());

async function tryReconnect() {
  try {
    const status = await ble.reconnectGranted();
    if (status) await openConnectedApp(status);
  } catch { /* gate remains */ }
}
tryReconnect();

function showView(name) {
  $$('.view').forEach(view => view.classList.toggle('active', view.id === `${name}View`));
  $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === name));
  if (name === 'library') renderActiveLibrary();
  if (name === 'device') ble.readStatus().then(updateDeviceStatus).catch(() => {});
  if (name === 'firmware') refreshFirmwareTab().catch(() => {});
}
$$('.tab').forEach(tab => tab.addEventListener('click', () => showView(tab.dataset.view)));

function closeObjectPalette() { const p=$('#objectPalette'); if(!p) return; p.classList.add('hidden'); p.setAttribute('aria-hidden','true'); }
$$('[data-add]').forEach(button => button.addEventListener('click', () => { editor.addElement(button.dataset.add); closeObjectPalette(); }));
$$('#imageInput, .paletteImageInput').forEach(input => input.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try { await editor.addImage(file); closeObjectPalette(); toast('Đã chèn ảnh', 'success'); } catch (error) { reportError(error); }
}));
$('#addObjectBtn')?.addEventListener('click', () => { const p=$('#objectPalette'); p.classList.remove('hidden'); p.setAttribute('aria-hidden','false'); });
$('#closeObjectPalette')?.addEventListener('click', closeObjectPalette);
$('#undoBtn').addEventListener('click', () => editor.undo());
$('#redoBtn').addEventListener('click', () => editor.redo());
$('#copyBtn')?.addEventListener('click', () => { if (editor.copySelected()) toast('Đã sao chép đối tượng', 'success'); });
$('#pasteBtn')?.addEventListener('click', () => { if (editor.pasteSelected()) toast('Đã dán đối tượng', 'success'); });
$('#duplicateBtn').addEventListener('click', () => editor.duplicateSelected());
$('#deleteBtn').addEventListener('click', () => editor.deleteSelected());
$('#layerUpBtn').addEventListener('click', () => editor.moveLayer(1));
$('#layerDownBtn').addEventListener('click', () => editor.moveLayer(-1));
$('#zoomInBtn').addEventListener('click', () => { editor.setZoom(editor.zoom + .5); updateZoom(); });
$('#zoomOutBtn').addEventListener('click', () => { editor.setZoom(editor.zoom - .5); updateZoom(); });
function updateZoom() { $('#zoomLabel').textContent = `${Math.round(editor.zoom * 100)}%`; }

/* R25.12 (mục 7, đề xuất #1): panel "cỡ thật" -- gương 1:1 canvas chính
 * sang #trueSizePreview mỗi khung hình. editor.render() được gọi từ rất
 * nhiều chỗ khác nhau trong editor.js (kéo/thả, đổi thuộc tính, tick đồng
 * hồ xem trước) -- rAF poll là cách rẻ và chắc chắn không bỏ sót khung nào
 * thay vì phải móc vào từng chỗ gọi render(). Zoom mặc định 400% khiến
 * chữ 7px (sàn kỹ thuật thật, xem fontSizeMin ở trên) trông như 28px trên
 * màn hình -- nguồn gốc hợp lý của nhiều báo cáo "chữ vẫn to/rõ" trong khi
 * trên máy thật lại mờ/vỡ nét, đúng như nhiều lần audit resize trước đây. */
const trueSizeCanvas = $('#trueSizePreview');
const trueSizeCtx = trueSizeCanvas?.getContext('2d');
function syncTrueSizePreview() {
  if (trueSizeCtx && editor.canvas && editor.canvas.width > 0 && editor.canvas.height > 0) {
    if (trueSizeCanvas.width !== editor.canvas.width) trueSizeCanvas.width = editor.canvas.width;
    if (trueSizeCanvas.height !== editor.canvas.height) trueSizeCanvas.height = editor.canvas.height;
    trueSizeCtx.imageSmoothingEnabled = false;
    trueSizeCtx.drawImage(editor.canvas, 0, 0);
  }
  requestAnimationFrame(syncTrueSizePreview);
}
requestAnimationFrame(syncTrueSizePreview);
$('#gridBtn').addEventListener('click', event => { editor.setGrid(!editor.grid); event.currentTarget.classList.toggle('active', editor.grid); });
$('#bwBtn').addEventListener('click', event => { editor.setBw(!editor.bw); event.currentTarget.classList.toggle('active', editor.bw); });
$('#snapBtn')?.addEventListener('click', event => { editor.setSnap(!editor.snap); event.currentTarget.classList.toggle('active', editor.snap); });
$('#planePreview')?.addEventListener('change', event => editor.setPreviewPlane(event.target.value));
/* R25.6 (Phase C): used to call editor.setProfile() directly -- which
 * silently rescales every element's x/y/w/h/fontSize by axis-swap ratios
 * (setProfile() in editor.js). That's a real layout-breaking operation, not
 * a cosmetic toggle, so it now needs an explicit confirmation instead of
 * firing on every dropdown change. */
/* R25.12 (Phần B mục 8): đổi HƯỚNG cùng thiết bị vẫn co giãn tỉ lệ như cũ
 * (cảnh báo cũ, không đổi). Đổi SANG thiết bị khác (deviceClass khác) thì
 * cảnh báo MẠNH HƠN hẳn -- không co giãn, toạ độ giữ nguyên số cũ, gần như
 * chắc chắn phải dựng lại bố cục từ đầu. */
/* R26.1 (Task 3): ẩn (không xoá) 2 <option> 400x300/300x400 khỏi bộ chọn
 * panel khi FEATURES.PANEL_420 tắt -- PANEL_PROFILES trong panel_profiles.js
 * giữ nguyên, chỉ lọc ở tầng UI này. */
if (!FEATURES.PANEL_420) {
  $$('#screenProfile option').forEach(option => {
    if (DEVICE.profiles[option.value]?.deviceClass === 'eink42tri') option.hidden = true;
  });
  $('#panel420Tagline')?.classList.add('hidden');
}
$('#screenProfile').addEventListener('change', event => {
  const target = event.target.value;
  const previous = editor.project.profileKey || `${editor.project.width}x${editor.project.height}`;
  if (target === previous) return;
  const targetProfile = DEVICE.profiles[target];
  /* R26.1 (Task 3): phòng trường hợp console/DevTools ép chọn 1 <option>
   * 4.2" đã bị ẩn ở tầng UI (xem init phía dưới) -- chặn ở đây nữa, revert
   * về giá trị cũ. */
  if (!FEATURES.PANEL_420 && targetProfile?.deviceClass === 'eink42tri') {
    event.target.value = previous;
    toast('Thiết bị 4.2" chưa được hỗ trợ trong phiên bản này', 'error');
    return;
  }
  const currentClass = editor.project.deviceClass || 'eink213';
  const targetClass = targetProfile?.deviceClass || 'eink213';
  const deviceChange = currentClass !== targetClass;
  showModal(deviceChange
    ? `<h2>Đổi SANG thiết bị khác?</h2><p class="prop-help">Đây là thiết bị KHÁC (kích thước/số mặt phẳng màu khác hẳn) -- toạ độ mọi đối tượng sẽ giữ NGUYÊN số cũ, KHÔNG tự co giãn theo khung mới. Gần như chắc chắn bạn sẽ phải dựng lại bố cục từ đầu.${targetProfile?.designOnly ? ' Thiết bị này hiện CHỈ HỖ TRỢ THIẾT KẾ, chưa gửi lên máy thật được.' : ''}</p>
      <div class="modal-actions"><button class="btn" id="modalCancel">Hủy</button><button class="btn primary" id="modalConfirm">Vẫn đổi, tôi tự dựng lại bố cục</button></div>`
    : `<h2>Đổi hướng màn hình?</h2><p class="prop-help">Đổi hướng màn hình sẽ cần chỉnh lại bố cục -- các đối tượng sẽ được co giãn tạm theo tỉ lệ, không tự động xoay đẹp.</p>
      <div class="modal-actions"><button class="btn" id="modalCancel">Hủy</button><button class="btn primary" id="modalConfirm">Vẫn đổi</button></div>`);
  $('#modalCancel').onclick = () => { event.target.value = previous; closeModal(); };
  $('#modalConfirm').onclick = () => { editor.setProfile(target); closeModal(); };
});

$$('[data-align]').forEach(button => button.addEventListener('click', () => editor.alignSelected(button.dataset.align)));
$$('[data-nudge]').forEach(button => button.addEventListener('click', () => {
  const [dx,dy] = button.dataset.nudge.split(',').map(Number);
  const step = Number($('#nudgeStepBtn')?.dataset.step || 1);
  editor.nudge(dx,dy,step);
}));
$('#nudgeStepBtn')?.addEventListener('click', event => {
  const next = Number(event.currentTarget.dataset.step || 1) === 1 ? 5 : 1;
  event.currentTarget.dataset.step = String(next); event.currentTarget.textContent = `${next} px`;
});

window.addEventListener('keydown', event => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (!typing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); editor.deleteSelected(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? editor.redo() : editor.undo(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); editor.duplicateSelected(); }
  if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); editor.copySelected(); }
  if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); editor.pasteSelected(); }
  if (!typing && editor.selected && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
    event.preventDefault();
    /* R25.8 (muc 7y/7z): buoc 1px mac dinh, Shift = 10px (truoc la 5px --
     * sua cho dung dung yeu cau). Alt = CHINH KICH THUOC (w/h) thay vi di
     * chuyen (x/y) -- moi phim tat rieng, khong doi hanh vi Move da co san.
     * Ap dung cho MOI loai doi tuong (khong loai tru type nao), khop voi
     * advancedGeometry()/handlePoints() da la generic cho tat ca type. */
    const delta = event.shiftKey ? 10 : 1;
    const selected = editor.selected;
    if (event.altKey) {
      const patch = { w:selected.w, h:selected.h };
      if (event.key === 'ArrowLeft') patch.w -= delta;
      if (event.key === 'ArrowRight') patch.w += delta;
      if (event.key === 'ArrowUp') patch.h -= delta;
      if (event.key === 'ArrowDown') patch.h += delta;
      editor.updateSelected(patch);
    } else {
      const patch = { x:selected.x, y:selected.y };
      if (event.key === 'ArrowLeft') patch.x -= delta;
      if (event.key === 'ArrowRight') patch.x += delta;
      if (event.key === 'ArrowUp') patch.y -= delta;
      if (event.key === 'ArrowDown') patch.y += delta;
      editor.updateSelected(patch);
    }
  }
});

function field(label, key, value, type = 'number', options = {}) {
  if (type === 'range') {
    /* Slider kéo (step theo options.step, mặc định 1) + ô nhập số cạnh bên
     * cùng khóa `data-prop` — hai control tự đồng bộ nhau trong handler ở
     * dưới. Mũi tên = ±step (mặc định trình duyệt), Shift+mũi tên = ±10
     * qua data-role="range-step10" đọc trong wireProps(). */
    const min = options.min != null ? `min="${options.min}"` : '';
    const max = options.max != null ? `max="${options.max}"` : '';
    const step = options.step != null ? options.step : 1;
    const unit = options.unit || '';
    return `<div class="prop ${options.full ? 'full' : ''} range-prop">
      <label>${label}</label>
      <div class="range-row">
        <input data-prop="${key}" data-role="range" type="range" ${min} ${max} step="${step}" value="${escapeHtml(value)}">
        <input data-prop="${key}" data-role="range-number" type="number" ${min} ${max} step="${step}" value="${escapeHtml(value)}" class="range-number">
        ${unit ? `<span class="range-unit">${escapeHtml(unit.trim())}</span>` : ''}
      </div>
    </div>`;
  }
  const attrs = [
    `data-prop="${key}"`, `type="${type}"`, `value="${escapeHtml(value)}"`,
    options.min != null ? `min="${options.min}"` : '', options.max != null ? `max="${options.max}"` : '',
    options.step != null ? `step="${options.step}"` : '',
    options.list ? `list="${escapeHtml(options.list)}"` : '',
    options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ''
  ].filter(Boolean).join(' ');
  return `<div class="prop ${options.full ? 'full' : ''}"><label>${label}</label><input ${attrs}></div>`;
}
function selectField(label, key, value, items, full = false) {
  return `<div class="prop ${full ? 'full' : ''}"><label>${label}</label><select data-prop="${key}">${items.map(([id,name,disabled]) => `<option value="${escapeHtml(id)}" ${String(value)===String(id)?'selected':''} ${disabled?'disabled':''}>${escapeHtml(name)}</option>`).join('')}</select></div>`;
}
function toggleField(label, key, checked, full = true) {
  return `<label class="checkbox-row ${full ? 'full' : ''}"><input data-prop="${key}" type="checkbox" ${checked?'checked':''}><span>${label}</span></label>`;
}
/* Lệnh Studio (Phần F, mục F2, 2026-08-26): panel Thuộc tính gom thành 4
 * accordion (Vị trí & Kích thước / Chữ & Font / Hiệu ứng / Nâng cao) --
 * KHÔNG bớt field nào, chỉ gói lại (đối chiếu docs/thiet-ke-features-
 * before.md ↔ -after.md để xác nhận đủ). `renderInspector()` rebuild TOÀN
 * BỘ #propertyForm sau mỗi thay đổi thuộc tính (xem "R24 bug fix" phía
 * trên) -- nếu không tự nhớ, mọi section người dùng vừa mở tay sẽ tự đóng
 * lại ngay sau khi kéo 1 thanh trượt. `inspectorSectionOpen` (module-scope,
 * sống hết phiên làm việc, không cần bền qua reload trang) + listener
 * 'toggle' gắn 1 LẦN trên #propertyForm (không gắn lại mỗi lần render,
 * 'toggle' không bubble nên bắt ở pha capture -- tham số `true`) lo việc
 * này, cùng cơ chế với .prop-popover ở fontPickerHtml()/textSizePickerHtml(). */
const inspectorSectionOpen = {};
function inspectorSection(id, title, innerHtml, defaultOpen) {
  if (!innerHtml) return '';
  const open = inspectorSectionOpen[id] ?? defaultOpen;
  return `<details class="advanced-props full inspector-section" data-section="${id}" ${open ? 'open' : ''}><summary>${title}</summary><div class="advanced-grid">${innerHtml}</div></details>`;
}
$('#propertyForm')?.addEventListener('toggle', event => {
  const details = event.target;
  if (!(details instanceof HTMLElement) || !details.classList.contains('inspector-section')) return;
  inspectorSectionOpen[details.dataset.section] = details.open;
}, true);

function advancedGeometry(element) {
  return inspectorSection('vi-tri-kich-thuoc', 'Vị trí và kích thước',
    field('X','x',Math.round(element.x),'number',{step:1})+
    field('Y','y',Math.round(element.y),'number',{step:1})+
    field('Rộng','w',Math.round(element.w),'number',{min:1})+
    field('Cao','h',Math.round(element.h),'number',{min:1}),
  false);
}

/* Sample text used to estimate how wide a box needs to be at a given font
 * size — mirrors the defaults editor.js's dynamicSample()/defaultsFor() use,
 * kept local here since app.js doesn't import editor.js internals. */
/* R23: kept in sync with editor.js's defaultsFor()/dynamicSample() sample
 * text -- see docs/FONT_ATLAS_TNVA.md's format-mismatch audit. */
const TEXT_SIZE_DEFAULT_SAMPLE = { date:'27/07/2026', weekday:'Thứ bảy', lunar:'ÂL 10/06', canchi:'Bính Ngọ', holiday:'Tết Nguyên Đán', temperature:'28C', voltage:'3.8V', batteryPercent:'85%', dayOnly:'19', monthOnly:'06', yearOnly:'2026' };
/* R25.12 (mục 5): thông điệp số đếm ký tự + cảnh báo tràn khung -- dùng
 * chung giữa lần dựng form đầu tiên (renderInspector()) và listener 'input'
 * sống trên #propText (không rebuild cả form khi đang gõ, xem chú thích ở
 * chỗ gọi). box lấy từ tham số riêng vì lúc gõ 'live', kích thước khung
 * (element.w/h) không đổi nhưng text đã đổi (đo trên bản nháp {...element,
 * text:control.value}, không phải trên element gốc chưa cập nhật). */
function textMetricsMessage(metrics, box) {
  const overflow = !metrics.fitsWidth || !metrics.fitsHeight;
  if (!overflow) return `${metrics.count} ký tự · ${metrics.maxWidth}×${metrics.totalHeight}px -- vừa khung.`;
  const reasons = [];
  if (!metrics.fitsWidth) reasons.push('chữ rộng hơn khung');
  if (!metrics.fitsHeight) reasons.push('chữ cao hơn khung');
  return `${metrics.count} ký tự · ${metrics.maxWidth}×${metrics.totalHeight}px -- ⚠ TRÀN khung (${Math.round(box.w)}×${Math.round(box.h)}px): ${reasons.join(', ')}. Giảm cỡ chữ, rút ngắn nội dung, hoặc nới khung.`;
}
function textSizeSampleLength(element) {
  if (element.type === 'time') return element.showSeconds ? 8 : 5;
  if (element.type === 'text') return Math.max(3, String(element.text || 'Aa').length);
  return String(element.format || TEXT_SIZE_DEFAULT_SAMPLE[element.type] || 'Aa').length;
}
const TEXT_SIZE_PRESETS = [[16,'Nhỏ'],[26,'Vừa'],[40,'To'],[56,'Siêu to']];
/* Lệnh Studio (mục B1, 2026-08-26): cùng cơ chế popover với fontPickerHtml()
 * ngay trên -- 4 giá trị/px/tên/data-text-size giữ NGUYÊN 100%, chỉ gói lại
 * trong <details class="prop-popover"> để gọn panel. Nếu fontSize hiện tại
 * không khớp đúng 1 trong 4 preset (vd người dùng kéo tay/nhập số khác),
 * hiện thẳng số px thay vì tên -- không bịa nhãn sai. */
function textSizePickerHtml(fontSize) {
  const current = TEXT_SIZE_PRESETS.find(([size]) => size === Number(fontSize||0));
  const currentLabel = current ? `${current[1]} (${current[0]}px)` : `${Math.round(fontSize||0)}px`;
  const grid = `<div class="size-preset-grid">${TEXT_SIZE_PRESETS.map(([size,name])=>`<button type="button" data-text-size="${size}" class="${Number(fontSize||0)===size?'active':''}">${name}<small>${size}px</small></button>`).join('')}</div>`;
  return `<details class="advanced-props prop-popover full"><summary>Cỡ chữ: <b>${escapeHtml(currentLabel)}</b></summary>${grid}</details>`;
}
const TEXT_SIZE_TYPES = new Set(['text','time','date','weekday','lunar','canchi','holiday','temperature','voltage','batteryPercent','dayOnly','monthOnly','yearOnly']);
const CUSTOM_HOUR_FONTS = new Set(['outfit','lobster','pacifico','yellowtail','montez','dancingScript','greatVibes','playball','caveat','kaushan','courgette','classic','lunar']);
/* R23: the atlas-backed fonts render on-device once their glyph atlas is
 * uploaded (see docs/FONT_ATLAS_TNVA.md); until then the device falls back
 * to Outfit. Editor preview always shows the real font either way.
 * R24: montez/yellowtail joined for the digit clock specifically -- TIME_GLYPHS
 * ('0123456789:') has no Vietnamese character in it, so their missing
 * Vietnamese subset (see atlas-generator.js's ATLAS_FONT_HAS_VIETNAMESE)
 * never comes up here even though it rules them out for Vietnamese text
 * fields elsewhere in the picker. */
const ATLAS_HOUR_FONTS = new Set(['dancingScript','greatVibes','playball','montez','yellowtail','caveat','kaushan','courgette','classic','lunar']);
const HOUR_FONT_CHOICES = [
  ['classic','Classic','Có chân, đậm rõ'],
  ['lunar','Lunar','Gọn hiện đại, đủ dấu Việt'],
  ['outfit','Outfit','Gọn, hiện đại'],
  ['lobster','Lobster','Tròn, nổi bật'],
  ['pacifico','Pacifico','Viết tay mềm'],
  ['yellowtail','Yellowtail','Nghiêng cổ điển'],
  ['montez','Montez','Mảnh thanh lịch'],
  ['dancingScript','Dancing Script','Viết tay bay bổng'],
  ['greatVibes','Great Vibes','Thư pháp mảnh'],
  ['playball','Playball','Tròn trịa vui tươi'],
  ['caveat','Caveat','Viết tay đậm'],
  ['kaushan','Kaushan Script','Cọ nghệ thuật'],
  ['courgette','Courgette','Nghiêng mềm mại'],
  ['robotoCondensed','Sans gọn','Dễ đọc'],
  ['dseg','7 đoạn','Điện tử'],
  ['pixel','Pixel','Ô vuông']
];
/* R24: which element types are Vietnamese by construction (their
 * ELEMENT_GLYPHS entry in atlas-generator.js always includes accented
 * characters -- weekday names, holiday names, Can/Chi syllables, the "ÂL"
 * lunar-date marker) vs types that are pure ASCII (time/date/temperature/
 * voltage/batteryPercent -- digits and punctuation only, per the same
 * file) vs "text", where it depends on what the user actually typed. */
const ELEMENT_ALWAYS_VIETNAMESE = new Set(['weekday','holiday','canchi','lunar']);

/* Font-pipeline audit (2026-08-25) — Phần B: chú thích ngắn cho từng font,
 * suy từ HOUR_FONT_CHOICES (mọi font atlas/thời gian đã có sẵn) + bổ sung
 * cho 5 font tĩnh-only (canchiSans/inter/notoMono/georgia/impact) không
 * nằm trong danh sách đó -- 1 nguồn dùng chung cho fontPickerHtml() thay
 * vì mỗi widget tự bịa mô tả riêng. */
const FONT_NOTES = Object.fromEntries(HOUR_FONT_CHOICES.map(([id,,note]) => [id, note]));
Object.assign(FONT_NOTES, {
  canchiSans: 'Khớp Can Chi', inter: 'Sans rõ nét', notoMono: 'Đều nét',
  georgia: 'Cổ điển có chân', impact: 'Tiêu đề đậm',
});

/* Font-pipeline audit (2026-08-25) — Phần B: 1 CONTROL COMPONENT DÙNG
 * CHUNG cho mọi widget có chữ (TEXT_SIZE_TYPES) -- trước đây 'time' có
 * lưới nút preview riêng (digit-font-grid/data-hour-font), mọi loại khác
 * dùng selectField() dropdown phẳng không preview; giờ CẢ HAI gọi đúng 1
 * hàm này. Tái dùng NGUYÊN CSS .digit-font-grid/.clock-font-* đã có (không
 * style mới). `previewText` nên là dynamicSample(element) (editor.js) --
 * đúng chữ mẫu canvas thật sự vẽ, không đoán riêng. `isDisabled(font)` tuỳ
 * chọn (vd cảnh báo thiếu dấu Việt) -- mặc định không font nào bị khoá.
 *
 * Lệnh Studio (mục B2, 2026-08-26): gói lưới trong <details class=
 * "prop-popover"> -- 1 nút gọn hiện tên font đang chọn, bấm mới mở lưới,
 * đóng khi chọn xong hoặc click ra ngoài/Esc (2 việc sau xử lý ở 1
 * listener chung gắn 1 lần trên document, xem "Phần B: đóng popover"
 * phía dưới -- <details> không tự đóng khi bấm ra ngoài). Danh sách
 * font/id/data-font-choice giữ NGUYÊN 100%, không bớt font nào. */
function fontPickerHtml(fontItems, currentFont, previewText, isDisabled = () => false) {
  const currentLabel = (fontItems.find(([font]) => font === currentFont) || [])[1] || currentFont;
  const grid = `<div class="digit-font-grid" aria-label="Chọn font">${fontItems.map(([font,name]) => {
    const disabled = isDisabled(font);
    return `<button type="button" data-font-choice="${font}" class="clock-font-${font} ${currentFont===font?'active':''}" ${disabled?'disabled':''}><b>${escapeHtml(previewText)}</b><span>${escapeHtml(name)}</span><small>${escapeHtml(FONT_NOTES[font]||'')}</small></button>`;
  }).join('')}</div>`;
  return `<details class="advanced-props prop-popover full"><summary>Font: <b>${escapeHtml(currentLabel)}</b></summary>${grid}</details>`;
}

/* Font-pipeline audit (2026-08-25) — Phần A: editor.fontReadyWarning (đặt
 * bởi checkSelectedFontReady() trong editor.js) chỉ mang TÊN FAMILY CSS
 * (vd "TNVA Kaushan Script"), không phải font key -- so khớp qua
 * FONT_FAMILY_CSS[element.font] thay vì so ngược lại. CẤM fallback im
 * lặng: hiện rõ ràng thay vì lặng lẽ vẽ bằng font khác. */
function fontReadyWarningHtml(element) {
  if (!editor.fontReadyWarning || !ATLAS_FONTS.has(element.font)) return '';
  if (FONT_FAMILY_CSS[element.font] !== editor.fontReadyWarning) return '';
  return `<div class="prop full"><small class="prop-help prop-warning">⚠ Font "${escapeHtml(editor.fontReadyWarning)}" chưa tải xong trong trình duyệt -- bản xem trước có thể đang tạm hiện font khác. Đợi vài giây hoặc chọn lại font này; nếu vẫn vậy, tải lại trang.</small></div>`;
}

function firmwareAtLeast(value, wanted = [2,1,10]) {
  const found=String(value||'').match(/(\d+)\.(\d+)\.(\d+)/);
  if(!found) return false;
  const current=found.slice(1,4).map(Number);
  for(let i=0;i<3;i++){if(current[i]!==wanted[i]) return current[i]>wanted[i];}
  return true;
}

function renderInspector(element) {
  const empty = $('#emptyInspector');
  const form = $('#propertyForm');
  if (!element) { empty.classList.remove('hidden'); form.classList.add('hidden'); form.innerHTML = ''; return; }
  empty.classList.add('hidden'); form.classList.remove('hidden');

  let html = `<div class="object-summary full"><div><span>${layerIcon(element.type)}</span><b>${escapeHtml(TYPE_LABELS[element.type] || element.type)}</b></div><small>${Math.round(element.w)}×${Math.round(element.h)} px</small></div>`;
  html += field('Tên lớp', 'name', element.name || '', 'text', { full:true });
  /* Phần F (mục F2): nội dung 2 khối type-specific dưới đây được gom vào
   * accumulator riêng thay vì nối thẳng vào `html`, để cuối hàm gói mỗi
   * khối trong 1 accordion ("Chữ & Font"/"Hiệu ứng") -- không đổi BẤT KỲ
   * điều kiện/thứ tự field nào bên trong, chỉ đổi chỗ `html +=` thành
   * `htmlText +=`/`htmlEffects +=`. Đối chiếu docs/thiet-ke-features-
   * before.md ↔ -after.md để xác nhận không mất field nào. */
  let htmlText = '';
  let htmlEffects = '';

  if (TEXT_SIZE_TYPES.has(element.type)) {
    const staticText = element.type === 'text';
    /* R24: font script (Dancing Script/Great Vibes/Playball/Montez/Yellowtail)
     * were only ever offered for the "time" field -- everything else stayed
     * on the compiled 1-bit pixel fonts even though the atlas pipeline
     * itself (collectFaceAtlasNeed() in atlas-generator.js) already handles
     * every element type generically. Montez/Yellowtail individually stay
     * disabled (not hidden -- picker shows why) wherever the field is
     * Vietnamese by construction or, for static text, currently contains
     * non-ASCII characters -- see ATLAS_FONT_HAS_VIETNAMESE's measured
     * cmap results. */
    const elementNeedsVietnamese = staticText
      ? containsNonAsciiText(element.text)
      : ELEMENT_ALWAYS_VIETNAMESE.has(element.type);
    /* Font-pipeline audit (2026-08-25): chữ mẫu trong nút chọn font -- dùng
     * ĐÚNG dynamicSample() (editor.js) cho mọi widget động, khớp 100% với
     * chữ canvas thật sự vẽ. 'text' không có dynamicSample() (chỉ trả '' --
     * không phải widget động) nên dùng nội dung người dùng đã gõ. */
    const fontPreviewText = staticText ? (element.text || 'Chữ mẫu') : dynamicSample(element);
    const isFontDisabled = font => elementNeedsVietnamese && ATLAS_FONT_HAS_VIETNAMESE[font] === false;
    const scriptFontItems = HOUR_FONT_CHOICES
      .filter(([font]) => ATLAS_HOUR_FONTS.has(font) && !(staticText && ['classic','lunar'].includes(font)))
      .map(([font,name]) => [font, name]);
    const fontItems = (staticText
      /* R25.12 (mục 5): 'canchiSans' MỚI -- vẽ bằng đúng bảng bitmap sfont
       * 14px mà Can Chi dùng, mặc định cho Chữ mới tạo. 'robotoCondensed'
       * (ctx.font trình duyệt, diện mạo khác) giữ nguyên cho face cũ đã
       * chọn nó, đổi nhãn để phân biệt rõ với lựa chọn mới. */
      ? [['pixel','Pixel 1-bit'],['canchiSans','Sans gọn (khớp Can Chi)'],['classic','Classic · có chân'],['lunar','Lunar · hiện đại'],['robotoCondensed','Sans gọn (trình duyệt)'],['inter','Sans rõ'],['notoMono','Mono'],['georgia','Có chân'],['impact','Tiêu đề đậm'],['dseg','Số điện tử']]
      : [['pixel','Pixel 1-bit'],['robotoCondensed','Chữ đồng hồ'],['dseg','Số điện tử']]
    ).concat(scriptFontItems);

    if (element.type === 'text') {
      /* R25.12 (mục 5): số đếm ký tự + cảnh báo tràn khung -- đo bằng CHÍNH
       * XÁC công thức editor vẽ (staticTextMetrics(), không đoán riêng ở
       * đây). Đổi cỡ/font/khung thì renderInspector() rebuild lại nên tự
       * khớp; riêng lúc GÕ vào textarea, onSelection() cố tình BỎ QUA rebuild
       * toàn form để không mất focus/con trỏ giữa chừng (xem chú thích
       * "R24 bug fix" ở khai báo `editor` phía trên) -- #textMetricsInfo vì
       * vậy được cập nhật riêng bằng listener 'input' ngay dưới, KHÔNG qua
       * renderInspector(). */
      const metrics = editor.staticTextMetrics(element);
      const overflow = !metrics.fitsWidth || !metrics.fitsHeight;
      htmlText += `<div class="prop full"><label>Nội dung</label><textarea id="propText" data-prop="text">${escapeHtml(element.text || '')}</textarea></div>`;
      htmlText += `<div class="prop full"><small id="textMetricsInfo" class="prop-help${overflow ? ' prop-warning' : ''}">${textMetricsMessage(metrics, element)}</small></div>`;
      /* Widget Chữ nhiều dòng audit (2026-08-25): Enter trong textarea ở
       * trên đã là ngắt dòng thật (\n, textarea gốc trình duyệt) -- tự
       * xuống hàng khi vượt khung do resolveTextLines()/drawText() lo,
       * không cần control riêng. Line-height + font/size riêng từng dòng
       * CHỈ áp cho font ctx.font thường (không phải 'pixel'/'canchiSans' --
       * hai bảng bitmap đó không có khái niệm trộn font khác nhau từng
       * dòng, giữ nguyên hành vi 1-font-cho-cả-khối như trước). */
      if (element.font !== 'pixel' && element.font !== 'canchiSans') {
        htmlText += field('Giãn dòng','lineHeightMult',element.lineHeightMult || 1.12,'range',{min:.8,max:2.5,step:.05,full:true,unit:'×'});
        const textLines = String(element.text || '').split('\n');
        if (textLines.length > 1) {
          const lineFontItems = [['','(mặc định)']].concat(fontItems);
          htmlText += `<div class="prop full"><label>Font/cỡ riêng từng dòng</label><div class="line-style-rows">${textLines.map((line, index) => {
            const override = element.lineStyles?.[index] || {};
            const preview = escapeHtml(line || `(dòng ${index + 1} trống)`).slice(0, 24);
            return `<div class="line-style-row">
              <small title="${escapeHtml(line)}">${preview}</small>
              <select data-line-font="${index}">${lineFontItems.map(([id,name]) => `<option value="${escapeHtml(id)}" ${String(override.font||'')===String(id)?'selected':''}>${escapeHtml(name)}</option>`).join('')}</select>
              <input type="number" data-line-size="${index}" min="6" max="80" step="1" placeholder="${element.fontSize||12}" value="${override.fontSize||''}">
            </div>`;
          }).join('')}</div></div>
          <div class="prop full"><small class="prop-help">Để trống = dùng font/cỡ chữ chung của khối (bên dưới). Danh sách này tự khớp lại số dòng sau khi bấm ra ngoài ô Nội dung.</small></div>`;
        }
      }
    }

    if (element.type === 'time') {
      htmlText += fontPickerHtml(HOUR_FONT_CHOICES.map(([font,name]) => [font,name]), element.font, fontPreviewText);
      const supportsEffect = CUSTOM_HOUR_FONTS.has(element.font);
      const isAtlasFont = ATLAS_HOUR_FONTS.has(element.font);
      const effectValue = element.digitEffect === '3d' ? 'light' : (element.digitEffect || 'normal');
      htmlText += `<div class="digit-effect-grid full"><label>Hiệu ứng số giờ</label><div>
        <button type="button" data-hour-effect="normal" class="${effectValue==='normal'?'active':''}">Phẳng</button>
        <button type="button" data-hour-effect="light" class="${effectValue==='light'?'active':''}" ${supportsEffect?'':'disabled'}>Nổi nhẹ</button>
        <button type="button" data-hour-effect="bold" class="${effectValue==='bold'?'active':''}" ${supportsEffect?'':'disabled'}>Nổi đậm</button>
      </div><small>${supportsEffect
        ? (isAtlasFont ? 'Đổ bóng được nướng sẵn vào atlas — khớp đúng thiết bị sau khi tải atlas lên.' : 'Cả ba kiểu được vẽ thật trên đồng hồ (nhẹ và đậm hiện cùng một độ nổi cố định của máy).')
        : 'Hiệu ứng nổi dùng với 8 font số mới.'}</small></div>`;
      /* R25.8 (mục 4q): hướng bóng chỉ chọn được cho font nướng-atlas --
       * font sfont/device vẽ thật trên chip luôn cố định xuống-phải
       * (draw_scalable_clock_text() trong face_custom.c), đổi ở đây không
       * tác dụng gì với chúng nên ẩn hẳn thay vì hiện nút không làm gì. */
      if (isAtlasFont) {
        const dirValue = ['dr','dl','ur','ul'].includes(element.digitEffectDir) ? element.digitEffectDir : 'dr';
        const dirDisabled = effectValue === 'normal';
        htmlText += `<div class="digit-effect-grid full"><label>Hướng bóng</label><div>
          <button type="button" data-hour-effect-dir="ul" class="${dirValue==='ul'?'active':''}" ${dirDisabled?'disabled':''} title="Lên-trái">↖</button>
          <button type="button" data-hour-effect-dir="ur" class="${dirValue==='ur'?'active':''}" ${dirDisabled?'disabled':''} title="Lên-phải">↗</button>
          <button type="button" data-hour-effect-dir="dl" class="${dirValue==='dl'?'active':''}" ${dirDisabled?'disabled':''} title="Xuống-trái">↙</button>
          <button type="button" data-hour-effect-dir="dr" class="${dirValue==='dr'?'active':''}" ${dirDisabled?'disabled':''} title="Xuống-phải">↘</button>
        </div></div>`;
      }
      htmlText += toggleField('Hiện giây','showSeconds',element.showSeconds);
    }

    htmlText += textSizePickerHtml(element.fontSize);

    if (element.type !== 'time') {
      htmlText += fontPickerHtml(fontItems, element.font, fontPreviewText, isFontDisabled);
      if (isFontDisabled(element.font)) {
        const fontLabel = (HOUR_FONT_CHOICES.find(item => item[0] === element.font) || [])[1] || element.font;
        htmlText += `<div class="prop full"><small class="prop-help prop-warning">Font "${escapeHtml(fontLabel)}" thiếu dấu tiếng Việt (đo trực tiếp từ file — xem atlas-generator.js) — chữ có dấu sẽ mất ký tự trên đồng hồ. Đổi font khác hoặc bỏ dấu nội dung.</small></div>`;
      }
    }
    htmlText += fontReadyWarningHtml(element);
    htmlText += `<div class="prop full"><small class="prop-help">${staticText
      ? (ATLAS_HOUR_FONTS.has(element.font) ? 'Font script — nướng vào atlas, khớp đúng thiết bị sau khi tải atlas lên.' : 'Font được đóng vào gói.')
      : element.type === 'time' ? 'Font số được nhúng trong firmware, bản xem trước và đồng hồ dùng chung nét 1-bit.'
      : ATLAS_HOUR_FONTS.has(element.font) ? 'Font script — nướng vào atlas (đủ mọi giá trị field này có thể hiện), khớp đúng thiết bị sau khi tải atlas lên.'
      : 'Font có sẵn trên đồng hồ.'}</small></div>`;
    /* R25.10 (mục 2g/2h): sàn 5px trước đây SAI cho font bitmap đồng hồ --
     * device-fonts.js's scaledBitmapTextWidth()/drawScaledBitmapText() tự
     * áp Math.max(7, ...) bên trong (khớp firmware's draw_scalable_clock_
     * text(): if(target_h<7) target_h=7), nên kéo xuống 5-6 không có tác
     * dụng gì, im lặng. Font atlas (script) có sàn RIÊNG, lớn hơn nhiều
     * (ATLAS_MIN_SCRIPT_PX=22, nét mảnh vỡ dưới mức đó).
     * R25.12 (audit resize lần 3, mục 1e): SAI TƯƠNG TỰ cho MỌI đối tượng
     * động khác (date/weekday/lunar/voltage/canchi/holiday/temperature/
     * batteryPercent/Chữ) -- trước đây "Cỡ chữ" hoàn toàn KHÔNG CÓ TÁC
     * DỤNG cho các loại này trên máy thật (root cause chính đợt này, xem
     * draw_text_descriptor() trong face_custom.c) nên sàn 5px "đúng" chỉ
     * vì không có gì để sai cả -- giờ đã sửa firmware để "Cỡ chữ" thật sự
     * co giãn (epd_draw_scaled_text(), epd_gui.c), và hàm đó CŨNG kẹp sàn
     * 7px giống hệt font bitmap đồng hồ (cùng một lý do: nét 1-bit vỡ dưới
     * mức đó) -- sàn UI phải khớp theo, không còn là 5px nữa. */
    const isBitmapClock = element.type === 'time' && isClockBitmapFont(element.font);
    /* R25.12-hotfix (mất chân chữ dưới 14px): TRƯỚC ĐÂY chỉ kẹp sàn
     * ATLAS_MIN_SCRIPT_PX (22px, nét mảnh vỡ dưới mức đó sau 1-bit) cho
     * widget 'time' -- MỌI type khác (text/canchi/holiday/weekday/...)
     * chọn cùng font script rơi vào sàn 7px/5px không liên quan, kéo được
     * xuống 10-14px và trực tiếp lộ bug cắt chân chữ (rasterizeGlyph(),
     * atlas-generator.js, đã vá riêng). Sàn 22px là giới hạn kỹ thuật của
     * CHÍNH FONT đó (rasterize ở cellPx nhỏ), không phải đặc thù của
     * widget 'time' -- bỏ ràng buộc loại, áp cho MỌI type dùng font
     * script. */
    const isAtlasClock = ATLAS_HOUR_FONTS.has(element.font);
    const isScalableDynamic = element.type !== 'time' && DYNAMIC_TYPES.has(element.type)
      && !['calendar','calendarWeek','weekStrip'].includes(element.type);
    /* R25.12 (mục 5): 'text'+'canchiSans' đi qua CÙNG bảng bitmap sfont
     * (Math.max(7,...) trong scaledBitmapTextWidth()) như mọi đối tượng
     * động khác -- sàn 7px là giới hạn kỹ thuật THẬT, không phải 5px tuỳ
     * tiện của nhánh ctx.font (font khác của 'text' vẫn giữ sàn 5px cũ,
     * ctx.font không có giới hạn kỹ thuật đo được nào ở đây).
     * R25.12 (audit resize lần 3, mục 1c, khoảng trống còn sót lại): 'text'+
     * 'pixel' CŨNG có sàn cứng 7px y hệt -- drawText()'s nhánh pixel dùng
     * `scale = clamp(Math.floor((fontSize+3)/7),1,8)`, scale=1 (sàn) đã là
     * glyph 5×7 gốc, không có cách nào vẽ nhỏ hơn (không phải nội suy, là
     * bảng bit tay cố định) -- kéo xuống 5-6 im lặng không đổi gì, cùng lớp
     * lỗi với các trường hợp trên, chỉ chưa được gộp vào điều kiện này. */
    const isCanChiMatchText = element.type === 'text' && (element.font === 'canchiSans' || element.font === 'pixel');
    /* Font-pipeline audit (2026-08-25): sàn 6px cho nhánh KHÔNG có giới hạn
     * kỹ thuật đo được (ctx.font tự do, vd 'inter'/'georgia') -- khớp yêu
     * cầu gốc "6-80px". Hai nhánh CÒN LẠI (7px cho bảng bitmap co giãn,
     * atlasFontMinPx() cho font script nướng atlas) GIỮ NGUYÊN sàn kỹ thuật
     * thật đã đo -- hạ xuống 6 một cách giả tạo sẽ tái phát đúng lỗi nét
     * vỡ/chân chữ mất đã sửa ở đợt kiểm tra pipeline stride trước. */
    const fontSizeMin = isAtlasClock ? atlasFontMinPx(element.font) : (isBitmapClock || isScalableDynamic || isCanChiMatchText) ? 7 : 6;
    htmlText += field('Cỡ chữ','fontSize',element.fontSize,'range',{min:fontSizeMin,max:80,step:1,full:true,unit:' px'});
    if (isBitmapClock || isScalableDynamic || isCanChiMatchText) {
      const is213 = Number(editor.project?.planes || 1) !== 2 && (!editor.project?.deviceClass || editor.project.deviceClass === 'eink213');
      htmlText += `<div class="prop full"><small class="prop-help">${is213
        ? 'Màn 2.13\": cỡ 7–10px dùng nét 5×7 nguyên bản cho số/ký tự ASCII; chữ Việt và cỡ 11–13px dùng nét gốc 14px. Không co bitmap nên bản xem trước và đồng hồ khớp nhau.'
        : `Chữ nhỏ nhất đọc được là ${fontSizeMin}px -- nét 1-bit vỡ dưới mức đó.`}</small></div>`;
    }
    else if (isAtlasClock) htmlText += `<div class="prop full"><small class="prop-help">Font nướng atlas nhỏ nhất đọc được là ${fontSizeMin}px.</small></div>`;
    /* Chỉ chữ tĩnh mới có độ đậm thật: nó được trình duyệt tô thẳng vào ảnh
       nền 1-bit. Lớp động do firmware vẽ bằng font bitmap, không có nét đậm. */
    if (staticText) htmlText += selectField('Độ đậm','weight',element.weight,[['400','Regular'],['600','Semi Bold'],['700','Bold'],['800','Extra Bold']]);
    htmlText += selectField('Canh lề','align',element.align,[['left','Trái'],['center','Giữa'],['right','Phải']]);
    htmlText += toggleField('Đảo nền chữ','inverse',Boolean(element.inverse));
  }
  html += inspectorSection('chu-font', 'Chữ & Font', htmlText, true);

  if (element.type === 'battery') {
    /* R24: icon pin vốn đã vẽ vector cả hai phía -- web preview
       (FaceEditor.drawBattery() ở trên, strokeRect/fillRect theo w/h) lẫn
       firmware (draw_battery_descriptor() trong face_custom.c, cũng dựng
       hình theo w/h chứ không có bảng bitmap cố định nào) -- chỉ thiếu một
       control kéo kích thước rõ ràng thay vì phải mở "Vị trí và kích thước"
       bên dưới. Trượt theo chiều cao, rộng luôn ăn theo tỉ lệ 2:1 mặc định
       (24×12) để icon không bị méo. */
    htmlEffects += field('Kích thước','h',element.h,'range',{min:5,max:40,step:1,full:true,unit:' px'});
    htmlEffects += `<div class="prop full"><small class="prop-help">Vẽ vector khi hiển thị — thu nhỏ vẫn đọc được mức pin, không phải ảnh bitmap dựng sẵn.</small></div>`;
  }

  if (element.type === 'calendar' || element.type === 'calendarWeek') {
    /* Chỉ còn hai lựa chọn mà firmware thật sự phân biệt. Bốn lựa chọn cũ
       ("7 ô ngày · cao/ngắn", "Lịch dọc", "Lịch dọc gọn") vẽ ra y hệt nhau
       trên máy, nên đã bỏ. Muốn dải 7 thẻ thì dùng đối tượng "Lịch tuần thẻ". */
    htmlEffects += selectField('Kiểu lịch','calendarType',element.calendarType || 0,[
      ['0','Tháng — có tiêu đề'],['5','Tháng — không tiêu đề']
    ],true);
    /* R25.11 (mục 7): trước đây "Cỡ chữ" là control giả (firmware không đọc
       font_size cho lịch) — thay bằng lựa chọn FONT thật, khớp cf_draw_month()
       trong face_custom.c. Tự động = hành vi 2 tầng pixel cũ, không đổi gì
       cho face đã lưu (giá trị mặc định 0). */
    htmlEffects += selectField('Font chữ ngày','calendarFontChoice',element.calendarFontChoice || 0,[
      ['0','Tự động (pixel, theo kích thước ô)'],
      ['1','Luôn pixel (3×5/5×7 mảnh)'],
      ['2','Roboto Condensed (khi ô đủ to)']
    ],true);
    try {
      const geo = calendarGeometry(element);
      const willDraw = geo.useSfont ? 'chữ Roboto Condensed 14px rõ nét'
        : geo.large ? 'chữ 5×7 nét' + (geo.twoCharLabels ? ', nhãn CN T2…' : ', nhãn C 2 3…')
                    : 'chữ 3×5 mảnh — kéo khung cao thêm để nét hơn';
      const sfontHint = Number(element.calendarFontChoice) === 2 && !geo.useSfont
        ? ' · cần ô ≥16×16px mới đủ chỗ cho Roboto Condensed, đang tự rơi về tầng pixel'
        : '';
      htmlEffects += `<div class="prop full"><label>Máy sẽ vẽ</label><small class="prop-help">Ô ${geo.cellW}×${geo.cellH} px · ${willDraw}${sfontHint}</small></div>`;
    } catch (error) { console.error('calendarGeometry:', error); }
  }

  if (element.type === 'image') {
    htmlEffects += `<div class="full image-source-actions"><button id="replaceImageBtn" class="btn">Đổi ảnh</button><button id="openBitmapForImageBtn" class="btn">Chấm từng điểm</button></div>`;
    htmlEffects += field('Phóng ảnh','imageScale',element.imageScale || 1,'range',{min:.05,max:5,step:.01,full:true});
    htmlEffects += field('Lệch X','imageOffsetX',element.imageOffsetX || 0,'number',{step:1}) + field('Lệch Y','imageOffsetY',element.imageOffsetY || 0,'number',{step:1});
    htmlEffects += field('Ngưỡng','threshold',element.threshold || 150,'range',{min:0,max:255,step:1,full:true});
    htmlEffects += field('Tương phản','contrast',element.contrast || 1.15,'range',{min:.3,max:3,step:.05,full:true});
    htmlEffects += field('Độ sáng','brightness',element.brightness || 0,'range',{min:-100,max:100,step:1,full:true});
    htmlEffects += selectField('Phối điểm','dither',element.dither,[['ordered','Ordered 4×4'],['floyd','Floyd–Steinberg'],['none','Đen trắng thuần']],true);
    htmlEffects += toggleField('Đảo màu đen trắng','invert',Boolean(element.invert));
    htmlEffects += `<div class="full action-group"><button id="fitImageBtn" class="btn">Vừa khung</button><button id="fillImageBtn" class="btn">Phủ kín</button><button id="resetImageBtn" class="btn">Đặt lại</button></div>`;
    /* PHẦN 5 -- chỉ hiện cho ảnh chèn từ "Trang trí Tết" (element.decorationId
     * do addDecoration() gắn). Đổi cỡ = thay bằng bitmap 1:1 cỡ khác đã
     * dựng sẵn (sắc nét), KHÔNG phải co giãn ảnh hiện có (mờ nét). */
    const decoItem = element.decorationId ? tetDecorationById(element.decorationId) : null;
    if (decoItem) {
      htmlEffects += `<div class="prop full"><label>Cỡ trang trí Tết · ${escapeHtml(decoItem.label)}</label><div class="size-preset-grid full">${decoItem.sizes.map(s=>`<button type="button" data-decor-size="${s.key}" class="${element.decorationSize===s.key?'active':''}">${s.label}<small>${s.w}×${s.h}px</small></button>`).join('')}</div></div>`;
    }
  }

  if (element.type === 'shape') {
    htmlEffects += selectField('Loại hình','shapeKind',element.shapeKind || 'roundRect',[
      ['circle','Hình tròn / elip'],['square','Hình vuông / chữ nhật'],['triangle','Tam giác'],['diamond','Hình thoi'],['star','Ngôi sao'],['heart','Trái tim'],['progress','Thanh tiến độ'],['line','Đường thẳng'],['battery','Viền pin'],['roundRect','Vuông bo góc'],['roundRectFill','Vuông fill bo góc']
    ],true);
    if (element.shapeKind === 'progress') htmlEffects += field('Mức tiến độ','progressPct',element.progressPct ?? 68,'range',{min:0,max:100,step:1,full:true,unit:'%'});
    htmlEffects += field('Độ dày nét','lineWidth',element.lineWidth || 1,'range',{min:1,max:8,step:1,full:true,unit:' px'});
    htmlEffects += field('Bo góc','radius',element.radius || 6,'range',{min:0,max:30,step:1,full:true,unit:' px'});
    htmlEffects += toggleField('Tô đen','fill',Boolean(element.fill));
  }

  if (element.type === 'line' || element.type === 'rect' || element.type === 'legacyShape') {
    htmlEffects += field('Độ dày nét','lineWidth',element.lineWidth || 1,'range',{min:1,max:8,step:1,full:true,unit:' px'});
  }

  if (element.type === 'line') {
    /* R25.12 (mục 2): 'smooth' (mặc định cho face đã lưu trước bản vá này)
     * = cách vẽ CŨ, canvas tự khử răng cưa quanh nét mảnh -- khi kéo dài,
     * pixel mép xám bị ngưỡng 1-bit nhận/loại không đều theo từng đoạn,
     * nhìn như cong lượn trên máy thật dù dữ liệu vẫn là 1 đường thẳng.
     * 'crisp' (MỚI, mặc định cho đường kẻ mới tạo) = tự vẽ từng pixel theo
     * Bresenham, luôn đen/trắng tuyệt đối, luôn thẳng bất kể độ dài/góc. */
    htmlEffects += selectField('Kiểu vẽ','lineStyle',element.lineStyle || 'smooth',[
      ['smooth','Mượt (cũ -- có thể cong khi kéo dài)'],
      ['crisp','Thẳng (mới -- luôn thẳng, khuyên dùng)']
    ],true);
    htmlEffects += `<div class="prop full"><small class="prop-help">${element.lineStyle === 'crisp'
      ? 'Vẽ từng pixel thẳng tuyệt đối (Bresenham) -- không bị cong dù kéo dài hay xoay góc.'
      : 'Cách vẽ cũ, giữ để không đổi diện mạo face đã lưu trước đây -- có thể hiện cong/răng cưa khi đường kéo dài trên máy thật. Đổi sang "Thẳng" nếu gặp lỗi này.'
    }</small></div>`;
    htmlEffects += `<div class="prop full"><small class="prop-help">Giữ <b>Shift</b> khi kéo đầu đường trên khung thiết kế để khoá thẳng tuyệt đối ngang/dọc.</small></div>`;
  }

  if (element.type === 'invertRegion') {
    /* Vùng tô audit (2026-08-25): mở rộng từ chỉ-tô-đen sang 4 chế độ --
     * xem drawInvertRegion()/isInsideInvertRegion() (editor.js) cho phần
     * vẽ + auto-đảo chữ thật. fillMode thiếu (face cũ lưu trước bản này)
     * = 'black' đúng hành vi cũ, không đổi diện mạo face đã lưu. */
    const fillMode = element.fillMode || 'black';
    htmlEffects += selectField('Kiểu tô','fillMode',fillMode,[
      ['black','Đen đặc'],['white','Trắng đặc (đè lên nền đen)'],
      ['outline','Viền (chỉ đường bao)'],['invert','Đảo màu (đảo pixel đã có)']
    ],true);
    htmlEffects += field('Bo góc','radius',element.radius || 0,'range',{min:0,max:30,step:1,full:true,unit:' px (0 = vuông)'});
    if (fillMode === 'outline') {
      htmlEffects += field('Độ dày viền','borderWidth',element.borderWidth || 2,'range',{min:1,max:5,step:1,full:true,unit:' px'});
    }
    const coverage = (element.w * element.h) / (editor.project.width * editor.project.height);
    /* R25.9 (mục 12ww/xx/aaa): cảnh báo mảng đen lớn làm chậm refresh/dễ
     * bóng ma -- chỉ còn ý nghĩa cho 2 chế độ THẬT SỰ phủ đen một vùng lớn
     * ('black' luôn, 'invert' chỉ khi nền dưới nó đã trắng -- không đo
     * được trước nên vẫn cảnh báo cho chắc); 'white'/'outline' không tạo
     * thêm mảng đen lớn nào cả. */
    const blackHeavy = fillMode === 'black' || fillMode === 'invert';
    htmlEffects += `<div class="prop full"><small class="prop-help">${fillMode === 'white'
      ? 'Tô trắng, đè lên được nền đen vẽ trước nó (đúng thứ tự lớp) -- dùng để "khoét chữ" trên nền đen. Đối tượng chữ nằm trên vùng này vẽ CHỮ ĐEN bình thường (không tự đảo).'
      : fillMode === 'outline'
      ? 'Chỉ vẽ viền, giữa trong suốt -- không đổi màu chữ/nội dung bên trong.'
      : fillMode === 'invert'
      ? 'Đảo pixel TĨNH đã vẽ trước nó trong vùng này (đúng theo hình bo góc). Đối tượng chữ động (giờ/thứ/...) nằm trên vùng này tự vẽ trắng, không cần bật "Đảo nền chữ" thủ công.'
      : 'Đối tượng có tâm nằm trong vùng này (và xếp trên nó trong danh sách lớp) tự động vẽ trắng, không cần bật "Đảo nền chữ" thủ công.'
    }${blackHeavy && coverage > 0.5 ? ' <b class="prop-warning">⚠ Vùng này chiếm hơn nửa màn hình -- mảng đen lớn làm E-Ink refresh lâu hơn và dễ để lại bóng ma.</b>' : ''}</small></div>`;
    htmlEffects += `<div class="prop full"><small class="prop-help">Đổi thứ tự vẽ (đè lên/xuống dưới đối tượng khác) bằng nút ↑/↓ ở khung "Lớp" bên dưới.</small></div>`;
  }

  if (element.type === 'weekStrip') {
    /* R25.10 (mục 2b): thêm cảnh báo rõ ràng khi khung quá hẹp (khớp đúng
     * ngưỡng thật cf_draw_week_strip() dùng, face_clock_common.c: cell<16
     * hoặc h<24 thì firmware không vẽ gì).
     * R25.11 (mục 5): thêm control cỡ chữ THẬT cho số ngày -- trước đây
     * hoàn toàn tự động theo kích thước khung, không có cách nào chỉnh
     * riêng ("chọn mà không chỉnh được nhỏ/to hơn" đúng như báo cáo). Nhân
     * vào công thức tự tính có sẵn (day_h) trong cf_draw_week_strip(),
     * KHÔNG đổi nhãn thứ/tháng/dòng âm lịch (giữ nguyên như cũ). */
    const cell = Math.floor(element.w / 7);
    const tooSmall = cell < 16 || element.h < 24;
    htmlEffects += `<div class="prop full"><small class="prop-help">${tooSmall
      ? '<b class="prop-warning">⚠ Khung quá hẹp -- máy sẽ không vẽ gì cả. Cần tối thiểu ~112×24px (đang ' + Math.round(element.w) + '×' + Math.round(element.h) + 'px).</b>'
      : `Ô ${cell}×${Math.round(element.h)}px · ${element.h >= 53 ? 'cỡ số ngày TO (7 đoạn)' : 'cỡ số ngày vừa (chữ pixel)'}${element.h - (element.h >= 53 ? 21 : 14) - 11 >= 9 ? ', đủ chỗ dòng âm lịch' : ', không đủ chỗ dòng âm lịch'}`
    }</small></div>`;
    htmlEffects += field('Cỡ số ngày','sizePct',element.sizePct || 100,'range',{min:50,max:200,step:10,full:true,unit:'%'});
    htmlEffects += selectField('Font lịch tuần','weekFont',element.weekFont || 'lunar',[
      ['lunar','Lunar · hiện đại'],['classic','Classic · có chân'],
      ['pixel','Pixel · vuông'],['device','Nét thiết bị cũ']
    ],true);
    htmlEffects += `<div class="prop full"><small class="prop-help">Classic/Lunar áp dụng ngay cho phần thiết kế và ảnh kho web. “Nét thiết bị cũ” dùng khi cần đối chiếu bản DA14585 hiện tại.</small></div>`;
    htmlEffects += `<div class="prop full"><small class="prop-help">100% = tự động theo khung (như cũ). Chỉ đổi cỡ SỐ NGÀY, không đổi nhãn thứ/tháng/dòng âm lịch.</small></div>`;
  }

  /* R25.12 (Phần B mục 10/14/15), sửa theo web-tu-thich-ung-theo-panel muc
   * 4 "Bảng màu: mono -> ẩn hẳn nút chọn màu; bwr -> hiện đen/đỏ": ĐÃ kết
   * nối -- đọc THẲNG color_mode của panel đang kết nối (activePanel), bất
   * kể project.planes (đề phòng thiết kế 3 màu mở trên panel mono thật,
   * hoặc ngược lại). CHƯA kết nối (activePanel null) -- giữ hành vi cũ
   * theo project.planes (nháp offline không đổi, đúng quyết định đã chốt).
   * element.color vẫn có thể mang giá trị cũ '#000000'/thiếu hẳn,
   * elementPlane() luôn coi là 'black'. */
  const activePanel = getActivePanel();
  const showColorControl = activePanel ? activePanel.color_mode === COLOR_MODE.BWR : editor.project.planes === 2;
  if (showColorControl) {
    const colorOptions = element.type === 'image'
      ? [['black','Đen'],['red','Đỏ'],['auto','Tự tách đỏ từ ảnh']]
      : [['black','Đen'],['red','Đỏ']];
    htmlEffects += selectField('Màu (thiết bị 3 màu)','color',element.color === 'auto' ? 'auto' : elementPlane(element),colorOptions,true);
    if (element.type === 'image' && element.color === 'auto') htmlEffects += `<div class="prop full"><small class="prop-help">Web tự tách vùng đỏ bão hòa sang mặt phẳng đỏ; phần còn lại sang mặt phẳng đen. Dùng nút xem từng màu trên thanh công cụ để kiểm tra.</small></div>`;
    const warning = redUsageWarning(element);
    if (warning) htmlEffects += `<div class="prop full"><small class="prop-help prop-warning">⚠ ${warning.message}</small></div>`;
  }
  html += inspectorSection('hieu-ung', 'Hiệu ứng', htmlEffects, false);
  html += advancedGeometry(element);
  html += inspectorSection('nang-cao', 'Nâng cao',
    toggleField('Khóa vị trí','locked',Boolean(element.locked)) +
    toggleField('Hiển thị','visible',element.visible !== false),
  false);
  form.innerHTML = html;

  form.querySelectorAll('[data-prop]').forEach(control => {
    const handler = () => {
      let value;
      if (control.type === 'checkbox') value = control.checked;
      else if (control.type === 'number' || control.type === 'range') value = Number(control.value);
      else value = control.value;
      const key = control.dataset.prop;
      /* Slider + ô nhập số cạnh nhau (field(...,'range',...)) chia sẻ cùng
       * data-prop nhưng khác data-role — đồng bộ control còn lại mỗi khi
       * một bên đổi giá trị, không phát lại sự kiện lên chính nó (giữ vị
       * trí con trỏ khi đang gõ số). */
      if (control.dataset.role) {
        form.querySelectorAll(`[data-prop="${key}"]`).forEach(sibling => {
          if (sibling !== control) sibling.value = control.value;
        });
      }
      const selected = editor.selected;
      const patch = { [key]: value };
      if (key === 'font') patch.fontFamily = '';
      if (selected && TEXT_SIZE_TYPES.has(selected.type) &&
          (key === 'fontSize' || (selected.type === 'time' && key === 'showSeconds'))) {
        const fontSize = key === 'fontSize' ? Number(value) : Number(selected.fontSize || 12);
        const showSeconds = key === 'showSeconds' ? Boolean(value) : Boolean(selected.showSeconds);
        const characters = textSizeSampleLength({ ...selected, showSeconds });
        const wantedW = Math.min(editor.project.width, Math.max(selected.w, Math.ceil(characters * fontSize * .62)));
        const wantedH = Math.min(editor.project.height, Math.max(selected.h, Math.ceil(fontSize * 1.15)));
        patch.w = wantedW; patch.h = wantedH;
        patch.x = Math.max(0, Math.min(selected.x, editor.project.width - wantedW));
        patch.y = Math.max(0, Math.min(selected.y, editor.project.height - wantedH));
      }
      if (selected && selected.type === 'battery' && key === 'h') {
        /* Giữ tỉ lệ 2:1 (mặc định 24×12) khi kéo thanh "Kích thước" --
         * xem field('Kích thước','h',...) ở trên: chỉ có một control, rộng
         * ăn theo cao để icon không bị méo ở bất cứ kích thước nào. */
        patch.w = Math.min(editor.project.width, Math.max(7, Math.round(Number(value) * 2)));
      }
      editor.updateSelected(patch);
    };
    control.addEventListener(control.tagName === 'SELECT' || control.type === 'checkbox' ? 'change' : 'input', handler);
    /* Shift+mũi tên = bước 10 đơn vị thay vì step mặc định (thường 1).
     * Trình duyệt không hỗ trợ sẵn cho input range/number nên tự xử lý. */
    if (control.dataset.role === 'range' || control.dataset.role === 'range-number') {
      control.addEventListener('keydown', event => {
        if (!event.shiftKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' &&
            event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
        event.preventDefault();
        const dir = (event.key === 'ArrowUp' || event.key === 'ArrowRight') ? 1 : -1;
        const min = control.min !== '' ? Number(control.min) : -Infinity;
        const max = control.max !== '' ? Number(control.max) : Infinity;
        control.value = Math.max(min, Math.min(max, Number(control.value) + dir * 10));
        control.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  });
  /* R25.12 (mục 5): #textMetricsInfo cập nhật sống lúc gõ -- KHÔNG qua
   * renderInspector() (bị chặn cố ý trong lúc gõ, xem "R24 bug fix" ở khai
   * báo `editor`). Đo trên bản nháp {...element, text: giá trị đang gõ},
   * không đợi editor.updateSelected() (control data-prop="text" khác) chạy
   * xong -- không phụ thuộc thứ tự hai listener trên cùng sự kiện 'input'. */
  if (element.type === 'text') {
    const textarea = $('#propText');
    const metricsBox = $('#textMetricsInfo');
    if (textarea && metricsBox) {
      textarea.addEventListener('input', () => {
        const metrics = editor.staticTextMetrics({ ...element, text: textarea.value });
        metricsBox.className = 'prop-help' + (!metrics.fitsWidth || !metrics.fitsHeight ? ' prop-warning' : '');
        metricsBox.textContent = textMetricsMessage(metrics, element);
      });
    }
  }
  /* Font-pipeline audit (2026-08-25) — Phần B: 1 wiring dùng chung cho nút
   * fontPickerHtml() sinh ra, thay data-hour-font (chỉ 'time' có trước
   * đây). 'time' còn cần thêm templateStyle/digitEffect (STYLE enum quyết
   * định vẽ 7-đoạn/pixel/chữ số) -- các widget khác chỉ đổi `font`, giữ
   * đúng hành vi cũ của selectField('Font',...)'s data-prop handler. */
  form.querySelectorAll('[data-font-choice]').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    const font = button.dataset.fontChoice;
    const selected = editor.selected;
    const patch = { font, fontFamily:'' };
    if (selected?.type === 'time') {
      patch.templateStyle = font==='dseg'?3:(font==='pixel'?0:4);
      patch.digitEffect = CUSTOM_HOUR_FONTS.has(font) ? (selected?.digitEffect||'normal') : 'normal';
    }
    editor.updateSelected(patch);
  }));
  form.querySelectorAll('[data-hour-effect]').forEach(button => button.addEventListener('click', () => {
    if(button.disabled || !CUSTOM_HOUR_FONTS.has(editor.selected?.font)) return;
    editor.updateSelected({digitEffect:button.dataset.hourEffect});
  }));
  form.querySelectorAll('[data-hour-effect-dir]').forEach(button => button.addEventListener('click', () => {
    if(button.disabled) return;
    editor.updateSelected({digitEffectDir:button.dataset.hourEffectDir});
  }));
  form.querySelectorAll('[data-text-size]').forEach(button => button.addEventListener('click', () => {
    const size=Number(button.dataset.textSize); const selected=editor.selected; if(!selected) return;
    const wantedW=Math.min(editor.project.width,Math.ceil(textSizeSampleLength(selected)*size*.62));
    const wantedH=Math.min(editor.project.height,Math.ceil(size*1.15));
    editor.updateSelected({fontSize:size,w:wantedW,h:wantedH,x:Math.max(0,Math.min(selected.x,editor.project.width-wantedW)),y:Math.max(0,Math.min(selected.y,editor.project.height-wantedH))});
  }));
  /* Widget Chữ nhiều dòng audit (2026-08-25): ghi vào element.lineStyles[i]
   * (mảng lồng, không phải thuộc tính phẳng) -- không tái dùng handler
   * chung data-prop ở trên (nó chỉ biết gán patch[key]=value phẳng).
   * '' (chọn "(mặc định)"/xoá số) nghĩa là xoá field đó khỏi override --
   * không lưu chuỗi rỗng/NaN vào project, giữ dữ liệu sạch. */
  const patchLineStyle = (index, key, value) => {
    const selected = editor.selected;
    if (!selected) return;
    const lineStyles = (selected.lineStyles || []).slice();
    const entry = { ...(lineStyles[index] || {}) };
    if (value === '' || value == null) delete entry[key]; else entry[key] = value;
    lineStyles[index] = entry;
    editor.updateSelected({ lineStyles });
  };
  form.querySelectorAll('[data-line-font]').forEach(select => select.addEventListener('change', () => {
    patchLineStyle(Number(select.dataset.lineFont), 'font', select.value);
  }));
  form.querySelectorAll('[data-line-size]').forEach(input => input.addEventListener('input', () => {
    const value = input.value === '' ? '' : Math.max(6, Math.min(80, Math.round(Number(input.value) || 0)));
    patchLineStyle(Number(input.dataset.lineSize), 'fontSize', value);
  }));
  $('#fitImageBtn')?.addEventListener('click', () => fitImage(false));
  $('#fillImageBtn')?.addEventListener('click', () => fitImage(true));
  $('#resetImageBtn')?.addEventListener('click', () => {
    /* R25.8 (mục 8dd): về đúng đề xuất tự động lúc chọn ảnh (xem
     * analyzeImageForOneBit() trong editor.js), không phải một hằng số cố
     * định vô can hệ với ảnh đang chọn -- ảnh cũ lưu trước bản vá này
     * chưa có imageAutoXxx thì mới rơi về hằng số như hành vi cũ. */
    const el = editor.selected;
    editor.updateSelected({
      imageScale:1, imageOffsetX:0, imageOffsetY:0,
      threshold: el?.imageAutoThreshold ?? 150,
      contrast: el?.imageAutoContrast ?? 1.15,
      dither: el?.imageAutoDither ?? 'ordered',
      invert: false
    });
  });
  $('#replaceImageBtn')?.addEventListener('click', () => $('#imageInput')?.click());
  $('#openBitmapForImageBtn')?.addEventListener('click', () => openBitmapEditor(editor.selected));
  form.querySelectorAll('[data-decor-size]').forEach(button => button.addEventListener('click', async () => {
    try { await editor.resizeDecoration(button.dataset.decorSize); } catch (error) { reportError(error); }
  }));
}

function fitImage(fill) {
  const element = editor.selected;
  if (!element || element.type !== 'image' || !element.sourceW || !element.sourceH) return;
  const fit = Math.min(element.w / element.sourceW, element.h / element.sourceH);
  const cover = Math.max(element.w / element.sourceW, element.h / element.sourceH);
  editor.updateSelected({ imageScale: fill ? cover : fit, imageOffsetX:0, imageOffsetY:0 });
}

async function openBitmapEditor(target = null) {
  const initialW = Math.max(4, Math.min(212, Math.round(target?.sourceW || target?.w || 60)));
  const initialH = Math.max(4, Math.min(212, Math.round(target?.sourceH || target?.h || 40)));
  showModal(`<div class="bitmap-editor">
    <div class="bitmap-head"><div><span class="eyebrow">TNVA PIXEL</span><h2>Chấm từng điểm</h2></div><button id="bitmapClose" class="icon-close">×</button></div>
    <div class="bitmap-size-row"><label>Rộng<input id="bitmapWidth" type="number" min="4" max="212" value="${initialW}"></label><label>Cao<input id="bitmapHeight" type="number" min="4" max="212" value="${initialH}"></label><button id="bitmapResize" class="btn">Đổi cỡ lưới</button></div>
    <div class="bitmap-stage"><canvas id="bitmapCanvas"></canvas></div>
    <div class="bitmap-tools">
      <button data-bitmap-tool="black" class="active">✎<span>Bút đen</span></button>
      <button data-bitmap-tool="white">⌫<span>Bút trắng</span></button>
      <button data-bitmap-action="undo">↶<span>Undo</span></button>
      <button data-bitmap-action="fillBlack">■<span>Tô đen</span></button>
      <button data-bitmap-action="fillWhite">□<span>Tô trắng</span></button>
      <button data-bitmap-action="invert">◐<span>Đảo</span></button>
      <button data-bitmap-action="flipH">↔<span>Lật ngang</span></button>
      <button data-bitmap-action="flipV">↕<span>Lật dọc</span></button>
      <button data-bitmap-action="rotate">⟳<span>Xoay 90°</span></button>
      <button data-bitmap-action="clear">⌧<span>Xóa hết</span></button>
    </div>
    <div class="modal-actions"><button id="bitmapCancel" class="btn">Hủy</button><button id="bitmapOk" class="btn primary">Dùng ảnh này</button></div>
  </div>`);

  const canvas = $('#bitmapCanvas');
  const ctx = canvas.getContext('2d');
  let width = initialW, height = initialH;
  let pixels = new Uint8Array(width * height);
  let tool = 'black', drawing = false;
  const history = [];

  const pushHistory = () => { history.push({width,height,pixels:pixels.slice()}); if (history.length > 30) history.shift(); };
  const cellSize = () => Math.max(3, Math.min(12, Math.floor(Math.min(720 / width, 480 / height))));
  const resizeCanvas = () => { const c=cellSize(); canvas.width=width*c; canvas.height=height*c; canvas.style.aspectRatio=`${width}/${height}`; draw(); };
  const draw = () => {
    const c=cellSize(); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#111';
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) if(pixels[y*width+x]) ctx.fillRect(x*c,y*c,c,c);
    if(c>=5){ ctx.strokeStyle='rgba(50,60,70,.22)'; ctx.lineWidth=1; ctx.beginPath(); for(let x=0;x<=width;x++){ctx.moveTo(x*c+.5,0);ctx.lineTo(x*c+.5,height*c);} for(let y=0;y<=height;y++){ctx.moveTo(0,y*c+.5);ctx.lineTo(width*c,y*c+.5);} ctx.stroke(); }
  };
  const point = event => { const r=canvas.getBoundingClientRect(); return {x:Math.floor((event.clientX-r.left)*width/r.width),y:Math.floor((event.clientY-r.top)*height/r.height)}; };
  const paint = event => { const p=point(event); if(p.x<0||p.y<0||p.x>=width||p.y>=height)return; pixels[p.y*width+p.x]=tool==='black'?1:0; draw(); };

  if (target?.imageData) {
    try {
      const image = new Image();
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=target.imageData;});
      const off=document.createElement('canvas'); off.width=width; off.height=height;
      const offCtx=off.getContext('2d',{willReadFrequently:true}); offCtx.fillStyle='#fff';offCtx.fillRect(0,0,width,height);offCtx.drawImage(image,0,0,width,height);
      const data=offCtx.getImageData(0,0,width,height).data;
      for(let i=0;i<pixels.length;i++){const j=i*4; pixels[i]=(.299*data[j]+.587*data[j+1]+.114*data[j+2])<150?1:0;}
    } catch { /* start blank */ }
  }
  resizeCanvas();

  canvas.addEventListener('pointerdown', event => { pushHistory(); drawing=true; canvas.setPointerCapture?.(event.pointerId); paint(event); });
  canvas.addEventListener('pointermove', event => { if(drawing) paint(event); });
  canvas.addEventListener('pointerup', event => { drawing=false; canvas.releasePointerCapture?.(event.pointerId); });
  canvas.addEventListener('pointercancel', () => { drawing=false; });

  $$('[data-bitmap-tool]').forEach(button => button.addEventListener('click', () => { tool=button.dataset.bitmapTool; $$('[data-bitmap-tool]').forEach(x=>x.classList.toggle('active',x===button)); }));
  $$('[data-bitmap-action]').forEach(button => button.addEventListener('click', () => {
    const action=button.dataset.bitmapAction;
    if(action==='undo'){const state=history.pop();if(state){width=state.width;height=state.height;pixels=state.pixels;$('#bitmapWidth').value=width;$('#bitmapHeight').value=height;resizeCanvas();}return;}
    pushHistory();
    if(action==='fillBlack') pixels.fill(1);
    if(action==='fillWhite'||action==='clear') pixels.fill(0);
    if(action==='invert') for(let i=0;i<pixels.length;i++) pixels[i]=pixels[i]?0:1;
    if(action==='flipH'){const next=new Uint8Array(pixels.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)next[y*width+(width-1-x)]=pixels[y*width+x];pixels=next;}
    if(action==='flipV'){const next=new Uint8Array(pixels.length);for(let y=0;y<height;y++)for(let x=0;x<width;x++)next[(height-1-y)*width+x]=pixels[y*width+x];pixels=next;}
    if(action==='rotate'){const next=new Uint8Array(width*height);const oldW=width,oldH=height;for(let y=0;y<oldH;y++)for(let x=0;x<oldW;x++)next[x*oldH+(oldH-1-y)]=pixels[y*oldW+x];width=oldH;height=oldW;pixels=next;$('#bitmapWidth').value=width;$('#bitmapHeight').value=height;resizeCanvas();return;}
    draw();
  }));
  $('#bitmapResize').onclick=()=>{const nw=Math.max(4,Math.min(212,Number($('#bitmapWidth').value)||width));const nh=Math.max(4,Math.min(212,Number($('#bitmapHeight').value)||height));pushHistory();const next=new Uint8Array(nw*nh);for(let y=0;y<Math.min(height,nh);y++)for(let x=0;x<Math.min(width,nw);x++)next[y*nw+x]=pixels[y*width+x];width=nw;height=nh;pixels=next;resizeCanvas();};
  $('#bitmapClose').onclick=$('#bitmapCancel').onclick=closeModal;
  $('#bitmapOk').onclick=async()=>{
    const out=document.createElement('canvas');out.width=width;out.height=height;const o=out.getContext('2d');o.fillStyle='#fff';o.fillRect(0,0,width,height);o.fillStyle='#000';for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[y*width+x])o.fillRect(x,y,1,1);
    const dataUrl=out.toDataURL('image/png');
    if(target?.type==='image') editor.updateSelected({imageData:dataUrl,sourceW:width,sourceH:height,w:Math.min(width,editor.project.width),h:Math.min(height,editor.project.height),imageScale:1,imageOffsetX:0,imageOffsetY:0,dither:'none',threshold:128,contrast:1,brightness:0});
    else { const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png')); const file=new File([blob],'bitmap.png',{type:'image/png'}); const el=await editor.addImage(file); editor.updateSelected({w:Math.min(width,editor.project.width),h:Math.min(height,editor.project.height),imageScale:1,dither:'none',threshold:128,contrast:1,brightness:0},false); }
    closeModal(); toast('Đã thêm ảnh pixel','success');
  };
}

$('#bitmapEditorBtn')?.addEventListener('click', () => openBitmapEditor());
$('#paletteBitmapBtn')?.addEventListener('click', () => { closeObjectPalette(); openBitmapEditor(); });


function renderLayers() {
  const list = $('#layersList');
  $('#layerCount').textContent = String(editor.project.elements.length);
  list.innerHTML = editor.project.elements.slice().reverse().map(element => `
    <div class="layer-row ${element.id===editor.selectedId?'active':''}" data-layer="${element.id}">
      <span class="layer-icon">${layerIcon(element.type)}</span>
      <span>${escapeHtml(element.name || TYPE_LABELS[element.type] || element.type)}</span>
      <button data-hide="${element.id}">${element.visible?'●':'○'}</button>
    </div>`).join('');
  list.querySelectorAll('[data-layer]').forEach(row => row.addEventListener('click', event => { if (!event.target.dataset.hide) editor.select(row.dataset.layer); }));
  list.querySelectorAll('[data-hide]').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation(); editor.select(button.dataset.hide); editor.updateSelected({ visible:!editor.selected.visible });
  }));
}
function renderMobileLayers() {
  const list = $('#mobileLayersList');
  if (!list) return;
  if (!editor.project.elements.length) { list.innerHTML = '<div class="object-strip-empty">Chưa có đối tượng</div>'; return; }
  list.innerHTML = editor.project.elements.slice().reverse().map(element => `
    <button class="object-chip ${element.id===editor.selectedId?'active':''}" data-mobile-layer="${element.id}">
      <span class="object-chip-icon">${layerIcon(element.type)}</span>
      <span class="object-chip-copy"><b>${escapeHtml(element.name || TYPE_LABELS[element.type] || element.type)}</b><small>${Math.round(element.w)}×${Math.round(element.h)}${element.locked?' · khóa':''}</small></span>
      <span class="object-chip-state">${element.visible!==false?'●':'○'}</span>
    </button>`).join('');
  list.querySelectorAll('[data-mobile-layer]').forEach(button => button.addEventListener('click', () => editor.select(button.dataset.mobileLayer)));
  requestAnimationFrame(() => list.querySelector('.object-chip.active')?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'}));
}

function layerIcon(type) { return ({text:'T',calendar:'▦',calendarWeek:'7',time:'⌚',date:'日',weekday:'T2',lunar:'ÂL',canchi:'CC',holiday:'★',temperature:'°C',voltage:'V',batteryPercent:'%',battery:'▰',analog:'◷',image:'Ả',shape:'◯',line:'／',rect:'□',legacyShape:'◇',invertRegion:'▮',dayOnly:'@d',monthOnly:'@M',yearOnly:'@y'})[type] || '•'; }

$('#designTitle').addEventListener('input', event => { editor.project.title = normalizeVietnameseText(event.target.value); editor.changed(); });
$('#designAuthor').addEventListener('input', event => { editor.project.author = normalizeVietnameseText(event.target.value); editor.changed(); });
/* R25.6 (Phase C): orientation is now the first explicit choice when
 * starting a new design, not an assumed pre-set toolbar dropdown value --
 * this modal used to just confirm "Tạo mới" against whatever #screenProfile
 * already happened to be. */
/* R25.12 (Phần B mục 8): CHỌN THIẾT BỊ trước, rồi mới đến hướng màn --
 * bước đầu luồng thiết kế, không phải một dropdown ẩn trong thanh công cụ.
 * 4.2" gắn rõ nhãn "CHỈ THIẾT KẾ" (designOnly, mục 9) ngay tại bước chọn để
 * không ai lầm tưởng gửi lên máy được ngay. */
function deviceGroups() {
  const groups = new Map();
  for (const [key, profile] of Object.entries(DEVICE.profiles)) {
    /* R26.1 (Task 3): ẩn nhóm 4.2" khỏi modal "Tạo mới" khi FEATURES.PANEL_420
     * tắt -- lọc ở tầng UI, không đụng DEVICE.profiles/PANEL_PROFILES. */
    if (!FEATURES.PANEL_420 && profile.deviceClass === 'eink42tri') continue;
    const deviceClass = profile.deviceClass || 'eink213';
    if (!groups.has(deviceClass)) groups.set(deviceClass, []);
    groups.get(deviceClass).push([key, profile]);
  }
  return groups;
}
function showOrientationStep(deviceClass, profiles) {
  showModal(`<h2>Chọn hướng màn hình</h2><p class="prop-help">Đổi hướng sau này sẽ cần chỉnh lại bố cục.</p>
    <div class="orientation-pick-grid full">${profiles.map(([key, profile]) => `
      <button class="btn primary" data-pick-profile="${key}">${profile.width > profile.height ? 'Ngang' : 'Dọc'}<small>${profile.width} × ${profile.height}</small></button>
    `).join('')}</div>
    <div class="modal-actions"><button class="btn" id="modalBack">← Chọn lại thiết bị</button><button class="btn" id="modalCancel">Hủy</button></div>`);
  $('#modalCancel').onclick = closeModal;
  $('#modalBack').onclick = showDeviceStep;
  $$('[data-pick-profile]').forEach(button => button.onclick = () => { editor.newProject(button.dataset.pickProfile); closeModal(); });
}
function showDeviceStep() {
  const groups = deviceGroups();
  showModal(`<h2>Tạo mới</h2><p class="prop-help">Chọn thiết bị trước -- mỗi thiết bị có kích thước, ngân sách gói/atlas và khả năng gửi lên máy khác nhau.</p>
    <div class="orientation-pick-grid full">${[...groups.entries()].map(([deviceClass, profiles]) => {
      const sample = profiles[0][1];
      return `<button class="btn primary" data-pick-device="${deviceClass}">${sample.designOnly ? '4.2" 3 màu (đen/trắng/đỏ)' : '2.13" 1-bit'}<small>${sample.designOnly ? 'CHỈ THIẾT KẾ -- chưa gửi lên máy được' : 'Đã có thiết bị thật'}</small></button>`;
    }).join('')}</div>
    <div class="modal-actions"><button class="btn" id="modalCancel">Hủy</button></div>`);
  $('#modalCancel').onclick = closeModal;
  $$('[data-pick-device]').forEach(button => button.onclick = () => showOrientationStep(button.dataset.pickDevice, groups.get(button.dataset.pickDevice)));
}
$('#newDesignBtn').addEventListener('click', showDeviceStep);

async function open42SamplePicker() {
  try {
    const root = new URL('web_faces/tricolor_42_samples/', document.baseURI);
    const response = await fetch(new URL('index.json', root), { cache:'no-cache' });
    if (!response.ok) throw new Error('Không đọc được danh sách mẫu 4.2');
    const rows = await response.json();
    showModal(`<div class="sample-picker"><div class="bitmap-head"><div><span class="eyebrow">MẪU 4.2 · 3 MÀU</span><h2>Chọn bố cục khởi đầu</h2></div><button id="sampleClose" class="icon-close">×</button></div>
      <p class="prop-help">Mẫu chỉ là điểm khởi đầu: mở xong có thể đổi font, màu, vị trí và mọi đối tượng.</p>
      <div class="sample-picker-grid">${rows.map((row,index)=>`<button class="sample-card" data-sample-index="${index}"><b>${escapeHtml(row.title)}</b><span>${row.width} × ${row.height}</span><small>${row.elementCount} đối tượng · ${row.redElements} lớp đỏ</small></button>`).join('')}</div>
      <div class="modal-actions"><button class="btn" id="sampleCancel">Hủy</button></div></div>`);
    $('#sampleClose').onclick = $('#sampleCancel').onclick = closeModal;
    $$('[data-sample-index]').forEach(button => button.onclick = async () => {
      button.disabled = true;
      try {
        const row = rows[Number(button.dataset.sampleIndex)];
        const projectResponse = await fetch(new URL(row.file, root), { cache:'no-cache' });
        if (!projectResponse.ok) throw new Error('Không mở được mẫu đã chọn');
        editor.loadProject(await projectResponse.json());
        closeModal(); toast('Đã mở mẫu 4.2', 'success');
      } catch (error) { reportError(error); button.disabled = false; }
    });
  } catch (error) { reportError(error); }
}
/* R26.1 (Task 3): không đăng ký listener khi PANEL_420 tắt -- đồng nhất
 * cách làm với khối OTA_MANUAL_FILE (Task 1)/OTA_GITHUB_CHANNEL (Task 2). */
if (FEATURES.PANEL_420) $('#open42SamplesBtn')?.addEventListener('click', open42SamplePicker);

/* PHẦN 5 -- Trang trí Tết: bitmap 1-bit dựng sẵn (tools/generate_tet_decorations.mjs),
 * KHÔNG phải font -- chèn ra đúng 1 phần tử 'image' bình thường
 * (editor.addDecoration()), không widget ID mới, không tốn atlas/RAM. */
function openTetDecorationPicker() {
  showModal(`<div class="sample-picker"><div class="bitmap-head"><div><span class="eyebrow">TRANG TRÍ TẾT</span><h2>Chọn cụm chữ thư pháp</h2></div><button id="tetDecorClose" class="icon-close">×</button></div>
    <p class="prop-help">Bitmap dựng sẵn cho sắc nét trên màn 1-bit -- không phải font. Chọn cỡ để chèn; đổi cỡ khác hoặc đảo màu sau trong bảng thuộc tính.</p>
    <div class="sample-picker-grid tet-decor-grid">${TET_DECORATIONS.map(item => `
      <div class="sample-card tet-decor-card">
        <img class="tet-decor-thumb" src="${item.sizes[Math.min(1, item.sizes.length - 1)].url}" alt="${escapeHtml(item.label)}">
        <b>${escapeHtml(item.label)}</b>
        <div class="tet-decor-size-row">${item.sizes.map(s => `<button type="button" data-decor="${item.id}" data-size="${s.key}">${s.label}</button>`).join('')}</div>
      </div>`).join('')}</div>
    <div class="modal-actions"><button class="btn" id="tetDecorCancel">Đóng</button></div></div>`);
  $('#tetDecorClose').onclick = $('#tetDecorCancel').onclick = closeModal;
  $$('.tet-decor-size-row button').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await editor.addDecoration(button.dataset.decor, button.dataset.size);
      closeModal(); toast('Đã chèn trang trí Tết', 'success');
    } catch (error) { reportError(error); button.disabled = false; }
  }));
}
$('#tetDecorBtn')?.addEventListener('click', () => { closeObjectPalette(); openTetDecorationPicker(); });
$('#paletteTetDecorBtn')?.addEventListener('click', () => { closeObjectPalette(); openTetDecorationPicker(); });
$('#previewPngBtn')?.addEventListener('click', async () => {
  try {
    const filter = editor.project.planes === 2 && editor.previewPlane !== 'combined' ? editor.previewPlane : null;
    await editor.downloadPreviewPng(filter);
    toast('Đã xuất ảnh PNG', 'success');
  } catch (error) { reportError(error); }
});

$('#saveLocalBtn').addEventListener('click', async () => {
  try {
    const preview = await editor.previewDataUrl();
    const saved = await saveProject({ ...editor.exportProject(), preview });
    editor.project.createdAt = saved.createdAt;
    toast('Đã lưu', 'success');
    await renderLocalLibrary();
  } catch (error) { reportError(error); }
});
/* R25.12 (Phần B mục 9): project 3 màu (planes===2) chưa có firmware/driver
 * thật -- xuất file THIẾT KẾ (.tnva42design) thay vì .tnvaface, không nhầm
 * là gửi lên máy được. */
$('#downloadBtn').addEventListener('click', async () => {
  try { editor.project.planes === 2 ? await editor.downloadTricolorDesign() : await editor.downloadFace(); }
  catch (error) { reportError(error); }
});
$('#openFileBtn').addEventListener('click', () => $('#projectFileInput').click());
$('#downloadProjectBtn').addEventListener('click', () => editor.downloadProject());
$('#projectFileInput').addEventListener('change', async event => {
  const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
  try { await editor.importFile(file); toast('Đã mở file', 'success'); } catch (error) { reportError(error); }
});

$('#installBtn').addEventListener('click', async () => {
  try {
    /* R25.13 Bước 6: thiết bị 3 màu (planes===2) đi đường TN42 riêng --
     * KHÔNG chạm vào nhánh TNF1/2.13 bên dưới (atlas font, compile(),
     * uploadFace() -- toàn bộ giữ nguyên y hệt). checkPanelMatch()/
     * updateDeviceCapabilityUI() đã khoá nút này nếu panel đang kết nối
     * không khớp deviceClass đang thiết kế -- tới được đây nghĩa là đã
     * đúng panel_id=2. */
    if (editor.project.planes === 2) {
      const compiled = await editor.compileTn42();
      showModal(`<h2>Gửi vào đồng hồ</h2><p id="installStep" class="prop-help">Đang gửi giao diện 4.2"…</p><div class="progress"><span id="installProgress"></span></div><div class="modal-actions"><button class="btn" id="modalCancel">Hủy</button></div>`);
      $('#modalCancel').onclick = closeModal;
      log(`Đang gửi thiết kế 4.2": ${editor.project.title || 'Giao diện mới'}`, {operation:'tn42-upload',step:'prepare',size:compiled.bytes.length});
      await ble.uploadTn42Package(compiled.bytes, value => { const bar=$('#installProgress'); if(bar) bar.style.width=`${value}%`; });
      log('Thiết kế 4.2" đang hiển thị trên đồng hồ');
      closeModal(); toast('Đã gửi giao diện', 'success');
      return;
    }
    const usesNewHourFont=editor.project.elements.some(item=>item.visible!==false&&item.type==='time'&&CUSTOM_HOUR_FONTS.has(item.font));
    if(usesNewHourFont && !firmwareAtLeast(lastDeviceStatus?.time?.firmware)) throw new Error('Hãy nạp firmware 2.1.10 trước khi dùng font số mới');

    /* R23: atlas fonts need their glyph atlas on flash before the face
     * package that references them means anything -- upload it first
     * (skipped entirely if its bytes match what's already on the device;
     * see docs/FONT_ATLAS_TNVA.md requirement 6, "không gửi lại mỗi lần
     * đổi face"). Budget/error checking happens here so a face that can't
     * fit is rejected before any BLE traffic, not mid-upload. */
    const atlasPlan = await prepareAtlasForUpload();
    /* BƯỚC 4 (hợp nhất code path): từ đây, preview atlas-font vẽ bằng cách
     * giải mã ĐÚNG bytes vừa build cho upload này (drawAtlasFontText() ở
     * editor.js) -- không còn là xấp xỉ fillText() riêng. null khi face
     * này không dùng atlas font (atlasPlan null) -- rơi về fillText như cũ. */
    editor.previewAtlas = atlasPlan ? { fontKey: atlasPlan.fontKey, cellPx: atlasPlan.cellPx, bytes: atlasPlan.bytes } : null;

    const compiled = await editor.compile();
    const tnf1Budget = currentTnf1BudgetBytes();
    if (compiled.packageBytes.length > tnf1Budget) {
      const { bitplane, descriptors, template } = compiled.sizeBreakdown;
      const parts = [
        { label: 'Nền ảnh (theo kích thước màn)', bytes: bitplane },
        { label: 'Đối tượng động (layer)', bytes: descriptors },
        { label: 'Chữ tĩnh trong template', bytes: template }
      ].sort((a, b) => b.bytes - a.bytes);
      const worst = parts[0];
      const suggestion = worst.label.startsWith('Nền')
        ? 'nền ảnh cố định theo kích thước màn hình -- hãy giảm bớt số đối tượng phủ lên hoặc đổi ảnh nền khác.'
        : worst.label.startsWith('Đối tượng')
          ? 'giảm số lớp/đối tượng động trên thiết kế.'
          : 'rút ngắn nội dung chữ tĩnh (nhãn tự nhập).';
      throw new Error(`Giao diện ${(compiled.packageBytes.length/1024).toFixed(1)} KB vượt `
        + `${(tnf1Budget/1024).toFixed(1)} KB (dư ${compiled.packageBytes.length - tnf1Budget} byte). `
        + `Ăn nhiều nhất: ${worst.label} (${worst.bytes}B). Gợi ý: ${suggestion}`);
    }
    showModal(`<h2>Gửi vào đồng hồ</h2><p id="installStep" class="prop-help">${atlasPlan?.needsUpload ? 'Đang gửi atlas font…' : 'Đang gửi giao diện…'}</p><div class="progress"><span id="installProgress"></span></div><div class="modal-actions"><button class="btn" id="modalCancel">Hủy</button></div>`);
    $('#modalCancel').onclick = closeModal;

    if (atlasPlan?.needsUpload) {
      log(`Đang gửi atlas font (${(atlasPlan.bytes.length/1024).toFixed(1)} KB, ${atlasPlan.glyphCount} glyph)`, {operation:'atlas-upload',step:'prepare',size:atlasPlan.bytes.length});
      await ble.uploadAtlas(atlasPlan.bytes, value => { const bar=$('#installProgress'); if(bar) bar.style.width=`${value}%`; });
      localStorage.setItem(atlasCrcStorageKey(), String(crc32(atlasPlan.bytes)));
      const stepLabel=$('#installStep'); if(stepLabel) stepLabel.textContent='Đang gửi giao diện…';
      const bar=$('#installProgress'); if(bar) bar.style.width='0%';
    }

    log(`Đang gửi thiết kế: ${editor.project.title || 'Giao diện mới'}`);
    await ble.uploadFace(compiled.packageBytes, value => { const bar=$('#installProgress'); if(bar) bar.style.width=`${value}%`; });
    log('Thiết kế đang hiển thị trên đồng hồ');
    closeModal(); toast('Đã gửi giao diện', 'success');
  } catch (error) { closeModal(); reportError(error); }
});

/* R25.12-hotfix (điều tra hồi quy): khoá cache CRC atlas trước đây là MỘT
 * chuỗi cố định 'tnvaLastAtlasCrc' dùng CHUNG cho MỌI thiết bị từng kết nối
 * qua trình duyệt này -- nếu thiết bị bị nạp lại firmware (mất/khác atlas
 * trên flash) mà trình duyệt KHÔNG biết, lần "Gửi vào đồng hồ" tiếp theo sẽ
 * ÂM THẦM bỏ qua gửi atlas (nghĩ đã khớp), để lại atlas CŨ/rỗng trên máy --
 * đúng lớp triệu chứng "chữ sai/thiếu sau khi nạp lại firmware" một người
 * dùng vừa báo. Không có bằng chứng đây LÀ nguyên nhân cụ thể lần đó (không
 * có thiết bị để kiểm chứng trực tiếp), nhưng đây là một khoảng hở thật,
 * sửa cho chắc: khoá theo device_id, không còn dùng chung giữa các thiết bị
 * (hoặc cùng thiết bị nhưng đã nạp lại firmware và mất trạng thái flash). */
function atlasCrcStorageKey() {
  const deviceId = lastDeviceStatus?.time?.deviceId;
  return deviceId ? `tnvaLastAtlasCrc:${deviceId}` : 'tnvaLastAtlasCrc';
}

/* Returns null if this face doesn't use an atlas-backed font at all.
 * Otherwise rasterizes/packs it (throws with a breakdown-based message if
 * it won't fit 4 KB) and reports needsUpload:false when its CRC matches
 * localStorage's tnvaLastAtlasCrc (scoped per device, see above), so a
 * repeat "Gửi vào đồng hồ" on an unchanged atlas doesn't resend it. */
async function prepareAtlasForUpload() {
  const budgetBytes = currentAtlasBudgetBytes();
  const estimate = await estimateFaceAtlas(editor.project, currentAtlasEffect(), budgetBytes);
  if (!estimate) return null;
  if (estimate.error || estimate.overBudget) {
    const top = estimate.breakdown.slice(0, 3).map(b => `${b.label} (${b.bytes}B)`).join(', ');
    /* Suggested size: budget bytes scale roughly linearly with cellPx for
     * a fixed glyph set (more px -> taller columns -> more bytes/glyph),
     * so back-solving from the measured totalBytes at the current size
     * gives a reasonable target rather than a guess. */
    const suggestedPx = Math.max(atlasFontMinPx(estimate.fontKey),
      Math.floor(estimate.cellPx * (budgetBytes / Math.max(1, estimate.totalBytes)) * 0.92));
    throw new Error(`Atlas ${(estimate.totalBytes/1024).toFixed(1)} KB vượt ngân sách ${(budgetBytes/1024).toFixed(1)} KB. `
      + `Nặng nhất: ${top || 'không rõ'}. Thử giảm cỡ chữ xuống khoảng ${suggestedPx}px.`);
  }
  const crc = crc32(estimate.bytes);
  const lastCrc = localStorage.getItem(atlasCrcStorageKey());
  return {
    bytes: estimate.bytes, glyphCount: estimate.glyphCount, needsUpload: String(crc) !== lastCrc,
    fontKey: estimate.fontKey, cellPx: estimate.cellPx,
  };
}

/* The atlas is built from whichever 'time' element actually drives its
 * font/size (see collectFaceAtlasNeed()), so its effect must come from
 * that same element, not necessarily editor.selected. */
function currentAtlasEffect() {
  const need = collectFaceAtlasNeed(editor.project);
  const owner = need && editor.project.elements.find(el => el.font === need.fontKey && ATLAS_HOUR_FONTS.has(el.font));
  const value = owner?.digitEffect === '3d' ? 'light' : (owner?.digitEffect || 'normal');
  const mode = value === 'bold' ? 'bold' : value === 'light' ? 'light' : 'flat';
  /* R25.8 (mục 4): hướng đổ bóng giờ đọc từ chính đối tượng thay vì luôn
   * cố định xuống-phải -- xem digitEffectDir trong renderInspector(). */
  return { mode, direction: DIGIT_EFFECT_DIRS[owner?.digitEffectDir] || DIGIT_EFFECT_DIRS.dr };
}

/* Kho/hồ sơ cũ chưa ghi width/height -> mặc định 2.13" (thiết bị duy nhất
 * tồn tại lúc các mục này được tạo). Dùng chung bởi designCard() (hiển thị)
 * và isPanelCompatibleRow() (lọc theo panel_id, mục 2) -- một nguồn duy
 * nhất, không lệch công thức fallback giữa 2 chỗ. */
function rowScreenSize(row) {
  return {
    width: row.width || row.screen_width || row.payload?.screen?.width || PANEL_PROFILES[DEFAULT_PROFILE_KEY].width,
    height: row.height || row.screen_height || row.payload?.screen?.height || PANEL_PROFILES[DEFAULT_PROFILE_KEY].height,
  };
}

/*
 * Web-tu-thich-ung-theo-panel muc 2: "Face library chỉ hiện face khớp
 * activePanel. Face không khớp ẩn hẳn, KHÔNG hiện xám." -- activePanel
 * null (chưa kết nối) KHÔNG lọc gì (giữ nguyên luồng duyệt/nhập offline đã
 * chốt). Kích thước không khớp profile nào đã biết (panelIdForSize trả
 * null) thì KHÔNG ẩn oan -- chỉ ẩn khi XÁC ĐỊNH được là panel khác.
 */
function isPanelCompatibleRow(row) {
  const activePanel = getActivePanel();
  if (!activePanel) return true;
  const { width, height } = rowScreenSize(row);
  const rowPanelId = panelIdForSize(width, height);
  return rowPanelId === null || rowPanelId === activePanel.id;
}

/* R26.1 (Task 3): isPanelCompatibleRow() ở trên chỉ lọc SAU khi đã kết nối
 * (activePanel null lúc offline -> không lọc gì) -- kho hiện tại chưa có
 * face 4.2" nào nhưng phòng khi có, ẩn hẳn theo kích thước bất kể đã kết
 * nối hay chưa khi FEATURES.PANEL_420 tắt, không phụ thuộc activePanel. */
function isPanel420AllowedRow(row) {
  if (FEATURES.PANEL_420) return true;
  const { width, height } = rowScreenSize(row);
  return !((width === 400 && height === 300) || (width === 300 && height === 400));
}

async function renderLocalLibrary() {
  const rows = await listProjects();
  const query = normalizeSearch($('#librarySearch').value);
  const filtered = rows
    .filter(row => !query || normalizeSearch(`${row.title} ${row.author}`).includes(query))
    .filter(isPanelCompatibleRow)
    .filter(isPanel420AllowedRow);
  const root = $('#localLibrary');
  root.innerHTML = filtered.length ? filtered.map(row => designCard(row,'local')).join('') : '<div class="empty-state panel">Chưa có giao diện</div>';
  bindLibraryCards(root,'local');
}

function designCard(row, source) {
  const preview = source === 'local' ? row.preview : (row.preview_url || row.localPreview || row.preview);
  const title = row.title || 'Không tên';
  const author = row.author || 'Ẩn danh';
  const { width, height } = rowScreenSize(row);
  return `<article class="design-card" data-card="${escapeHtml(row.id)}" data-source="${source}">
    <div class="card-preview">${preview ? `<img loading="lazy" src="${escapeHtml(preview)}" alt="">` : ''}</div>
    <div class="card-body"><div class="card-title">${escapeHtml(title)}${row.mine ? `<span class="orientation-badge">${row.status === 'rejected' ? 'BỊ TỪ CHỐI' : 'ĐANG CHỜ DUYỆT'}</span>` : ''}</div><div class="card-meta">${escapeHtml(author)} · ${width}×${height}${row.rejection_reason ? ` · ${escapeHtml(row.rejection_reason)}` : ''}</div>
    <div class="card-actions"><button class="btn" data-open>${source==='local'?'Mở':'Gửi vào đồng hồ'}</button><button class="btn" data-download>Tải</button>${source==='local'?'<button class="btn" data-delete>Xóa</button>':''}</div></div></article>`;
}

/* Gói kho có sẵn nằm ngay trong thư mục web, tải thẳng không qua dịch vụ
 * nào -- kho cộng đồng (từng tải qua Pi khi thiếu packageUrl) đã bị gỡ. */
async function loadFacePackageBytes(row) {
  const response = await fetch(row.packageUrl, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Không tải được gói giao diện');
  return normalizeCrisp213Package(new Uint8Array(await response.arrayBuffer()));
}

function bindLibraryCards(root, source, suppliedRows = null) {
  root.querySelectorAll('[data-card]').forEach(card => {
    const id = card.dataset.card;
    card.querySelector('[data-open]').onclick = async () => {
      try {
        if (source === 'local') {
          const rows = await listProjects();
          const row = rows.find(item => String(item.id) === String(id));
          if (row) editor.loadProject(row);
          showView('designer');
          return;
        }
        if (!ble.connected) throw new Error('Chưa kết nối đồng hồ');
        const row = suppliedRows.find(item => String(item.id) === String(id));
        if (!row) throw new Error('Không tìm thấy giao diện');
        const bytes = await loadFacePackageBytes(row);
        await ble.uploadFace(bytes, value => { if (value % 10 === 0 || value === 100) toast(`Đang gửi ${value}%`); });
        toast('Đã áp dụng giao diện', 'success');
      } catch (error) { reportError(error); }
    };
    card.querySelector('[data-download]').onclick = async () => {
      try {
        if (source === 'local') {
          const rows = await listProjects();
          const row = rows.find(item => String(item.id) === String(id));
          if (!row) throw new Error('Không tìm thấy giao diện');
          download(`${slug(row.title)}.tnvaproject`, new Blob([JSON.stringify(row,null,2)],{type:'application/json'}));
        } else {
          const row = suppliedRows.find(item => String(item.id) === String(id));
          if (!row) throw new Error('Không tìm thấy giao diện');
          const bytes = await loadFacePackageBytes(row);
          download(`${slug(row.title)}.tnvafacebin`, new Blob([bytes],{type:'application/octet-stream'}));
        }
      } catch (error) { reportError(error); }
    };
    card.querySelector('[data-delete]')?.addEventListener('click', async () => {
      try { await deleteProject(id); await renderLocalLibrary(); }
      catch (error) { reportError(error); }
    });
  });
}

function normalizeSearch(text='') {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}
function slug(text='giao-dien'){return normalizeSearch(text).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'giao-dien';}
/* Kho có sẵn: các gói dựng từ file kho giao diện, phục vụ ngay tại chỗ nên
   không cần cấu hình dịch vụ nào. Xem tools/import_design_warehouse.py. */
const WAREHOUSE_ROOT = 'web_faces/warehouse';
let warehouseRows = null;

async function loadWarehouseRows() {
  if (warehouseRows) return warehouseRows;
  const response = await fetch(`${WAREHOUSE_ROOT}/index.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Chưa dựng kho có sẵn');
  const index = await response.json();
  warehouseRows = (index.items || []).map(item => ({
    id: `wh-${item.id}`,
    title: item.title,
    author: item.author || 'Kho TNVA',
    preview: `${WAREHOUSE_ROOT}/${item.preview}`,
    packageUrl: `${WAREHOUSE_ROOT}/${item.package}`,
    /* R25.6 (Phase B): index.json now carries explicit width/height
     * (rebuild_design_warehouse.py's build_one()) -- fall back to deriving
     * from orientation only for an index.json built before this change. */
    width: item.width ?? (item.orientation === 'portrait' ? PANEL_PROFILES['104x212'].width : PANEL_PROFILES['212x104'].width),
    height: item.height ?? (item.orientation === 'portrait' ? PANEL_PROFILES['104x212'].height : PANEL_PROFILES['212x104'].height),
  }));
  return warehouseRows;
}

/* R25.6 (Phase C): "auto" (default) hides whichever orientation doesn't
 * match the project currently open in the editor -- a landscape design in
 * progress shouldn't need to wade through portrait warehouse cards it can't
 * use as-is. The filter itself can still be flipped to browse anyway. */
function libraryOrientationWanted() {
  const mode = $('#libraryOrientationFilter')?.value || 'auto';
  if (mode === 'all') return null;
  if (mode === 'landscape' || mode === 'portrait') return mode;
  return editor.project.width > editor.project.height ? 'landscape' : 'portrait';
}

async function renderWarehouseLibrary() {
  const root = $('#warehouseLibrary');
  root.innerHTML = '<div class="empty-state panel">Đang tải</div>';
  try {
    const term = normalizeSearch($('#librarySearch').value.trim());
    const wanted = libraryOrientationWanted();
    const rows = (await loadWarehouseRows())
      .filter(row => !term || normalizeSearch(`${row.title} ${row.author}`).includes(term))
      .filter(row => !wanted || (row.width > row.height ? 'landscape' : 'portrait') === wanted)
      .filter(isPanelCompatibleRow)
      .filter(isPanel420AllowedRow);
    root.innerHTML = rows.length
      ? rows.map(row => designCard(row, 'warehouse')).join('')
      : '<div class="empty-state panel">Không tìm thấy giao diện (thử đổi bộ lọc hướng)</div>';
    bindLibraryCards(root, 'warehouse', rows);
  } catch (error) {
    root.innerHTML = `<div class="empty-state panel">${escapeHtml(error.message)}</div>`;
  }
}

function activeLibraryMode() {
  return $('.library-tab.active')?.dataset.library || 'warehouse';
}
function renderActiveLibrary() {
  const mode = activeLibraryMode();
  if (mode === 'warehouse') return renderWarehouseLibrary();
  return renderLocalLibrary();
}

$$('.library-tab').forEach(button => button.addEventListener('click', () => {
  $$('.library-tab').forEach(item=>item.classList.toggle('active',item===button));
  const mode=button.dataset.library;
  $('#localLibrary').classList.toggle('hidden',mode!=='local');
  $('#warehouseLibrary').classList.toggle('hidden',mode!=='warehouse');
  renderActiveLibrary();
}));
$('#librarySearch').addEventListener('input', renderActiveLibrary);
$('#libraryOrientationFilter')?.addEventListener('change', renderActiveLibrary);

/* R25.8 (mục 2e/2f): thay cho cơ chế tự bù ngầm cũ (đã bỏ hẳn khỏi
 * ble.js) -- một số hiệu chỉnh do người dùng tự nhập, lưu ở localStorage,
 * cộng vào giờ thực mỗi lần bấm "Đồng bộ giờ" (xem ble.js's
 * syncTimeUnlocked(correctionSec)). Lưu dạng giây (số nguyên) bất kể đơn
 * vị hiển thị là giây hay phút, để chỉ có một nguồn sự thật. */
const CLOCK_CORRECTION_KEY = 'tnvaClockCorrectionSec';
function loadClockCorrectionSec() {
  const raw = Number(localStorage.getItem(CLOCK_CORRECTION_KEY));
  return Number.isFinite(raw) ? raw : 0;
}
function renderClockCorrectionBadge(sec) {
  const badge = $('#clockCorrectionBadge');
  if (!badge) return;
  badge.classList.toggle('hidden', !sec);
  badge.textContent = sec ? ` · ${sec > 0 ? '+' : ''}${sec}s mỗi lần đồng bộ` : '';
}
(function initClockCorrectionUi() {
  const sec = loadClockCorrectionSec();
  const valueInput = $('#clockCorrectionValue');
  const unitSelect = $('#clockCorrectionUnit');
  if (!valueInput || !unitSelect) return;
  const useMinutes = sec !== 0 && sec % 60 === 0;
  unitSelect.value = useMinutes ? '60' : '1';
  valueInput.value = sec ? String(sec / (useMinutes ? 60 : 1)) : '';
  renderClockCorrectionBadge(sec);
})();
$('#clockCorrectionSaveBtn')?.addEventListener('click', () => {
  const valueInput = $('#clockCorrectionValue');
  const unit = Number($('#clockCorrectionUnit')?.value || 1);
  const raw = Number(valueInput?.value || 0);
  if (!Number.isFinite(raw)) { toast('Số hiệu chỉnh không hợp lệ', 'error'); return; }
  const sec = Math.round(raw) * unit;
  localStorage.setItem(CLOCK_CORRECTION_KEY, String(sec));
  renderClockCorrectionBadge(sec);
  toast(sec ? `Đã lưu hiệu chỉnh ${sec > 0 ? '+' : ''}${sec}s` : 'Đã tắt hiệu chỉnh giờ thủ công', 'success');
});

$('#syncTimeBtn').addEventListener('click', async () => {
  const button=$('#syncTimeBtn'); button.disabled=true;
  try {
    const correctionSec = loadClockCorrectionSec();
    updateDeviceStatus(await ble.syncTime(correctionSec));
    toast(correctionSec ? `Đã đồng bộ ngày giờ (kèm hiệu chỉnh ${correctionSec > 0 ? '+' : ''}${correctionSec}s)` : 'Đã đồng bộ ngày giờ', 'success');
  } catch(error){reportError(error);} finally { button.disabled=!ble.connected; }
});
$('#toggleHourBtn').addEventListener('click', async () => { try { await ble.toggleHourFormat(); toast('Đã đổi định dạng','success'); } catch(error){reportError(error);} });
/* R26.1 (Task 1 offline-activation): nguồn byte cho OTA giờ có 2 luồng --
 * chọn file thủ công (FEATURES.OTA_MANUAL_FILE, dưới đây) hoặc kênh GitHub
 * chính thức (FEATURES.OTA_GITHUB_CHANNEL, tab Firmware). Cả hai đều build
 * ra cùng một `release` shape rồi gọi runFirmwareUpdate() -- hàm này (và
 * ble.updateFirmware() nó gọi bên trong) là "phần truyền file" dùng chung,
 * KHÔNG đổi logic chunk/CRC/xác nhận theo nguồn file. */
function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/* Khai báo ở scope module (không trong khối FEATURES.OTA_MANUAL_FILE bên
 * dưới) vì setDeviceOffline() (phía trên, luôn chạy mỗi lần mất kết nối)
 * cần reset 2 biến này bất kể cờ bật hay tắt -- chỉ phần ĐĂNG KÝ listener
 * cho input file mới bị cờ chặn. */
let selectedFirmwareBin = null;
let selectedFirmwareSig = null;
function updateInstallFirmwareBtnState() {
  const button = $('#installFirmwareBtn');
  if (button) button.disabled = !(selectedFirmwareBin && selectedFirmwareSig);
}

/* Sau khi 0xa4 ACK báo đã ghi+xác minh xong, đồng hồ tự platform_reset()
 * ~0.5s sau (xem ota_reset_cb() trong user_custs1_impl.c) -- mất kết nối
 * ngay lúc đó là DẤU HIỆU THÀNH CÔNG, không phải lỗi. Dò lại tối đa 10s rồi
 * đọc FF01 để so version thật đang chạy với version vừa nạp: khớp = xác
 * nhận thành công, không khớp = đã rollback về slot cũ (ota_begin() chỉ
 * chuyển slot mới sau khi CRC32+SHA-256 toàn ảnh đạt, nên "không khớp" ở
 * đây luôn có nghĩa là bootloader tự quay lại ảnh cũ, không phải brick). */
async function waitForOtaReconnectAndVerify(expectedVersion) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!ble.connected) {
      try {
        const status = await ble.reconnectGranted();
        if (status?.time?.firmware) {
          return { outcome: status.time.firmware === expectedVersion ? 'verified' : 'rolledback', firmware: status.time.firmware };
        }
      } catch { /* Chưa quảng bá lại kịp, thử lại ở vòng sau. */ }
    }
    await delay(700);
  }
  return { outcome: 'timeout' };
}

/* Hàm OTA dùng chung -- cả luồng chọn-file-thủ-công (Task 1) lẫn kênh GitHub
 * (Task 2) đều gọi đúng hàm này, chỉ khác `release`/`expectedVersion`/`ui`
 * (bộ nút+progress bar riêng của từng tab). `release.download_url` có thể là
 * blob: (file cục bộ) hoặc https: (GitHub raw) -- ble.updateFirmware() tự
 * fetch() rồi validate size/SHA-256/CRC32/chữ ký/version, không phân biệt
 * nguồn. */
async function runFirmwareUpdate(release, expectedVersion, ui) {
  const { buttonEl, cancelBtnEl, progressEl, barEl, textEl } = ui;
  buttonEl.disabled = true; progressEl.classList.remove('hidden'); barEl.style.width = '0%';
  cancelBtnEl.classList.remove('hidden'); cancelBtnEl.disabled = false;
  const blockUnload = event => { event.preventDefault(); event.returnValue = ''; };
  window.addEventListener('beforeunload', blockUnload);
  try {
    await ble.updateFirmware(release, value => { barEl.style.width = `${value}%`; textEl.textContent = `${value}%`; });
    cancelBtnEl.classList.add('hidden');
    textEl.textContent = 'Đang khởi động lại...';
    const { outcome, firmware } = await waitForOtaReconnectAndVerify(expectedVersion);
    if (outcome === 'verified') toast(`Cập nhật thành công, phiên bản ${firmware}`, 'success');
    else if (outcome === 'rolledback') toast(`Đã rollback về bản cũ (không xác nhận được phiên bản ${expectedVersion}, đang chạy ${firmware})`, 'error');
    else toast('Chưa thấy đồng hồ sau 10s, đang chờ thêm -- kiểm tra lại sau, đây chưa hẳn là lỗi', 'warning');
  } catch (error) {
    cancelBtnEl.classList.add('hidden');
    if (error.otaCancelled) toast('Đã huỷ cập nhật, đồng hồ vẫn dùng bản cũ', 'success');
    else reportError(error);
  } finally {
    window.removeEventListener('beforeunload', blockUnload);
    buttonEl.disabled = false;
    setTimeout(() => progressEl.classList.add('hidden'), 1800);
    if (release.download_url?.startsWith('blob:')) URL.revokeObjectURL(release.download_url);
  }
}

/* R26.1 (Task 1): khối chọn-file-thủ-công -- ẩn hoàn toàn sau
 * FEATURES.OTA_MANUAL_FILE. Khi tắt, KHÔNG đăng ký bất kỳ listener nào cho
 * #firmwareBinFile/#firmwareSigFile/#installFirmwareBtn/#cancelFirmwareBtn
 * (tránh gọi được qua console/DevTools) và bỏ qua bước hiện lại
 * #firmwareUpdatePanel lúc kết nối (xem openConnectedApp() bên trên). */
if (FEATURES.OTA_MANUAL_FILE) {
  $('#firmwareBinFile')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    selectedFirmwareBin = file ? new Uint8Array(await file.arrayBuffer()) : null;
    updateInstallFirmwareBtnState();
  });
  $('#firmwareSigFile')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    selectedFirmwareSig = file ? new Uint8Array(await file.arrayBuffer()) : null;
    updateInstallFirmwareBtnState();
  });

  $('#cancelFirmwareBtn')?.addEventListener('click', () => {
    ble.cancelFirmwareUpdate();
    $('#cancelFirmwareBtn').disabled = true;
    $('#firmwareProgressText').textContent = 'Đang huỷ...';
  });

  $('#installFirmwareBtn')?.addEventListener('click', async () => {
    if (!selectedFirmwareBin || !selectedFirmwareSig) return;
    if (selectedFirmwareSig.length !== 116) {
      toast('File chữ ký phải đúng 116 byte (52 manifest + 64 chữ ký) -- lấy từ sign_ota.py, đừng sửa tay', 'error');
      return;
    }
    const manifest = selectedFirmwareSig.slice(0, 52);
    const signature = selectedFirmwareSig.slice(52);
    const release = {
      download_url: URL.createObjectURL(new Blob([selectedFirmwareBin])),
      manifest_b64: bytesToBase64(manifest),
      signature_b64: bytesToBase64(signature),
    };
    const expectedVersion = `${manifest[6]}.${manifest[7]}.${manifest[8]}`;
    await runFirmwareUpdate(release, expectedVersion, {
      buttonEl: $('#installFirmwareBtn'), cancelBtnEl: $('#cancelFirmwareBtn'),
      progressEl: $('#firmwareProgress'), barEl: $('#firmwareProgress').querySelector('span'),
      textEl: $('#firmwareProgressText'),
    });
  });
}

/* R26.1 (Task 2 offline-activation): tab "Firmware" -- kênh cập nhật CHÍNH
 * THỨC đọc manifest.json từ GitHub raw (FEATURES.OTA_GITHUB_CHANNEL). Ẩn cả
 * nút tab lẫn #firmwareView, không đăng ký listener nào khi tắt -- đồng nhất
 * cách làm với khối OTA_MANUAL_FILE ở trên. */
if (!FEATURES.OTA_GITHUB_CHANNEL) {
  $('#firmwareTabBtn')?.classList.add('hidden');
  $('#firmwareView')?.classList.add('hidden');
} else {
  /* So major/minor/patch bằng số, không so chuỗi ("1.9.0" phải > "1.10.0"
   * sai nếu so chuỗi) -- cùng thuật toán ble.js's updateFirmwareUnlocked()
   * (dòng ~1088) đã dùng để CHẶN THẬT ở tầng transport; hàm này chỉ dùng để
   * hiển thị đúng trạng thái TRƯỚC khi bấm nút, không thay thế kiểm tra đó. */
  const compareVersion = (a, b) => {
    const pa = String(a || '0.0.0').split('.').map(Number);
    const pb = String(b || '0.0.0').split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      const diff = (pa[index] || 0) - (pb[index] || 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  };

  const FW_MANIFEST_CACHE_KEY = 'tnvaFwManifestCache';
  const FW_MANIFEST_CACHE_TTL_MS = 10 * 60 * 1000;

  async function fetchFwManifest({ force = false } = {}) {
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(FW_MANIFEST_CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.at < FW_MANIFEST_CACHE_TTL_MS) return cached.manifest;
      } catch { /* Cache hỏng/không đọc được -- coi như chưa có, fetch lại. */ }
    }
    const response = await fetch(FW_MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Không tải được manifest.json (HTTP ${response.status})`);
    const manifest = await response.json();
    try { sessionStorage.setItem(FW_MANIFEST_CACHE_KEY, JSON.stringify({ at: Date.now(), manifest })); }
    catch { /* sessionStorage đầy/bị chặn (chế độ ẩn danh) -- không chặn luồng chính, chỉ mất cache. */ }
    return manifest;
  }

  let fwSelectedBuild = null;

  async function renderFirmwareTab() {
    const currentVersionEl = $('#fwCurrentVersion'), latestVersionEl = $('#fwLatestVersion');
    const connectRow = $('#fwConnectRow'), changelogEl = $('#fwChangelog'), statusEl = $('#fwStatusText');
    const updateBtn = $('#fwUpdateBtn'), retryBtn = $('#fwRetryBtn');
    fwSelectedBuild = null;
    updateBtn.classList.add('hidden');
    retryBtn.classList.add('hidden');
    changelogEl.classList.add('hidden');
    connectRow.classList.toggle('hidden', ble.connected);

    if (!ble.connected) {
      currentVersionEl.textContent = 'Chưa kết nối';
      latestVersionEl.textContent = '--';
      statusEl.textContent = 'Kết nối đồng hồ để kiểm tra cập nhật';
      return;
    }
    const currentVersion = lastDeviceStatus?.time?.firmware || null;
    currentVersionEl.textContent = currentVersion || '--';

    statusEl.textContent = 'Đang kiểm tra bản cập nhật...';
    let manifest;
    try {
      manifest = await fetchFwManifest();
    } catch (error) {
      latestVersionEl.textContent = '--';
      statusEl.textContent = 'Không kiểm tra được bản cập nhật. Kiểm tra kết nối mạng.';
      retryBtn.classList.remove('hidden');
      return;
    }

    /* Task 3 mục 4: bỏ qua mọi build panel 4.2" khi FEATURES.PANEL_420 tắt
     * -- panel==='213' đã tự loại '420' rồi, giữ điều kiện tường minh phòng
     * khi manifest tương lai gộp nhiều panel khác cấu trúc. */
    const build = (manifest.builds || []).find(entry =>
      entry.panel === '213' && (FEATURES.PANEL_420 || entry.panel !== '420'));
    if (!build) {
      latestVersionEl.textContent = '--';
      statusEl.textContent = 'Không có bản cập nhật cho panel 2.13" trong manifest.';
      return;
    }
    latestVersionEl.textContent = build.version;

    if (compareVersion(build.version, currentVersion) <= 0) {
      statusEl.textContent = `Đồng hồ đang chạy phiên bản mới nhất (v${currentVersion})`;
      return;
    }

    fwSelectedBuild = build;
    changelogEl.textContent = build.notes || '';
    changelogEl.classList.remove('hidden');
    statusEl.textContent = '';
    updateBtn.classList.remove('hidden');
  }

  $('#fwConnectBtn')?.addEventListener('click', event => connect(event.currentTarget));
  $('#fwRetryBtn')?.addEventListener('click', () => { renderFirmwareTab().catch(reportError); });
  $('#fwCancelBtn')?.addEventListener('click', () => {
    ble.cancelFirmwareUpdate();
    $('#fwCancelBtn').disabled = true;
    $('#fwProgressText').textContent = 'Đang huỷ...';
  });
  $('#fwUpdateBtn')?.addEventListener('click', async () => {
    if (!fwSelectedBuild) return;
    const build = fwSelectedBuild;
    const updateBtn = $('#fwUpdateBtn');
    updateBtn.disabled = true;
    /* Chốt với người dùng (xem lệnh gộp offline-activation, Task 2): mỗi
     * bản .bin trên GitHub kèm 1 file <file>.ota-sig.bin cùng thư mục --
     * đúng convention tools/ota-sign/sign_ota.py đã xuất mặc định. Không có
     * file này, ble.updateFirmware() sẽ từ chối ở bước validate chữ ký
     * (spi_flash.c's ota_begin() cũng từ chối y hệt trên chip thật). */
    let release;
    try {
      const sigResponse = await fetch(FW_BASE_URL + build.file + '.ota-sig.bin', { cache: 'no-store' });
      if (!sigResponse.ok) throw new Error('Không tải được file chữ ký .ota-sig.bin -- kiểm tra file này có tồn tại cùng thư mục trên GitHub không');
      const sigBytes = new Uint8Array(await sigResponse.arrayBuffer());
      if (sigBytes.length !== 116) throw new Error('File .ota-sig.bin sai định dạng (phải đúng 116 byte: 52 manifest + 64 chữ ký)');
      release = {
        download_url: FW_BASE_URL + build.file,
        manifest_b64: bytesToBase64(sigBytes.slice(0, 52)),
        signature_b64: bytesToBase64(sigBytes.slice(52)),
        sha256: build.sha256, version: build.version, size_bytes: build.size,
      };
    } catch (error) {
      reportError(error);
      updateBtn.disabled = false;
      return;
    }
    await runFirmwareUpdate(release, build.version, {
      buttonEl: updateBtn, cancelBtnEl: $('#fwCancelBtn'),
      progressEl: $('#fwProgress'), barEl: $('#fwProgress').querySelector('span'),
      textEl: $('#fwProgressText'),
    });
    await renderFirmwareTab().catch(() => {});
  });

  refreshFirmwareTab = renderFirmwareTab; // gán vào biến module-scope khai báo phía trên -- xem showView()/updateDeviceStatus()/setDeviceOffline().
}

function downloadActivity(name, data, type) {
  download(name, new Blob([data], {type}));
}
$('#copyLogBtn')?.addEventListener('click', async () => {
  const text=activityEntries.map(activityLine).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Đã sao chép nhật ký','success'); }
  catch { toast('Không sao chép được nhật ký','error'); }
});
/* R25.6 (Phase E): "for support" framing -- a one-line context header so a
 * support ticket doesn't need the user to retype device name/firmware/id.
 * Body stays the exact flat activityLine() format used on screen and for
 * clipboard copy, unchanged, so existing support tooling that parses this
 * export keeps working. */
$('#downloadLogTxtBtn')?.addEventListener('click', () => {
  const header = [
    `TNVA Studio -- nhật ký hoạt động, xuất lúc ${new Date().toISOString()}`,
    `Thiết bị: ${lastDeviceStatus?.name || '(chưa kết nối)'}`,
    `Firmware: ${lastDeviceStatus?.time?.firmware || '--'}  ·  Device ID: ${lastDeviceStatus?.time?.deviceId || '--'}`,
    '---'
  ].join('\n');
  downloadActivity(`tnva-log-${new Date().toISOString().replace(/[:.]/g,'-')}.txt`, `${header}\n${activityEntries.map(activityLine).join('\n')}`, 'text/plain;charset=utf-8');
});
$('#downloadLogJsonBtn')?.addEventListener('click', () => downloadActivity(`tnva-log-${new Date().toISOString().replace(/[:.]/g,'-')}.json`, JSON.stringify({version:2,entries:activityEntries},null,2), 'application/json'));
$('#clearLogBtn').addEventListener('click', () => { activityEntries=[]; localStorage.removeItem(ACTIVITY_LOG_KEY); renderActivityLog(); $('#liveActivity').textContent='Sẵn sàng'; });
$('#logSeverityFilter')?.addEventListener('change', renderActivityLog);


function markBuiltinFace(faceId) {
  $$('[data-face-card]').forEach(card => card.classList.toggle('active-face', Number(card.dataset.faceCard) === Number(faceId)));
}

/* R26: Tự động đổi giao diện (Auto Rotate). Phase-1 scope (xem
 * docs/AUTO_ROTATE_TNVA.md cho lý do): chỉ 6 mặt tích hợp + đúng 1 "mặt
 * tuỳ chỉnh hiện có" (id 6 -- bất kể đó là giao diện lấy từ Kho hay ảnh
 * khách tự tải, firmware/flash không phân biệt, đều là cùng một slot A/B
 * đang có). Không polling giây qua BLE cho countdown -- chỉ đọc
 * elapsedMinutes mỗi ~5s (deviceTimer có sẵn) rồi tự đếm lùi bằng
 * setInterval 1s thuần JS phía web (mục K). */
const AUTO_ROTATE_ITEM_NAMES = [
  'Mặt 01 · Giờ + âm lịch',
  'Mặt 02 · Dọc · Thông tin',
  'Mặt 03 · Dọc · Lịch âm',
  'Mặt 04 · Lịch tháng chia đôi',
  'Mặt 05 · Lịch âm chi tiết',
  'Mặt 06 · Sự kiện sắp tới',
  'Ảnh tuỳ chỉnh hiện có (Kho giao diện / ảnh khách)'
];
let autoRotateItems = [];          // mảng thứ tự các id (0..6) đang bật, local (có thể chưa lưu)
let autoRotateEnabledLocal = false;
let autoRotateIntervalLocal = 10;
let autoRotateDirty = false;       // true khi người dùng vừa sửa, chưa bấm Lưu -- chặn poll ghi đè
let autoRotateElapsedMinutes = 0;
let autoRotateCustomAvailable = false;
let autoRotateCountdownTimer = null;

function renderAutoRotatePanel() {
  const enabledCb = $('#autoRotateEnabled');
  if (enabledCb) enabledCb.checked = autoRotateEnabledLocal;
  const intervalInput = $('#autoRotateIntervalInput');
  if (intervalInput && document.activeElement !== intervalInput) intervalInput.value = autoRotateIntervalLocal;
  $$('#autoRotateIntervalPresets button').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.minutes) === autoRotateIntervalLocal);
  });
  const list = $('#autoRotateItemList');
  if (!list) return;
  const order = autoRotateItems.slice();
  for (let id = 0; id < AUTO_ROTATE_ITEM_NAMES.length; id++) if (!order.includes(id)) order.push(id);
  list.innerHTML = order.map(id => {
    const included = autoRotateItems.includes(id);
    const idx = autoRotateItems.indexOf(id);
    const unavailable = id === 6 && !autoRotateCustomAvailable;
    return `<li class="auto-rotate-item-row${included ? ' included' : ''}${unavailable ? ' unavailable' : ''}" data-item="${id}">
      <label><input type="checkbox" data-toggle-item="${id}" ${included ? 'checked' : ''} ${unavailable ? 'disabled' : ''}>
      <span>${AUTO_ROTATE_ITEM_NAMES[id]}${unavailable ? ' <i>(chưa có ảnh trên máy)</i>' : ''}</span></label>
      <span class="auto-rotate-item-actions">
        <button type="button" data-move-up="${id}" ${!included || idx === 0 ? 'disabled' : ''} title="Lên">↑</button>
        <button type="button" data-move-down="${id}" ${!included || idx === autoRotateItems.length - 1 ? 'disabled' : ''} title="Xuống">↓</button>
      </span></li>`;
  }).join('');
}

function moveAutoRotateItem(id, direction) {
  const idx = autoRotateItems.indexOf(id);
  const swapIdx = idx + direction;
  if (idx < 0 || swapIdx < 0 || swapIdx >= autoRotateItems.length) return;
  [autoRotateItems[idx], autoRotateItems[swapIdx]] = [autoRotateItems[swapIdx], autoRotateItems[idx]];
  autoRotateDirty = true;
  renderAutoRotatePanel();
}

$('#autoRotateItemList')?.addEventListener('click', event => {
  const upBtn = event.target.closest('[data-move-up]:not([disabled])');
  const downBtn = event.target.closest('[data-move-down]:not([disabled])');
  if (upBtn) moveAutoRotateItem(Number(upBtn.dataset.moveUp), -1);
  else if (downBtn) moveAutoRotateItem(Number(downBtn.dataset.moveDown), 1);
});
$('#autoRotateItemList')?.addEventListener('change', event => {
  const toggle = event.target.closest('[data-toggle-item]');
  if (!toggle) return;
  const id = Number(toggle.dataset.toggleItem);
  autoRotateDirty = true;
  if (toggle.checked) { if (!autoRotateItems.includes(id)) autoRotateItems.push(id); }
  else { autoRotateItems = autoRotateItems.filter(existing => existing !== id); }
  renderAutoRotatePanel();
});
$('#autoRotateEnabled')?.addEventListener('change', event => {
  autoRotateEnabledLocal = event.target.checked;
  autoRotateDirty = true;
});
$('#autoRotateIntervalPresets')?.addEventListener('click', event => {
  const btn = event.target.closest('button[data-minutes]');
  if (!btn) return;
  autoRotateIntervalLocal = Number(btn.dataset.minutes);
  autoRotateDirty = true;
  renderAutoRotatePanel();
});
$('#autoRotateIntervalInput')?.addEventListener('change', event => {
  let value = Math.round(Number(event.target.value) || 0);
  if (value < 1) value = 1;
  if (value > 1440) value = 1440;
  autoRotateIntervalLocal = value;
  autoRotateDirty = true;
  renderAutoRotatePanel();
});

function updateAutoRotateCountdown() {
  const wrap = $('#autoRotateCountdown');
  const valueEl = $('#autoRotateCountdownValue');
  if (!wrap || !valueEl) return;
  if (autoRotateCountdownTimer) { clearInterval(autoRotateCountdownTimer); autoRotateCountdownTimer = null; }
  if (!autoRotateEnabledLocal || autoRotateItems.length < 2) { wrap.hidden = true; return; }
  wrap.hidden = false;
  let remainingSec = Math.max(0, (autoRotateIntervalLocal - autoRotateElapsedMinutes) * 60);
  const render = () => {
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    valueEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  render();
  autoRotateCountdownTimer = setInterval(() => {
    remainingSec = Math.max(0, remainingSec - 1);
    render();
    if (remainingSec <= 0) { clearInterval(autoRotateCountdownTimer); autoRotateCountdownTimer = null; }
  }, 1000);
}

/* Gọi từ updateDeviceStatus() mỗi lần đọc FF01 (kết nối lần đầu + mỗi 5s).
 * Không ghi đè state khi người dùng đang sửa dở (autoRotateDirty) -- tránh
 * mất thao tác đang làm giữa hai lần poll. */
function syncAutoRotateFromStatus(time) {
  const panel = $('#autoRotatePanel');
  if (!panel) return;
  const ar = time?.autoRotate;
  if (!ar) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  autoRotateCustomAvailable = Boolean(time?.customValid);
  autoRotateElapsedMinutes = ar.elapsedMinutes;
  if (!autoRotateDirty) {
    autoRotateEnabledLocal = ar.enabled;
    autoRotateIntervalLocal = ar.intervalMinutes;
    autoRotateItems = ar.items.slice(0, ar.itemCount).filter(id => id >= 0 && id < AUTO_ROTATE_ITEM_NAMES.length);
    renderAutoRotatePanel();
  } else {
    renderAutoRotatePanel();
  }
  updateAutoRotateCountdown();
}

$('#autoRotateSaveBtn')?.addEventListener('click', async () => {
  if (!ble.connected) return;
  const statusEl = $('#autoRotateStatus');
  try {
    setBleOperationBusy(true, 'auto-rotate');
    const status = await ble.setAutoRotateConfig({
      enabled: autoRotateEnabledLocal,
      intervalMinutes: autoRotateIntervalLocal,
      items: autoRotateItems
    });
    autoRotateDirty = false;
    updateDeviceStatus(status);
    if (statusEl) statusEl.textContent = 'Đã lưu.';
    toast('Đã lưu tự động đổi giao diện', 'success');
    log('Đã lưu cấu hình tự động đổi giao diện');
  } catch (error) {
    if (statusEl) statusEl.textContent = `Lỗi: ${error.message}`;
    toast(`Lỗi lưu tự động đổi giao diện: ${error.message}`, 'error');
  } finally {
    setBleOperationBusy(false, 'auto-rotate');
  }
});

$$('.apply-face').forEach(button => button.addEventListener('click', async () => {
  /* R25.9 (mục 11ss/uu): nút áp dụng đã bị vô hiệu hoá đồng loạt bởi
   * setBleOperationBusy() ngay khi ble.selectFace() bắt đầu (runExclusive
   * gọi operationListeners trước khi làm gì khác) -- dòng này chỉ chặn
   * thêm cú nhấp đầu tiên trước khi listener kịp chạy, không phải cơ chế
   * chính. Bấm dồn 10 lần: chỉ lệnh cuối cùng còn hiệu lực vì mọi nút đều
   * disabled trong lúc thao tác đang chạy -- xem test tay ở báo cáo. */
  button.disabled = true;
  const id = Number(button.dataset.face);
  try {
    toast('Đang đổi giao diện…');
    log(`Đang áp dụng mặt tích hợp ${id + 1}`);
    const status = await ble.selectFace(id, secondsLeft => {
      $('#liveActivity').textContent = secondsLeft > 0
        ? `Đang cập nhật màn hình… (còn ~${secondsLeft}s)`
        : 'Đang cập nhật màn hình…';
    });
    updateDeviceStatus(status);
    log(`Đã áp dụng mặt tích hợp ${id + 1}`);
    toast('Đã đổi giao diện', 'success');
  } catch (error) { reportError(error); }
  finally { if (lastDeviceStatus) updateDeviceStatus(lastDeviceStatus); }
}));

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function buildTnf1(bitplane, descriptors = [], strings = new Uint8Array(), packageId = 0) {
  const descBytes = descriptors.length ? concatBytes(...descriptors) : new Uint8Array();
  const payload = concatBytes(bitplane, descBytes, strings);
  const total = 24 + payload.length;
  if (total > 4096) throw new Error('Gói vượt quá 4 KB');
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x31464e54, true);
  header[4] = 2; header[5] = 212; header[6] = 104; header[7] = 27;
  view.setUint16(8, bitplane.length, true);
  header[10] = descriptors.length; header[11] = 16;
  view.setUint16(12, strings.length, true);
  view.setUint16(14, total, true);
  const payloadCrc=crc32(payload);
  view.setUint32(16, (packageId>>>0) || ((payloadCrc^0x544e5641)>>>0) || 1, true);
  view.setUint32(20, payloadCrc, true);
  return concatBytes(header, payload);
}

function encodeUtf8Limited(text, maxBytes) {
  const chars=Array.from(normalizeVietnameseText(text));
  let bytes=new TextEncoder().encode(chars.join(''));
  while(bytes.length>maxBytes && chars.length){ chars.pop(); bytes=new TextEncoder().encode(chars.join('')); }
  return bytes;
}

function canvasToBitplane(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  const { data } = ctx.getImageData(0, 0, 212, 104);
  return packBitplaneRowMajor(data, 212, 104);
}

const photoCanvas = $('#photoCanvas');
const photoCtx = photoCanvas.getContext('2d', { willReadFrequently:true });
const photoSource = document.createElement('canvas'); photoSource.width = 212; photoSource.height = 104;
let photoImage = null;
let photoState = { scale:1, x:0, y:0, rotation:0, flipH:1, flipV:1, dragging:false, px:0, py:0 };

function valueOf(id) { return Number($(id).value); }
function renderPhoto() {
  const w = 212, h = 104;
  const raw = document.createElement('canvas'); raw.width = w; raw.height = h;
  const rctx = raw.getContext('2d', { willReadFrequently:true });
  rctx.fillStyle = '#fff'; rctx.fillRect(0,0,w,h);
  if (photoImage) {
    const fit = $('#photoFit').value;
    const angle = ((photoState.rotation % 360) + 360) % 360;
    const rotated = angle === 90 || angle === 270;
    const iw = rotated ? photoImage.height : photoImage.width;
    const ih = rotated ? photoImage.width : photoImage.height;
    const base = fit === 'contain' ? Math.min(w/iw,h/ih) : Math.max(w/iw,h/ih);
    const scale = base * photoState.scale;
    rctx.save();
    rctx.translate(w/2 + photoState.x, h/2 + photoState.y);
    rctx.scale(photoState.flipH, photoState.flipV);
    rctx.rotate(angle * Math.PI / 180);
    rctx.imageSmoothingEnabled = true;
    rctx.drawImage(photoImage, -photoImage.width*scale/2, -photoImage.height*scale/2, photoImage.width*scale, photoImage.height*scale);
    rctx.restore();
  } else {
    rctx.strokeStyle='#000';rctx.lineWidth=1;rctx.strokeRect(8.5,8.5,194,86);
    rctx.strokeRect(78.5,20.5,55,31);rctx.beginPath();rctx.moveTo(82,47);rctx.lineTo(95,35);rctx.lineTo(103,42);rctx.lineTo(112,30);rctx.lineTo(130,47);rctx.stroke();
    rctx.fillStyle='#000';rctx.fillRect(122,25,4,4);
    drawBitmapAligned(rctx,'small','CHỌN ẢNH',12,57,188,'center','#000');
    const hint='212X104 · 1-BIT',hintW=tinyTextWidth(hint,1);
    drawTinyText(rctx,alignedX(12,188,hintW,'center'),76,hint,1,'#000');
  }
  const image = rctx.getImageData(0,0,w,h);
  const src = new Float32Array(w*h);
  const brightness = valueOf('#photoBrightness') * 2.0;
  const contrast = valueOf('#photoContrast') / 100;
  for(let i=0;i<src.length;i++){
    const p=i*4; const gray=.299*image.data[p]+.587*image.data[p+1]+.114*image.data[p+2];
    src[i]=Math.max(0,Math.min(255,(gray-128)*contrast+128+brightness));
  }
  const sharp = valueOf('#photoSharpness')/100;
  if(sharp>0){
    const copy=src.slice();
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x; const blur=(copy[i-w]+copy[i+w]+copy[i-1]+copy[i+1]+copy[i])/5;
      src[i]=Math.max(0,Math.min(255,copy[i]+(copy[i]-blur)*sharp*2.2));
    }
  }
  const threshold=valueOf('#photoThreshold');
  const mode=$('#photoDither').value;
  const out=new Uint8ClampedArray(w*h);
  if(mode==='floyd'){
    const work=src.slice();
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x, old=work[i], val=old<threshold?0:255, err=old-val;out[i]=val;
      if(x+1<w)work[i+1]+=err*7/16;if(y+1<h){if(x>0)work[i+w-1]+=err*3/16;work[i+w]+=err*5/16;if(x+1<w)work[i+w+1]+=err/16;}
    }
  }else if(mode==='ordered'){
    const m=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;out[i]=src[i] < threshold + (m[y&3][x&3]-7.5)*7 ? 0:255;}
  }else{for(let i=0;i<src.length;i++)out[i]=src[i]<threshold?0:255;}
  const final=photoCtx.createImageData(w,h);
  for(let i=0;i<out.length;i++){const p=i*4;final.data[p]=final.data[p+1]=final.data[p+2]=out[i];final.data[p+3]=255;}
  photoCtx.putImageData(final,0,0);
  $('#photoZoomLabel').textContent=`${Math.round(photoState.scale*100)}%`;
  for(const [id,outId] of [['#photoBrightness','#photoBrightnessValue'],['#photoContrast','#photoContrastValue'],['#photoThreshold','#photoThresholdValue'],['#photoSharpness','#photoSharpnessValue']]) $(outId).textContent=$(id).value;
}

$('#photoInput').addEventListener('change', event => {
  const file=event.target.files?.[0]; event.target.value=''; if(!file)return;
  const image=new Image(); image.onload=()=>{photoImage=image;photoState={scale:1,x:0,y:0,rotation:0,flipH:1,flipV:1,dragging:false,px:0,py:0};renderPhoto();URL.revokeObjectURL(image.src);}; image.src=URL.createObjectURL(file);
});
['#photoFit','#photoDither','#photoBrightness','#photoContrast','#photoThreshold','#photoSharpness'].forEach(id=>$(id).addEventListener('input',renderPhoto));
$('#photoZoomIn').onclick=()=>{photoState.scale=Math.min(5,photoState.scale+.1);renderPhoto();};
$('#photoZoomOut').onclick=()=>{photoState.scale=Math.max(.2,photoState.scale-.1);renderPhoto();};
$('#photoRotateLeft').onclick=()=>{photoState.rotation-=90;renderPhoto();};
$('#photoRotateRight').onclick=()=>{photoState.rotation+=90;renderPhoto();};
$('#photoFlipH').onclick=()=>{photoState.flipH*=-1;renderPhoto();};
$('#photoFlipV').onclick=()=>{photoState.flipV*=-1;renderPhoto();};
$('#photoReset').onclick=()=>{photoState={scale:1,x:0,y:0,rotation:0,flipH:1,flipV:1,dragging:false,px:0,py:0};$('#photoBrightness').value=0;$('#photoContrast').value=120;$('#photoThreshold').value=145;$('#photoSharpness').value=35;renderPhoto();};
$('#photoAuto').onclick=()=>{$('#photoBrightness').value=5;$('#photoContrast').value=145;$('#photoThreshold').value=150;$('#photoSharpness').value=45;$('#photoDither').value='floyd';renderPhoto();};
photoCanvas.addEventListener('pointerdown',e=>{photoState.dragging=true;photoState.px=e.clientX;photoState.py=e.clientY;photoCanvas.setPointerCapture(e.pointerId);});
photoCanvas.addEventListener('pointermove',e=>{if(!photoState.dragging)return;const rect=photoCanvas.getBoundingClientRect();photoState.x+=(e.clientX-photoState.px)*212/rect.width;photoState.y+=(e.clientY-photoState.py)*104/rect.height;photoState.px=e.clientX;photoState.py=e.clientY;renderPhoto();});
photoCanvas.addEventListener('pointerup',()=>{photoState.dragging=false;});
$('#photoUpload').onclick=async()=>{try{if(!photoImage)throw new Error('Chưa chọn ảnh');log('Đang xử lý và gửi ảnh tĩnh',{operation:'photo-upload',step:'prepare',orientation:'landscape'});const plane=canvasToBitplane(photoCanvas);const packet=buildTnf1(plane);await ble.uploadFace(packet);log('Ảnh tĩnh đã lưu',{operation:'photo-upload',step:'confirmed',size:packet.length,crc32:crc32(packet).toString(16).padStart(8,'0'),orientation:'landscape',result:'ok'});toast('Ảnh đang hiển thị trên đồng hồ','success');}catch(error){log(`Lỗi gửi ảnh: ${error.message}`,{operation:'photo-upload',step:'error',error:error.message,result:'error'});reportError(error);}};

const countdownCanvas=$('#countdownCanvas');
const countdownCtx=countdownCanvas.getContext('2d');
function countdownValues(){const target=new Date($('#countdownTarget').value);const diff=Math.max(0,target-Date.now());return{days:Math.floor(diff/86400000),hours:Math.floor(diff%86400000/3600000),minutes:Math.floor(diff%3600000/60000),target};}
function countdownTargetText(t){return Number.isNaN(t.getTime())?'--/--/---- --:--':`${String(t.getDate()).padStart(2,'0')}/${String(t.getMonth()+1).padStart(2,'0')}/${t.getFullYear()} ${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`;}
function renderCountdown(){
 const {days,hours,minutes,target}=countdownValues(); const mode=$('#countdownMode').value; const custom=mode==='custom';
 $('.countdown-form').classList.toggle('default-mode',!custom);
 const title=($('#countdownTitle').value||'Sinh Nhật').slice(0,32); const framed=custom&&$('#countdownStyle').value==='frame'; const size=custom?Number($('#countdownSize').value):1;
 countdownCtx.fillStyle='#fff';countdownCtx.fillRect(0,0,212,104);countdownCtx.strokeStyle='#000';countdownCtx.lineWidth=1;countdownCtx.strokeRect(2.5,2.5,207,99);
 if(framed){countdownCtx.fillStyle='#000';countdownCtx.fillRect(6,5,200,15);}
 const left=5,top=4,width=202,height=96;
 const titleY=top+(custom?(framed?3:2):1);
 drawBitmapAligned(countdownCtx,'small',title,left+2,titleY,width-4,'center',framed?'#fff':'#000');
 const main=days>0?String(days):`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
 const mainW=bitmapTextWidth('large',main),mainY=top+18+(custom&&size===0?7:0);
 drawBitmapText(countdownCtx,'large',alignedX(left,width,mainW,'center'),mainY,main,'#000');
 let sub=custom?($('#countdownSubtitle').value||'').replaceAll('{H}',String(hours).padStart(2,'0')).replaceAll('{M}',String(minutes).padStart(2,'0')):`NGÀY - ${String(hours).padStart(2,'0')} GIỜ ${String(minutes).padStart(2,'0')} PHÚT`;
 const showTarget=!custom||$('#countdownShowTarget').checked;
 const subY=top+height-(custom?(showTarget?25:15):27);
 drawBitmapAligned(countdownCtx,'small',sub,left+2,subY,width-4,'center','#000');
 if(showTarget){const targetText=countdownTargetText(target),targetW=tinyTextWidth(targetText,1);drawTinyText(countdownCtx,alignedX(left+2,width-4,targetW,'center'),top+height-(custom?10:11),targetText,1,'#000');}
 $('#countdownReadout').textContent=`${days} ngày ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
}
function makeCountdownPackage(){
 const target=new Date($('#countdownTarget').value);if(Number.isNaN(target.getTime()))throw new Error('Chưa chọn ngày giờ đích');
 const custom=$('#countdownMode').value==='custom';const title=($('#countdownTitle').value||'Sinh Nhật').trim();const subtitle=custom?($('#countdownSubtitle').value||'').trim():'';
 const stamp=`${target.getFullYear()}${String(target.getMonth()+1).padStart(2,'0')}${String(target.getDate()).padStart(2,'0')}${String(target.getHours()).padStart(2,'0')}${String(target.getMinutes()).padStart(2,'0')}|${title}|${subtitle}`;
 const strings=encodeUtf8Limited(stamp,95); const c=document.createElement('canvas');c.width=212;c.height=104;const cx=c.getContext('2d');cx.fillStyle='#fff';cx.fillRect(0,0,212,104);
 let style=0;if(custom){style|=2;if($('#countdownStyle').value==='frame')style|=1;style|=(Number($('#countdownSize').value)&3)<<2;if($('#countdownShowTarget').checked)style|=0x20;}
 const d=new Uint8Array(16);d.set([10,1,1,0,5,4,202,96,50,7,0,0,strings.length,style,0,0]);return buildTnf1(canvasToBitplane(c),[d],strings,crc32(strings));
}
$('#countdownForm').addEventListener('submit',async e=>{e.preventDefault();try{const packet=makeCountdownPackage();const view=new DataView(packet.buffer,packet.byteOffset,packet.byteLength);log('Đang gửi đếm ngược',{operation:'countdown',step:'prepare',packageId:view.getUint32(16,true),title:$('#countdownTitle').value,size:packet.length,crc32:view.getUint32(20,true).toString(16).padStart(8,'0'),orientation:'landscape'});await ble.uploadFace(packet);localStorage.setItem('tnvaCountdown',JSON.stringify({mode:$('#countdownMode').value,title:$('#countdownTitle').value,subtitle:$('#countdownSubtitle').value,target:$('#countdownTarget').value,style:$('#countdownStyle').value,size:$('#countdownSize').value,showTarget:$('#countdownShowTarget').checked}));log('Đếm ngược đã lưu',{operation:'countdown',step:'confirmed',packageId:view.getUint32(16,true),size:packet.length,crc32:view.getUint32(20,true).toString(16).padStart(8,'0'),result:'ok'});toast('Đã gửi vào đồng hồ','success');}catch(error){log(`Lỗi đếm ngược: ${error.message}`,{operation:'countdown',step:'error',error:error.message,result:'error'});reportError(error);}});
['#countdownMode','#countdownTitle','#countdownSubtitle','#countdownTarget','#countdownStyle','#countdownSize','#countdownShowTarget'].forEach(id=>$(id).addEventListener('input',renderCountdown));
const savedCountdown=JSON.parse(localStorage.getItem('tnvaCountdown')||'null');if(savedCountdown){$('#countdownMode').value=savedCountdown.mode||'default';$('#countdownTitle').value=savedCountdown.title||'Sinh Nhật';$('#countdownSubtitle').value=savedCountdown.subtitle||'NGÀY - {H} GIỜ {M} PHÚT';$('#countdownTarget').value=savedCountdown.target||'';$('#countdownStyle').value=savedCountdown.style||'clean';$('#countdownSize').value=savedCountdown.size||'1';$('#countdownShowTarget').checked=savedCountdown.showTarget!==false;}else{const d=new Date(Date.now()+7*86400000);d.setSeconds(0,0);$('#countdownTarget').value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}setInterval(renderCountdown,30000);renderCountdown();renderPhoto();

editor.newProject('212x104');
updateZoom();
renderLayers();
setDeviceOffline();
renderActiveLibrary();


const previewParams = new URLSearchParams(location.search);
if (previewParams.get('offline') === '1') {
  openStudioOffline();
  const view = previewParams.get('view');
  if (view && ['main','library','designer','image','countdown'].includes(view)) showView(view);
}
