import { crisp213TextPlan } from './text-size-policy.js';
import { PANEL_PROFILES } from './panel_profiles.js';

/* R23: builds flash glyph atlases for the atlas-backed script fonts
 * (Dancing Script / Great Vibes / Playball) in the exact binary format
 * firmware's tnva_font_atlas.c reads -- see docs/FONT_ATLAS_TNVA.md.
 * Only glyphs a face's own dynamic text can actually produce are included
 * (not a blanket Vietnamese alphabet), so weekday/holiday/can-chi are
 * enumerated from firmware's own fixed lists, mirrored below.
 */

export const ATLAS_MAGIC = 'TNVA';
export const ATLAS_VERSION = 1;
export const ATLAS_HEADER_SIZE = 16;
export const ATLAS_ENTRY_SIZE = 6;
export const ATLAS_MAX_GLYPHS = 64;
/* One atlas occupies one 4KB flash sector (tnva_font_atlas.h's
 * TNVA_ATLAS_SLOT_SIZE) -- the second slot is only for double-buffered
 * upload safety, never a second concurrently-active atlas, so the budget
 * for a single atlas is 4KB, not the 8KB the whole reserved region adds
 * up to. Matches the existing "Gói: X/4KB" face-package bar exactly.
 * R25.13 Bước 2: nguồn số giờ là panel_profiles.js (2.13" atlasBudgetBytes)
 * thay vì hardcode ở đây -- giá trị không đổi (vẫn 4096), chỉ gộp một
 * nguồn duy nhất. Cơ chế atlas này chỉ dùng cho 2.13" (4.2" đọc text mẫu
 * thẳng từ flash qua read_template_open(), không có atlas glyph). */
export const ATLAS_BUDGET_BYTES = PANEL_PROFILES['212x104'].atlasBudgetBytes;
/* R25.8 (mục 4): 4 hướng đổ bóng cho hiệu ứng 3D nướng vào atlas -- 'dr'
 * (xuống-phải) là mặc định, khớp đúng hướng firmware dùng cho font sfont
 * (draw_scalable_clock_text() trong face_custom.c luôn cộng offset dương
 * cho cả x lẫn y, không có khái niệm hướng). 3 hướng còn lại chỉ áp dụng
 * được cho hiệu ứng nướng-atlas này (thiết kế xong là bake chết vào ảnh),
 * không đổi được cách sfont vẽ trên chip. */
export const DIGIT_EFFECT_DIRS = {
  dr: { dx: 1, dy: 1 },
  dl: { dx: -1, dy: 1 },
  ur: { dx: 1, dy: -1 },
  ul: { dx: -1, dy: -1 }
};
/* R24: montez/yellowtail rejoin here -- both were removed from firmware for
 * the same RAM reason font_rc_44/F_DSEG7_50 were (see FONT_ATLAS_TNVA.md),
 * so re-adding them has to go through the atlas, never back into a compiled
 * bitmap table. Their glyph coverage is real Apache-2.0 Google Fonts .ttf
 * (weble/assets/fonts/clock/Montez-LICENSE.txt, Yellowtail-LICENSE.txt --
 * Apache 2.0, not OFL, hence the different license filename convention),
 * already self-hosted and already declared in carnival.css ("TNVA Montez" /
 * "TNVA Yellowtail") from when they were digit-only choices; no new woff2
 * needed since there is no Vietnamese subset to split out of them (next
 * comment). */
/* R24 (Phase 0): caveat/kaushan/courgette added via tools/fetch_and_subset_clock_font.py
 * + tools/check_font_vietnamese_cmap.py -- measured the same way as
 * montez/yellowtail below, and found the same way: no Vietnamese subset.
 * Single .ttf each (weble/assets/fonts/clock/Caveat-Regular.ttf,
 * KaushanScript-Regular.ttf, Courgette-Regular.ttf), OFL licensed. */
export const ATLAS_FONTS = new Set([
  'dancingScript', 'greatVibes', 'playball', 'montez', 'yellowtail',
  'caveat', 'kaushan', 'courgette', 'classic', 'lunar'
]);
export const ATLAS_MIN_SCRIPT_PX = 22; /* thin script strokes go illegible/broken below this after 1-bit threshold */
const SCRIPT_ATLAS_FONTS = new Set([
  'dancingScript', 'greatVibes', 'playball', 'montez', 'yellowtail',
  'caveat', 'kaushan', 'courgette'
]);
export function atlasFontMinPx(fontKey) {
  return SCRIPT_ATLAS_FONTS.has(fontKey) ? ATLAS_MIN_SCRIPT_PX : 8;
}
export function atlasFontWeight(fontKey) {
  return fontKey === 'classic' ? 700 : fontKey === 'lunar' ? 600 : 400;
}

