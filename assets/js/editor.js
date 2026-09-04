import { DEVICE } from './config.js';
import { PANEL_PROFILES, DEFAULT_PROFILE_KEY } from './panel_profiles.js';
import {
  alignedX, bitmapTextWidth, drawBitmapText,
  drawScaledBitmapText, drawTinyText, isClockBitmapFont,
  scaledBitmapTextWidth, tinyTextWidth, SFONT_MASTER_HEIGHT
} from './device-fonts.js';
import {
  ATLAS_FONTS, ATLAS_MIN_SCRIPT_PX, DIGIT_EFFECT_DIRS, FONT_FAMILY_CSS,
  atlasFontMinPx, atlasFontWeight, packBitplaneRowMajor,
  atlasTextWidth, blitAtlasBytes
} from './atlas-generator.js';
import { crisp213TextPlan } from './text-size-policy.js';
import { tetDecorationById, tetDecorationSize } from './tet-decorations.js';
import {
  TN42_FLAG_INVERSE, TN42_FLAG_LONG, TN42_FLAG_SECONDS, TN42_FLAG_RED,
  TN42_DESCRIPTOR_BYTES, TN42_MAX_DESCRIPTORS, TN42_PHYSICAL_WIDTH, TN42_PHYSICAL_HEIGHT,
  TN42_MAX_PACKAGE_BYTES, buildTn42Package,
} from './tn42-encoder.js';

/* R25.12 (mục 4): dayOnly/monthOnly/yearOnly -- 3 widget MỚI, độc lập với
 * 'date' (giữ nguyên, không đụng) -- mỗi cái chỉ hiện MỘT thành phần ngày
 * tháng năm, tự do đặt vị trí/cỡ/font riêng. Dùng lại nguyên cơ chế
 * TNVA_DYN_TEMPLATE có sẵn (như canchi/holiday/temperature/batteryPercent)
 * -- xem TEMPLATE_COMPONENTS/DEVICE_DYNAMIC_TYPE bên dưới -- KHÔNG cần sửa
 * firmware (render_template() đã xử lý @d/@M/@y đơn lẻ sẵn). */
const DYNAMIC_TYPES = new Set(['time', 'date', 'weekday', 'lunar', 'canchi', 'holiday', 'temperature', 'voltage', 'batteryPercent', 'battery', 'analog', 'calendar', 'calendarWeek', 'weekStrip', 'dayOnly', 'monthOnly', 'yearOnly']);
const TYPE_LABELS = {
  text: 'Chữ', time: 'Giờ', date: 'Ngày', weekday: 'Thứ', lunar: 'Âm lịch',
  canchi: 'Can Chi', holiday: 'Ngày lễ', temperature: 'Nhiệt độ', voltage: 'Điện áp',
  batteryPercent: 'Phần trăm pin', battery: 'Pin', analog: 'Đồng hồ kim', calendar: 'Lịch tháng',
  /* Tên cũ gây hiểu nhầm: đối tượng này vẫn là lịch THÁNG, chỉ bỏ tiêu đề.
     Dải 7 ngày thật sự là "Lịch tuần thẻ" bên dưới. Giữ lại kiểu này để các
     thiết kế cũ mở lên không hỏng, nhưng không còn nút thêm mới. */
  calendarWeek: 'Lịch tháng · không tiêu đề',
  weekStrip: 'Lịch tuần thẻ',
  image: 'Ảnh', line: 'Đường', rect: 'Khung', shape: 'Hình học', legacyShape: 'Hình gốc',
  invertRegion: 'Vùng tô',
  /* R25.12 (mục 4): 3 widget mới, tách riêng khỏi 'date' (Ngày, vẫn giữ
     nguyên nghĩa "ngày tháng năm gộp" như cũ). */
  dayOnly: 'Ngày (riêng)', monthOnly: 'Tháng (riêng)', yearOnly: 'Năm (riêng)'
};
/* Kho cộng đồng (2026-09): whitelist ID widget hợp lệ dùng để chặn upload
 * thiết kế mang loại đối tượng lạ (từ bản Studio tương lai/khác) lên Kho --
 * TYPE_LABELS đã là danh sách đầy đủ mọi 'type' hợp lệ hiện có (nguồn duy
 * nhất, không lặp lại tay lần thứ 2 -- xem kho-upload.js). */
const VALID_ELEMENT_TYPES = new Set(Object.keys(TYPE_LABELS));
const FONT_STACKS = {
  pixel: '"TNVA Mono", ui-monospace, monospace',
  robotoCondensed: '"TNVA Sans", sans-serif',
  inter: '"TNVA Sans", sans-serif',
  notoMono: '"TNVA Mono", monospace',
  dseg: '"TNVA Mono", monospace',
  outfit: '"TNVA Outfit", sans-serif',
  lobster: '"TNVA Lobster", cursive',
  pacifico: '"TNVA Pacifico", cursive',
  /* Static-text-only fonts (rasterized into the background bitmap, so any
   * locally available font renders fine — no DA14585 glyph table needed). */
  verdana: '"TNVA Sans", sans-serif',
  trebuchet: '"TNVA Sans", sans-serif',
  georgia: '"TNVA Serif", serif',
  impact: '"TNVA Sans", sans-serif',
  /* R25.12 (mục 5): drawText() vẽ khoá này bằng bảng bitmap 'small' (sfont
   * 14px, khớp Can Chi) chứ KHÔNG qua ctx.font/FONT_STACKS -- entry này chỉ
   * để phòng hờ (swatch dropdown, mọi chỗ khác lỡ tra FONT_STACKS[font]
   * chung chung) không bao giờ nhận undefined. */
  canchiSans: '"TNVA Sans", sans-serif'
};
/* Font-pipeline audit (2026-08-25): mọi font atlas (ATLAS_FONTS -- dancing
 * Script/greatVibes/playball/montez/yellowtail/caveat/kaushan/courgette/
 * classic/lunar) suy CSS font-family TRỰC TIẾP từ FONT_FAMILY_CSS
 * (atlas-generator.js) thay vì lặp lại tên tay ở đây lần thứ 2 -- ĐÚNG LỖI
 * THẬT đã xảy ra: caveat/kaushan/courgette được thêm vào ATLAS_FONTS/
 * FONT_FAMILY_CSS (R24) nhưng KHÔNG được thêm vào bảng tay FONT_STACKS ở
 * đây -- drawAtlasFontText()'s `ctx.font = \`${weight} ${px}px
 * ${FONT_STACKS[element.font]}\`` (bên dưới) ra "...undefined" cho 3 font
 * đó, một chuỗi ctx.font KHÔNG HỢP LỆ mà canvas âm thầm bỏ qua (giữ
 * nguyên font trước đó) -- "chọn xong không đổi gì", 100% tái hiện được,
 * không phải do timing @font-face. Vòng lặp này khiến việc thêm font atlas
 * MỚI trong tương lai không thể tái phát đúng lớp lỗi này nữa (1 nguồn sự
 * thật, không còn bảng song song). classic/lunar dùng fallback serif/sans
 * riêng (2 lựa chọn "thân thiện", không phải chữ script) thay vì 'cursive'
 * chung của các font script thật. */
const ATLAS_FONT_GENERIC_FALLBACK = { classic: 'serif', lunar: 'sans-serif' };
for (const key of ATLAS_FONTS) {
  FONT_STACKS[key] = `"${FONT_FAMILY_CSS[key]}", ${ATLAS_FONT_GENERIC_FALLBACK[key] || 'cursive'}`;
}
const EDITOR_FONT_READY = typeof document !== 'undefined' && document.fonts
  ? Promise.all([
      document.fonts.load('400 16px "TNVA Sans"'), document.fonts.load('800 16px "TNVA Sans"'),
      document.fonts.load('400 16px "TNVA Mono"'), document.fonts.load('800 16px "TNVA Mono"'),
      document.fonts.load('400 16px "TNVA Serif"'), document.fonts.load('800 16px "TNVA Serif"'),
      document.fonts.load('600 16px "TNVA Outfit"'), document.fonts.load('400 16px "TNVA Lobster"'),
      document.fonts.load('400 16px "TNVA Pacifico"'),
      /* Cùng lý do trên: mọi font atlas preload từ FONT_FAMILY_CSS +
       * atlasFontWeight() thay vì liệt kê tay -- caveat/kaushan/courgette
       * trước đây thiếu hẳn ở đây (thiếu preload không phải nguyên nhân
       * chính của bug -- FONT_STACKS ở trên mới là chính -- nhưng vẫn cần
       * sửa để lần chọn ĐẦU TIÊN không đua với font-display:swap). */
      ...[...ATLAS_FONTS].map(key => document.fonts.load(`${atlasFontWeight(key)} 16px "${FONT_FAMILY_CSS[key]}"`))
    ]).then(() => document.fonts.ready).catch(() => undefined)
  : Promise.resolve();
/* Font-pipeline audit (2026-08-25): EDITOR_FONT_READY ở trên chỉ tải MỘT
 * lần lúc module vừa load (16px) -- đủ để "mồi" font vào bộ nhớ đệm của
 * trình duyệt, nhưng render() (canvas xem trước sống) hoàn toàn ĐỒNG BỘ và
 * không đợi promise đó, và cũng không có gì kích hoạt vẽ lại nếu đúng lúc
 * người dùng chọn font, nó vẫn đang tải (lazy font-display:swap). Cache Map
 * khoá family+weight+size (BẮT BUỘC gồm cả size -- yêu cầu gốc) để không
 * gọi document.fonts.load() lặp lại cho cùng 1 tổ hợp đã biết kết quả.
 * onSettled() luôn được gọi (đồng bộ nếu đã biết kết quả, bất đồng bộ nếu
 * chưa) với true/false từ document.fonts.check() thật -- không đoán. */
const atlasFontReadyCache = new Map();
function ensureAtlasFontReady(family, weight, px, onSettled) {
  const key = `${family}|${weight}|${Math.ceil(px)}`;
  let entry = atlasFontReadyCache.get(key);
  if (!entry) {
    const spec = `${weight} ${Math.ceil(px)}px "${family}"`;
    const promise = (typeof document !== 'undefined' && document.fonts)
      ? document.fonts.load(spec).then(() => document.fonts.ready).then(() => document.fonts.check(spec)).catch(() => false)
      : Promise.resolve(true);
    entry = { checked: false, ok: true };
    atlasFontReadyCache.set(key, entry);
    promise.then(ok => { entry.checked = true; entry.ok = ok; onSettled?.(ok); });
  } else if (entry.checked) {
    onSettled?.(entry.ok);
  }
  return entry;
}
/* IDs are shared with the DA14585 TNF1 descriptor renderer. Only fonts the
 * device can actually render (pixel/robotoCondensed/dseg) get a real ID;
 * everything else — including the static-only fonts above — must fall back
 * to Roboto Condensed (id 1) for dynamic elements via deviceFontId(). Note
 * id 1 is also deviceFontId()'s hardcoded fallback for anything it doesn't
 * special-case, so it's already "taken" by Roboto Condensed in practice —
 * ids 2/3 are unused dead legacy values (nothing ever emits them; see
 * deviceFontId() below).
 *
 * R25.11 BUG FIX (mục 3, "chọn Montez -> hiện font khác"): montez/yellowtail
 * used to sit at ids 9/8 here, inside the SAME 5-9 range face_custom.c's
 * custom_clock_font_id_for() reserves for fonts still compiled into
 * epd_gui.c's font_list[] (outfit=5/lobster=6/pacifico=7 really are still
 * resident there). But font_list[] only has 10 slots (0-9) since R22.8 —
 * Yellowtail/Montez's own resident bitmaps were dropped that round to save
 * ~2.6KB RAM (see epd_gui.c's font_list[] comment) and were meant to become
 * atlas-only, exactly like dancingScript/greatVibes/playball below. Nobody
 * updated this table when that happened: wire id 9/8 still hits
 * custom_clock_font_id_for()'s resident-font branch, which maps them to the
 * now-nonexistent font_list[10]/[11] and clock_font_index() silently clamps
 * that back to id 7 (Outfit) -- so Montez/Yellowtail always rendered as
 * Outfit on real hardware, no matter what atlas was uploaded. Fixed by
 * moving them out of the 5-9 range entirely, alongside fresh, EXPLICIT ids
 * for caveat/kaushan/courgette (R24 additions that were missing from
 * deviceFontId()'s whitelist below and only worked by numeric coincidence,
 * landing on id 1 which happens to also not collide with 5-9/10-12).
 * face_custom.c's draw_time_descriptor_sized() treats every id it doesn't
 * otherwise recognize (0/4/5-9) identically -- try the uploaded atlas, else
 * Outfit -- so any id from 10 up reaches the same code path 1/2/3 already
 * did; the exact number only needs to avoid 0/1/4/5-9. */
const FONT_IDS = {
  pixel:0, robotoCondensed:1, inter:1, notoMono:1, dseg:4,
  outfit:5, lobster:6, pacifico:7,
  dancingScript:10, greatVibes:11, playball:12,
  montez:13, yellowtail:14, caveat:15, kaushan:16, courgette:17,
  verdana:1, trebuchet:1, georgia:1, impact:1, classic:18, lunar:19
};
const HANDLE_SIZE = 4;
const STYLE = { text:0, clockOutline:1, clockSolid:2, clockSegment:3, clockText:4, textLarge:5 };
const FLAG_INVERSE = 0x01;
/* Bit 0x02 chỉ có nghĩa với đối tượng Thứ: tên dài ("Thứ bảy") thay vì "T7".
   Firmware không có cờ chữ đậm cho lớp động — xem face_custom.c. */
const FLAG_WEEKDAY_LONG = 0x02;
const FLAG_SECONDS = 0x04;
const FLAG_ROTATE_CCW = 0x08;
const FLAG_CLOCK_3D = 0x10;

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, step = 1) { return Math.round(value / step) * step; }

/* R25.8 (mục 8bb): đo histogram thật của ảnh (ở đúng kích thước sẽ hiển
 * thị, không phải ảnh gốc full-res, vì nội dung thu nhỏ mới là cái thật sự
 * lên máy) để tự đề xuất threshold/contrast/dither hợp lý, thay vì luôn
 * dùng 3 hằng số cố định (150/1.15/'ordered') bất kể ảnh sáng/tối/ảnh
 * chụp hay hình nét. Người dùng vẫn chỉnh tay được sau đó (mục 8cc) --
 * đây chỉ là điểm khởi đầu thông minh hơn, không khoá chết lựa chọn. */
function analyzeImageForOneBit(image, targetW, targetH) {
  const fallback = { threshold: 150, contrast: 1.15, dither: 'ordered' };
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(targetW));
  canvas.height = Math.max(1, Math.round(targetH));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) || 1;
  const drawW = image.naturalWidth * scale, drawH = image.naturalHeight * scale;
  ctx.drawImage(image, (canvas.width - drawW) / 2, (canvas.height - drawH) / 2, drawW, drawH);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const hist = new Array(256).fill(0);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]);
    hist[gray]++;
    total++;
  }
  if (total === 0) return fallback;

  /* Otsu's method: the split point that maximizes between-class variance
   * -- standard, well-tested way to pick a threshold from a histogram
   * without guessing a fixed number for every image. */
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, weightB = 0, varMax = -1, threshold = 128;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;
    sumB += t * hist[t];
    const meanB = sumB / weightB, meanF = (sum - sumB) / weightF;
    const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (between > varMax) { varMax = between; threshold = t; }
  }

  /* 2nd/98th percentile stretch: how far the real content spans inside
   * 0-255. A narrow spread (hazy/low-contrast photo) gets a contrast boost
   * so the 1-bit result isn't a near-blank or near-solid rectangle; an
   * already-wide spread gets left close to 1x. */
  let cumulative = 0, p2 = 0, p98 = 255;
  const lowCut = total * 0.02, highCut = total * 0.98;
  for (let t = 0; t < 256; t++) { cumulative += hist[t]; if (cumulative >= lowCut) { p2 = t; break; } }
  cumulative = 0;
  for (let t = 255; t >= 0; t--) { cumulative += hist[t]; if (cumulative >= total - highCut) { p98 = t; break; } }
  const spread = Math.max(20, p98 - p2);
  const contrast = Math.round(clamp(255 / spread, 0.7, 2.2) * 100) / 100;

  /* Bimodal already (mostly near-pure-black/white pixels) = line art, a
   * logo, or text -- straight threshold stays crisp. Otherwise = photo or
   * gradient content that would band badly without dithering. */
  let extreme = 0;
  for (let t = 0; t < 32; t++) extreme += hist[t];
  for (let t = 224; t < 256; t++) extreme += hist[t];
  const dither = (extreme / total) > 0.7 ? 'none' : 'ordered';

  return { threshold, contrast, dither };
}
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function utf8BytesLimited(text, maxBytes) {
  const chars=Array.from(normalizeVietnameseText(text));
  let raw=new TextEncoder().encode(chars.join(''));
  while(raw.length>maxBytes && chars.length){ chars.pop(); raw=new TextEncoder().encode(chars.join('')); }
  return raw;
}

function normalizeVietnameseText(value) {
  return String(value ?? '').normalize('NFC');
}

