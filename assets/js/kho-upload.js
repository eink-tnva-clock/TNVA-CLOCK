/*
 * Kho giao diện cộng đồng (2026-09) -- validation trước khi upload (Phần 2
 * lệnh gốc). Đây là chốt chặn giữ Kho luôn tương thích firmware: mọi bước
 * dưới đây chạy TRƯỚC khi gọi Supabase, dùng lại đúng các hàm compile/export
 * hiện có của Studio (không viết lại logic mã hoá TNF1 lần thứ hai).
 */
import { VALID_ELEMENT_TYPES } from './editor.js';
import { KHO_MAX_PACKAGE_BYTES, KHO_MAX_THUMB_BYTES, KHO_RATE_LIMIT_PER_DAY } from './kho-config.js';
import { khoUpload, khoUploadThumb } from './kho-client.js';

const RATE_KEY = 'kho_upload_log';
const MA_XOA_KEY = 'kho_ma_xoa'; // map id -> token hiển thị "<id>::<ma_xoa>"

function readRateLog() {
  try {
    const arr = JSON.parse(localStorage.getItem(RATE_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/* Rate limit mềm (Phần 2 mục 5): chỉ chống spam vô ý bằng localStorage, KHÔNG
 * phải cơ chế bảo mật -- xoá localStorage hoặc dùng trình duyệt khác là lách
 * được, đúng như lệnh gốc đã lường trước. */
export function checkUploadRateLimit() {
  const now = Date.now();
  const windowMs = 24 * 3600 * 1000;
  const recent = readRateLog().filter(timestamp => now - timestamp < windowMs);
  if (recent.length >= KHO_RATE_LIMIT_PER_DAY) {
    throw new Error(`Bạn đã đăng ${KHO_RATE_LIMIT_PER_DAY} lần trong 24 giờ qua -- thử lại sau.`);
  }
  return recent;
}
function recordUpload(recent) {
  recent.push(Date.now());
  localStorage.setItem(RATE_KEY, JSON.stringify(recent));
}

function readTokenMap() {
  try {
    const map = JSON.parse(localStorage.getItem(MA_XOA_KEY) || '{}');
    return map && typeof map === 'object' ? map : {};
  } catch { return {}; }
}
function storeDeleteToken(id, token, title) {
  const map = readTokenMap();
  map[id] = { token, title: title || '' };
  localStorage.setItem(MA_XOA_KEY, JSON.stringify(map));
}
/** { [id]: { token, title } } -- dùng để hiện danh sách "giao diện tôi đã đăng" tiện xoá. */
export function listMyUploadTokens() {
  return readTokenMap();
}
export function forgetMyUploadToken(id) {
  const map = readTokenMap();
  delete map[id];
  localStorage.setItem(MA_XOA_KEY, JSON.stringify(map));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không đọc được ảnh xem trước'));
    img.src = src;
  });
}
async function dataUrlToPngBlob(dataUrl, scale) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
/* Hạ scale dần tới khi PNG < maxBytes (Phần 2 mục 4) -- dùng ĐÚNG ảnh
 * compile() đã render (1-bit, đúng renderer preview face), không vẽ lại
 * bằng đường khác. */
async function shrinkPngUnder(dataUrl, maxBytes) {
  let scale = 1;
  let blob = await dataUrlToPngBlob(dataUrl, scale);
  while (blob.size > maxBytes && scale > 0.2) {
    scale *= 0.75;
    blob = await dataUrlToPngBlob(dataUrl, scale);
  }
  return blob;
}

/**
 * Toàn bộ kiểm tra trước upload (Phần 2 mục 1-4) -- KHÔNG gọi mạng, chạy
 * xong là biết ngay có đăng được không, dùng để hiện lỗi lên form trước khi
 * người dùng bấm nút "Đăng" thật.
 * @param {import('./editor.js').FaceEditor} editor
 */
export async function validateForKho(editor) {
  if (editor.project.planes === 2) {
    throw new Error('Kho giao diện chỉ nhận thiết kế cho máy 2.13" (SSD1680) -- thiết kế 4.2" 3 màu chưa hỗ trợ.');
  }
  const invalid = editor.project.elements.find(item => !VALID_ELEMENT_TYPES.has(item.type));
  if (invalid) {
    throw new Error(`Đối tượng loại "${invalid.type}" không nằm trong danh sách ID hợp lệ hiện tại -- không thể đăng lên Kho.`);
  }
  const compiled = await editor.compile(); // tự ném lỗi nếu sai kích thước màn/atlas
  const kichThuocNen = compiled.packageBytes.length;
  if (kichThuocNen > KHO_MAX_PACKAGE_BYTES) {
    throw new Error(`Giao diện nặng ${kichThuocNen} byte, vượt giới hạn ${KHO_MAX_PACKAGE_BYTES} byte của đồng hồ. Hãy bớt widget hoặc ảnh.`);
  }
  const thumbBlob = await shrinkPngUnder(compiled.preview, KHO_MAX_THUMB_BYTES);
  return { compiled, kichThuocNen, thumbBlob };
}

const COMBINING_DIACRITICS_RE = new RegExp('[̀-ͯ]', 'g'); // xem editor.js's slugify() -- cùng logic
function slugifyAscii(text) {
  return (text || 'giao-dien').normalize('NFD').replace(COMBINING_DIACRITICS_RE, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'giao-dien';
}

/**
 * Đăng thật lên Supabase (Phần 2 mục 6 + Phần 3.1). Gọi sau khi
 * validateForKho() đã pass và người dùng đã điền tên/tác giả/mô tả.
 * @returns {Promise<{row:object, deleteToken:string}>}
 */
export async function submitKhoUpload(editor, { ten, tacGia, moTa }) {
  const rateLog = checkUploadRateLimit();
  const { kichThuocNen, thumbBlob } = await validateForKho(editor);

  const thumbUrl = await khoUploadThumb(thumbBlob, `${slugifyAscii(ten)}.png`);
  const maXoa = crypto.randomUUID();
  const row = await khoUpload({
    ten: String(ten).slice(0, 40),
    tac_gia: String(tacGia).slice(0, 24),
    mo_ta: moTa ? String(moTa).slice(0, 200) : null,
    thiet_ke: editor.exportProject(),
    thumb_url: thumbUrl,
    kich_thuoc_nen: kichThuocNen,
    ma_xoa: maXoa,
  });

  recordUpload(rateLog);
  const deleteToken = `${row.id}::${maXoa}`;
  storeDeleteToken(row.id, deleteToken, row.ten);
  return { row, deleteToken };
}