/* R25.12-hotfix: export thêm (trước là private) -- trang chẩn đoán
 * `debug-font-check.html` cần đúng bảng này để tự dựng phiên bản "trước
 * sửa" (baseline 0.78 cũ) so sánh cạnh phiên bản đã vá, không đoán tên
 * font CSS riêng một chỗ khác dễ lệch. */
export const FONT_FAMILY_CSS = {
  dancingScript: 'TNVA Dancing Script',
  greatVibes: 'TNVA Great Vibes',
  playball: 'TNVA Playball',
  montez: 'TNVA Montez',
  yellowtail: 'TNVA Yellowtail',
  caveat: 'TNVA Caveat',
  kaushan: 'TNVA Kaushan Script',
  courgette: 'TNVA Courgette',
  classic: 'TNVA Serif',
  lunar: 'TNVA Sans'
};

/* Measured, not assumed (scratchpad/check_cmap.py read each .ttf's cmap
 * directly): Montez and Yellowtail's cmap tables cover only 2 of the 90
 * codepoints in the precomposed Vietnamese block U+1EA0-1EF9 and are
 * entirely missing the base letters Ơ/ơ/Ư/ư -- real Vietnamese strings
 * ("Thứ bảy", "Đông Xuân", "Nguyễn"...) lose more than half their
 * characters. Dancing Script/Great Vibes/Playball's -vietnamese.woff2
 * files (carnival.css unicode-range split) were confirmed the opposite way
 * and cover the full block. This gates the picker (app.js) so
 * Montez/Yellowtail stay available for the digit clock and other
 * accent-free content -- where they are exactly as usable as before R23 --
 * without silently mangling Vietnamese text. */
export const ATLAS_FONT_HAS_VIETNAMESE = {
  dancingScript: true,
  greatVibes: true,
  playball: true,
  montez: false,
  yellowtail: false,
  /* R24 -- measured via tools/check_font_vietnamese_cmap.py, all three:
   * 2-14 of 90 precomposed codepoints, base letters O-horn/U-horn entirely
   * absent. Same accent-free-only treatment as montez/yellowtail. */
  caveat: false,
  kaushan: false,
  courgette: false,
  /* Both files are self-hosted DejaVu subsets checked against the complete
   * precomposed Vietnamese alphabet, including Ơ/Ư and every tone. */
  classic: true,
  lunar: true
};
/* True if `text` contains a character outside the fonts' shared-safe ASCII
 * range -- conservative on purpose (flags punctuation/CJK/etc as "needs
 * checking" too, not just Vietnamese) since anything past 0x7E is exactly
 * what a font missing its Vietnamese subset tends to also be missing. */
export function containsNonAsciiText(text) {
  return /[^\x00-\x7E]/.test(String(text || ''));
}

/* Mirrors cf_weekday_long() in clock_face_common.c exactly. */
export const WEEKDAY_LONG_VN = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
export const WEEKDAY_SHORT_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/* Mirrors tnva_holidays[] in tnva_holidays.c exactly (name strings only —
 * date fields don't matter for glyph coverage). */
export const HOLIDAY_NAMES_VN = [
  'Ông Công', 'Giao thừa', 'Tết Nguyên Đán', 'Nguyên Tiêu', 'Hàn Thực',
  'Giỗ Tổ Hùng Vương', 'Đoan Ngọ', 'Thất Tịch', 'Vu Lan', 'Trung Thu', 'Trùng Cửu',
  'Tết DL', 'Valentine', 'Quốc tế Phụ nữ', 'Thống nhất', 'Quốc tế Lao động',
  'Quốc tế Thiếu nhi', 'Thương binh Liệt sĩ', 'Quốc khánh', 'Phụ nữ Việt Nam',
  'Halloween', 'Nhà giáo Việt Nam', 'Giáng sinh', 'Ngày của Mẹ', 'Ngày của Cha'
];
/* Mirrors the can[]/chi[] syllable tables in face_clock_common.c exactly. */
export const CAN_VN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
export const CHI_VN = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];