function crc32Bytes(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* R25.12 (mục 4): dayOnly/monthOnly/yearOnly nối vào ĐÚNG cơ chế template
 * dùng chung này (type=8=TNVA_DYN_TEMPLATE, firmware render_template() đã
 * xử lý @d/@M/@y đơn lẻ từ trước -- không cần sửa firmware). */
const TEMPLATE_COMPONENTS = { canchi:'@K', holiday:'@H', temperature:'@D', batteryPercent:'@P', dayOnly:'@d', monthOnly:'@M', yearOnly:'@y' };
const DEVICE_DYNAMIC_TYPE = { time:1, date:2, weekday:3, lunar:4, voltage:5, battery:6, analog:7, canchi:8, holiday:8, temperature:8, batteryPercent:8, calendar:9, calendarWeek:9, weekStrip:11, dayOnly:8, monthOnly:8, yearOnly:8 };

/* Bản sao của phép tính bố cục trong cf_draw_month(). Studio và firmware phải
   dùng chung công thức, nếu không cái vẽ ra trên máy sẽ khác bản thiết kế.
   Dùng cả cho bản xem trước lẫn dòng gợi ý cỡ chữ trong bảng thuộc tính. */
export function calendarGeometry(element) {
  const header = Number(element.calendarType) === 5 ? 0 : 9;
  const cellW = Math.max(1, Math.floor(element.w / 7));
  let labelH = 9;
  let cellH = Math.floor((element.h - header - labelH) / 6);
  let large = cellW >= 12 && cellH >= 9;
  /* R25.11 (mục 7): calendarFontChoice 1 ép luôn tầng pixel 3x5 dù ô đủ to
   * -- khớp cf_draw_month()'s "if(font_choice == 1) large_cells = 0;". */
  if (Number(element.calendarFontChoice) === 1) large = false;
  if (!large) { labelH = 7; cellH = Math.floor((element.h - header - labelH) / 6); }
  /* calendarFontChoice 2 ép sfont (Roboto Condensed 14) khi ô đủ to -- cùng
   * ngưỡng tối thiểu 16x16 với cf_draw_month(), tự rơi về tầng pixel/5x7
   * hiện có khi không vừa (không bao giờ vẽ tràn/vỡ nét). */
  const sfontEligible = cellW >= 16 && cellH >= 16;
  const useSfont = Number(element.calendarFontChoice) === 2 && sfontEligible;
  return {
    header, labelH, cellW, cellH: Math.max(1, cellH), large,
    twoCharLabels: (large || useSfont) && cellW >= 14, useSfont,
  };
}
function deviceFontId(item) {
  /* Static labels are rasterized with their exact web font. Dynamic text must
   * use a font embedded in the DA14585 image. Inter/Noto legacy selections
   * therefore fall back to Roboto Condensed instead of producing a mismatch. */
  if (item.font === 'dseg') return 4;
  if (item.font === 'pixel') return 0;
  /* R25.11: every clock-digit font in FONT_IDS above id 4 belongs here --
   * previously caveat/kaushan/courgette were missing from this list and
   * fell through to `return 1` below, which only worked by numeric
   * coincidence (id 1 doesn't collide with the resident-font range 5-9
   * either). Listing all eight explicitly means a future id reassignment
   * in FONT_IDS can't silently break one of them again. */
  if (ATLAS_FONTS.has(item.font) || (item.type === 'time' &&
      ['outfit','lobster','pacifico'].includes(item.font)))
    return FONT_IDS[item.font];
  return 1;
}
function deviceAlign(value) { return value === 'center' ? 1 : value === 'right' ? 2 : 0; }
function slugify(text) {
  return (text || 'giao-dien').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'giao-dien';
}

function defaultProject(width = PANEL_PROFILES[DEFAULT_PROFILE_KEY].width, height = PANEL_PROFILES[DEFAULT_PROFILE_KEY].height) {
  return {
    id: uid(),
    format: 'TNVA_PROJECT',
    version: 3,
    title: 'Giao diện mới',
    author: '',
    width,
    height,
    background: '#f4f1e6',
    elements: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/* R25.12 (Phần B): 'color' trong `base` trước đây là '#000000' cố định,
 * KHÔNG hề được đọc ở đâu trong toàn bộ editor.js/app.js (xác nhận bằng
 * grep -- trường chết). Tái dùng làm bộ chọn MẶT PHẲNG MÀU cho thiết bị
 * 3 màu (4.2") -- 'black' (mặc định) / 'red'. Thiết bị 1-bit (2.13") ẩn
 * hẳn control này (xem app.js), và mọi giá trị cũ ('#000000' hoặc thiếu
 * hẳn trường) đều rơi về 'black' qua elementPlane() bên dưới -- không đổi
 * diện mạo bất kỳ face 2.13" nào đã lưu. */
function elementPlane(element) { return element?.color === 'red' ? 'red' : 'black'; }
function elementMatchesPlane(element, plane) {
  if (element?.type === 'image' && element.color === 'auto') return plane === 'black' || plane === 'red';
  return elementPlane(element) === plane;
}
/* R25.12 (Phần B mục 12): đỏ trên panel e-ink 3 màu thật không phải #FF0000
 * -- đây là sắc tố (pigment) không phải đèn phát sáng, hiện ra đỏ cam xỉn.
 * Dùng đúng màu này cho MỌI chỗ xem trước (canvas thiết kế, ảnh mẫu export)
 * để không đánh lừa người thiết kế về độ tương phản thật trên máy. */
const TRICOLOR_RED_PREVIEW = '#C0392B';
/* R25.12 (Phần B mục 14/15): tần suất cập nhật THẬT của từng loại đối
 * tượng -- quyết định đối tượng nào nên/không nên tô đỏ (đỏ tốn thêm lượt
 * quét, refresh lâu hơn nhiều). 'high' = đổi mỗi phút/giây (giờ) -- cảnh
 * báo MẠNH nhưng vẫn cho phép nếu người dùng cố tình (mục 15: "Vẫn cho
 * phép nếu người dùng cố tình"). 'medium' = đổi vài lần/giờ (nhiệt độ,
 * pin, đồng hồ kim) -- cảnh báo nhẹ. 'low'/thiếu trong bảng = tĩnh hoặc
 * đổi 1 lần/ngày (ngày/thứ/âm lịch/can chi/lịch/nhãn tĩnh/hình) -- không
 * cảnh báo, đúng danh sách "nên đỏ" người dùng liệt kê. */
const RED_UPDATE_FREQUENCY = {
  time: 'high',
  temperature: 'medium', voltage: 'medium', batteryPercent: 'medium', battery: 'medium', analog: 'medium',
};
function redUsageWarning(element) {
  if (elementPlane(element) !== 'red') return null;
  const level = RED_UPDATE_FREQUENCY[element.type];
  if (level === 'high') return { level, message: 'Đối tượng này đổi mỗi phút/giây -- tô đỏ sẽ làm E-Ink phải quét lại vùng đỏ RẤT thường xuyên, chậm và mau hỏng tấm nền. Nên để đen, chỉ tô đỏ nhãn/khung tĩnh.' };
  if (level === 'medium') return { level, message: 'Đối tượng này đổi định kỳ (không phải mỗi phút) -- tô đỏ vẫn làm chậm refresh hơn đối tượng tĩnh. Cân nhắc để đen nếu cập nhật thường xuyên trong thiết kế của bạn.' };
  return null;
}
function defaultsFor(type, width, height) {
  const base = {
    id: uid(), type, name: TYPE_LABELS[type] || type,
    x: 10, y: 10, w: 60, h: 18, visible: true,
    font: 'robotoCondensed', fontSize: 12, weight: 700, align: 'left',
    color: 'black', text: '', lineWidth: 1,
    threshold: 150, contrast: 1.15, invert: false, dither: 'ordered', brightness: 0,
    imageScale: 1, imageOffsetX: 0, imageOffsetY: 0, imageData: '',
    format: '', showSeconds: false, templateStyle: STYLE.text, digitEffect: 'normal', digitEffectDir: 'dr', inverse: false, calendarType: 0, legacy: null,
    locked: false, shapeKind: 'roundRect', radius: 6, fill: false
  };
  switch (type) {
    /* R25.12 (mục 5): font mặc định cho 'text' mới tạo đổi sang 'canchiSans'
     * -- vẽ bằng ĐÚNG bảng bitmap sfont 14px mà 'canchi' (Bính Ngọ) dùng
     * (xem drawText()), không còn qua ctx.font trình duyệt. Vừa khớp diện
     * mạo Can Chi thật, vừa có sàn px THẬT (7px, Math.max(7,...) đã có sẵn
     * trong scaledBitmapTextWidth()/drawScaledBitmapText(), khớp đúng
     * firmware) thay vì sàn 5px tuỳ tiện trước đây không dựa trên giới hạn
     * kỹ thuật nào cả. Khoá font MỚI (không phải 'robotoCondensed' cũ) --
     * 'text' đã lưu trước bản vá vẫn mang khoá font cũ, không đổi diện mạo. */
    case 'text': return { ...base, text: 'Nội dung', w: 110, h: 22, font: 'canchiSans', fontSize: 15 };
    case 'time': return { ...base, x: 30, y: 26, w: 152, h: 52, font: 'outfit', fontSize: 44, align: 'center', format: 'HH:mm', templateStyle: STYLE.clockText };
    /* calendarFontChoice: 0 = tự động (mặc định, giống hệt hành vi trước
     * R25.11), 1 = ép pixel 3x5, 2 = ép sfont khi ô đủ to (mục 7). */
    case 'calendar': return { ...base, x: 8, y: 12, w: 132, h: 74, calendarType: 0, fontSize: 8, calendarFontChoice: 0 };
    case 'calendarWeek': return { ...base, x: 4, y: 20, w: width - 8, h: 60, calendarType: 5, fontSize: 8, calendarFontChoice: 0 };
    /* Dải 7 thẻ: cao tối thiểu 44px mới đủ bốn dòng thứ/ngày/tháng/âm lịch.
     * sizePct: 100 = tự động (mặc định, giống hệt hành vi trước R25.11),
     * 50..200 = tỉ lệ % người dùng tự chỉnh cho chữ số ngày (mục 5). */
    case 'weekStrip': return { ...base, x: 4, y: 3, w: width - 8, h: 46, fontSize: 8, sizePct: 100, weekFont: 'lunar' };
    case 'date': return { ...base, x: 10, y: 8, w: 100, h: 16, format: 'dd/MM/yyyy' };
    case 'weekday': return { ...base, x: 10, y: 78, w: 70, h: 16, format: 'Thứ bảy' };
    case 'lunar': return { ...base, x: 90, y: 78, w: 90, h: 16, format: 'ÂL 10/06' };
    case 'canchi': return { ...base, x: 70, y: 78, w: 80, h: 16, format: 'Bính Ngọ', align: 'center' };
    case 'holiday': return { ...base, x: 45, y: 78, w: 122, h: 16, format: 'Tết Nguyên Đán', align: 'center' };
    /* R23: sample text matches what the device actually displays now --
     * temperature is an integer (cf_temperature_display_c() in
     * clock_face_common.c), battery percent rounds to the nearest 5
     * (cf_battery_percent_display()), voltage keeps its existing 1
     * decimal. See docs/FONT_ATLAS_TNVA.md's format-mismatch audit. */
    case 'temperature': return { ...base, x: width - 55, y: height - 16, w: 52, h: 14, format: '28C', align: 'right' };
    case 'voltage': return { ...base, x: width - 48, y: height - 16, w: 45, h: 14, format: '3.8V', align: 'right' };
    case 'batteryPercent': return { ...base, x: width - 42, y: 20, w: 38, h: 14, format: '85%', align: 'right' };
    /* R25.12 (mục 4): 3 widget MỚI, độc lập -- 'date' (Ngày, gộp cả ba) giữ
     * NGUYÊN không đổi. Vị trí mặc định đặt cạnh nhau (không chồng lẫn),
     * người dùng tự sắp lại theo ý. Sample hiển thị khớp giá trị mẫu
     * expandTemplateSample() dùng cho @d/@M/@y (19/06/2026). */
    case 'dayOnly': return { ...base, x: 10, y: 50, w: 30, h: 16, format: '19', align: 'center' };
    case 'monthOnly': return { ...base, x: 44, y: 50, w: 30, h: 16, format: '06', align: 'center' };
    case 'yearOnly': return { ...base, x: 78, y: 50, w: 46, h: 16, format: '2026', align: 'center' };
    case 'battery': return { ...base, x: width - 28, y: 5, w: 24, h: 12 };
    case 'analog': return { ...base, x: width - 62, y: 17, w: 54, h: 54 };
    case 'image': return { ...base, x: 20, y: 15, w: Math.min(120, width - 40), h: Math.min(70, height - 30), name: 'Ảnh' };
    /* R25.12 (mục 2): lineStyle 'crisp' = mặc định MỚI cho đường kẻ mới tạo
     * (vẽ đúng, không cong khi kéo dài -- xem drawLine()). Đường kẻ đã lưu
     * từ trước bản vá không đi qua defaultsFor() nữa (nạp thẳng từ JSON),
     * nên vẫn thiếu field này = tự động rơi về 'smooth' = giữ đúng hành vi
     * cũ, không đổi diện mạo face đã lưu. */
    case 'line': return { ...base, x: 15, y: 50, w: 100, h: 1, lineWidth: 1, lineStyle: 'crisp' };
    case 'rect': return { ...base, x: 15, y: 15, w: 80, h: 45, lineWidth: 1 };
    case 'shape': return { ...base, x: 18, y: 14, w: 72, h: 42, lineWidth: 1, shapeKind: 'roundRect', radius: 6, fill: false };
    case 'legacyShape': return { ...base, x: 10, y: 10, w: 80, h: 20, lineWidth: 1, legacy: { hinh:2, custom:0, size:80, thingnet:1 } };
    /* R25.9 (mục 12): nền đen tĩnh -- nướng thẳng vào ảnh nền 1-bit như
     * 'shape', không phải đối tượng động. radius=0 là vuông (mục ww). */
    case 'invertRegion': return { ...base, x: 20, y: 20, w: 80, h: 40, radius: 0, fillMode: 'black', borderWidth: 2 };
    default: return base;
  }
}

/* Vùng tô audit (2026-08-25): đảo R/G/B của đúng những pixel NẰM TRONG
 * hình bo góc (x,y,w,h,radius) đã có sẵn trên canvas -- không đảo cả hình
 * chữ nhật bao ngoài (4 góc ngoài bán kính sẽ giữ nguyên, không lộ vệt
 * vuông ở góc khi radius>0). Thuần hàm toạ độ nguyên, không phụ thuộc
 * `this` -- gọi được từ drawInvertRegion() (class method) hay test độc lập
 * như nhau. */
function invertRegionPixels(ctx, x, y, w, h, radius) {
  const image = ctx.getImageData(x, y, w, h);
  const data = image.data;
  const rx = Math.min(radius, w / 2), ry = Math.min(radius, h / 2);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (radius > 0 && rx > 0 && ry > 0) {
        const nearLeft = col < rx, nearRight = col > w - rx - 1;
        const nearTop = row < ry, nearBottom = row > h - ry - 1;
        if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
          const ccx = nearLeft ? rx : w - rx - 1;
          const ccy = nearTop ? ry : h - ry - 1;
          const dx = (col - ccx) / rx, dy = (row - ccy) / ry;
          if (dx * dx + dy * dy > 1) continue; /* ngoài góc bo -- không đảo */
        }
      }
      const i = (row * w + col) * 4;
      data[i] = 255 - data[i]; data[i + 1] = 255 - data[i + 1]; data[i + 2] = 255 - data[i + 2];
    }
  }
  ctx.putImageData(image, x, y);
}

/* Widget Chữ nhiều dòng audit (2026-08-25): word-wrap tham lam thuần --
 * tách theo dấu cách, dồn từ vào dòng hiện tại tới khi vượt maxWidth mới
 * xuống dòng mới. Một từ ĐƠN LẺ tự nó đã rộng hơn maxWidth vẫn được giữ
 * nguyên trên dòng riêng (không cắt giữa từ/dấu tiếng Việt) -- tràn nhẹ
 * còn hơn cắt chữ giữa chừng khó đọc. `ctx.font` phải được set TRƯỚC khi
 * gọi (đo bằng đúng font/size của dòng đó). */
function wrapTextLine(ctx, text, maxWidth) {
  if (!text) return [''];
  const words = text.split(' ');
  const rows = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      rows.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  rows.push(current);
  return rows;
}

/* Widget Chữ nhiều dòng audit (2026-08-25): 1 nguồn DÙNG CHUNG cho cả
 * drawText() (vẽ thật) và staticTextMetrics() (đo tràn khung) -- không đo
 * riêng 1 công thức khác dễ lệch. Mỗi dòng LOGIC (người dùng gõ Enter,
 * `\n`-split) có font/size RIÊNG qua element.lineStyles[index] (rơi về
 * element.font/fontSize nếu dòng đó không có override -- face cũ không có
 * trường này vẫn vẽ y hệt như trước, không cần migrate), rồi tự xuống
 * hàng (word-wrap) TỪNG DÒNG LOGIC theo đúng font/size của chính nó khi
 * vượt element.w. Trả về mảng "dòng hiển thị" (đã wrap), mỗi dòng biết
 * font/size/weight/scaleX/lineHeight của riêng nó -- lineHeightMult nhân
 * với fontSize CỦA TỪNG DÒNG (dòng to hơn tự giãn dòng nhiều hơn), không
 * phải 1 hằng số chung cho cả khối. */
function resolveTextLines(ctx, element, rawText) {
  const logicalLines = String(rawText ?? '').split('\n');
  const lineHeightMult = Number(element.lineHeightMult) > 0 ? Number(element.lineHeightMult) : 1.12;
  const rows = [];
  logicalLines.forEach((line, index) => {
    const override = element.lineStyles?.[index] || {};
    const font = override.font || element.font || 'inter';
    const fontSize = Number(override.fontSize) > 0 ? Number(override.fontSize) : (Number(element.fontSize) || 12);
    const family = FONT_STACKS[font] || FONT_STACKS.inter;
    const weight = font === 'impact' ? 900 : Number(override.weight || element.weight || 400);
    const scaleX = font === 'robotoCondensed' ? .78 : font === 'impact' ? .7 : 1;
    ctx.font = `${weight} ${fontSize}px ${family}`;
    const maxWidth = Math.max(4, element.w) / scaleX;
    for (const wrapped of wrapTextLine(ctx, line, maxWidth)) {
      rows.push({ text: wrapped, font, fontSize, weight, scaleX, family, lineHeight: fontSize * lineHeightMult });
    }
  });
  return rows;
}

function dynamicSample(element) {
  switch (element.type) {
    case 'time': return element.showSeconds ? '21:44:08' : '21:44';
    case 'date': return element.format || '27/07/2026';
    case 'weekday': return element.format || 'Thứ bảy';
    case 'lunar': return element.format || 'ÂL 10/06';
    case 'canchi': return element.format || 'Bính Ngọ';
    case 'holiday': return element.format || 'Tết Nguyên Đán';
    case 'temperature': return element.format || '28C';
    case 'voltage': return element.format || '3.8V';
    case 'batteryPercent': return element.format || '85%';
    case 'dayOnly': return element.format || '19';
    case 'monthOnly': return element.format || '06';
    case 'yearOnly': return element.format || '2026';
    default: return '';
  }
}

function expandTemplateSample(template = '') {
  /* R23: @V/@D/@P sample values match face_custom.c's actual output
   * format exactly -- @V was showing 2 decimals ("3.30V") when the device
   * has always used 1 ("3.3V"), and @D/@P now round the same way the
   * device's display layer does (integer C, nearest-5 %). See
   * docs/FONT_ATLAS_TNVA.md's format-mismatch audit. */
  const values = {
    '@hh':'11','@mm':'33','@h':'11','@m':'33','@d':'19','@M':'06','@y':'2026',
    '@T':'Thứ 6','@W':'Thứ sáu','@t':'6','@A':'05','@L':'05','@V':'3.3V',
    '@D':'30C','@K':'Bính Ngọ','@H':'Tết Nguyên Đán','@P':'85%',
    '@q':'170','@Q':'25','@c':'365','@C':'365','@u':'--'
  };
  let value = String(template || '');
  Object.keys(values).sort((a,b) => b.length-a.length).forEach(token => { value = value.split(token).join(values[token]); });
  return value;
}

function explicitTypeForTemplate(template = '', clock = false) {
  if (clock || /^@hh?:@mm?$/.test(String(template).trim())) return 'time';
  const value = String(template).trim();
  if (/^(@d|@M|@y|[\s/.-])+$/.test(value)) return 'date';
  if (/^@(?:T|W|t)$/.test(value)) return 'weekday';
  if (/^(?:ÂL\s*)?@A[\s/.-]+@L$/.test(value)) return 'lunar';
  if (value === '@K') return 'canchi';
  if (value === '@H') return 'holiday';
  if (value === '@D') return 'temperature';
  if (value === '@V') return 'voltage';
  if (value === '@P') return 'batteryPercent';
  return null;
}
function legacyClockProfile(object) {
  const vendor = Number(object.font ?? 3);
  const raw = clamp(Number(object.size || 50), 10, 120);
  if (vendor === 2) return { font:'robotoCondensed', style:STYLE.clockOutline, fontSize:clamp(Math.round(raw*.82),32,62) };
  if (vendor === 0) return { font:'robotoCondensed', style:STYLE.clockSolid, fontSize:clamp(Math.round(raw*.92),30,62) };
  if (vendor === 4) return { font:'dseg', style:STYLE.clockSegment, fontSize:clamp(Math.round(raw*.9),28,65) };
  if (vendor === 3) return { font:'robotoCondensed', style:STYLE.clockText, fontSize:clamp(Math.round(raw*.44),18,46) };
  return { font:'robotoCondensed', style:STYLE.clockText, fontSize:clamp(Math.round(raw*.3),11,30) };
}

function legacyFont(font) {
  if (typeof font === 'string') {
    const name = font.toLowerCase();
    if (name.includes('dseg') || name.includes('digital')) return 'dseg';
    if (name.includes('mono')) return 'notoMono';
    if (name.includes('condensed') || name.includes('oswald')) return 'robotoCondensed';
    if (name.includes('pixel')) return 'pixel';
    return 'inter';
  }
  return ({0:'pixel',1:'robotoCondensed',2:'inter',3:'notoMono',4:'dseg'})[Number(font)] || 'robotoCondensed';
}
function legacyFontSize(object) {
  if (object.fontSize) return clamp(Number(object.fontSize), 5, 80);
  if (object.size) return clamp(Number(object.size), 5, 80);
  return Number(object.font) === 0 ? 10 : Number(object.font) === 2 ? 14 : 12;
}
function legacyBitmapDataUrl(object) {
  const width = Math.max(1, Number(object.width || 1));
  const height = Math.max(1, Number(object.height || 1));
  const bits = Array.isArray(object.dataImg) ? object.dataImg : [];
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const black = Boolean(bits[i]);
    const value = black ? 0 : 255;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png');
}
function legacyTextWidth(text, size) {
  return Math.max(16, Math.round(String(text || '').length * size * .58));
}