export const TIME_GLYPHS = '0123456789:';
/* Covers @D (temperature, "-12C"/"--C" -- integer since the R23 display
 * rounding fix, see face_custom.c's 'D' case, no degree symbol), @V
 * (voltage, "3.7V"/"--.-V"), @P (battery percent, "85%" -- rounds to the
 * nearest 5, see cf_battery_percent_display() in clock_face_common.c). */
export const TEMP_BATTERY_GLYPHS = '0123456789.-%CV';

/* BƯỚC 5 audit fix (2026-08-24): trước đây `if (ch.trim())` loại bỏ CẢ dấu
 * cách khỏi tập ký tự cần rasterize -- ELEMENT_GLYPHS.canchi cố ý nối thêm
 * `' '` (xem bên dưới) đúng vì biết chữ hiển thị thật là "Bính Ngọ" (có
 * cách), nhưng uniqueChars() lại âm thầm xoá nó trước khi tới
 * rasterizeGlyph(). Kết quả: atlas font (classic/lunar/dancingScript/...)
 * không bao giờ có glyph cho dấu cách -- chữ nhiều từ dính liền thành một
 * ("BínhNgọ", "Thứhai") trên cả preview lẫn máy thật, đúng lớp triệu chứng
 * "gãy/dính chữ" đã báo. Chỉ giữ lại dấu cách (0x20) -- tab/newline vẫn bị
 * loại như cũ (text luôn được split theo '\n' trước khi rasterize từng ký
 * tự, không ký tự nào thực sự cần glyph tab/newline). */
function uniqueChars(...strings) {
  const set = new Set();
  for (const s of strings) for (const ch of String(s || '')) if (ch.trim() || ch === ' ') set.add(ch);
  return set;
}

/* ===================================================================== *
 * Rasterizer                                                             *
 * ===================================================================== */

/* Same luma + fixed threshold FaceEditor.renderToCanvas() already uses for
 * the final 1-bit compile pass (editor.js), so atlas glyphs look
 * consistent with the rest of the compiled face rather than inventing a
 * second threshold rule. */
function isBlackPixel(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) < 160;
}

/* Rasterizes one character at `cellPx` height into a column-major, 1-bit,
 * byte-padded-per-column bitmap. `effect` bakes a fake-3D shadow directly
 * into the bitmap (see docs/FONT_ATLAS_TNVA.md "3D digit effect") since
 * the chip has no RAM budget to compose it at draw time.
 *
 * R25.8 (mục 4n/4o) bug fix: this used to paint a same-color shadow copy
 * UNDER the main glyph and stop there -- with both passes solid black,
 * anywhere they overlapped just merged into one bigger black shape with no
 * visible "step" (mục 4o's "dính thành một mảng đen"), and the look never
 * matched the firmware's own 3D effect for sfont/device fonts
 * (draw_scalable_clock_text() in face_custom.c, already correct --
 * editor.js's drawClockBitmapText() mirrors it for preview). That function
 * uses a proven 3-pass technique this now copies exactly: 1) shadow copy
 * offset by `shadowPx` in the glyph color, 2) a SECOND copy offset by
 * `shadowPx - 1` painted in the BACKGROUND color -- this erases all but a
 * thin ~1px sliver of the shadow, which is what keeps the block looking
 * like a crisp relief step instead of a blob -- 3) the real glyph on top,
 * unshifted. offset values 2/3 (not the old 1/2) match
 * draw_scalable_clock_text()'s own clamp(2, 3, targetHeight/18) range, so
 * "nổi nhẹ"/"nổi đậm" bracket the exact same relief depths the firmware
 * already produces for its own fonts -- same visual language either path. */
export async function rasterizeGlyph(fontKey, ch, cellPx, effect = { mode: 'flat' }) {
  const family = FONT_FAMILY_CSS[fontKey];
  const isScript = SCRIPT_ATLAS_FONTS.has(fontKey);
  const weight = atlasFontWeight(fontKey);
  const px = Math.max(cellPx, atlasFontMinPx(fontKey));
  await document.fonts.load(`${weight} ${Math.ceil(px)}px "${family}"`);
  await document.fonts.ready;

  const shadowPx = effect.mode === 'bold' ? 3 : effect.mode === 'light' ? 2 : 0;
  const dir = effect.direction || DIGIT_EFFECT_DIRS.dr;
  /* Canvas height is exactly cellPx -- the row range the scan/pack loops
   * below use -- so there is no vertical offset to keep in sync between
   * where the glyph is drawn and where it's read back. Only horizontal
   * padding is needed (left bearing / advance overshoot); an extreme
   * ascender/descender at a very small cellPx can clip at the top/bottom,
   * same tradeoff the old compiled tnva_big_glyphs bitmaps already made. */
  const padX = Math.ceil(px * 0.6) + shadowPx + 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.ceil(px * 1.6) + padX * 2);
  canvas.height = cellPx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `${weight} ${px}px "${family}"`;
  ctx.textBaseline = 'alphabetic';

  /* R25.12-hotfix (mất chân chữ dưới 14px): baseline trước đây CỐ ĐỊNH
   * 78% trên / 22% dưới, không lấy từ font thật -- ở cellPx nhỏ (dưới
   * ~14), 22% chỉ còn 2-3 hàng, không đủ chứa chân chữ g/y/p/q hay dấu
   * tiếng Việt nằm dưới baseline (ạ, ệ, ...) -- bị cắt cụt. Đo bằng
   * TextMetrics's fontBoundingBoxAscent/Descent (đặc trưng theo ĐÚNG
   * font/cỡ đang bake, không phải hằng số đoán) -- có fallback về đúng
   * tỉ lệ 0.78 cũ nếu trình duyệt không hỗ trợ 2 trường này (Canvas 2D
   * Level 2, chưa chắc có ở mọi nơi -- không để hàm này ném lỗi/NaN nếu
   * thiếu). Math.floor() (không phải round()) khi tính baseline -- làm
   * tròn về hướng DƯ CHO PHẦN DƯỚI hơn phần trên, đúng chiều bảo vệ chân
   * chữ. */
  const metrics = ctx.measureText(ch);
  const hasRealMetrics = Number.isFinite(metrics.fontBoundingBoxAscent) && Number.isFinite(metrics.fontBoundingBoxDescent)
    && (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) > 0;
  const ascentRatio = hasRealMetrics
    ? metrics.fontBoundingBoxAscent / (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)
    : 0.78;
  let baselineY = Math.floor(cellPx * ascentRatio);
  /* Sàn tối thiểu TUYỆT ĐỐI cho phần dưới baseline -- không bao giờ dưới
   * 2px bất kể metrics đo được nhỏ hơn (làm tròn cộng dồn ở cellPx rất
   * nhỏ có thể ăn mất nốt phần ít ỏi còn lại, mục 7). Đồng thời không đẩy
   * baseline lên quá cao (mất chỗ chữ hoa/dấu phía trên) -- kẹp cả hai
   * phía. */
  const minBelowPx = Math.max(2, Math.round(cellPx * 0.08));
  if (cellPx - baselineY < minBelowPx) baselineY = cellPx - minBelowPx;
  baselineY = Math.max(baselineY, Math.ceil(cellPx * 0.4));
  const originX = padX;

  const paintGlyph = (dx, dy, fill) => {
    /* Script strokes are thin enough to break into dots after 1-bit
     * thresholding; stroke first (fattens the outline), then fill on top,
     * both in the same color -- see docs/FONT_ATLAS_TNVA.md "canvas
     * rasterizer". Using `fill` (not hardcoded black) lets the same helper
     * paint the background-color erase pass below. */
    if (isScript) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = fill;
      ctx.strokeText(ch, originX + dx, baselineY + dy);
    }
    ctx.fillStyle = fill;
    ctx.fillText(ch, originX + dx, baselineY + dy);
  };

  if (shadowPx > 0) {
    paintGlyph(dir.dx * shadowPx, dir.dy * shadowPx, '#000');
    paintGlyph(dir.dx * (shadowPx - 1), dir.dy * (shadowPx - 1), '#fff');
  }
  paintGlyph(0, 0, '#000');

  const advance = Math.max(1, Math.ceil(ctx.measureText(ch).width) + (shadowPx > 0 ? shadowPx : 0) + 1);

  /* BƯỚC 5 audit fix (2026-08-24): whitespace paints no ink but MUST still
   * become a real atlas entry carrying its measured advance -- firmware's
   * atlas_find_glyph()/this module's own blitAtlasBytes() both treat "no
   * entry for this codepoint" as advance=0, so without this the atlas
   * decode path (device AND the unified preview) collapses "Bính Ngọ" /
   * "Thứ hai" / holiday names into one run-together word, even though the
   * word gap is right there in the source text. Falls through to the
   * ordinary blank-pixel-scan below for anything else that happens to
   * paint no ink (a genuinely unsupported/tofu glyph) -- dropping THOSE
   * (not giving them an atlas entry at all) is still correct, there is no
   * meaningful width to advance past. */
  if (/^\s$/.test(ch)) return { width: 0, advance: Math.min(255, advance), bitmap: new Uint8Array(0) };

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  let minX = canvas.width, maxX = -1;
  for (let y = 0; y < cellPx; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      if (isBlackPixel(data[i], data[i + 1], data[i + 2])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  if (maxX < minX) return null; /* blank glyph (unsupported/tofu char) */

  const width = Math.min(255, maxX - minX + 1);
  const bytesPerCol = Math.ceil(cellPx / 8);
  const bitmap = new Uint8Array(width * bytesPerCol);
  for (let col = 0; col < width; col++) {
    const x = minX + col;
    for (let row = 0; row < cellPx; row++) {
      const i = (row * canvas.width + x) * 4;
      if (isBlackPixel(data[i], data[i + 1], data[i + 2])) {
        bitmap[col * bytesPerCol + (row >> 3)] |= (0x80 >> (row & 7));
      }
    }
  }
  return { width, advance: Math.min(255, advance), bitmap };
}

/* ===================================================================== *
 * Row-major background bitplane packer                                  *
 * ===================================================================== */

/* Font-pipeline audit (2026-08-24): the exact ImageData -> 1-bit formula
 * requested for every packing site in this codebase --
 * rowBytes = ceil(width/8), MSB-first (bit 7 = leftmost column,
 * `0x80 >> (x & 7)`). This used to be three separate copies of the same
 * loop (editor.js's compile() and compileTricolor(), app.js's
 * canvasToBitplane()) -- centralized here so there is exactly one
 * implementation to test (tests/test_bitplane_stride_isolation.py) and
 * reuse, not three that could silently drift apart. `data` is the RGBA
 * `.data` of an ImageData (or any array-like with the same layout) --
 * only the red channel is read, matching every call site's existing
 * assumption that the source canvas is always plain black-on-white before
 * this runs (renderToCanvas()'s oneBit threshold already ran). */
export function packBitplaneRowMajor(data, width, height, threshold = 128) {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4] < threshold) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