export class FaceEditor {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.onChange = options.onChange || (() => {});
    this.onSelection = options.onSelection || (() => {});
    this.onPackage = options.onPackage || (() => {});
    this.project = defaultProject();
    this.selectedId = null;
    this.zoom = 4;
    this.grid = true;
    this.bw = true;
    this.snap = true;
    this.previewPlane = 'combined';
    this.clipboardElement = null;
    this.history = [];
    this.future = [];
    this.imageCache = new Map();
    this.drag = null;
    this.rendering = false;
    /* BƯỚC 4 (hợp nhất preview atlas với payload): {fontKey, cellPx, bytes}
     * của atlas THẬT gần nhất đã build cho upload -- xem
     * drawAtlasFontText()/app.js's #installBtn handler. null = chưa build
     * atlas nào trong phiên này, fillText() vẫn là xấp xỉ hợp lệ duy nhất. */
    this.previewAtlas = null;
    /* Font-pipeline audit (2026-08-25): tên family (FONT_FAMILY_CSS[...])
     * khi document.fonts.check() xác nhận font atlas của đối tượng đang
     * chọn KHÔNG tải được -- xem checkSelectedFontReady(). null = ổn/chưa
     * biết. renderInspector() (app.js) đọc cờ này để hiện cảnh báo. */
    this.fontReadyWarning = null;
    this.bindCanvas();
    this.resizeCanvas();
    this.render();
  }

  bindCanvas() {
    this.canvas.addEventListener('pointerdown', event => this.pointerDown(event));
    window.addEventListener('pointermove', event => this.pointerMove(event));
    window.addEventListener('pointerup', event => this.pointerUp(event));
    this.canvas.addEventListener('dblclick', event => {
      const point = this.point(event);
      const element = this.hitElement(point.x, point.y);
      if (element?.type === 'text') {
        this.selectedId = element.id;
        this.onSelection(element.id, element, { editText: true });
      }
    });
  }

  setZoom(value) {
    this.zoom = clamp(value, 1.5, 7);
    this.canvas.style.width = `${this.project.width * this.zoom}px`;
    this.canvas.style.height = `${this.project.height * this.zoom}px`;
    this.render();
  }

  setGrid(value) { this.grid = Boolean(value); this.render(); }
  setBw(value) { this.bw = Boolean(value); this.render(); }
  setSnap(value) { this.snap = Boolean(value); }
  setPreviewPlane(value) {
    this.previewPlane = ['combined','black','red'].includes(value) ? value : 'combined';
    this.render();
  }

  resizeCanvas() {
    this.canvas.width = this.project.width;
    this.canvas.height = this.project.height;
    this.canvas.style.width = `${this.project.width * this.zoom}px`;
    this.canvas.style.height = `${this.project.height * this.zoom}px`;
  }

  /* R25.12 (Phần B mục 8): 'eink213' (212x104/104x212, đổi HƯỚNG cùng một
   * thiết bị) vẫn co giãn tỉ lệ như cũ (setProfile() nguyên bản, KHÔNG đổi
   * hành vi cho face 2.13" -- deviceClass thiếu ở project cũ tự coi là
   * 'eink213', đúng thiết bị duy nhất tồn tại trước bản vá này). Đổi hẳn
   * SANG thiết bị khác (deviceClass khác, vd 2.13" <-> 4.2") thì KHÔNG co
   * giãn mù -- toạ độ x/y/w/h/fontSize giữ nguyên số cũ (có thể rơi ra
   * ngoài khung mới), người dùng tự dựng lại bố cục, đúng yêu cầu "KHÔNG
   * tự co giãn mù". app.js hiện cảnh báo rõ trước khi gọi hàm này (xem
   * #screenProfile's change handler). */
  setProfile(profile) {
    const target = DEVICE.profiles[profile];
    if (!target) return;
    this.commit();
    const currentClass = this.project.deviceClass || 'eink213';
    const targetClass = target.deviceClass || 'eink213';
    if (currentClass === targetClass) {
      const sx = target.width / this.project.width;
      const sy = target.height / this.project.height;
      for (const element of this.project.elements) {
        element.x = Math.round(element.x * sx);
        element.y = Math.round(element.y * sy);
        element.w = Math.max(1, Math.round(element.w * sx));
        element.h = Math.max(1, Math.round(element.h * sy));
        element.fontSize = Math.max(5, Math.round(element.fontSize * Math.min(sx, sy)));
      }
    }
    this.project.width = target.width;
    this.project.height = target.height;
    this.project.profileKey = profile;
    this.project.deviceClass = targetClass;
    this.project.planes = target.planes || 1;
    this.resizeCanvas();
    this.changed();
  }

  /* Web-tu-thich-ung-theo-panel muc 4 "Widget đang có màu 'red' khi chuyển
   * sang panel mono: ép về 'black', ghi log cảnh báo, KHÔNG xoá widget":
   * chỉ đổi thuộc tính color, KHÔNG động tới bất kỳ field nào khác của
   * phần tử. Dùng đúng khuôn mẫu commit()-trước/changed()-sau MỘT LẦN như
   * setProfile() (không commit()/changed() lặp mỗi phần tử). Trả về danh
   * sách id đã đổi (rỗng nếu không có gì cần đổi) để app.js tự quyết định
   * có ghi log/toast hay không -- editor.js không biết về UI log/toast. */
  forceRedElementsToBlack() {
    const affected = this.project.elements.filter(element => element.color === 'red');
    if (!affected.length) return [];
    this.commit();
    affected.forEach(element => { element.color = 'black'; });
    this.changed();
    return affected.map(element => element.id);
  }

  newProject(profile = '212x104') {
    const target = DEVICE.profiles[profile] || DEVICE.profiles['212x104'];
    this.project = defaultProject(target.width, target.height);
    this.project.profileKey = profile;
    this.project.deviceClass = target.deviceClass || 'eink213';
    this.project.planes = target.planes || 1;
    this.history = [];
    this.future = [];
    this.selectedId = null;
    this.resizeCanvas();
    this.changed();
  }

  loadProject(project) {
    if (!project || !Array.isArray(project.elements)) throw new Error('File không hợp lệ');
    this.project = { ...defaultProject(project.width || PANEL_PROFILES[DEFAULT_PROFILE_KEY].width, project.height || PANEL_PROFILES[DEFAULT_PROFILE_KEY].height), ...clone(project) };
    this.project.title = normalizeVietnameseText(this.project.title);
    this.project.author = normalizeVietnameseText(this.project.author);
    for (const element of this.project.elements) {
      /* R23: 'light'/'bold' replace the old single '3d' value (still
       * accepted below at the wire-flag site for imported/legacy data) --
       * see docs/FONT_ATLAS_TNVA.md requirement D. */
      if (element.type === 'time' && !['normal','light','bold'].includes(element.digitEffect)) element.digitEffect = 'normal';
      this.normalizeElement(element);
    }
    this.selectedId = null;
    this.history = [];
    this.future = [];
    this.resizeCanvas();
    this.preloadImages();
    this.changed();
  }

  exportProject() { return clone(this.project); }

  async addImage(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('Không phải file ảnh');
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const image = await this.loadImage(dataUrl);
    this.commit();
    const element = defaultsFor('image', this.project.width, this.project.height);
    element.imageData = dataUrl;
    element.name = file.name.replace(/\.[^.]+$/, '') || 'Ảnh';
    const fit = Math.min(element.w / image.naturalWidth, element.h / image.naturalHeight);
    element.imageScale = fit;
    element.sourceW = image.naturalWidth;
    element.sourceH = image.naturalHeight;
    /* R25.8 (mục 8bb): phân tích ảnh thật thay vì luôn dùng 3 hằng số cố
     * định -- xem analyzeImageForOneBit() bên dưới. imageAutoXxx lưu lại
     * kết quả phân tích ban đầu để nút "Đặt lại" (mục 8dd) trả về đúng đề
     * xuất tự động, không phải một hằng số vô can hệ với ảnh này. */
    const analysis = analyzeImageForOneBit(image, element.w, element.h);
    element.threshold = analysis.threshold;
    element.contrast = analysis.contrast;
    element.dither = analysis.dither;
    element.imageAutoThreshold = analysis.threshold;
    element.imageAutoContrast = analysis.contrast;
    element.imageAutoDither = analysis.dither;
    this.project.elements.push(element);
    this.selectedId = element.id;
    this.changed();
    return element;
  }

  addElement(type) {
    this.commit();
    const element = defaultsFor(type, this.project.width, this.project.height);
    this.project.elements.push(element);
    this.selectedId = element.id;
    this.changed();
    return element;
  }

  /* PHẦN 5 -- Trang trí Tết. Chèn ĐÚNG một phần tử `type:'image'` bình
   * thường (không widget ID mới) -- bitmap đã dựng sẵn (xem
   * tet-decorations.js + tools/generate_tet_decorations.mjs), không phải
   * font, nên không tốn atlas/RAM và nướng thẳng vào bitplane tĩnh như mọi
   * ảnh khác. `imageData` luôn là data: URL tự chứa (fetch rồi encode ngay,
   * giống hệt addImage() đọc File) để dự án xuất/đăng kho vẫn portable --
   * không lưu đường dẫn tương đối vào project. `decorationId`/`decorationSize`
   * chỉ là bookkeeping cho inspector (đổi cỡ) -- bản build cũ mở lại face
   * này vẫn ra đúng ảnh, chỉ mất tiện ích "đổi cỡ nhanh". */
  async addDecoration(decorationId, sizeKey) {
    const size = tetDecorationSize(decorationId, sizeKey);
    if (!size) throw new Error('Không tìm thấy trang trí Tết này');
    const response = await fetch(size.url);
    if (!response.ok) throw new Error('Không tải được ảnh trang trí');
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const image = await this.loadImage(dataUrl);
    this.commit();
    const element = defaultsFor('image', this.project.width, this.project.height);
    element.imageData = dataUrl;
    element.name = tetDecorationById(decorationId)?.label || 'Trang trí Tết';
    element.w = image.naturalWidth;
    element.h = image.naturalHeight;
    element.sourceW = image.naturalWidth;
    element.sourceH = image.naturalHeight;
    element.imageScale = 1;
    element.threshold = 128;
    element.contrast = 1;
    element.dither = 'none';
    element.invert = false;
    element.decorationId = decorationId;
    element.decorationSize = sizeKey;
    this.project.elements.push(element);
    this.selectedId = element.id;
    this.changed();
    return element;
  }

  /* Đổi cỡ trang trí Tết ĐANG CHỌN sang cỡ khác trong cùng bộ (giống mọi
   * lệnh sửa-đối-tượng khác trong lớp này) -- thay ảnh 1:1 (không co
   * giãn/làm mờ), giữ nguyên vị trí x/y hiện tại. */
  async resizeDecoration(sizeKey) {
    const element = this.selected;
    if (!element?.decorationId) throw new Error('Không phải trang trí Tết');
    const size = tetDecorationSize(element.decorationId, sizeKey);
    if (!size) throw new Error('Không tìm thấy cỡ này');
    const response = await fetch(size.url);
    if (!response.ok) throw new Error('Không tải được ảnh trang trí');
    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const image = await this.loadImage(dataUrl);
    this.updateSelected({
      imageData: dataUrl, w: image.naturalWidth, h: image.naturalHeight,
      sourceW: image.naturalWidth, sourceH: image.naturalHeight,
      imageScale: 1, decorationSize: sizeKey,
    });
  }

  select(id) {
    this.selectedId = id;
    this.render();
    this.onSelection(id, this.selected);
  }

  get selected() { return this.project.elements.find(item => item.id === this.selectedId) || null; }

  updateSelected(patch, commit = true) {
    const element = this.selected;
    if (!element) return;
    if (commit) this.commit();
    Object.assign(element, patch);
    this.normalizeElement(element);
    this.changed();
  }

  normalizeElement(element) {
    for (const key of ['name','text','format']) if (element[key] != null) element[key] = normalizeVietnameseText(element[key]);
    /* Đường cong/gãy bậc audit (2026-08-25): với MỌI type khác, w/h là
     * KÍCH THƯỚC (phải >=1, 0 vô nghĩa). Nhưng 'line' dùng w/h làm VECTOR
     * lệch (drawLine(): x1=x+w, y1=y+h) -- 0 là giá trị HOÀN TOÀN HỢP LỆ,
     * nghĩa là "ngang tuyệt đối" (h=0) hoặc "dọc tuyệt đối" (w=0). Sàn
     * cũ min=1 áp chung cho mọi type khiến Math.round()+clamp(...,1,...)
     * KHÔNG BAO GIỜ cho ra đúng 0 -- mọi lần người dùng cố kéo đường thật
     * sự ngang/dọc đều bị ép lệch giả đúng 1px giữa 2 đầu mút, vẽ ra
     * "cong/gãy bậc" dù drawLineCrisp() (Bresenham) tự nó hoàn toàn đúng.
     * Đây là nguyên nhân gốc thật, xác nhận bằng cách đọc code, không đoán. */
    const sizeFloor = element.type === 'line' ? 0 : 1;
    element.w = clamp(Math.round(element.w), sizeFloor, this.project.width);
    element.h = clamp(Math.round(element.h), sizeFloor, this.project.height);
    element.x = clamp(Math.round(element.x), 0, this.project.width - element.w);
    element.y = clamp(Math.round(element.y), 0, this.project.height - element.h);
    element.fontSize = clamp(Math.round(element.fontSize || 10), 6, 80);
    element.lineWidth = clamp(Math.round(element.lineWidth || 1), 1, 8);
    if (element.lineHeightMult != null) element.lineHeightMult = clamp(Math.round(Number(element.lineHeightMult) * 20) / 20, .8, 2.5);
    if (element.type === 'weekStrip' && !['classic','lunar','pixel','device'].includes(element.weekFont)) {
      element.weekFont = 'lunar';
    }
  }

  deleteSelected() {
    if (!this.selected) return;
    this.commit();
    this.project.elements = this.project.elements.filter(item => item.id !== this.selectedId);
    this.selectedId = null;
    this.changed();
  }

  duplicateSelected() {
    const element = this.selected;
    if (!element) return;
    this.commit();
    const copy = clone(element);
    copy.id = uid();
    copy.name = `${element.name} copy`;
    copy.x += 4;
    copy.y += 4;
    this.project.elements.push(copy);
    this.selectedId = copy.id;
    this.changed();
  }

  copySelected() {
    if (!this.selected) return false;
    this.clipboardElement = clone(this.selected);
    return true;
  }

  pasteSelected() {
    if (!this.clipboardElement) return null;
    this.commit();
    const copy = clone(this.clipboardElement);
    copy.id = uid();
    copy.name = `${normalizeVietnameseText(copy.name || TYPE_LABELS[copy.type] || copy.type)} copy`;
    copy.x = clamp(Number(copy.x || 0) + 4, 0, Math.max(0, this.project.width - Number(copy.w || 1)));
    copy.y = clamp(Number(copy.y || 0) + 4, 0, Math.max(0, this.project.height - Number(copy.h || 1)));
    this.normalizeElement(copy);
    this.project.elements.push(copy);
    this.selectedId = copy.id;
    this.clipboardElement = clone(copy);
    this.changed();
    return copy;
  }

  moveLayer(direction) {
    const index = this.project.elements.findIndex(item => item.id === this.selectedId);
    if (index < 0) return;
    const target = clamp(index + direction, 0, this.project.elements.length - 1);
    if (target === index) return;
    this.commit();
    const [element] = this.project.elements.splice(index, 1);
    this.project.elements.splice(target, 0, element);
    this.changed();
  }

  nudge(dx, dy, amount = 1) {
    const element = this.selected;
    if (!element || element.locked) return;
    this.updateSelected({ x: element.x + dx * amount, y: element.y + dy * amount });
  }

  alignSelected(mode) {
    const element = this.selected;
    if (!element || element.locked) return;
    const patch = {};
    if (mode === 'left') patch.x = 0;
    if (mode === 'hcenter') patch.x = Math.round((this.project.width - element.w) / 2);
    if (mode === 'right') patch.x = this.project.width - element.w;
    if (mode === 'top') patch.y = 0;
    if (mode === 'vcenter') patch.y = Math.round((this.project.height - element.h) / 2);
    if (mode === 'bottom') patch.y = this.project.height - element.h;
    this.updateSelected(patch);
  }

  commit() {
    const snapshot = JSON.stringify(this.project);
    if (this.history.at(-1) !== snapshot) this.history.push(snapshot);
    if (this.history.length > 60) this.history.shift();
    this.future = [];
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.history.pop());
    this.selectedId = null;
    this.resizeCanvas();
    this.changed(false);
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.future.pop());
    this.selectedId = null;
    this.resizeCanvas();
    this.changed(false);
  }

  changed(render = true) {
    this.project.updatedAt = new Date().toISOString();
    if (render) this.render();
    this.checkSelectedFontReady();
    this.onChange(this.exportProject());
    this.onSelection(this.selectedId, this.selected);
    requestAnimationFrame(() => this.reportPackage());
  }

  /* Font-pipeline audit (2026-08-25): 1 chỗ chặn CHUNG cho mọi đường đổi
   * thuộc tính (đổi font, đổi cỡ chữ, đổi text, chọn lại đối tượng...) --
   * changed() là hàm DUY NHẤT mọi thao tác sửa project đều đi qua, nên vá
   * ở đây phủ hết, không cần vá riêng từng listener trong app.js. Nếu font
   * atlas của đối tượng đang chọn chưa chắc đã sẵn sàng, vẽ lại canvas
   * NGAY khi document.fonts xác nhận xong (đúng/sai), và set
   * this.fontReadyWarning cho renderInspector() (app.js) hiện cảnh báo rõ
   * ràng thay vì im lặng dùng font khác. */
  checkSelectedFontReady() {
    const element = this.selected;
    this.fontReadyWarning = null;
    if (!element || !ATLAS_FONTS.has(element.font)) return;
    const family = FONT_FAMILY_CSS[element.font];
    const weight = atlasFontWeight(element.font);
    const px = Math.max(atlasFontMinPx(element.font), Number(element.fontSize) || atlasFontMinPx(element.font));
    const entry = ensureAtlasFontReady(family, weight, px, ok => {
      if (this.selected !== element) return; /* người dùng đã chọn đối tượng khác trong lúc chờ */
      this.fontReadyWarning = ok ? null : family;
      this.render();
      this.onSelection(this.selectedId, this.selected);
    });
    if (entry.checked && !entry.ok) this.fontReadyWarning = family;
  }

  async reportPackage() {
    /* R25.8: onPackage's consumer (app.js) is the one place that knows the
     * REAL, firmware-reported budget when a device is connected -- this
     * class has no access to that live state, so it no longer guesses a
     * second, possibly-disagreeing threshold from DEVICE.profiles here.
     * R25.12 (Phần B): project 3 màu (planes===2) không có packageBytes
     * kiểu TNF1 (compile() cố ý throw cho loại project này) -- báo tổng
     * byte HAI mặt phẳng bit qua compileTricolor() thay vào đó, để thanh
     * "Gói: x/y KB" không đứng yên ở 0 một cách khó hiểu. */
    try {
      if (this.project.planes === 2) {
        const compiled = await this.compileTricolor();
        this.onPackage(compiled.sizeBreakdown.totalBitplaneBytes);
      } else {
        const compiled = await this.compile();
        this.onPackage(compiled.packageBytes.length);
      }
    } catch { this.onPackage(0); }
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * this.canvas.width / rect.width,
      y: (event.clientY - rect.top) * this.canvas.height / rect.height
    };
  }

  pointerDown(event) {
    if (event.button !== 0) return;
    const point = this.point(event);
    const selected = this.selected;
    const handle = selected && !selected.locked ? this.hitHandle(point.x, point.y, selected) : null;
    const element = handle ? selected : this.hitElement(point.x, point.y);
    if (!element) {
      this.select(null);
      return;
    }
    this.select(element.id);
    if (element.locked) { event.preventDefault(); return; }
    this.commit();
    this.drag = {
      pointerId: event.pointerId,
      mode: handle ? 'resize' : 'move',
      handle,
      startX: point.x,
      startY: point.y,
      origin: clone(element)
    };
    this.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  pointerMove(event) {
    if (!this.drag) return;
    const element = this.selected;
    if (!element) return;
    const point = this.point(event);
    let dx = point.x - this.drag.startX;
    let dy = point.y - this.drag.startY;
    const step = this.snap ? 1 : 0.25;
    dx = round(dx, step); dy = round(dy, step);
    if (this.drag.mode === 'move') {
      element.x = this.drag.origin.x + dx;
      element.y = this.drag.origin.y + dy;
    } else {
      const h = this.drag.handle;
      const isLine = element.type === 'line';
      /* Đường cong/gãy bậc audit (2026-08-25): giữ Shift khi kéo tay cầm
       * của ĐƯỜNG THẲNG = khoá thẳng tuyệt đối ngang/dọc -- ép trục lệch
       * ít hơn về ĐÚNG 0 (không phải "làm tròn cho gần thẳng"), chọn theo
       * trục người dùng đang kéo mạnh hơn. Chỉ áp cho 'line' -- rect/shape
       * kéo độc lập cả 2 trục là đúng ý thiết kế, không có khái niệm
       * "thẳng ngang/dọc". */
      if (event.shiftKey && isLine) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
      }
      let x = this.drag.origin.x, y = this.drag.origin.y, w = this.drag.origin.w, height = this.drag.origin.h;
      if (h.includes('e')) w += dx;
      if (h.includes('s')) height += dy;
      if (h.includes('w')) { x += dx; w -= dx; }
      if (h.includes('n')) { y += dy; height -= dy; }
      /* 'line': w/h là vector lệch, 0 hợp lệ (xem normalizeElement()) --
       * sàn 4px kiểu kích thước hình chữ nhật ở đây sẽ ép lệch giả, đúng
       * lớp lỗi đã báo. Type khác giữ nguyên sàn 4px như cũ. */
      if (!isLine) {
        if (w < 4) { if (h.includes('w')) x -= 4 - w; w = 4; }
        if (height < 4) { if (h.includes('n')) y -= 4 - height; height = 4; }
      }
      Object.assign(element, { x, y, w, h: height });
    }
    this.normalizeElement(element);
    this.render();
    this.onSelection(this.selectedId, element);
  }

  pointerUp(event) {
    if (!this.drag) return;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.drag = null;
    this.changed();
  }

  hitElement(x, y) {
    for (let i = this.project.elements.length - 1; i >= 0; i--) {
      const element = this.project.elements[i];
      if (!element.visible) continue;
      /* Đường cong/gãy bậc audit (2026-08-25): 'line' giờ có thể có w=0
       * hoặc h=0 (ngang/dọc tuyệt đối, xem normalizeElement()) -- hộp hit-
       * test theo đúng x/y/w/h sẽ mỏng đúng 1px theo trục đó, gần như
       * không bấm trúng được. Nới thêm padding theo max(lineWidth, 4)/2
       * mỗi phía CHỈ cho 'line' -- không đổi hành vi bấm chọn của type
       * khác. */
      if (element.type === 'line') {
        const pad = Math.max(Number(element.lineWidth) || 1, 4) / 2;
        const x0 = Math.min(element.x, element.x + element.w) - pad, x1 = Math.max(element.x, element.x + element.w) + pad;
        const y0 = Math.min(element.y, element.y + element.h) - pad, y1 = Math.max(element.y, element.y + element.h) + pad;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return element;
        continue;
      }
      if (x >= element.x && x <= element.x + element.w && y >= element.y && y <= element.y + element.h) return element;
    }
    return null;
  }

  handlePoints(element) {
    const x = element.x, y = element.y, x2 = x + element.w, y2 = y + element.h, cx = x + element.w / 2, cy = y + element.h / 2;
    return { nw:[x,y], n:[cx,y], ne:[x2,y], e:[x2,cy], se:[x2,y2], s:[cx,y2], sw:[x,y2], w:[x,cy] };
  }

  hitHandle(x, y, element) {
    for (const [name, point] of Object.entries(this.handlePoints(element))) {
      if (Math.abs(x - point[0]) <= HANDLE_SIZE && Math.abs(y - point[1]) <= HANDLE_SIZE) return name;
    }
    return null;
  }

  preloadImages() {
    for (const element of this.project.elements) if (element.type === 'image' && element.imageData) this.loadImage(element.imageData).then(() => this.render());
  }

  loadImage(dataUrl) {
    const cached = this.imageCache.get(dataUrl);
    if (cached instanceof HTMLImageElement) return Promise.resolve(cached);
    if (cached) return cached;
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        this.imageCache.set(dataUrl, image);
        resolve(image);
      };
      image.onerror = () => reject(new Error('Không đọc được ảnh'));
      image.src = dataUrl;
    });
    this.imageCache.set(dataUrl, promise);
    return promise;
  }

  render() {
    if (this.rendering) return;
    this.rendering = true;
    const ctx = this.ctx;
    ctx.save();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = this.project.background || '#f4f1e6';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    /* R25.12 (Phần B mục 11/12): thiết bị 3 màu (planes===2, 4.2") vẽ mặt
     * phẳng ĐEN trước (như cũ), rồi mặt phẳng ĐỎ đè lên ở dưới bằng đúng
     * màu đỏ cam xỉn thật của tấm nền -- KHÔNG trộn chung một lượt vẽ, vì
     * mọi draw*() bên dưới đều tô cứng '#000'/BLACK, không có khái niệm
     * màu. this.project.planes là undefined cho MỌI face 2.13" đã có/mới
     * tạo -> tricolor=false -> đúng 1 lượt vẽ y hệt trước bản vá này,
     * không đổi một pixel nào. */
    const tricolor = this.project.planes === 2;
    const showBlack = !tricolor || this.previewPlane !== 'red';
    const showRed = tricolor && this.previewPlane !== 'black';
    for (const element of this.project.elements) {
      if (!element.visible) continue;
      if (!showBlack || (tricolor && !elementMatchesPlane(element, 'black'))) continue;
      this.drawElement(ctx, element, { bw: this.bw, planeFilter: tricolor ? 'black' : null });
    }
    /* R23: the "1-bit" toggle (this.bw) previously only thresholded photo
     * elements (processImage()'s own oneBit pass) -- text and vector shapes
     * stayed smooth-antialiased on this live canvas even though
     * renderToCanvas()'s export/compile path has always thresholded
     * everything. That let the editor show a diagonal stroke or thin
     * script-font edge as soft gray while the device (and the exported
     * preview PNG) render the same pixel as flat black or white -- exactly
     * the mismatch docs/FONT_ATLAS_TNVA.md's WYSIWYG audit flags. Same
     * luma + threshold as that pass, applied here too, before the
     * grid/selection UI chrome (which must stay crisp, not device content). */
    if (this.bw) {
      const image = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const data = image.data;
      for (let i = 0; i < data.length; i += 4) {
        const gray = .299*data[i] + .587*data[i+1] + .114*data[i+2];
        const value = gray < 160 ? 0 : 255;
        data[i]=data[i+1]=data[i+2]=value; data[i+3]=255;
      }
      ctx.putImageData(image, 0, 0);
    }
    if (showRed) {
      const redCanvas = document.createElement('canvas');
      redCanvas.width = this.canvas.width; redCanvas.height = this.canvas.height;
      const redCtx = redCanvas.getContext('2d', { willReadFrequently: true });
      redCtx.fillStyle = '#fff'; redCtx.fillRect(0, 0, redCanvas.width, redCanvas.height);
      for (const element of this.project.elements) {
        if (!element.visible || !elementMatchesPlane(element, 'red')) continue;
        this.drawElement(redCtx, element, { bw: this.bw, planeFilter: 'red' });
      }
      if (this.bw) {
        const image = redCtx.getImageData(0, 0, redCanvas.width, redCanvas.height);
        const data = image.data;
        for (let i = 0; i < data.length; i += 4) {
          const gray = .299*data[i] + .587*data[i+1] + .114*data[i+2];
          const value = gray < 160 ? 0 : 255;
          data[i]=data[i+1]=data[i+2]=value; data[i+3]=255;
        }
        redCtx.putImageData(image, 0, 0);
      }
      const redImage = redCtx.getImageData(0, 0, redCanvas.width, redCanvas.height);
      const mainImage = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
      for (let i = 0; i < redImage.data.length; i += 4) {
        if (redImage.data[i] < 200) {
          mainImage.data[i] = 0xC0; mainImage.data[i+1] = 0x39; mainImage.data[i+2] = 0x2B; mainImage.data[i+3] = 255;
        }
      }
      ctx.putImageData(mainImage, 0, 0);
    }
    if (this.grid) this.drawGrid(ctx);
    if (this.selected) this.drawSelection(ctx, this.selected);
    ctx.restore();
    this.rendering = false;
  }

  drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(60,70,80,.14)';
    ctx.lineWidth = .3;
    for (let x = 0; x <= this.project.width; x += 4) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.project.height); ctx.stroke(); }
    for (let y = 0; y <= this.project.height; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.project.width, y); ctx.stroke(); }
    ctx.restore();
  }

  drawSelection(ctx, element) {
    ctx.save();
    ctx.strokeStyle = '#2b7cff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = .7;
    ctx.setLineDash([2, 1]);
    ctx.strokeRect(element.x - .5, element.y - .5, element.w + 1, element.h + 1);
    ctx.setLineDash([]);
    if (!element.locked) for (const point of Object.values(this.handlePoints(element))) {
      ctx.fillRect(point[0] - 1.4, point[1] - 1.4, 2.8, 2.8);
      ctx.strokeRect(point[0] - 1.4, point[1] - 1.4, 2.8, 2.8);
    }
    if (element.locked) { ctx.fillStyle='#2b7cff'; ctx.font='700 5px sans-serif'; ctx.fillText('LOCK', element.x+1, Math.max(5,element.y+5)); }
    ctx.restore();
  }

  /* R25.9 (mục 12xx): tâm đối tượng rơi vào 1 vùng invertRegion đứng DƯỚI
   * nó (z-order thấp hơn -- index nhỏ hơn trong project.elements, tức vẽ
   * trước/nằm dưới) thì coi như đang "trong vùng đảo", bất kể element.
   * inverse hiện là gì. Chỉ cộng thêm (OR), không tắt bớt: người dùng vẫn
   * tự bật inverse thủ công cho một đối tượng đứng riêng như trước.
   * Vùng tô audit (2026-08-25): chỉ 'black' (mặc định/legacy -- face cũ
   * lưu trước khi có fillMode không có trường này, undefined nghĩa là
   * 'black' như xưa nay) và 'invert' thật sự tạo nền TỐI, mới cần chữ
   * bên trên tự đảo trắng. 'white' cần chữ ĐEN bình thường mới đọc được
   * (đảo lại sẽ mất chữ), 'outline' không tô gì cả nên không ảnh hưởng. */
  isInsideInvertRegion(element) {
    const elements = this.project.elements;
    const index = elements.indexOf(element);
    if (index <= 0) return false;
    const cx = element.x + element.w / 2, cy = element.y + element.h / 2;
    for (let i = 0; i < index; i++) {
      const region = elements[i];
      if (region.type !== 'invertRegion' || region.visible === false) continue;
      if (region.fillMode === 'white' || region.fillMode === 'outline') continue;
      if (cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h) return true;
    }
    return false;
  }

  /* Không đổi element gốc (sẽ làm sai dữ liệu lưu project) -- chỉ tạo bản
   * sao nông riêng cho lượt vẽ này khi cần tự động đảo màu. */
  withAutoInverse(element) {
    if (element.inverse || !this.isInsideInvertRegion(element)) return element;
    return { ...element, inverse: true };
  }

  drawElement(ctx, element, options = {}) {
    switch (element.type) {
      case 'text': return this.drawText(ctx, this.withAutoInverse(element), element.text || '');
      case 'time': case 'date': case 'weekday': case 'lunar': case 'canchi': case 'holiday': case 'temperature': case 'voltage': case 'batteryPercent': case 'dayOnly': case 'monthOnly': case 'yearOnly': {
        const drawEl = this.withAutoInverse(element);
        return this.drawText(ctx, drawEl, dynamicSample(drawEl));
      }
      case 'calendar': case 'calendarWeek': return this.drawGuarded(ctx, element, 'drawCalendar');
      case 'weekStrip': return this.drawGuarded(ctx, element, 'drawWeekStrip');
      case 'battery': return this.drawBattery(ctx, element);
      case 'analog': return this.drawAnalog(ctx, element);
      case 'line': return this.drawLine(ctx, element);
      case 'rect': return this.drawRect(ctx, element);
      case 'shape': return this.drawShape(ctx, element);
      case 'legacyShape': return this.drawLegacyShape(ctx, element);
      case 'image': return this.drawImage(ctx, element, options);
      case 'invertRegion': return this.drawInvertRegion(ctx, element);
    }
  }

  /* R25.9 (mục 12) / Vùng tô audit (2026-08-25): nướng thẳng vào ảnh nền
   * tĩnh giống 'shape' -- không phải đối tượng động, không tốn
   * descriptor/atlas, nên KHÔNG CẦN sửa firmware: bốn chế độ dưới đây đều
   * giải quyết xong ở canvas web trước khi đóng gói bitplane, y hệt
   * shape/rect/text tĩnh đã luôn làm. Thứ tự vẽ (đè lên nền đen được hay
   * không) là chuyện z-order trong project.elements -- canvas vẽ tuần tự
   * theo mảng đó, phần tử đứng SAU trong mảng luôn đè lên phần tử đứng
   * TRƯỚC, không cần đụng gì ở tầng ghép framebuffer.
   *   - 'black'/'white': tô đặc, kể cả 'white' đè lên được nền đen vẽ
   *     trước nó (đúng z-order, không phải trường hợp đặc biệt).
   *   - 'outline': chỉ viền, giữa trong suốt -- không đụng nội dung dưới.
   *   - 'invert': đảo THẬT từng pixel đã có trong vùng ngay trên canvas
   *     này (getImageData/putImageData, kẹp đúng hình bo góc bằng
   *     invertRegionPixels() -- chỉ đảo pixel bên trong hình, không đảo
   *     hình chữ nhật bao ngoài). CHỈ đảo được nội dung TĨNH đã vẽ trước
   *     nó (shape/text/ảnh khác) -- nội dung ĐỘNG (giờ/thứ/...) do firmware
   *     vẽ sau, ở thời điểm chạy thật, không nằm trong canvas này để đảo
   *     ngược -- phần đó dựa vào isInsideInvertRegion()/FLAG_INVERSE
   *     (TNVA_DYN_FLAG_INVERSE, face_custom.c -- đã có sẵn, xác nhận
   *     dùng ở draw_time_descriptor()/draw_text_descriptor() v.v., không
   *     cần sửa) đúng cơ chế 'black' vẫn luôn dùng. */
  drawInvertRegion(ctx, element) {
    const mode = element.fillMode || 'black';
    const radius = Math.max(0, Number(element.radius || 0));
    const rx = Math.min(radius, element.w / 2, element.h / 2);
    const tracePath = () => {
      ctx.beginPath();
      if (rx > 0 && ctx.roundRect) ctx.roundRect(element.x, element.y, element.w, element.h, rx);
      else ctx.rect(element.x, element.y, element.w, element.h);
    };
    ctx.save();
    if (mode === 'outline') {
      ctx.strokeStyle = '#000';
      ctx.lineWidth = clamp(Math.round(Number(element.borderWidth) || 2), 1, 5);
      tracePath();
      ctx.stroke();
    } else if (mode === 'invert') {
      const x = Math.max(0, Math.round(element.x)), y = Math.max(0, Math.round(element.y));
      const w = Math.min(ctx.canvas.width - x, Math.round(element.w));
      const h = Math.min(ctx.canvas.height - y, Math.round(element.h));
      if (w > 0 && h > 0) invertRegionPixels(ctx, x, y, w, h, rx);
    } else {
      ctx.fillStyle = mode === 'white' ? '#fff' : '#000';
      tracePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawSegmentText(ctx, element, text, outline = false) {
    const value = String(text);
    const h = Math.max(7, Number(element.fontSize || 12));
    const digitW = Math.max(5, Math.round(h * .56));
    const thick = Math.max(1, Math.round(h * .11));
    const gap = Math.max(1, Math.round(h * .08));
    const colonW = Math.max(3, Math.round(digitW * .38));
    const masks = [0x3f,0x06,0x5b,0x4f,0x66,0x6d,0x7d,0x07,0x7f,0x6f];
    const widths = [...value].map(ch => ch === ':' ? colonW : digitW);
    const total = widths.reduce((a,b) => a+b,0) + Math.max(0, value.length-1)*gap;
    let x = element.x;
    if (element.align === 'center') x = element.x + (element.w-total)/2;
    else if (element.align === 'right') x = element.x + element.w-total;
    const y = element.y + (element.h-h)/2;
    const half = Math.floor(h/2);
    const bar = (x1,y1,x2,y2) => {
      const bx=Math.round(x1), by=Math.round(y1), bw=Math.max(1,Math.round(x2-x1)), bh=Math.max(1,Math.round(y2-y1));
      if (outline) { ctx.lineWidth=1; ctx.strokeRect(bx+.5,by+.5,Math.max(1,bw-1),Math.max(1,bh-1)); }
      else ctx.fillRect(bx,by,bw,bh);
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(element.x, element.y, element.w, element.h); ctx.clip();
    if (element.inverse) { ctx.fillStyle='#000'; ctx.fillRect(element.x,element.y,element.w,element.h); }
    ctx.fillStyle = element.inverse ? '#fff' : '#000';
    ctx.strokeStyle = element.inverse ? '#fff' : '#000';
    for (const ch of value) {
      if (ch === ':') {
        const d = Math.max(1, thick);
        bar(x+(colonW-d)/2, y+h*.31, x+(colonW+d)/2, y+h*.31+d);
        bar(x+(colonW-d)/2, y+h*.68, x+(colonW+d)/2, y+h*.68+d);
        x += colonW+gap;
        continue;
      }
      if (!/[0-9]/.test(ch)) { x += digitW+gap; continue; }
      const m = masks[Number(ch)];
      if (m&0x01) bar(x+thick,y,x+digitW-thick,y+thick);
      if (m&0x02) bar(x+digitW-thick,y+thick,x+digitW,y+half-thick/2);
      if (m&0x04) bar(x+digitW-thick,y+half+thick/2,x+digitW,y+h-thick);
      if (m&0x08) bar(x+thick,y+h-thick,x+digitW-thick,y+h);
      if (m&0x10) bar(x,y+half+thick/2,x+thick,y+h-thick);
      if (m&0x20) bar(x,y+thick,x+thick,y+half-thick/2);
      if (m&0x40) bar(x+thick,y+half-thick/2,x+digitW-thick,y+half+thick/2);
      x += digitW+gap;
    }
    ctx.restore();
  }

  drawClockBitmapText(ctx, element, text) {
    const value = String(text);
    /* Compiled bitmap fonts (outfit/lobster/pacifico/yellowtail/montez)
     * only ever get ONE device-computed offset intensity (see
     * draw_scalable_clock_text() in face_custom.c) -- unlike atlas fonts,
     * where light/bold genuinely differ in the baked bitmap. Collapsing
     * both to the same preview here keeps this WYSIWYG-accurate instead of
     * showing a distinction the device can't actually produce. 'normal'/
     * '3d' from before R23 both still work. */
    const effect = element.digitEffect === 'light' || element.digitEffect === 'bold' || element.digitEffect === '3d';
    let targetHeight = Math.max(7, Math.min(Number(element.fontSize || 40), element.h));
    let offset = 0;
    let totalWidth = 0;
    do {
      offset = effect ? Math.min(3, Math.max(2, Math.floor(targetHeight / 18))) : 0;
      totalWidth = scaledBitmapTextWidth(element.font, value, targetHeight) + offset;
      if ((totalWidth <= element.w && targetHeight + offset <= element.h) || targetHeight <= 7) break;
      targetHeight--;
    } while (targetHeight > 7);
    const x = alignedX(element.x, element.w, totalWidth, element.align);
    const y = Math.round(element.y + (element.h - targetHeight - offset) / 2);
    const color = element.inverse ? '#fff' : '#000';
    const background = element.inverse ? '#000' : '#fff';
    ctx.save();
    ctx.beginPath(); ctx.rect(element.x, element.y, element.w, element.h); ctx.clip();
    if (element.inverse) { ctx.fillStyle='#000'; ctx.fillRect(element.x,element.y,element.w,element.h); }
    if (effect) {
      drawScaledBitmapText(ctx, element.font, x + offset, y + offset, value, targetHeight, color);
      drawScaledBitmapText(ctx, element.font, x + offset - 1, y + offset - 1, value, targetHeight, background);
    }
    drawScaledBitmapText(ctx, element.font, x, y, value, targetHeight, color);
    ctx.restore();
  }

  /* R23: live preview for the atlas-backed script fonts. Before this, a
   * 'time' element using dancingScript/greatVibes/playball fell through to
   * the generic 44px "large" bitmap preview below (same one robotoCondensed
   * uses) -- i.e. the canvas showed a plain digit font instead of the
   * actual chosen script typeface, a real WYSIWYG gap (see
   * docs/FONT_ATLAS_TNVA.md requirement C). This draws with the real
   * self-hosted font and the same shadow/erase/main technique
   * atlas-generator.js's rasterizeGlyph() uses to bake the 3D effect
   * (R25.8: rewritten to match drawClockBitmapText()'s already-correct
   * 3-pass algorithm below, see that function's comment and
   * rasterizeGlyph()'s), so the preview matches what an uploaded atlas
   * will actually contain (modulo antialiasing -- the final oneBit
   * threshold pass in renderToCanvas() removes that difference for the
   * compiled/exported image, just not for this live on-screen canvas). */
  /* BƯỚC 4 (hợp nhất code path): khi đã có atlas bytes THẬT vừa build cho
   * lần "Gửi vào đồng hồ" gần nhất (app.js set editor.previewAtlas ngay sau
   * prepareAtlasForUpload(), trước compile()) và font của element khớp
   * đúng font đó, vẽ preview bằng cách GIẢI MÃ chính bitmap đã đóng gói
   * (blitAtlasBytes(), đọc đúng thuật toán atlas_draw_glyph() phía
   * firmware) thay vì xấp xỉ lại bằng fillText() bên dưới. Atlas không có
   * khái niệm "cỡ chữ riêng từng element" -- toàn bộ face chia sẻ đúng 1
   * cellPx (xem collectFaceAtlasNeed()) -- nên nhánh này CỐ Ý bỏ qua
   * element.fontSize, dùng previewAtlas.cellPx, đúng những gì máy thật sẽ
   * vẽ (không có scale runtime cho glyph atlas). Không áp lại hiệu ứng 3D ở
   * đây: hiệu ứng đã nướng thẳng vào bitmap lúc build atlas rồi. */
  drawAtlasFontTextFromBytes(ctx, element, text, atlas) {
    const lines = String(text).split('\n');
    const cellH = atlas.cellPx;
    const color = element.inverse ? '#fff' : '#000';
    ctx.save();
    ctx.beginPath(); ctx.rect(element.x, element.y, element.w, element.h); ctx.clip();
    if (element.inverse) { ctx.fillStyle = '#000'; ctx.fillRect(element.x, element.y, element.w, element.h); }
    let top = Math.round(element.y + (element.h - cellH * lines.length) / 2);
    for (const value of lines) {
      const width = atlasTextWidth(atlas.bytes, value);
      const x = alignedX(element.x, element.w, width, element.align);
      blitAtlasBytes(ctx, atlas.bytes, value, x, top, color);
      top += cellH;
    }
    ctx.restore();
  }

  drawAtlasFontText(ctx, element, text) {
    if (this.previewAtlas && this.previewAtlas.fontKey === element.font) {
      this.drawAtlasFontTextFromBytes(ctx, element, text, this.previewAtlas);
      return;
    }
    const lines = String(text).split('\n');
    const minimum = atlasFontMinPx(element.font);
    const px = Math.max(minimum, Math.min(Number(element.fontSize || 40), element.h));
    const weight = atlasFontWeight(element.font);
    const script = minimum === ATLAS_MIN_SCRIPT_PX;
    const color = element.inverse ? '#fff' : '#000';
    const background = element.inverse ? '#000' : '#fff';
    ctx.save();
    ctx.beginPath(); ctx.rect(element.x, element.y, element.w, element.h); ctx.clip();
    if (element.inverse) { ctx.fillStyle = '#000'; ctx.fillRect(element.x, element.y, element.w, element.h); }
    ctx.font = `${weight} ${px}px ${FONT_STACKS[element.font]}`;
    ctx.textBaseline = 'alphabetic';
    const probe = ctx.measureText('Ág');
    const ascent = Number.isFinite(probe.actualBoundingBoxAscent) ? probe.actualBoundingBoxAscent : px * .78;
    const descent = Number.isFinite(probe.actualBoundingBoxDescent) ? probe.actualBoundingBoxDescent : px * .22;
    const lineHeight = Math.max(px, Math.ceil(ascent + descent) + 1);
    let baselineY = element.y + Math.round((element.h - lineHeight * lines.length) / 2 + ascent);
    const shadowPx = element.digitEffect === 'bold' ? 3 : element.digitEffect === 'light' ? 2 : 0;
    const dir = DIGIT_EFFECT_DIRS[element.digitEffectDir] || DIGIT_EFFECT_DIRS.dr;
    const paint = (value, x, baseline, dx, dy, fill) => {
      if (script) {
        ctx.lineJoin = 'round'; ctx.lineWidth = 0.9; ctx.strokeStyle = fill;
        ctx.strokeText(value, x + dx, baseline + dy);
      }
      ctx.fillStyle = fill;
      ctx.fillText(value, x + dx, baseline + dy);
    };
    for (const value of lines) {
      const width = ctx.measureText(value).width;
      const x = alignedX(element.x, element.w, width, element.align);
      if (shadowPx > 0) {
        paint(value, x, baselineY, dir.dx * shadowPx, dir.dy * shadowPx, color);
        paint(value, x, baselineY, dir.dx * (shadowPx - 1), dir.dy * (shadowPx - 1), background);
      }
      paint(value, x, baselineY, 0, 0, color);
      baselineY += lineHeight;
    }
    ctx.restore();
  }

  drawText(ctx, element, text) {
    const crispPlan = crisp213TextPlan(this.project, element, text);
    const clockStyle = Number(element.templateStyle || 0);
    if (!crispPlan && element.type === 'time' && isClockBitmapFont(element.font) && /^[0-9:\n]+$/.test(String(text))) {
      this.drawClockBitmapText(ctx, element, text);
      return;
    }
    if (!crispPlan && ATLAS_FONTS.has(element.font)) {
      this.drawAtlasFontText(ctx, element, text);
      return;
    }
    if (!crispPlan && (element.font === 'dseg' || [STYLE.clockOutline,STYLE.clockSolid,STYLE.clockSegment].includes(clockStyle)) && /^[0-9:\n]+$/.test(String(text))) {
      this.drawSegmentText(ctx, element, text, clockStyle === STYLE.clockOutline);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(element.x, element.y, element.w, element.h);
    ctx.clip();
    if (element.inverse) { ctx.fillStyle = '#000'; ctx.fillRect(element.x, element.y, element.w, element.h); }
    ctx.fillStyle = element.inverse ? '#fff' : '#000';
    const lines = String(text).split('\n');
    const color = element.inverse ? '#fff' : '#000';
    const dynamic = element.type !== 'text' && DYNAMIC_TYPES.has(element.type);

    if (dynamic) {
      const fontSize = crispPlan?.renderPx ?? Number(element.fontSize || 12);
      const isTemplate = ['canchi','holiday','temperature','batteryPercent','dayOnly','monthOnly','yearOnly'].includes(element.type);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (crispPlan?.mode === 'tiny' || (!crispPlan && element.font === 'pixel')) {
          let scale = crispPlan?.mode === 'tiny' ? 1 : element.type === 'time'
            ? clamp(Math.floor((fontSize + 3) / 7), 1, 8)
            : isTemplate ? clamp(Math.floor((fontSize + 3) / 7), 1, 5) : 1;
          while (scale > 1 && (tinyTextWidth(line, scale) > element.w || 7 * scale > element.h)) scale--;
          const width = tinyTextWidth(line, scale);
          const x = alignedX(element.x, element.w, width, element.align);
          /* render_time_descriptor() only enters its vertically-centred
           * sized branch at >=12px. Our crisp sub-14px time tier is native
           * 5x7/font0 and therefore starts exactly at descriptor y. */
          const y = ((element.type === 'time' && !crispPlan) || isTemplate)
            ? Math.round(element.y + (element.h - 7 * scale) / 2)
            : Math.round(element.y + index * 8);
          drawTinyText(ctx, x, y, line, scale, color);
          continue;
        }

        if (!crispPlan && element.type === 'time' && fontSize >= 12 && element.font !== 'dseg') {
          const width = bitmapTextWidth('large', line);
          if (element.h >= 44 && width <= element.w) {
            drawBitmapText(ctx, 'large', alignedX(element.x, element.w, width, element.align),
              Math.round(element.y + (element.h - 44) / 2), line, color);
          } else {
            const fallbackWidth = tinyTextWidth(line, 1);
            drawTinyText(ctx, alignedX(element.x, element.w, fallbackWidth, element.align), element.y, line, 1, color);
          }
          continue;
        }

        /* R25.12 (audit resize lần 3, mục 1): TRƯỚC ĐÂY luôn vẽ đúng 1
         * kích thước gốc (~14px) bất kể fontSize -- khớp đúng bug thật ở
         * firmware (draw_text_descriptor() trong face_custom.c trước bản
         * sửa cùng đợt). Giờ dùng drawScaledSmallText() (device-fonts.js,
         * scale nội suy master 14px) để bản xem trước phản ánh đúng thứ
         * máy thật sẽ vẽ sau khi sửa firmware.
         * R25.12-hotfix (hồi quy chữ vỡ): TRƯỚC ĐÂY dòng dưới chọn bảng
         * 'dseg' khi element.font==='dseg', với lý do "firmware coi mọi
         * font_id 0..4 là cùng một bảng sfont nên chọn bảng nào để VẼ
         * không quan trọng". Đúng một nửa: firmware đúng là luôn vẽ sfont
         * cho MỌI đối tượng động (font_id 0..4 đều ra cùng 1 kết quả trên
         * máy) -- nhưng bảng 'dseg' phía WEB chỉ có glyph SỐ (không có
         * bảng chữ cái/dấu tiếng Việt). Với bất kỳ ký tự nào KHÔNG có
         * trong bảng dseg, glyph() trả null và drawScaledBitmapText() bỏ
         * qua HOÀN TOÀN (không vẽ, KHÔNG tăng con trỏ) -- ký tự tiếp theo
         * vẽ chồng đúng lên vị trí ký tự trước, nhìn như "chữ bị thay
         * bằng chữ khác" (vd "28C" thành "2ЯC" khi widget Nhiệt độ chọn
         * dseg). Luôn dùng 'small' cho MỌI đối tượng động không phải
         * 'time' -- vừa khớp đúng thực tế firmware (WYSIWYG thật), vừa
         * loại bỏ hẳn khả năng chồng chữ này. KHÔNG đổi wire format --
         * deviceFontId()/descriptors gửi lên máy không đụng tới. */
        const table = 'small';
        const clampedSize = crispPlan?.renderPx ?? Math.max(7, fontSize);
        const y = isTemplate ? Math.round(element.y + (element.h - clampedSize) / 2) : Math.round(element.y + index * (clampedSize + 1));
        const width = scaledBitmapTextWidth(table, line, clampedSize, SFONT_MASTER_HEIGHT);
        drawScaledBitmapText(ctx, table, alignedX(element.x, element.w, width, element.align), y, line, clampedSize, color, SFONT_MASTER_HEIGHT);
      }
      ctx.restore();
      return;
    }

    /* R25.12 (mục 5): font MỚI 'canchiSans' (mặc định mới cho 'text' vừa
     * tạo) vẽ bằng ĐÚNG bảng bitmap sfont 14px ('small') mà 'canchi' dùng
     * -- khớp diện mạo Can Chi thật (không phải chỉ CSS font-family giống
     * na ná qua ctx.font), và có sàn px THẬT giống hệt mọi đối tượng động
     * khác (Math.max(7,...) đã có sẵn trong scaledBitmapTextWidth()/
     * drawScaledBitmapText(), khớp firmware). CỐ Ý dùng khoá font MỚI,
     * KHÔNG tái dùng 'robotoCondensed' -- face cũ đã lưu chọn 'robotoCondensed'
     * (vẽ qua ctx.font, khác hẳn diện mạo) phải giữ nguyên y hệt, không âm
     * thầm đổi khi mở lại. */
    if (element.font === 'canchiSans') {
      if (crispPlan?.mode === 'tiny') {
        const scale = 1;
        const lineHeight = 8;
        let y = Math.round(element.y + (element.h - lineHeight * lines.length) / 2);
        for (const line of lines) {
          const width = tinyTextWidth(line, scale);
          drawTinyText(ctx, alignedX(element.x, element.w, width, element.align), y, line, scale, color);
          y += lineHeight;
        }
        ctx.restore();
        return;
      }
      const clampedSize = crispPlan?.renderPx ?? Math.max(7, Number(element.fontSize || 12));
      const lineHeight = clampedSize + 1;
      let y = Math.round(element.y + (element.h - lineHeight * lines.length) / 2);
      for (const line of lines) {
        const width = scaledBitmapTextWidth('small', line, clampedSize, SFONT_MASTER_HEIGHT);
        drawScaledBitmapText(ctx, 'small', alignedX(element.x, element.w, width, element.align), y, line, clampedSize, color, SFONT_MASTER_HEIGHT);
        y += lineHeight;
      }
      ctx.restore();
      return;
    }

    /* Chữ tĩnh được đóng thẳng vào bitplane. Font trong gói luôn đi kèm web;
       đổi mục Font vì vậy thay đổi cả bản xem trước lẫn dữ liệu gửi lên máy. */
    if (element.font === 'pixel') {
      let scale = clamp(Math.floor((Number(element.fontSize || 7) + 3) / 7), 1, 8);
      const lineHeight = 8 * scale;
      let y = Math.round(element.y + (element.h - lineHeight * lines.length) / 2);
      for (const line of lines) {
        while (scale > 1 && tinyTextWidth(line, scale) > element.w) scale--;
        const width = tinyTextWidth(line, scale);
        drawTinyText(ctx, alignedX(element.x, element.w, width, element.align), y, line, scale, color);
        y += 8 * scale;
      }
      ctx.restore();
      return;
    }

    /* Widget Chữ nhiều dòng audit (2026-08-25): resolveTextLines() gộp
     * word-wrap + font/size riêng từng dòng logic -- xem định nghĩa hàm ở
     * đầu file. ctx.textBaseline/textAlign đặt 1 lần, ctx.font đổi LẠI cho
     * từng dòng bên trong vòng lặp (khác nhau nếu dòng đó có override). */
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const rows = resolveTextLines(ctx, element, text);
    const totalHeight = rows.reduce((sum, row) => sum + row.lineHeight, 0);
    let y = element.y + element.h / 2 - totalHeight / 2;
    for (const row of rows) {
      y += row.lineHeight / 2;
      ctx.font = `${row.weight} ${row.fontSize}px ${row.family}`;
      const width = ctx.measureText(row.text).width * row.scaleX;
      const x = alignedX(element.x, element.w, width, element.align);
      ctx.save(); ctx.translate(x, y); ctx.scale(row.scaleX, 1); ctx.fillText(row.text, 0, 0); ctx.restore();
      y += row.lineHeight / 2;
    }
    ctx.restore();
  }

  /* R25.12 (mục 5): đo bề rộng/cao CHÍNH XÁC bằng cùng công thức drawText()
   * dùng để vẽ 'text' -- không viết lại phép đo riêng ở app.js (dễ lệch
   * nhau qua từng đợt sửa sau này). Dùng cho số đếm ký tự + cảnh báo tràn
   * khung trong bảng thuộc tính. */
  staticTextMetrics(element) {
    const raw = String(element.text || '');
    const lines = raw.split('\n');
    const fontSize = Number(element.fontSize || 12);
    let maxWidth = 0, totalHeight = 0;
    if (element.font === 'canchiSans') {
      const crispPlan = crisp213TextPlan(this.project, element, raw);
      if (crispPlan?.mode === 'tiny') {
        for (const line of lines) maxWidth = Math.max(maxWidth, tinyTextWidth(line, 1));
        totalHeight = 8 * lines.length;
      } else {
        const clampedSize = crispPlan?.renderPx ?? Math.max(7, fontSize);
        for (const line of lines) maxWidth = Math.max(maxWidth, scaledBitmapTextWidth('small', line, clampedSize, SFONT_MASTER_HEIGHT));
        totalHeight = (clampedSize + 1) * lines.length;
      }
    } else if (element.font === 'pixel') {
      let scale = clamp(Math.floor((fontSize + 3) / 7), 1, 8);
      for (const line of lines) while (scale > 1 && tinyTextWidth(line, scale) > element.w) scale--;
      for (const line of lines) maxWidth = Math.max(maxWidth, tinyTextWidth(line, scale));
      totalHeight = 8 * scale * lines.length;
    } else {
      /* Widget Chữ nhiều dòng audit (2026-08-25): resolveTextLines() dùng
       * CHUNG với drawText() -- wrap + font/size riêng từng dòng đo ra
       * đúng những gì sẽ vẽ thật, không lệch công thức. */
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const rows = resolveTextLines(ctx, element, raw);
      for (const row of rows) {
        ctx.font = `${row.weight} ${row.fontSize}px ${row.family}`;
        maxWidth = Math.max(maxWidth, ctx.measureText(row.text).width * row.scaleX);
      }
      totalHeight = rows.reduce((sum, row) => sum + row.lineHeight, 0);
    }
    return {
      count: raw.length,
      maxWidth: Math.round(maxWidth), totalHeight: Math.round(totalHeight),
      fitsWidth: maxWidth <= element.w, fitsHeight: totalHeight <= element.h
    };
  }

  /* Bảy thẻ thứ/ngày/tháng/âm lịch; thẻ hôm nay đảo màu.
     Hình học khớp với cf_draw_week_strip() trong firmware: ô rộng
     Math.floor(w/7), phần dư chia đều hai bên, ba cỡ theo chiều cao:
     h>=53 số ngày cao 21px (máy vẽ bằng nét 7 đoạn), h>=44 cao 14px,
     thấp hơn thì bỏ dòng âm lịch rồi đến dòng tháng. */
  /* Hai bộ vẽ lịch chạy ở mỗi lần vẽ lại canvas. Một lỗi trong đó sẽ làm
     chết toàn bộ khung thiết kế, nên bắt lại tại chỗ và vẽ khung rỗng. */
  drawGuarded(ctx, element, method) {
    try { return this[method](ctx, element); }
    catch (error) {
      console.error(`${method}:`, error);
      ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.strokeRect(element.x + .5, element.y + .5, Math.max(1, element.w - 1), Math.max(1, element.h - 1));
      ctx.restore();
    }
  }

  /* R25.10 (mục 2h): trước đây thu nhỏ khung dưới ngưỡng thì widget biến
   * mất hoàn toàn, im lặng, không có dấu hiệu gì cho người thiết kế biết
   * tại sao -- cùng lỗi ở cả preview này lẫn firmware thật
   * (cf_draw_week_strip() trong face_clock_common.c cũng return sớm y
   * hệt, KHÔNG đổi vì đó là hành vi an toàn cố ý ở firmware). Chỉ sửa bên
   * web: viền đứt nét + nhãn ngắn thay vì trống trơn. */
  drawTooSmallWarning(ctx, element) {
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(element.x + 0.5, element.y + 0.5, Math.max(1, element.w - 1), Math.max(1, element.h - 1));
    ctx.setLineDash([]);
    if (element.w >= 36 && element.h >= 9) {
      ctx.fillStyle = '#000';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Quá hẹp', element.x + element.w / 2, element.y + element.h / 2);
    }
    ctx.restore();
  }

  drawWeekStrip(ctx, element) {
    /* The user asked for the polished 7-column calendar in the web editor
     * and gallery, including 212x104 projects.  Keep an explicit 'device'
     * option for anyone who wants the old firmware-exact pixel preview. */
    if ((element.weekFont || 'lunar') !== 'device') return this.drawWeekStripLarge(ctx, element);
    const cell = Math.floor(element.w / 7);
    if (cell < 16 || element.h < 24) { this.drawTooSmallWarning(ctx, element); return; }
    const x0 = element.x + Math.floor((element.w - cell * 7) / 2);
    /* R25.11 (mục 5): sizePct nhân vào chiều cao chữ số ngày -- khớp
     * size_pct trong cf_draw_week_strip() (firmware), cùng ngưỡng kẹp
     * 50..200, cùng chỗ áp dụng (chỉ số ngày, KHÔNG đổi nhãn thứ/tháng/âm
     * lịch -- firmware cũng chỉ scale day_h, xem clock_face_common.c). */
    const sizePct = Math.max(50, Math.min(200, Number(element.sizePct) || 100));
    const dayH = Math.round((element.h >= 53 ? 21 : 14) * sizePct / 100);
    const dayScale = sizePct >= 150 ? 3 : sizePct <= 70 ? 1 : 2;
    const yLabel = element.y + 2;
    const yDay = yLabel + 9;
    const yMonth = yDay + dayH + 2;
    const yLunar = yMonth + 9;
    const showMonth = yMonth + 7 <= element.y + element.h;
    const showLunar = yLunar + 7 <= element.y + element.h;
    const labels = ['T2','T3','T4','T5','T6','T7','CN'];
    const sample = [[27,7,14,6],[28,7,15,6],[29,7,16,6],[30,7,17,6],[31,7,18,6],[1,8,19,6],[2,8,20,6]];
    const today = 6;

    ctx.save();
    ctx.beginPath(); ctx.rect(element.x, element.y, element.w, element.h); ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    labels.forEach((label, index) => {
      const cx = x0 + index * cell;
      const right = cx + cell - 2;
      const bottom = element.y + element.h - 1;
      const invert = index === today;
      const [day, month, lunarDay, lunarMonth] = sample[index];
      ctx.fillStyle = '#fff'; ctx.fillRect(cx, element.y, right - cx + 1, bottom - element.y + 1);
      if (invert) { ctx.fillStyle = '#000'; ctx.fillRect(cx, element.y, right - cx + 1, bottom - element.y + 1); }
      else { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(cx + .5, element.y + .5, right - cx, bottom - element.y); }
      ctx.fillStyle = invert ? '#000' : '#fff';
      [[cx, element.y], [right, element.y], [cx, bottom], [right, bottom]].forEach(([px, py]) => ctx.fillRect(px, py, 1, 1));

      const middle = cx + (cell - 1) / 2;
      const color = invert ? '#fff' : '#000';
      const centered = (value, top, scale = 1) => {
        const width = tinyTextWidth(value, scale);
        drawTinyText(ctx, Math.round(middle - width / 2), top, value, scale, color);
      };
      centered(label, yLabel, 1);
      centered(String(day).padStart(2, '0'), yDay, dayScale);
      if (showMonth) centered(String(month).padStart(2, '0'), yMonth, 1);
      if (showLunar) centered(`${lunarDay}/${lunarMonth}`, yLunar, 1);
    });
    ctx.restore();
  }

  drawWeekStripLarge(ctx, element) {
    const cell = Math.floor(element.w / 7);
    if (cell < 16 || element.h < 24) { this.drawTooSmallWarning(ctx, element); return; }
    const x0 = element.x + Math.floor((element.w - cell * 7) / 2);
    const labels = ['T2','T3','T4','T5','T6','T7','CN'];
    const sample = [[27,7,14,6],[28,7,15,6],[29,7,16,6],[30,7,17,6],[31,7,18,6],[1,8,19,6],[2,8,20,6]];
    const today = 6;
    const family = FONT_STACKS[element.weekFont] || FONT_STACKS.lunar;
    const labelPx = clamp(Math.round(Math.min(cell * .24, element.h * .18)), 5, 18);
    const wantedDay = Math.round(Math.min(cell * .62, element.h * .42) * clamp(Number(element.sizePct || 100), 50, 200) / 100);
    const dayPx = clamp(wantedDay, 9, Math.max(9, Math.round(element.h * .45)));
    const detailPx = clamp(Math.round(Math.min(cell * .2, element.h * .14)), 5, 14);
    const yLabel = element.y + Math.max(1, Math.round(element.h * .035));
    const yDay = yLabel + labelPx + 1;
    const yMonth = yDay + dayPx + 1;
    const yLunar = yMonth + detailPx + 1;
    const showMonth = yMonth + detailPx <= element.y + element.h - 2;
    const showLunar = yLunar + detailPx <= element.y + element.h - 2;

    ctx.save();
    ctx.beginPath(); ctx.rect(element.x, element.y, element.w, element.h); ctx.clip();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let index = 0; index < 7; index++) {
      const left = x0 + index * cell;
      const width = Math.max(1, cell - 2);
      const invert = index === today;
      const [day, month, lunarDay, lunarMonth] = sample[index];
      ctx.fillStyle = invert ? '#000' : '#fff';
      ctx.fillRect(left, element.y, width, element.h);
      if (!invert) {
        ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
        ctx.strokeRect(left + .5, element.y + .5, Math.max(1, width - 1), Math.max(1, element.h - 1));
      }
      ctx.fillStyle = invert ? '#fff' : '#000';
      const center = left + width / 2;
      ctx.font = `700 ${labelPx}px ${family}`;
      ctx.fillText(labels[index], center, yLabel);
      ctx.font = `${element.weekFont === 'classic' ? 700 : 800} ${dayPx}px ${family}`;
      ctx.fillText(String(day).padStart(2, '0'), center, yDay);
      ctx.font = `600 ${detailPx}px ${family}`;
      if (showMonth) ctx.fillText(`T${String(month).padStart(2, '0')}`, center, yMonth);
      if (showLunar) ctx.fillText(`ÂL ${lunarDay}/${lunarMonth}`, center, yLunar);
    }
    ctx.restore();
  }

  /* Bản xem trước phải giống hệt cf_draw_month() trong firmware, nếu không
     thiết kế trên Studio sẽ khác hẳn cái hiện lên màn hình:
       - tiêu đề là dòng chữ "MM/YYYY", KHÔNG phải thanh nền đen;
       - chiều cao chia cho 6 hàng tuần, không phải 5 hay 7;
       - ô nhỏ thì máy dùng font 3x5 và nhãn rút còn "C 2 3..." */
  drawCalendar(ctx, element) {
    const geo = calendarGeometry(element);
    const { x, y, w, h } = element;
    const today = new Date();
    const first = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    /* R25.11 (mục 7): geo.useSfont dùng font web thật ("TNVA Sans", cùng
     * họ Roboto Condensed sfont của firmware) thay bảng pixel 5x7/3x5 --
     * chỉ khi ô đủ to (calendarGeometry() đã tự kẹp điều kiện này, khớp
     * cf_draw_month()'s font_choice==2). Tiêu đề "MM/YYYY" luôn dùng tiny-
     * text, giống hệt firmware (xem chú thích trong cf_draw_month()). */
    const glyph = geo.useSfont ? 16 : geo.large ? 7 : 5;
    if (geo.header) {
      drawTinyText(ctx, x, y, `${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`, 1, '#000');
    }
    const sfontWidth = (text) => ctx.measureText(text).width;
    const drawSfont = (text, left, top, color) => {
      ctx.save(); ctx.fillStyle = color; ctx.font = '14px "TNVA Sans", sans-serif';
      ctx.fillText(text, left, top); ctx.restore();
    };

    for (let column = 0; column < 7; column++) {
      const label = geo.twoCharLabels
        ? (column === 0 ? 'CN' : `T${column + 1}`)
        : (column === 0 ? 'C' : String(column + 1));
      if (geo.useSfont) {
        const labelW = sfontWidth(label);
        drawSfont(label, Math.round(x + column * geo.cellW + (geo.cellW - labelW) / 2), y + geo.header + 12, '#000');
      } else {
        const labelW = tinyTextWidth(label, 1);
        drawTinyText(ctx, Math.round(x + column * geo.cellW + (geo.cellW - labelW) / 2), y + geo.header, label, 1, '#000');
      }
    }

    for (let day = 1; day <= days; day++) {
      const index = first + day - 1;
      const row = Math.floor(index / 7), column = index % 7;
      const top = y + geo.header + geo.labelH + row * geo.cellH;
      const middle = x + column * geo.cellW + geo.cellW / 2;
      const value = String(day);
      const isToday = day === today.getDate();
      if (isToday) ctx.fillRect(x + column * geo.cellW, top - 1, geo.cellW, glyph + 2);
      if (geo.useSfont) {
        const valueW = sfontWidth(value);
        drawSfont(value, Math.round(middle - valueW / 2), top + 12, isToday ? '#fff' : '#000');
      } else {
        const valueW = tinyTextWidth(value, 1);
        drawTinyText(ctx, Math.round(middle - valueW / 2), top, value, 1, isToday ? '#fff' : '#000');
      }
    }
    ctx.restore();
  }

  drawShape(ctx, element) {
    const kind = element.shapeKind || 'roundRect';
    const lw = Math.max(1, Number(element.lineWidth || 1));
    const radius = Math.max(0, Math.min(Number(element.radius || 0), Math.min(element.w, element.h) / 2));
    const x = element.x + lw / 2, y = element.y + lw / 2;
    const w = Math.max(1, element.w - lw), h = Math.max(1, element.h - lw);
    ctx.save(); ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = lw;
    const rounded = () => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
      else ctx.rect(x, y, w, h);
    };
    const polygon = points => {
      ctx.beginPath();
      points.forEach(([px,py], index) => index ? ctx.lineTo(px,py) : ctx.moveTo(px,py));
      ctx.closePath(); element.fill ? ctx.fill() : ctx.stroke();
    };
    if (kind === 'circle') { ctx.beginPath(); ctx.ellipse(element.x + element.w/2, element.y + element.h/2, Math.max(1,w/2), Math.max(1,h/2), 0, 0, Math.PI*2); element.fill ? ctx.fill() : ctx.stroke(); }
    else if (kind === 'line') { ctx.beginPath(); ctx.moveTo(element.x, element.y + element.h/2); ctx.lineTo(element.x + element.w, element.y + element.h/2); ctx.stroke(); }
    else if (kind === 'triangle') polygon([[element.x+element.w/2,element.y+lw/2],[element.x+element.w-lw/2,element.y+element.h-lw/2],[element.x+lw/2,element.y+element.h-lw/2]]);
    else if (kind === 'diamond') polygon([[element.x+element.w/2,element.y+lw/2],[element.x+element.w-lw/2,element.y+element.h/2],[element.x+element.w/2,element.y+element.h-lw/2],[element.x+lw/2,element.y+element.h/2]]);
    else if (kind === 'star') {
      const points=[]; const cx=element.x+element.w/2, cy=element.y+element.h/2;
      const outer=Math.max(2,Math.min(element.w,element.h)/2-lw), inner=outer*.44;
      for(let i=0;i<10;i++){const angle=-Math.PI/2+i*Math.PI/5;const r=i%2?inner:outer;points.push([cx+Math.cos(angle)*r,cy+Math.sin(angle)*r]);}
      polygon(points);
    }
    else if (kind === 'heart') {
      ctx.beginPath();
      ctx.moveTo(element.x+element.w/2, element.y+element.h-lw);
      ctx.bezierCurveTo(element.x+element.w*.08,element.y+element.h*.68,element.x,element.y+element.h*.28,element.x+element.w*.25,element.y+element.h*.18);
      ctx.bezierCurveTo(element.x+element.w*.42,element.y+element.h*.08,element.x+element.w*.5,element.y+element.h*.22,element.x+element.w*.5,element.y+element.h*.3);
      ctx.bezierCurveTo(element.x+element.w*.5,element.y+element.h*.22,element.x+element.w*.58,element.y+element.h*.08,element.x+element.w*.75,element.y+element.h*.18);
      ctx.bezierCurveTo(element.x+element.w,element.y+element.h*.28,element.x+element.w*.92,element.y+element.h*.68,element.x+element.w/2,element.y+element.h-lw);
      ctx.closePath(); element.fill ? ctx.fill() : ctx.stroke();
    }
    else if (kind === 'progress') {
      rounded(); ctx.stroke();
      const pct=clamp(Number(element.progressPct ?? 68),0,100)/100;
      ctx.fillRect(element.x+lw*2,element.y+lw*2,Math.max(0,(element.w-lw*4)*pct),Math.max(1,element.h-lw*4));
    }
    else if (kind === 'battery') {
      const cap = Math.max(2, Math.round(element.w*.08));
      ctx.strokeRect(x, y, Math.max(2,w-cap-1), h);
      ctx.fillRect(element.x+element.w-cap, element.y+element.h*.32, cap, element.h*.36);
      if (element.fill) ctx.fillRect(element.x+lw*2, element.y+lw*2, Math.max(1, element.w-cap-lw*5), Math.max(1,element.h-lw*4));
    } else if (kind === 'square') { element.fill ? ctx.fillRect(element.x,element.y,element.w,element.h) : ctx.strokeRect(x,y,w,h); }
    else { rounded(); element.fill || kind === 'roundRectFill' ? ctx.fill() : ctx.stroke(); }
    ctx.restore();
  }

  drawLegacyShape(ctx, element) {
    const legacy=element.legacy||{};
    const kind=Number(legacy.hinh ?? 2);
    const thickness=Math.max(1,Number(legacy.thingnet || element.lineWidth || 1));
    ctx.save(); ctx.strokeStyle='#000'; ctx.fillStyle='#000'; ctx.lineWidth=thickness;
    if(kind===2){ctx.beginPath();ctx.moveTo(element.x,element.y);ctx.lineTo(element.x+element.w,element.y);ctx.stroke();}
    else if(kind===3){ctx.beginPath();ctx.moveTo(element.x,element.y);ctx.lineTo(element.x,element.y+element.h);ctx.stroke();}
    else if(kind===1){
      const radius=Math.max(1,Math.min(Number(legacy.custom||4),Math.min(element.w,element.h)/2));
      if(ctx.roundRect){ctx.beginPath();ctx.roundRect(element.x+.5,element.y+.5,Math.max(1,element.w-1),Math.max(1,element.h-1),radius);ctx.stroke();}
      else ctx.strokeRect(element.x+.5,element.y+.5,Math.max(1,element.w-1),Math.max(1,element.h-1));
    } else ctx.strokeRect(element.x+.5,element.y+.5,Math.max(1,element.w-1),Math.max(1,element.h-1));
    ctx.restore();
  }

  /* R25.12 (mục 2): đường kẻ 'smooth' (mặc định cũ, GIỮ NGUYÊN không đổi)
   * dùng ctx.stroke() -- canvas tự khử răng cưa (anti-alias) quanh nét 1px,
   * ra các pixel xám ở mép. Bước threshold ảnh xuống 1-bit sau đó (ngưỡng
   * gray<160, renderToCanvas()) NHẬN/LOẠI các pixel xám mép này tuỳ theo
   * đúng vị trí lệch pha dưới-pixel của từng đoạn dọc theo đường kẻ --
   * càng kéo dài, đường kẻ càng đi qua nhiều vị trí lệch pha khác nhau,
   * càng nhiều đoạn bị ăn/thiếu răng cưa khác nhau -- nhìn như "cong lượn"
   * trên màn E-Ink dù bản chất là các bậc thang răng cưa không đều, KHÔNG
   * PHẢI do firmware scale bitmap (line là đối tượng TĨNH, nướng thẳng vào
   * ảnh nền 1-bit lúc compile(), không có đường vẽ lại nào ở firmware).
   * 'crisp' (MỚI): tự vẽ từng pixel theo thuật toán Bresenham, mọi pixel
   * đều đen tuyệt đối hoặc trắng tuyệt đối ngay từ đầu -- không có pixel
   * xám mép nào để bước threshold xử lý sai, nên luôn thẳng tuyệt đối bất
   * kể độ dài/góc. element.lineStyle thiếu (face cũ đã lưu trước bản vá
   * này) = 'smooth' = hành vi cũ y hệt, không phá face đã lưu. */
  drawLine(ctx, element) {
    if (element.lineStyle === 'crisp') {
      return this.drawLineCrisp(ctx, element.x, element.y, element.x + element.w, element.y + element.h, element.lineWidth || 1);
    }
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = element.lineWidth || 1;
    ctx.beginPath();
    ctx.moveTo(element.x, element.y);
    ctx.lineTo(element.x + element.w, element.y + element.h);
    ctx.stroke();
    ctx.restore();
  }

  /* Bresenham thuần -- chỉ fillRect với toạ độ nguyên (không bao giờ khử
   * răng cưa), dày lineWidth px bằng cách vẽ 1 khối vuông lineWidth×lineWidth
   * quanh mỗi điểm trên đường. */
  drawLineCrisp(ctx, x0, y0, x1, y1, lineWidth) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    const w = Math.max(1, Math.round(lineWidth));
    const half = Math.floor(w / 2);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0, y = y0;
    ctx.save();
    ctx.fillStyle = '#000';
    for (;;) {
      ctx.fillRect(x - half, y - half, w, w);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
    ctx.restore();
  }

  drawRect(ctx, element) {
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = element.lineWidth || 1;
    ctx.strokeRect(element.x + .5, element.y + .5, Math.max(1, element.w - 1), Math.max(1, element.h - 1));
    ctx.restore();
  }

  drawBattery(ctx, element) {
    const x = element.x, y = element.y, w = element.w - 2, h = element.h;
    ctx.save();
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 1;
    ctx.strokeRect(x + .5, y + .5, Math.max(4, w - 1), Math.max(4, h - 1));
    ctx.fillRect(x + w, y + h * .3, 2, h * .4);
    ctx.fillRect(x + 2, y + 2, Math.max(1, (w - 5) * .68), Math.max(1, h - 4));
    ctx.restore();
  }

  drawAnalog(ctx, element) {
    const cx = element.x + element.w / 2, cy = element.y + element.h / 2;
    const radius = Math.max(3, Math.min(element.w, element.h) / 2 - 3);
    ctx.save(); ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 1;
    for (let hour = 0; hour < 12; hour++) {
      const angle = hour * Math.PI / 6 - Math.PI / 2;
      const outerX = cx + Math.cos(angle) * radius;
      const outerY = cy + Math.sin(angle) * radius;
      const inner = radius - (hour % 3 === 0 ? 4 : 2);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner); ctx.lineTo(outerX, outerY); ctx.stroke();
    }
    const minute = 44, hour = 21;
    let angle = minute * Math.PI / 30 - Math.PI / 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * (radius - 4), cy + Math.sin(angle) * (radius - 4)); ctx.stroke();
    angle = ((hour % 12) + minute / 60) * Math.PI / 6 - Math.PI / 2;
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * (radius * .52), cy + Math.sin(angle) * (radius * .52)); ctx.stroke();
    ctx.fillRect(cx - 1, cy - 1, 2, 2); ctx.restore();
  }

  drawImage(ctx, element, options = {}) {
    if (!element.imageData) return;
    const cached = this.imageCache.get(element.imageData);
    if (!(cached instanceof HTMLImageElement)) {
      this.loadImage(element.imageData).then(() => this.render()).catch(() => {});
      return;
    }
    const image = cached;
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(element.w)); off.height = Math.max(1, Math.round(element.h));
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    offCtx.fillStyle = '#fff'; offCtx.fillRect(0, 0, off.width, off.height);
    const scale = element.imageScale || Math.min(off.width / image.naturalWidth, off.height / image.naturalHeight);
    const drawW = image.naturalWidth * scale, drawH = image.naturalHeight * scale;
    const dx = (off.width - drawW) / 2 + (element.imageOffsetX || 0);
    const dy = (off.height - drawH) / 2 + (element.imageOffsetY || 0);
    offCtx.drawImage(image, dx, dy, drawW, drawH);
    const processed = this.processImage(offCtx.getImageData(0, 0, off.width, off.height), element, options.bw !== false, options.planeFilter || null);
    offCtx.putImageData(processed, 0, 0);
    ctx.drawImage(off, element.x, element.y, element.w, element.h);
  }

  processImage(imageData, element, forceBw = true, planeFilter = null) {
    const data = imageData.data;
    const contrast = Number(element.contrast || 1);
    const threshold = Number(element.threshold || 150);
    const brightness = Number(element.brightness || 0);
    const invert = Boolean(element.invert);
    const width = imageData.width;
    const values = new Float32Array(width * imageData.height);
    const eligible = element.color === 'auto' && planeFilter ? new Uint8Array(values.length) : null;
    for (let i = 0; i < values.length; i++) {
      const offset = i * 4;
      const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
      const redPixel = red > 70 && red - green > 30 && red - blue > 25 && red > green * 1.12 && red > blue * 1.12;
      if (eligible) eligible[i] = planeFilter === 'red' ? Number(redPixel) : Number(!redPixel);
      let gray = .299 * data[offset] + .587 * data[offset + 1] + .114 * data[offset + 2];
      gray = (gray - 128) * contrast + 128 + brightness;
      if (invert) gray = 255 - gray;
      values[i] = clamp(gray, 0, 255);
      if (eligible && planeFilter === 'red' && eligible[i]) values[i] = 0;
      if (eligible && !eligible[i]) values[i] = 255;
    }
    if (eligible) for (let i = 0; i < values.length; i++) if (!eligible[i]) values[i] = 255;
    if (forceBw) {
      if (element.dither === 'floyd') {
        for (let y = 0; y < imageData.height; y++) for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const old = values[index]; const next = old < threshold ? 0 : 255; const error = old - next; values[index] = next;
          if (x + 1 < width) values[index + 1] += error * 7 / 16;
          if (y + 1 < imageData.height) {
            if (x > 0) values[index + width - 1] += error * 3 / 16;
            values[index + width] += error * 5 / 16;
            if (x + 1 < width) values[index + width + 1] += error / 16;
          }
        }
      } else if (element.dither === 'ordered') {
        const matrix = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
        for (let y = 0; y < imageData.height; y++) for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const local = threshold + (matrix[y % 4][x % 4] - 7.5) * 8;
          values[index] = values[index] < local ? 0 : 255;
        }
      } else {
        for (let i = 0; i < values.length; i++) values[i] = values[i] < threshold ? 0 : 255;
      }
    }
    for (let i = 0; i < values.length; i++) {
      const offset = i * 4; const value = clamp(Math.round(values[i]), 0, 255);
      data[offset] = data[offset + 1] = data[offset + 2] = value; data[offset + 3] = 255;
    }
    return imageData;
  }

  /* R25.12 (Phần B mục 11): vẽ TẬP CON đối tượng khớp `planeFilter` (null =
   * mọi đối tượng, 'black'/'red' = chỉ đối tượng thuộc đúng mặt phẳng đó,
   * xem elementPlane()) lên MỘT ctx cho trước -- tách riêng để dùng chung
   * giữa renderToCanvas() (preview kết hợp + trích riêng từng mặt phẳng lúc
   * compile) mà không lặp lại logic ảnh/dither hai lần. */
  async paintElementsToCanvas(ctx, canvasSize, { includeDynamic, oneBit, planeFilter }) {
    for (const element of this.project.elements) {
      if (!element.visible) continue;
      if (!includeDynamic && DYNAMIC_TYPES.has(element.type)) continue;
      if (planeFilter && !elementMatchesPlane(element, planeFilter)) continue;
      if (element.type === 'image') {
        if (!element.imageData) continue;
        const image = await this.loadImage(element.imageData);
        const off = document.createElement('canvas'); off.width = Math.max(1, Math.round(element.w)); off.height = Math.max(1, Math.round(element.h));
        const offCtx = off.getContext('2d', { willReadFrequently: true });
        offCtx.fillStyle = '#fff'; offCtx.fillRect(0,0,off.width,off.height);
        const scale = element.imageScale || Math.min(off.width / image.naturalWidth, off.height / image.naturalHeight);
        const drawW = image.naturalWidth * scale, drawH = image.naturalHeight * scale;
        offCtx.drawImage(image, (off.width-drawW)/2+(element.imageOffsetX||0), (off.height-drawH)/2+(element.imageOffsetY||0), drawW, drawH);
        const processed = this.processImage(offCtx.getImageData(0,0,off.width,off.height), element, oneBit, planeFilter || null);
        offCtx.putImageData(processed,0,0); ctx.drawImage(off,element.x,element.y,element.w,element.h);
      } else this.drawElement(ctx, element, { bw: oneBit });
    }
    if (oneBit) {
      const image = ctx.getImageData(0,0,canvasSize.width,canvasSize.height);
      const data = image.data;
      for (let i=0;i<data.length;i+=4) {
        const gray = .299*data[i]+.587*data[i+1]+.114*data[i+2]; const value = gray < 160 ? 0 : 255;
        data[i]=data[i+1]=data[i+2]=value; data[i+3]=255;
      }
      ctx.putImageData(image,0,0);
    }
  }

  /* planeFilter (mới, mục 6/11): 'black' hoặc 'red' -- dùng lúc compile()
   * để trích MỘT mặt phẳng bit riêng biệt (compileTricolor() bên dưới gọi
   * hai lần, mỗi lần một màu). Để trống (mặc định, MỌI lời gọi hiện có --
   * compile() 2.13", previewDataUrl(), v.v.) = hành vi CŨ Y HỆT, kể cả với
   * project.planes===2: vẫn vẽ chỉ mặt phẳng đen rồi tô mặt phẳng đỏ đè lên
   * bằng đúng màu đỏ cam xỉn thật (mục 12), không phải trộn xám. */
  async renderToCanvas({ includeDynamic = true, includeSelection = false, oneBit = true, planeFilter = null } = {}) {
    await EDITOR_FONT_READY;
    const canvas = document.createElement('canvas');
    canvas.width = this.project.width; canvas.height = this.project.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const tricolor = !planeFilter && this.project.planes === 2;
    await this.paintElementsToCanvas(ctx, canvas, { includeDynamic, oneBit, planeFilter: planeFilter || (tricolor ? 'black' : null) });
    if (tricolor) {
      const redCanvas = document.createElement('canvas');
      redCanvas.width = canvas.width; redCanvas.height = canvas.height;
      const redCtx = redCanvas.getContext('2d', { willReadFrequently: true });
      redCtx.fillStyle = '#fff'; redCtx.fillRect(0, 0, redCanvas.width, redCanvas.height);
      await this.paintElementsToCanvas(redCtx, redCanvas, { includeDynamic, oneBit, planeFilter: 'red' });
      const redImage = redCtx.getImageData(0, 0, redCanvas.width, redCanvas.height);
      const mainImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < redImage.data.length; i += 4) {
        if (redImage.data[i] < 200) {
          mainImage.data[i] = 0xC0; mainImage.data[i+1] = 0x39; mainImage.data[i+2] = 0x2B; mainImage.data[i+3] = 255;
        }
      }
      ctx.putImageData(mainImage, 0, 0);
    }
    if (includeSelection && this.selected) this.drawSelection(ctx,this.selected);
    return canvas;
  }

  async compile() {
    /* R25.12 (Phần B): compile() đóng gói ĐÚNG MỘT mặt phẳng bit (đọc kênh
     * đỏ của canvas, xem vòng lặp bên dưới) -- gọi hàm này trên project 3
     * màu (planes===2) sẽ ÂM THẦM MẤT toàn bộ nội dung đỏ (bị composite
     * thành màu #C0392B, kênh đỏ=192 không <128 nên bị coi là "trắng").
     * Chặn cứng ở đây thay vì để mất dữ liệu im lặng -- dùng
     * compileTricolor() cho project 4.2"/3 màu. */
    if (this.project.planes === 2) throw new Error('Thiết bị 3 màu (4.2") dùng compileTricolor(), không dùng compile() -- xem ghi chú trong mã nguồn.');
    /* R25.13 Bước 2: 212/104 ở đây LÀ kích thước cố định của gói TNF1
     * (định dạng dây 2.13", xem docs/BLE_PROTOCOL_TNVA.md) -- đọc từ
     * panel_profiles.js để có một nguồn số duy nhất, giá trị không đổi. */
    const landscape = PANEL_PROFILES['212x104'];
    const logicalCanvas = await this.renderToCanvas({ includeDynamic:false, oneBit:true });
    const portrait = logicalCanvas.width === landscape.height && logicalCanvas.height === landscape.width;
    if (!portrait && (logicalCanvas.width !== landscape.width || logicalCanvas.height !== landscape.height)) throw new Error('Chỉ hỗ trợ màn 212 × 104 hoặc 104 × 212');

    let backgroundCanvas = logicalCanvas;
    if (portrait) {
      backgroundCanvas = document.createElement('canvas');
      backgroundCanvas.width = landscape.width; backgroundCanvas.height = landscape.height;
      const rotate = backgroundCanvas.getContext('2d');
      rotate.fillStyle = '#fff'; rotate.fillRect(0,0,landscape.width,landscape.height);
      rotate.translate(0,landscape.height); rotate.rotate(-Math.PI/2);
      rotate.drawImage(logicalCanvas,0,0);
    }

    const image = backgroundCanvas.getContext('2d').getImageData(0,0,backgroundCanvas.width,backgroundCanvas.height);
    const rowBytes = Math.ceil(backgroundCanvas.width / 8);
    const bitplane = packBitplaneRowMajor(image.data, backgroundCanvas.width, backgroundCanvas.height);

    const sourceDynamic = this.project.elements.filter(item => item.visible && DYNAMIC_TYPES.has(item.type)).slice(0,24);
    const descriptorSize = 16;
    const descriptors = new Uint8Array(sourceDynamic.length * descriptorSize);
    const strings = [];
    let stringLength = 0;
    const dynamic = [];

    const addString = text => {
      const raw = utf8BytesLimited(text,95);
      if (stringLength + raw.length > 720) throw new Error('Dữ liệu chữ động vượt giới hạn 720 byte');
      const offset = stringLength;
      strings.push(raw); stringLength += raw.length;
      return { raw, offset };
    };

    sourceDynamic.forEach((item,index) => {
      const offset=index*descriptorSize;
      const crispPlan=crisp213TextPlan(this.project,item);
      const wireFontId=crispPlan?.fontId ?? deviceFontId(item);
      const wireFontSize=crispPlan?.renderPx ?? Math.round(item.fontSize||12);
      let type=DEVICE_DYNAMIC_TYPE[item.type] || 0;
      let style=Number(item.templateStyle || STYLE.text);
      let templateInfo=null;
      if (TEMPLATE_COMPONENTS[item.type]) templateInfo=addString(TEMPLATE_COMPONENTS[item.type]);
      descriptors[offset]=type;
      descriptors[offset+1]=wireFontId;
      descriptors[offset+2]=deviceAlign(item.align);
      let flags=0;
      /* R25.9 (mục 12xx): cùng logic tự đảo màu với bản xem trước
       * (withAutoInverse() trong drawElement()) -- đối tượng nằm trong 1
       * vùng invertRegion phía dưới nó thì tự mang cờ đảo khi gửi lên máy,
       * không cần người dùng bật tay "Đảo nền chữ" từng cái một. */
      if (item.inverse || this.isInsideInvertRegion(item)) flags|=FLAG_INVERSE;
      if (portrait) flags|=FLAG_ROTATE_CCW;
      if (item.type==='time' && item.showSeconds) flags|=FLAG_SECONDS;
      if (item.type==='time' && (item.digitEffect==='light' || item.digitEffect==='bold' || item.digitEffect==='3d')) flags|=FLAG_CLOCK_3D;
      /* Bit 0x02 với đối tượng Thứ nghĩa là "tên dài" (Thứ bảy) chứ không
         phải chữ đậm — firmware không đọc cờ đậm ở đâu cả. Bản cũ đặt cùng
         bit này cho weight>=700, nên chỉnh ô Thứ sang Đậm là nó lặng lẽ đổi
         "T7" thành "Thứ bảy". */
      if (item.type==='weekday' && String(item.format||'').length>3) flags|=FLAG_WEEKDAY_LONG;
      descriptors[offset+3]=flags;
      descriptors[offset+4]=clamp(Math.round(item.x),0,255);
      descriptors[offset+5]=clamp(Math.round(item.y),0,255);
      descriptors[offset+6]=clamp(Math.round(item.w),1,255);
      descriptors[offset+7]=clamp(Math.round(item.h),1,255);
      descriptors[offset+8]=clamp(wireFontSize,5,255);
      descriptors[offset+9]=clamp(Math.round(Number(item.weight||400)/100),1,9);
      if (templateInfo) {
        descriptors[offset+10]=templateInfo.offset&0xff;
        descriptors[offset+11]=(templateInfo.offset>>8)&0xff;
        descriptors[offset+12]=templateInfo.raw.length;
      }
      if (item.type==='calendar' || item.type==='calendarWeek') style=item.type==='calendarWeek'?5:clamp(Number(item.calendarType||0),0,255);
      if (item.type==='weekStrip') style=0; /* TNVA_DYN_WEEKSTRIP không dùng style. */
      if (item.type==='battery') style=6; /* TNVA_STYLE_BATTERY_ICON: draws the icon graphic instead of "NN%" text. */
      descriptors[offset+13]=clamp(style,0,255);
      descriptors[offset+14]=clamp(Number(item.vendorFont||0),0,255);
      /* R25.11 (mục 5/7): d[15] chưa ai đọc trước bản này (luôn ghi cứng 0
       * -- xem chú thích ở face_custom.c's render_v2_descriptor()) nên là
       * byte AN TOÀN DUY NHẤT để tái dùng cho từng type mà không đổi hình
       * dạng face đã lưu/đã gửi lên máy trước bản này: 0 vẫn luôn có nghĩa
       * "hành vi cũ" cho MỌI type, kể cả type không dùng byte này. */
      let reserved15=0;
      if (item.type==='weekStrip') reserved15=clamp(Math.round(Number(item.sizePct)||100),0,255);
      else if (item.type==='calendar' || item.type==='calendarWeek') reserved15=clamp(Number(item.calendarFontChoice||0),0,255);
      descriptors[offset+15]=reserved15;
      dynamic.push({type:item.type,x:item.x,y:item.y,w:item.w,h:item.h,font:wireFontId,fontSize:wireFontSize,requestedFontSize:item.fontSize,align:item.align,flags,style,digitEffect:item.digitEffect||'normal',calendarType:item.calendarType||0,sizePct:item.sizePct,calendarFontChoice:item.calendarFontChoice});
    });

    const stringTable = new Uint8Array(stringLength);
    let stringOffset=0;
    for (const raw of strings) { stringTable.set(raw,stringOffset); stringOffset+=raw.length; }
    const payloadBytes = new Uint8Array(bitplane.length + descriptors.length + stringTable.length);
    payloadBytes.set(bitplane,0);
    payloadBytes.set(descriptors,bitplane.length);
    payloadBytes.set(stringTable,bitplane.length+descriptors.length);
    const headerSize=24;
    const totalSize=headerSize+payloadBytes.length;
    /* R25.6 (Phase D): no hard throw here anymore -- 4096 was a guess
     * baked into this function; the caller (app.js's #installBtn handler)
     * now compares totalSize against the REAL device-reported capacity
     * (ble.js readStatus()'s time.tnf1CapacityBytes, falling back to this
     * same 4096 only while nothing is connected) and can build a
     * breakdown-based message using the sizeBreakdown below, matching what
     * the atlas budget check already does. A pathological size still can't
     * silently produce a corrupt package: descriptor count is capped at 24
     * elements above (.slice(0,24)) and string data at 720B (addString's
     * own check), so nothing here grows unbounded even without the throw. */
    const sizeBreakdown = { bitplane: bitplane.length, descriptors: descriptors.length, template: stringTable.length, headerSize, totalSize };

    const packageBytes=new Uint8Array(totalSize);
    const view=new DataView(packageBytes.buffer);
    view.setUint32(0,0x31464e54,true);
    packageBytes[4]=2;
    packageBytes[5]=212;
    packageBytes[6]=104;
    packageBytes[7]=27;
    view.setUint16(8,bitplane.length,true);
    packageBytes[10]=sourceDynamic.length;
    packageBytes[11]=descriptorSize;
    view.setUint16(12,stringTable.length,true);
    view.setUint16(14,totalSize,true);
    const packageId=crc32Bytes(new TextEncoder().encode(String(this.project.id || this.project.title || 'TNVA'))) || 1;
    view.setUint32(16,packageId,true);
    view.setUint32(20,crc32Bytes(payloadBytes),true);
    packageBytes.set(payloadBytes,headerSize);

    const payload={
      format:'TNVA_FACE',version:5,title:this.project.title,author:this.project.author,
      screen:{width:this.project.width,height:this.project.height,deviceWidth:landscape.width,deviceHeight:landscape.height,rowBytes},
      background:{encoding:'1bpp-msb',data:bytesToBase64(bitplane)},dynamic,
      devicePackage:bytesToBase64(packageBytes),
      createdAt:this.project.createdAt,updatedAt:new Date().toISOString()
    };
    const bytes=new TextEncoder().encode(JSON.stringify(payload));
    return {payload,bytes,packageBytes,bitplane,dynamic,sizeBreakdown,preview:(await this.renderToCanvas({includeDynamic:true,oneBit:true})).toDataURL('image/png')};
  }

  /* R25.12 (Phần B mục 5/6/11): đường biên dịch RIÊNG cho thiết bị 3 màu
   * (4.2", planes===2) -- tách THẬT hai mặt phẳng bit độc lập (đen/trắng +
   * đỏ), mỗi mặt phẳng threshold riêng bằng renderToCanvas({planeFilter}).
   * Đây là phần thoả điều kiện dừng cứng "tách được 2 mặt phẳng bit ở tầng
   * rasterizer". Định dạng trả về là ĐỊNH DẠNG THIẾT KẾ (TNVA_TRICOLOR_
   * DESIGN) -- KHÔNG phải giao thức gửi lên thiết bị thật, vì 4.2" CHƯA có
   * firmware/driver thật (mục 9, "chưa gửi được lên thiết bị"). Không đóng
   * gói packageBytes kiểu TNF1 (sẽ ngộ nhận tương thích máy thật). */
  async compileTricolor() {
    if (this.project.planes !== 2) throw new Error('compileTricolor() chỉ dùng cho project 3 màu (planes===2)');
    const width = this.project.width, height = this.project.height;
    const rowBytes = Math.ceil(width / 8);

    const packPlane = async planeFilter => {
      const canvas = await this.renderToCanvas({ includeDynamic:false, oneBit:true, planeFilter });
      const image = canvas.getContext('2d').getImageData(0,0,width,height);
      return packBitplaneRowMajor(image.data, width, height);
    };
    const bwBitplane = await packPlane('black');
    const redBitplane = await packPlane('red');

    /* Mô tả đối tượng động -- CHƯA phải wire format thật (chưa có firmware
     * để khớp theo), chỉ đủ để thống kê/ghi tài liệu (bảng mẫu face mục 6). */
    const sourceDynamic = this.project.elements.filter(item => item.visible && DYNAMIC_TYPES.has(item.type)).slice(0,24);
    const dynamic = sourceDynamic.map(item => ({
      type:item.type, x:item.x, y:item.y, w:item.w, h:item.h,
      font:item.font, fontSize:item.fontSize, align:item.align, plane:elementPlane(item),
    }));

    const inkRatio = bitplane => {
      let bits = 0;
      for (const b of bitplane) { let v = b; while (v) { bits += v & 1; v >>= 1; } }
      return bits / (width * height);
    };
    const sizeBreakdown = {
      bwBitplaneBytes: bwBitplane.length, redBitplaneBytes: redBitplane.length,
      totalBitplaneBytes: bwBitplane.length + redBitplane.length,
      blackCoveragePct: Math.round(inkRatio(bwBitplane) * 1000) / 10,
      redCoveragePct: Math.round(inkRatio(redBitplane) * 1000) / 10,
    };

    const previewCombined = (await this.renderToCanvas({ includeDynamic:true, oneBit:true })).toDataURL('image/png');
    const previewBw = (await this.renderToCanvas({ includeDynamic:true, oneBit:true, planeFilter:'black' })).toDataURL('image/png');
    const previewRed = (await this.renderToCanvas({ includeDynamic:true, oneBit:true, planeFilter:'red' })).toDataURL('image/png');

    return {
      format: 'TNVA_TRICOLOR_DESIGN', version: 1,
      note: 'Định dạng THIẾT KẾ -- KHÔNG phải giao thức thiết bị thật, 4.2" chưa có firmware/driver.',
      title: this.project.title, author: this.project.author,
      width, height, rowBytes, planes: { bw: bwBitplane, red: redBitplane },
      dynamic, sizeBreakdown, refreshEstimateSeconds: this.estimateRefreshSeconds(),
      previewCombined, previewBw, previewRed,
    };
  }

  /*
   * R25.13 Bước 5: gói NHỊ PHÂN THẬT cho firmware 4.2" (định dạng "TN42",
   * xem tn42-encoder.js + REPORTS/PANEL_AUDIT.md mục 3). Khác
   * compileTricolor() (chỉ để xem trước/tài liệu) ở chỗ: 2 mặt phẳng nền
   * TĨNH dựng ở đúng layout VẬT LÝ 400×300 (xoay giống compile() làm cho
   * 2.13" dọc -- công thức đã verify khớp pixel()'s phép xoay trong
   * tnva42.c), và các đối tượng ĐỘNG mã hoá thành descriptor 24-byte sống
   * (vẽ lại mỗi lần refresh trên máy, không nướng vào bitmap) thay vì chỉ
   * ghi chú như compileTricolor()'s `dynamic`.
   */
  async compileTn42() {
    if (this.project.planes !== 2) throw new Error('compileTn42() chỉ dùng cho project 3 màu (planes===2)');
    const width = this.project.width, height = this.project.height;
    const portrait = height > width;
    const okLandscape = !portrait && width === TN42_PHYSICAL_WIDTH && height === TN42_PHYSICAL_HEIGHT;
    const okPortrait = portrait && width === TN42_PHYSICAL_HEIGHT && height === TN42_PHYSICAL_WIDTH;
    if (!okLandscape && !okPortrait) throw new Error('Chỉ hỗ trợ màn 400 × 300 hoặc 300 × 400');

    const physicalPlane = async planeFilter => {
      const logical = await this.renderToCanvas({ includeDynamic: false, oneBit: true, planeFilter });
      let physical = logical;
      if (portrait) {
        /* Y HỆT công thức compile() đã dùng cho 2.13" dọc -- đã verify khớp
         * pixel()'s "physical_x=y; physical_y=logical_width-1-x" trong
         * tnva42.c khi canvas xoay nguyên ô pixel (không phải điểm mẫu). */
        physical = document.createElement('canvas');
        physical.width = TN42_PHYSICAL_WIDTH; physical.height = TN42_PHYSICAL_HEIGHT;
        const rotate = physical.getContext('2d');
        rotate.fillStyle = '#fff'; rotate.fillRect(0, 0, TN42_PHYSICAL_WIDTH, TN42_PHYSICAL_HEIGHT);
        rotate.translate(0, TN42_PHYSICAL_HEIGHT); rotate.rotate(-Math.PI / 2);
        rotate.drawImage(logical, 0, 0);
      }
      const image = physical.getContext('2d').getImageData(0, 0, TN42_PHYSICAL_WIDTH, TN42_PHYSICAL_HEIGHT);
      return packBitplaneRowMajor(image.data, TN42_PHYSICAL_WIDTH, TN42_PHYSICAL_HEIGHT);
    };
    const bwPlane = await physicalPlane('black');
    const redPlane = await physicalPlane('red');

    /* Descriptor sống -- DEVICE_DYNAMIC_TYPE đã LÀ đúng bảng type TN42 dùng
     * (1=giờ..11=tuần, xác nhận từ render_descriptor_open() trong
     * tnva42.c) nên tái dùng thẳng, không cần bảng map riêng. type 10 (đếm
     * ngược) không có phần tử nguồn trong editor nên không bao giờ phát ra. */
    const sourceDynamic = this.project.elements
      .filter(item => item.visible && DYNAMIC_TYPES.has(item.type) && DEVICE_DYNAMIC_TYPE[item.type])
      .slice(0, TN42_MAX_DESCRIPTORS);
    const strings = [];
    let stringLength = 0;
    const addString = text => {
      const raw = utf8BytesLimited(text, 255);
      const offset = stringLength;
      strings.push(raw); stringLength += raw.length;
      return { raw, offset };
    };
    const descriptors = sourceDynamic.map(item => {
      const buf = new Uint8Array(TN42_DESCRIPTOR_BYTES);
      const view = new DataView(buf.buffer);
      buf[0] = DEVICE_DYNAMIC_TYPE[item.type];
      buf[1] = deviceAlign(item.align);
      let flags = 0;
      if (item.inverse || this.isInsideInvertRegion(item)) flags |= TN42_FLAG_INVERSE;
      if (item.type === 'time' && item.showSeconds) flags |= TN42_FLAG_SECONDS;
      if (item.type === 'weekday' && String(item.format || '').length > 3) flags |= TN42_FLAG_LONG;
      if (elementPlane(item) === 'red') flags |= TN42_FLAG_RED;
      buf[2] = flags;
      /* TNVA_STYLE_BATTERY_ICON (style==6): vẽ biểu tượng pin đồ hoạ thay vì
       * chữ "NN%" -- khớp case 6 trong render_descriptor_open(). Các type
       * khác của TN42 (lịch/tuần/đếm ngược) không đọc style, để 0. */
      buf[3] = item.type === 'battery' ? 6 : 0;
      view.setUint16(4, clamp(Math.round(item.x), 0, 65535), true);
      view.setUint16(6, clamp(Math.round(item.y), 0, 65535), true);
      view.setUint16(8, clamp(Math.round(item.w), 1, 65535), true);
      view.setUint16(10, clamp(Math.round(item.h), 1, 65535), true);
      view.setUint16(12, clamp(Math.round(item.fontSize || 12), 1, 65535), true);
      if (TEMPLATE_COMPONENTS[item.type]) {
        const info = addString(TEMPLATE_COMPONENTS[item.type]);
        view.setUint16(16, info.offset, true);
        buf[18] = info.raw.length;
      }
      return buf;
    });
    const stringTable = new Uint8Array(stringLength);
    let stringOffset = 0;
    for (const raw of strings) { stringTable.set(raw, stringOffset); stringOffset += raw.length; }

    const packageId = crc32Bytes(new TextEncoder().encode(String(this.project.id || this.project.title || 'TNVA'))) || 1;
    const compiled = buildTn42Package({
      portrait, logicalWidth: width, logicalHeight: height, packageId,
      bwPlane, redPlane, descriptors, strings: stringTable,
    });
    if (compiled.bytes.length > TN42_MAX_PACKAGE_BYTES) {
      throw new Error(`Gói TN42 (${compiled.bytes.length} byte) vượt quá ${TN42_MAX_PACKAGE_BYTES} byte cho phép -- bớt ảnh/vùng tô hoặc giảm chi tiết nền.`);
    }

    const previewCombined = (await this.renderToCanvas({ includeDynamic: true, oneBit: true })).toDataURL('image/png');
    const previewBw = (await this.renderToCanvas({ includeDynamic: true, oneBit: true, planeFilter: 'black' })).toDataURL('image/png');
    const previewRed = (await this.renderToCanvas({ includeDynamic: true, oneBit: true, planeFilter: 'red' })).toDataURL('image/png');

    return { ...compiled, title: this.project.title, author: this.project.author, portrait, previewCombined, previewBw, previewRed };
  }

  async downloadTn42() {
    const compiled = await this.compileTn42();
    const name = `${slugify(this.project.title)}.tn42`;
    download(name, new Blob([compiled.bytes], { type: 'application/octet-stream' }));
    return compiled;
  }

  /* Web-tu-thich-ung-theo-panel muc 4 "Đếm ngược: dùng refresh_timeout_ms
   * trong profile ... đừng hardcode": trước đây hardcode `hasRed?15:2`
   * bất kể panel nào đang mở -- đọc thẳng `refreshTimeoutMs` của
   * `panel_profiles.js` (2000ms cho 2.13", 18000ms cho 4.2" 3 màu, số đo
   * theo driver thật SSD1680-family/SSD1683 xem REPORTS/PANEL_AUDIT.md,
   * KHÔNG PHẢI UC8276 như comment cũ ở đây từng ghi nhầm). Có đỏ -> dùng
   * trọn ngưỡng timeout của profile (BWR quét 2 lượt, chậm); không đỏ ->
   * mono luôn chỉ 1 lượt nhanh, tri-màu không đỏ vẫn nhanh hơn hẳn có đỏ
   * nên lấy 1 mốc thấp cố định, không đọc theo timeout (timeout đo cho
   * trường hợp CÓ đỏ, chậm nhất). */
  estimateRefreshSeconds() {
    const hasRed = this.project.elements.some(element => element.visible && elementMatchesPlane(element, 'red'));
    const profile = PANEL_PROFILES[this.project.profileKey];
    const refreshMs = profile?.refreshTimeoutMs ?? 2000;
    return hasRed ? Math.round(refreshMs / 1000) : Math.min(2, Math.round(refreshMs / 1000));
  }

  async downloadFace() {
    const compiled = await this.compile();
    const name = `${slugify(this.project.title)}.tnvaface`;
    download(name, new Blob([compiled.bytes], { type:'application/json' }));
    return compiled;
  }

  /* R25.12 (Phần B mục 9/17): xuất file THIẾT KẾ cho project 3 màu (4.2") --
   * KHÔNG dùng đuôi .tnvaface (dễ hiểu lầm là gửi được lên máy như 2.13").
   * Chứa 2 mặt phẳng bit + 3 ảnh xem trước (kết hợp/đen/đỏ) dạng base64 --
   * đủ để làm tài liệu (bảng mẫu face mục 6/21) và mở lại đúng bằng chính
   * công cụ này, KHÔNG phải giao thức thiết bị thật. */
  async downloadTricolorDesign() {
    const compiled = await this.compileTricolor();
    const name = `${slugify(this.project.title)}.tnva42design`;
    const payload = {
      ...compiled,
      planes: { bw: bytesToBase64(compiled.planes.bw), red: bytesToBase64(compiled.planes.red) },
    };
    download(name, new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' }));
    return compiled;
  }

  async downloadPreviewPng(planeFilter = null) {
    const canvas = await this.renderToCanvas({ includeDynamic:true, oneBit:true, planeFilter });
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const suffix = planeFilter ? `-${planeFilter}` : '';
    download(`${slugify(this.project.title)}${suffix}.png`, blob);
  }

  downloadProject() {
    const name = `${slugify(this.project.title)}.tnvaproject`;
    download(name, new Blob([JSON.stringify(this.project,null,2)], { type:'application/json' }));
  }

  importLegacyEink(data, fileName = 'giao-dien.eink') {
    /* Định dạng .eink cũ có từ trước khi 4.2" tồn tại -- luôn là 2.13". */
    const legacy = PANEL_PROFILES['212x104'];
    const portrait = Boolean(data.xoaydoc);
    const width = portrait ? legacy.height : Number(data.screen_width || legacy.width);
    const height = portrait ? legacy.width : Number(data.screen_height || legacy.height);
    const project = defaultProject(width, height);
    project.title = String(fileName).replace(/\.[^.]+$/, '') || 'Giao diện E-ink';
    project.author = '';
    project.legacyEink = true;
    project.orientation = portrait ? 'portrait' : 'landscape';
    project.sourceSchema = { screen_width:data.screen_width, screen_height:data.screen_height, xoaydoc:Boolean(data.xoaydoc) };

    const pushTemplate = (object, template, clock = false) => {
      const explicitType = explicitTypeForTemplate(template, clock);
      const element = defaultsFor(explicitType || 'text', width, height);
      const profile = clock ? legacyClockProfile(object) : null;
      const fontSize = profile?.fontSize || legacyFontSize(object);
      const sample = expandTemplateSample(template);
      element.x = Number(object.x || 0);
      element.y = Number(object.y || 0);
      element.font = profile?.font || legacyFont(object.font);
      element.fontFamily = typeof object.font === 'string' ? object.font : '';
      element.fontSize = fontSize;
      element.weight = object.bold ? 800 : 600;
      if(explicitType) element.format = sample;
      else element.text = sample;
      element.templateStyle = profile?.style ?? (fontSize >= 22 && /^[0-9:@hmdMyTWA-LVCQqu \-/]+$/.test(String(template)) ? STYLE.textLarge : STYLE.text);
      element.inverse = Boolean(object.swapColor) || Number(object.color) === 0;
      element.vendorFont = typeof object.font === 'number' ? Number(object.font) : 0;
      element.align = 'left';
      const factor = [STYLE.clockOutline,STYLE.clockSolid,STYLE.clockSegment].includes(element.templateStyle) ? 2.86 : .58 * Math.max(1,String(sample).length);
      element.w = clamp(Math.round([STYLE.clockOutline,STYLE.clockSolid,STYLE.clockSegment].includes(element.templateStyle) ? fontSize*factor : Math.max(16,String(sample).length*fontSize*.58)), 8, width-Math.max(0,element.x));
      element.h = clamp(Math.round(fontSize*1.12+4), 8, height-Math.max(0,element.y));
      element.name = TYPE_LABELS[explicitType] || 'Chữ nhập từ tệp';
      element.legacy = clone(object);
      project.elements.push(element);
    };

    const objects = [];
    for (const raw of data.objects || []) {
      const object = clone(raw);
      if (String(object.type||'').toLowerCase() !== 'clock') { objects.push(object); continue; }
      const duplicate = objects.slice(-6).find(item => String(item.type||'').toLowerCase()==='clock' && Number(item.font)===Number(object.font) && Number(item.size)===Number(object.size) && Math.abs(Number(item.x||0)-Number(object.x||0))<=4 && Math.abs(Number(item.y||0)-Number(object.y||0))<=4);
      if (duplicate) { duplicate.x=Math.min(Number(duplicate.x||0),Number(object.x||0)); duplicate.y=Math.min(Number(duplicate.y||0),Number(object.y||0)); duplicate.bold=true; }
      else objects.push(object);
    }

    for (const object of objects) {
      const type = String(object.type || '').toLowerCase();
      if (type === 'image' && Array.isArray(object.dataImg) && object.dataImg.length) {
        const element = defaultsFor('image', width, height);
        element.x = Number(object.x || 0); element.y = Number(object.y || 0);
        element.w = Math.max(1, Number(object.width || 1)); element.h = Math.max(1, Number(object.height || 1));
        element.imageData = legacyBitmapDataUrl(object);
        element.sourceW = element.w; element.sourceH = element.h;
        element.imageScale = 1; element.threshold = 128; element.contrast = 1; element.dither = 'none';
        element.legacy=clone(object);
        project.elements.push(element);
        continue;
      }
      if (type === 'clock') {
        pushTemplate(object, '@h:@m', true);
        continue;
      }
      if (type === 'text' || type === 'super_text') {
        const content = String(object.txt || '');
        if (content.includes('@')) {
          pushTemplate(object, content, false);
        } else {
          const element = defaultsFor('text', width, height);
          const size = legacyFontSize(object);
          element.x = Number(object.x || 0); element.y = Number(object.y || 0);
          element.w = clamp(legacyTextWidth(content, size), 8, width-Math.max(0,element.x));
          element.h = clamp(Math.round(size*1.15+4), 8, height-Math.max(0,element.y));
          element.font = legacyFont(object.font); element.fontSize = size;
          element.fontFamily = type === 'super_text' && typeof object.font === 'string' ? object.font : '';
          element.weight = object.bold ? 800 : 600; element.text = content;
          element.inverse = Boolean(object.swapColor) || Number(object.color) === 0;
          element.legacy=clone(object);
          project.elements.push(element);
        }
        continue;
      }
      if (type === 'shape') {
        const kind = Number(object.hinh || 0);
        const size = Math.max(1, Number(object.size || 10));
        const thickness = clamp(Number(object.thingnet || 1), 1, 8);
        const element = defaultsFor('legacyShape', width, height);
        element.x = Number(object.x || 0); element.y = Number(object.y || 0);
        if (kind === 2) { element.w=size; element.h=1; }
        else if (kind === 3) { element.w=1; element.h=size; }
        else if (kind === 1) { element.w=Math.max(10,width-element.x-2); element.h=Math.max(10,height-element.y-2); }
        else { element.w=size; element.h=Math.max(2,Number(object.custom||size)); }
        element.lineWidth=thickness; element.legacy=clone(object);
        project.elements.push(element);
        continue;
      }
      if (type === 'calendar') {
        const element = defaultsFor('calendar', width, height);
        const style = Number(object.calendarType || 0);
        const dimensions = ({0:[132,74],1:[142,92],2:[142,92],3:[145,100],4:[145,96],5:[204,60]})[style] || [132,74];
        element.x=Number(object.x||0); element.y=Number(object.y||0);
        element.w=Math.min(dimensions[0],width-Math.max(0,element.x));
        element.h=Math.min(dimensions[1],height-Math.max(0,element.y));
        element.calendarType=style; element.legacy=clone(object);
        project.elements.push(element);
      }
    }
    this.loadProject(project);
  }

  async importFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (Array.isArray(data.objects) && data.screen_width && data.screen_height) {
      this.importLegacyEink(data, file.name);
      return;
    }
    if (data.format === 'TNVA_PROJECT' || Array.isArray(data.elements)) {
      this.loadProject(data);
      return;
    }
    if (data.format === 'TNVA_FACE') {
      const project = defaultProject(data.screen.width, data.screen.height);
      project.title = data.title || file.name.replace(/\.[^.]+$/, '');
      project.author = data.author || '';
      const bytes = Uint8Array.from(atob(data.background.data), char => char.charCodeAt(0));
      const canvas = document.createElement('canvas'); canvas.width = data.screen.width; canvas.height = data.screen.height;
      const ctx = canvas.getContext('2d'); const image = ctx.createImageData(canvas.width,canvas.height);
      for (let y=0;y<canvas.height;y++) for (let x=0;x<canvas.width;x++) {
        const black = bytes[y*data.screen.rowBytes+(x>>3)] & (0x80>>(x&7)); const value=black?0:255; const i=(y*canvas.width+x)*4;
        image.data[i]=image.data[i+1]=image.data[i+2]=value; image.data[i+3]=255;
      }
      ctx.putImageData(image,0,0);
      project.elements.push({ ...defaultsFor('image',project.width,project.height), x:0,y:0,w:project.width,h:project.height,imageData:canvas.toDataURL('image/png'),imageScale:1,name:'Nền đã biên dịch' });
      for (const descriptor of data.dynamic || []) {
        const migratedType = descriptor.type === 'template' ? explicitTypeForTemplate(descriptor.template) : descriptor.type;
        const type = migratedType || 'text';
        const migrated = { ...descriptor };
        delete migrated.template;
        if(!migratedType && descriptor.template) migrated.text = expandTemplateSample(descriptor.template);
        project.elements.push({ ...defaultsFor(type,project.width,project.height), ...migrated, type, id:uid(), name:TYPE_LABELS[type] || type, font:Object.keys(FONT_IDS).find(key=>FONT_IDS[key]===descriptor.font)||'pixel' });
      }
      this.loadProject(project);
      return;
    }
    throw new Error('File không hợp lệ');
  }

  async previewDataUrl() { return (await this.renderToCanvas({ includeDynamic:true, oneBit:true })).toDataURL('image/png'); }
}

export { TYPE_LABELS, VALID_ELEMENT_TYPES, FONT_STACKS, FONT_IDS, DYNAMIC_TYPES, download, dataUrlToBytes };
export { elementPlane, elementMatchesPlane, TRICOLOR_RED_PREVIEW, redUsageWarning, normalizeVietnameseText };
/* Font-pipeline audit (2026-08-25) — Phần B: app.js's fontPickerHtml() dùng
 * lại ĐÚNG hàm này để chữ mẫu trong nút chọn font khớp 100% với chữ thật
 * canvas vẽ (renderToCanvas() cũng gọi dynamicSample() y hệt), không đoán
 * mẫu riêng một chỗ khác dễ lệch. */
export { dynamicSample };
/* Widget Chữ nhiều dòng audit (2026-08-25): export để test hồi quy
 * (tests/test_multiline_text_widget.py) gọi thẳng, không viết lại logic
 * wrap/per-line-font riêng trong test. */
export { resolveTextLines, wrapTextLine };