/* ===================================================================== *
 * Binary packer                                                          *
 * ===================================================================== */

/* Same CRC-32 (poly 0xEDB88320) as ble.js's crc32() / spi_flash.c's
 * crc32() -- re-declared locally so this module has no import-order
 * dependency on ble.js. */
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* Builds one atlas from a Map<codepoint, {width,advance,bitmap}> (from
 * rasterizeGlyph, keyed by ch.codePointAt(0)). Throws if glyphCount would
 * exceed ATLAS_MAX_GLYPHS or the packed size would exceed the 4KB slot --
 * callers should check estimateFaceAtlas()'s totalBytes against
 * ATLAS_BUDGET_BYTES first so this is a should-never-happen safety net,
 * not the primary UI feedback path. */
export function packAtlas(cellPx, glyphs) {
  const entries = [...glyphs.entries()].sort((a, b) => a[0] - b[0]);
  if (entries.length === 0) throw new Error('Atlas rỗng: không có glyph nào để đóng gói');
  if (entries.length > ATLAS_MAX_GLYPHS) {
    throw new Error(`Atlas cần ${entries.length} glyph, vượt giới hạn ${ATLAS_MAX_GLYPHS}`);
  }
  let dataLen = 0;
  for (const [, g] of entries) dataLen += g.bitmap.length;
  const bodyLen = entries.length * ATLAS_ENTRY_SIZE + dataLen;
  const total = ATLAS_HEADER_SIZE + bodyLen;
  if (total > ATLAS_BUDGET_BYTES) {
    throw new Error(`Atlas ${total}B vượt ngân sách ${ATLAS_BUDGET_BYTES}B`);
  }

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let dataOffset = 0;
  const entryBase = ATLAS_HEADER_SIZE;
  const dataBase = entryBase + entries.length * ATLAS_ENTRY_SIZE;
  entries.forEach(([codepoint, g], i) => {
    const entryOff = entryBase + i * ATLAS_ENTRY_SIZE;
    view.setUint16(entryOff, codepoint, true);
    bytes[entryOff + 2] = g.width;
    bytes[entryOff + 3] = g.advance;
    view.setUint16(entryOff + 4, dataOffset, true);
    bytes.set(g.bitmap, dataBase + dataOffset);
    dataOffset += g.bitmap.length;
  });

  /* Header written last in this in-memory buffer too, for symmetry with
   * the firmware's own header-last flash write -- doesn't matter here
   * (it's all one atomic array) but keeps the two sides' logic mirrored. */
  bytes.set(new TextEncoder().encode(ATLAS_MAGIC), 0);
  bytes[4] = ATLAS_VERSION;
  bytes[5] = entries.length;
  bytes[6] = cellPx;
  bytes[7] = 0; /* baseline: reserved, v1 draws top-aligned */
  const bodyCrc = crc32(bytes.slice(ATLAS_HEADER_SIZE));
  view.setUint32(8, bodyCrc, true);
  view.setUint16(12, bodyLen, true);
  view.setUint16(14, 0, true); /* reserved */
  return bytes;
}

/* ===================================================================== *
 * Shared decoder / blit -- BƯỚC 4: preview must draw from the SAME bytes *
 * that get uploaded, not a separate fillText() approximation.           *
 * ===================================================================== */

/* Mirrors tnva_font_atlas.c's atlas_open() header validation + the
 * entry/data-base arithmetic exactly (magic/version/glyphCount/cellH,
 * entryBase = HEADER_SIZE, dataBase = entryBase + glyphCount*ENTRY_SIZE).
 * Does NOT verify the body CRC (that already happened once, at packAtlas()
 * time, and again on-device at upload-finish) -- this is a hot per-draw
 * path, not an integrity check. */
function readAtlasHeader(bytes) {
  if (!bytes || bytes.length < ATLAS_HEADER_SIZE) return null;
  if (bytes[0] !== 0x54 || bytes[1] !== 0x4e || bytes[2] !== 0x56 || bytes[3] !== 0x41) return null; /* 'TNVA' */
  if (bytes[4] !== ATLAS_VERSION) return null;
  const glyphCount = bytes[5], cellH = bytes[6];
  if (!glyphCount || !cellH) return null;
  const entryBase = ATLAS_HEADER_SIZE;
  return { glyphCount, cellH, entryBase, dataBase: entryBase + glyphCount * ATLAS_ENTRY_SIZE, bytesPerCol: Math.ceil(cellH / 8) };
}

/* Linear scan, same as firmware's atlas_find_glyph() (small glyph counts --
 * ATLAS_MAX_GLYPHS=64 -- a linear scan is what the chip does too, so this
 * intentionally does not "optimize" to a Map and diverge in Big-O terms
 * from what's being mirrored). */
function findAtlasGlyph(bytes, hdr, codepoint) {
  for (let i = 0; i < hdr.glyphCount; i++) {
    const off = hdr.entryBase + i * ATLAS_ENTRY_SIZE;
    if ((bytes[off] | (bytes[off + 1] << 8)) === codepoint) {
      return { width: bytes[off + 2], advance: bytes[off + 3], dataOffset: bytes[off + 4] | (bytes[off + 5] << 8) };
    }
  }
  return null;
}

/* Mirrors tnva_atlas_text_width() -- missing glyphs contribute 0 advance
 * (same as firmware: `adv` stays 0 when atlas_find_glyph() fails). */
export function atlasTextWidth(atlasBytes, text) {
  const hdr = readAtlasHeader(atlasBytes);
  if (!hdr) return 0;
  let total = 0;
  for (const ch of String(text)) total += findAtlasGlyph(atlasBytes, hdr, ch.codePointAt(0))?.advance || 0;
  return total;
}

/* Decodes and blits ALREADY-PACKED atlas bytes (exact output of
 * packAtlas()) onto a 2D canvas context -- mirrors tnva_font_atlas.c's
 * atlas_find_glyph() + atlas_draw_glyph() read path exactly (column-major
 * bitmap, MSB-first, same header/entry layout), so a preview built from
 * this function is bit-for-bit what the real device draws once the atlas
 * is uploaded -- not a fillText() approximation that merely resembles it.
 * `y` is the TOP of the cell (v1 atlases are top-aligned, see packAtlas()'s
 * header byte 7), same as atlas_draw_glyph()'s `y` parameter. Returns the
 * total advance, like drawBitmapText()/drawScaledBitmapText(). */
export function blitAtlasBytes(ctx, atlasBytes, text, x, y, color = '#000') {
  const hdr = readAtlasHeader(atlasBytes);
  if (!hdr) return 0;
  ctx.save();
  ctx.fillStyle = color;
  const top = Math.round(y);
  let cursor = Math.round(x);
  for (const ch of String(text)) {
    const g = findAtlasGlyph(atlasBytes, hdr, ch.codePointAt(0));
    if (!g) continue; /* matches firmware: unknown glyph draws nothing, advances 0 */
    const base = hdr.dataBase + g.dataOffset;
    for (let col = 0; col < g.width; col++) {
      const colBase = base + col * hdr.bytesPerCol;
      for (let row = 0; row < hdr.cellH; row++) {
        if (atlasBytes[colBase + (row >> 3)] & (0x80 >> (row & 7))) ctx.fillRect(cursor + col, top + row, 1, 1);
      }
    }
    cursor += g.advance;
  }
  ctx.restore();
  return cursor - Math.round(x);
}

/* Rasterizes + packs in one step. `codepoints` is any iterable of single
 * characters (not codepoint numbers) -- duplicates collapse naturally
 * since they're keyed by codePointAt(0). */
export async function buildAtlas(fontKey, cellPx, chars, effect) {
  const glyphs = new Map();
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (glyphs.has(cp)) continue;
    const g = await rasterizeGlyph(fontKey, ch, cellPx, effect);
    if (g) glyphs.set(cp, g);
  }
  return { bytes: packAtlas(cellPx, glyphs), glyphCount: glyphs.size };
}

/* ===================================================================== *
 * Face glyph collection -- decides WHAT a face needs an atlas for        *
 * ===================================================================== */

const ELEMENT_GLYPHS = {
  time: () => TIME_GLYPHS,
  temperature: () => TEMP_BATTERY_GLYPHS,
  voltage: () => TEMP_BATTERY_GLYPHS,
  batteryPercent: () => TEMP_BATTERY_GLYPHS,
  date: () => '0123456789/',
  /* Whether a given face shows the short ("T2") or long ("Thứ hai") form
   * depends on item.format's length at compile time (see editor.js's
   * FLAG_WEEKDAY_LONG handling) -- include both rather than parse that
   * convention a second time here; the extra glyphs cost is negligible. */
  weekday: () => WEEKDAY_LONG_VN.join('') + WEEKDAY_SHORT_VN.join(''),
  holiday: () => HOLIDAY_NAMES_VN.join(''),
  canchi: () => CAN_VN.join('') + CHI_VN.join('') + ' ',
  lunar: () => '0123456789/ÂLâlN.',
  text: element => element.text || '',
  /* R25.12 (mục 4): 3 widget mới -- mỗi cái chỉ cần glyph SỐ (0-9), không
   * ký tự nào khác (@d/@M/@y chỉ render số, xem render_template() trong
   * face_custom.c), nên đóng góp vào ngân sách atlas y hệt 'time'/
   * TIME_GLYPHS trừ dấu ':' (không bao giờ xuất hiện). Phải khai báo ở đây
   * để thanh ngân sách x/8KB tính đúng khi người dùng chọn font script cho
   * 1 trong 3 widget này -- thiếu dòng này sẽ ÂM THẦM báo ngân sách thấp
   * hơn thực tế (đúng lớp lỗi atlas đã sửa cho Montez/Yellowtail trước
   * đây, không lặp lại kiểu lỗi đó). */
  dayOnly: () => '0123456789',
  monthOnly: () => '0123456789',
  yearOnly: () => '0123456789'
};

/* Scans one project's elements for anything using an atlas-backed font and
 * returns what a single combined atlas for this face would need: which
 * font, what pixel size (the largest requested size wins -- v1 doesn't
 * support multiple atlas font sizes on one face, see
 * docs/FONT_ATLAS_TNVA.md), the exact glyph set, and a per-element size
 * breakdown for the budget bar. Returns null if the face uses no
 * atlas-backed font at all (nothing to upload). */
export function collectFaceAtlasNeed(project) {
  /* A sub-14px 2.13" dynamic field is deliberately routed to one of the
   * two resident native rasters by crisp213TextPlan().  Do not build/upload
   * an atlas that its final TNF1 descriptor will not reference. */
  const elements = (project?.elements || []).filter(el =>
    ATLAS_FONTS.has(el.font) && !crisp213TextPlan(project, el, el.text || ''));
  if (elements.length === 0) return null;

  let fontKey = elements[0].font;
  let cellPx = 0;
  for (const el of elements) {
    const minimum = atlasFontMinPx(el.font);
    const size = Math.max(minimum, Math.round(el.fontSize || minimum));
    if (size > cellPx) { cellPx = size; fontKey = el.font; }
  }

  /* R25.12 (Phần B mục 13): mỗi glyph biết thuộc mặt phẳng màu nào (đen/đỏ)
   * qua chính ĐỐI TƯỢNG dùng nó -- bản thân bitmap glyph không đổi theo
   * màu (không cần nướng 2 bản), chỉ cần biết widget nào cần nó thuộc mặt
   * phẳng nào để một firmware 4.2" trong tương lai biết vẽ ink đó vào
   * buffer đen hay đỏ. Bản sao 1-dòng của editor.js's elementPlane() --
   * KHÔNG import trực tiếp để tránh vòng lặp phụ thuộc (editor.js đã
   * import atlas-generator.js, chiều ngược lại sẽ tạo vòng). */
  const perElement = elements.map(el => ({
    id: el.id, label: el.name || TYPE_LABEL_VN[el.type] || el.type,
    chars: uniqueChars((ELEMENT_GLYPHS[el.type] || (() => ''))(el)),
    plane: el.color === 'red' ? 'red' : 'black',
  }));

  const combined = new Set();
  for (const item of perElement) for (const ch of item.chars) combined.add(ch);

  return { fontKey, cellPx, chars: combined, perElement };
}

const TYPE_LABEL_VN = {
  time: 'Giờ', temperature: 'Nhiệt độ', voltage: 'Điện áp', batteryPercent: 'Phần trăm pin',
  date: 'Ngày', weekday: 'Thứ', holiday: 'Ngày lễ', canchi: 'Can Chi', lunar: 'Âm lịch', text: 'Chữ',
  dayOnly: 'Ngày (riêng)', monthOnly: 'Tháng (riêng)', yearOnly: 'Năm (riêng)'
};

/* Rasterizes everything collectFaceAtlasNeed() found and reports exact
 * byte sizes per source element (for the "field nào ăn nhiều nhất" budget
 * message) without needing a second full rasterization pass later --
 * callers can reuse .atlasBytes directly for upload.
 *
 * R25.6 (Phase D): `budgetBytes` defaults to the hardcoded ATLAS_BUDGET_BYTES
 * (used when no device is connected yet) but callers should pass the real
 * device-reported capacity (ble.js readStatus()'s time.atlasCapacityBytes)
 * once connected -- that number is exactly what tnva_font_atlas.c enforces
 * and was found to differ from ATLAS_BUDGET_BYTES by 16 bytes (header size),
 * a real drift this closes rather than papers over. */
export async function estimateFaceAtlas(project, effect, budgetBytes = ATLAS_BUDGET_BYTES) {
  const need = collectFaceAtlasNeed(project);
  if (!need) return null;

  const glyphs = new Map();
  const perGlyphBytes = new Map(); /* codepoint -> byte size, for breakdown */
  for (const ch of need.chars) {
    const cp = ch.codePointAt(0);
    if (glyphs.has(cp)) continue;
    const g = await rasterizeGlyph(need.fontKey, ch, need.cellPx, effect);
    if (g) { glyphs.set(cp, g); perGlyphBytes.set(cp, g.bitmap.length + ATLAS_ENTRY_SIZE); }
  }

  let bytes = null;
  let error = null;
  try {
    bytes = packAtlas(need.cellPx, glyphs);
  } catch (e) {
    error = e.message;
  }
  const totalBytes = bytes ? bytes.length : (ATLAS_HEADER_SIZE +
    [...perGlyphBytes.values()].reduce((a, b) => a + b, 0));

  const breakdown = need.perElement.map(item => {
    let elementBytes = 0;
    for (const ch of item.chars) elementBytes += perGlyphBytes.get(ch.codePointAt(0)) || 0;
    return { id: item.id, label: item.label, bytes: elementBytes };
  }).sort((a, b) => b.bytes - a.bytes);

  return {
    fontKey: need.fontKey, cellPx: need.cellPx, glyphCount: glyphs.size,
    totalBytes, bytes, error, breakdown, budgetBytes, overBudget: totalBytes > budgetBytes
  };
}
