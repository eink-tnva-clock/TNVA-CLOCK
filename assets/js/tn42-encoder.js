/*
 * R25.13 Bước 5 -- bộ đóng gói nhị phân định dạng "TN42", đúng byte-for-byte
 * với những gì FIRMWARE_DA14585_4.2_TN42/.../tnva42.c đã đọc (KHÔNG suy đoán
 * -- mọi offset/hằng số dưới đây chép trực tiếp từ tnva42.h/tnva42.c, xem
 * REPORTS/PANEL_AUDIT.md mục 3). Module này KHÔNG phụ thuộc DOM/editor --
 * FaceEditor.compileTn42() (editor.js) gọi vào đây với dữ liệu đã render
 * sẵn (2 plane bitmap vật lý 400×300 + mảng descriptor + bảng chuỗi).
 *
 * Cực quan trọng -- polarity: đã xác nhận trực tiếp từ tnva42.c's
 * load_static_page_open() (comment nguyên văn "TN42 wire: 1=ink. Panel RAM:
 * 0=ink."): 2 plane nền TĨNH truyền/lưu trên dây/flash dùng quy ước
 * BIT=1 nghĩa là CÓ mực (đen ở plane BW, đỏ ở plane RED) -- ĐÚNG NGAY quy
 * ước packBitplaneRowMajor() (atlas-generator.js) đã dùng cho 2.13" (bit=1
 * khi pixel tối hơn threshold) nên compileTn42() tái dùng thẳng, không đảo
 * bit. Firmware tự đảo (~byte) khi nạp trang tĩnh vào RAM cuối cùng.
 */

/* ---- Hằng số khớp tnva42.h ---- */
export const TN42_MAGIC = 0x32344e54; // 'T','N','4','2' little-endian
export const TN42_HEADER_BYTES = 64;
export const TN42_PAGE_HEIGHT = 32;
export const TN42_PAGE_COUNT = 10;
export const TN42_PAGE_ENTRY_BYTES = 8;
export const TN42_DESCRIPTOR_BYTES = 24;
export const TN42_MAX_DESCRIPTORS = 24;
export const TN42_ROW_BYTES = 50; // ceil(400/8) -- LUÔN 400 vật lý, kể cả project dọc 300×400
export const TN42_PHYSICAL_WIDTH = 400;
export const TN42_PHYSICAL_HEIGHT = 300;
export const TN42_CODEC_RAW = 0;
export const TN42_CODEC_PACKBITS = 1;
/* Khớp TNVA42_MAX_PACKAGE_BYTES trong tnva42.h -- 6 sector flash sau product
 * header, KHÔNG PHẢI 32768 như bản đoán cũ trong config.js trước R25.13
 * (xem REPORTS/PANEL_AUDIT.md mục "Cái thật sự còn thiếu"). */
export const TN42_MAX_PACKAGE_BYTES = 24576;

export const TN42_FLAG_INVERSE = 0x01;
export const TN42_FLAG_LONG = 0x02;
export const TN42_FLAG_SECONDS = 0x04;
export const TN42_FLAG_RED = 0x20;

/* type(1) descriptor -- khớp render_descriptor_open() switch trong tnva42.c.
 * 10 (đếm ngược) chừa sẵn cho tương lai -- editor hiện chưa có phần tử
 * 'countdown' làm nguồn nên compileTn42() không bao giờ phát ra type này. */
export const TN42_TYPE = {
  time: 1, date: 2, weekday: 3, lunar: 4, voltage: 5, battery: 6,
  analog: 7, template: 8, calendar: 9, countdown: 10, week: 11,
};

/* ===================================================================== *
 * CRC32 (poly 0xEDB88320) -- tự chứa, khớp crc32.c/crc32.js/ble.js/
 * atlas-generator.js, không phụ thuộc thứ tự import module nào khác.
 * ===================================================================== */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ===================================================================== *
 * PackBits (TIFF-style) -- ĐÚNG thuật toán giải nén trong tnva42.c's
 * load_static_page_open(): control 0..127 -> (n+1) byte literal theo sau;
 * control 129..255 -> lặp 1 byte kế tiếp (257-control) lần; 128 không dùng.
 * Bộ nén dưới đây không tối ưu nhất có thể nhưng ĐÚNG 100% với decode --
 * self-test unpackBits(packBits(x))===x chạy ngay trong buildTn42Package()
 * trước khi trả về, không tin suông.
 * ===================================================================== */
export function packBits(bytes) {
  const out = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    let runLen = 1;
    while (runLen < 128 && i + runLen < n && bytes[i + runLen] === bytes[i]) runLen++;
    if (runLen >= 2) {
      out.push((257 - runLen) & 0xff, bytes[i]);
      i += runLen;
      continue;
    }
    let litLen = 1;
    while (litLen < 128 && i + litLen < n) {
      if (i + litLen + 1 < n && bytes[i + litLen] === bytes[i + litLen + 1]) break;
      litLen++;
    }
    out.push(litLen - 1, ...bytes.subarray(i, i + litLen));
    i += litLen;
  }
  return Uint8Array.from(out);
}

export function unpackBits(bytes, rawLength) {
  const out = new Uint8Array(rawLength);
  let i = 0, o = 0;
  while (o < rawLength) {
    if (i >= bytes.length) throw new Error('PackBits: hết dữ liệu nén trước khi đủ rawLength');
    const control = bytes[i++];
    if (control <= 127) {
      const count = control + 1;
      for (let k = 0; k < count; k++) out[o++] = bytes[i++];
    } else if (control >= 129) {
      const count = 257 - control;
      const value = bytes[i++];
      for (let k = 0; k < count; k++) out[o++] = value;
    }
    // control === 128: không hợp lệ/không dùng, bỏ qua giống firmware (không tiêu byte nào thêm).
  }
  return out;
}

function u16(view, offset, value) { view.setUint16(offset, value, true); }
function u32(view, offset, value) { view.setUint32(offset, value, true); }

/*
 * Nén MỘT plane (Uint8Array rowBytes*300, bit=1=có mực) thành 10 trang theo
 * đúng TN42_PAGE_HEIGHT. Trả về { pageBytes: Uint8Array (nối các trang đã
 * nén), entries: [{offset,size,rawSize,codec}, ...] } -- offset TƯƠNG ĐỐI
 * trong pageBytes, cộng thêm base lúc lắp ráp gói cuối cùng.
 */
function compressPlanePages(planeBytes) {
  const chunks = [];
  const entries = [];
  let cursor = 0;
  for (let page = 0; page < TN42_PAGE_COUNT; page++) {
    const rowStart = page * TN42_PAGE_HEIGHT;
    const rows = Math.min(TN42_PAGE_HEIGHT, TN42_PHYSICAL_HEIGHT - rowStart);
    const rawSize = TN42_ROW_BYTES * rows;
    const raw = planeBytes.subarray(rowStart * TN42_ROW_BYTES, rowStart * TN42_ROW_BYTES + rawSize);
    const packed = packBits(raw);
    /* Tự kiểm ngay -- không tin suông thuật toán nén của chính mình. */
    const roundTrip = unpackBits(packed, rawSize);
    let matches = roundTrip.length === raw.length;
    if (matches) for (let k = 0; k < raw.length; k++) if (roundTrip[k] !== raw[k]) { matches = false; break; }
    const useCodec = matches && packed.length < rawSize ? TN42_CODEC_PACKBITS : TN42_CODEC_RAW;
    const body = useCodec === TN42_CODEC_PACKBITS ? packed : raw;
    entries.push({ offset: cursor, size: body.length, rawSize, codec: useCodec });
    chunks.push(body);
    cursor += body.length;
  }
  const pageBytes = new Uint8Array(cursor);
  let at = 0;
  for (const chunk of chunks) { pageBytes.set(chunk, at); at += chunk.length; }
  return { pageBytes, entries };
}

/**
 * Lắp một gói TN42 hoàn chỉnh.
 * @param {object} spec
 * @param {boolean} spec.portrait -- header byte 5 (0=ngang 400×300, 1=dọc 300×400)
 * @param {number} spec.logicalWidth
 * @param {number} spec.logicalHeight
 * @param {number} spec.packageId -- u32, khác 0
 * @param {Uint8Array} spec.bwPlane -- rowBytes(50)*300 byte, bit=1=có mực đen, ĐÃ ở layout VẬT LÝ 400×300 (đã xoay nếu dọc)
 * @param {Uint8Array} spec.redPlane -- như trên, cho mực đỏ
 * @param {Array} spec.descriptors -- mỗi phần tử là Uint8Array(24) đã điền sẵn
 * @param {Uint8Array} spec.strings -- bảng chuỗi nối liền (template text)
 * @returns {{bytes:Uint8Array, packageId:number, payloadCrc:number, transportCrc:number, bwPlaneCrc:number, redPlaneCrc:number, sizeBreakdown:object}}
 */
export function buildTn42Package(spec) {
  const { portrait, logicalWidth, logicalHeight, packageId, bwPlane, redPlane, descriptors, strings } = spec;
  if (bwPlane.length !== TN42_ROW_BYTES * TN42_PHYSICAL_HEIGHT) throw new Error('bwPlane sai kích thước');
  if (redPlane.length !== TN42_ROW_BYTES * TN42_PHYSICAL_HEIGHT) throw new Error('redPlane sai kích thước');
  if (descriptors.length > TN42_MAX_DESCRIPTORS) throw new Error('Vượt quá 24 phần tử động');
  if (!packageId) throw new Error('packageId không được bằng 0');

  const bw = compressPlanePages(bwPlane);
  const red = compressPlanePages(redPlane);

  /* Bố cục sau header (offset tương đối, cộng TN42_HEADER_BYTES khi ghi vào header):
   *   [bảng trang BW: 10*8][bảng trang RED: 10*8][dữ liệu trang BW][dữ liệu trang RED][descriptor*N][strings] */
  const bwTableRel = 0;
  const redTableRel = bwTableRel + TN42_PAGE_COUNT * TN42_PAGE_ENTRY_BYTES;
  const bwDataRel = redTableRel + TN42_PAGE_COUNT * TN42_PAGE_ENTRY_BYTES;
  const redDataRel = bwDataRel + bw.pageBytes.length;
  const descriptorRel = redDataRel + red.pageBytes.length;
  const stringRel = descriptorRel + descriptors.length * TN42_DESCRIPTOR_BYTES;
  const payloadLength = stringRel + strings.length;
  const totalSize = TN42_HEADER_BYTES + payloadLength;

  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);

  // ---- Bảng trang (offset tuyệt đối = HEADER + rel) ----
  const writeTable = (entries, tableRel, dataRel) => {
    entries.forEach((entry, index) => {
      const at = TN42_HEADER_BYTES + tableRel + index * TN42_PAGE_ENTRY_BYTES;
      u16(view, at, dataRel + entry.offset);
      u16(view, at + 2, entry.size);
      u16(view, at + 4, entry.rawSize);
      bytes[at + 6] = entry.codec;
      bytes[at + 7] = 0;
    });
  };
  writeTable(bw.entries, bwTableRel, bwDataRel);
  writeTable(red.entries, redTableRel, redDataRel);

  bytes.set(bw.pageBytes, TN42_HEADER_BYTES + bwDataRel);
  bytes.set(red.pageBytes, TN42_HEADER_BYTES + redDataRel);
  descriptors.forEach((descriptor, index) => {
    bytes.set(descriptor, TN42_HEADER_BYTES + descriptorRel + index * TN42_DESCRIPTOR_BYTES);
  });
  bytes.set(strings, TN42_HEADER_BYTES + stringRel);

  // ---- Header (64 byte) ----
  u32(view, 0, TN42_MAGIC);
  bytes[4] = 1; // version
  bytes[5] = portrait ? 1 : 0;
  bytes[6] = 2; // plane_count
  bytes[7] = TN42_PAGE_HEIGHT;
  u16(view, 8, logicalWidth);
  u16(view, 10, logicalHeight);
  u16(view, 12, TN42_PHYSICAL_WIDTH);
  u16(view, 14, TN42_PHYSICAL_HEIGHT);
  u16(view, 16, TN42_ROW_BYTES);
  bytes[18] = TN42_PAGE_COUNT;
  bytes[19] = descriptors.length;
  bytes[20] = TN42_DESCRIPTOR_BYTES;
  bytes[21] = 0; // reserved
  u16(view, 22, totalSize);
  u32(view, 24, packageId >>> 0);
  const payloadCrc = crc32(bytes.subarray(TN42_HEADER_BYTES));
  u32(view, 28, payloadCrc);
  u16(view, 32, bwTableRel);
  u16(view, 34, redTableRel);
  u16(view, 36, descriptorRel);
  u16(view, 38, stringRel);
  u16(view, 40, strings.length);
  /* R25.13 Bước 5: MỞ RỘNG cộng thêm -- 2 CRC32 riêng từng plane, ghi vào
   * 8 byte vốn bỏ trống (42..49) của header 64-byte gốc. Không đổi offset
   * field nào validate_package_open() bản gốc đang kiểm -- xem
   * REPORTS/PANEL_AUDIT.md mục "Quyết định kỹ thuật". Firmware bản vá ở
   * Bước 5 xác minh thêm 2 field này; firmware CHƯA vá bỏ qua (offset nằm
   * ngoài mọi so khớp gốc), không phá khả năng tương thích ngược. */
  const bwPlaneCrc = crc32(bwPlane);
  const redPlaneCrc = crc32(redPlane);
  u32(view, 42, bwPlaneCrc);
  u32(view, 46, redPlaneCrc);
  // 50..63: dự phòng, để 0.

  const transportCrc = crc32(bytes); // CRC32 TOÀN gói (kể cả header) -- gửi trong lệnh 0x94, khớp flash_crc32(FLASH_BASE, upload_expected) firmware tính lại sau khi ghi flash xong.

  return {
    bytes, packageId: packageId >>> 0, payloadCrc, transportCrc, bwPlaneCrc, redPlaneCrc,
    sizeBreakdown: {
      headerBytes: TN42_HEADER_BYTES,
      pageTableBytes: 2 * TN42_PAGE_COUNT * TN42_PAGE_ENTRY_BYTES,
      bwPageBytes: bw.pageBytes.length, redPageBytes: red.pageBytes.length,
      descriptorBytes: descriptors.length * TN42_DESCRIPTOR_BYTES,
      stringBytes: strings.length,
      totalSize,
    },
  };
}

/*
 * Giải mã lại một gói TN42 -- dùng cho Bước 7 (tự kiểm + xuất PNG xem
 * trước), mirror ĐÚNG validate_package_open()/load_static_page_open() phía
 * firmware (bao gồm cả bước tự đảo bit "wire 1=ink -> RAM 0=ink"). KHÔNG
 * dùng trên đường gửi thật -- chỉ để kiểm chứng.
 */
export function decodeTn42Package(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (u32r(view, 0) !== TN42_MAGIC) throw new Error('Sai magic TN42');
  const version = bytes[4];
  const portrait = bytes[5] === 1;
  const planeCount = bytes[6];
  const pageHeight = bytes[7];
  const logicalWidth = view.getUint16(8, true);
  const logicalHeight = view.getUint16(10, true);
  const physicalWidth = view.getUint16(12, true);
  const physicalHeight = view.getUint16(14, true);
  const rowBytes = view.getUint16(16, true);
  const pageCount = bytes[18];
  const descriptorCount = bytes[19];
  const descriptorBytes = bytes[20];
  const totalSize = view.getUint16(22, true);
  const packageId = view.getUint32(24, true);
  const payloadCrc = view.getUint32(28, true);
  const bwTableRel = view.getUint16(32, true);
  const redTableRel = view.getUint16(34, true);
  const descriptorRel = view.getUint16(36, true);
  const stringRel = view.getUint16(38, true);
  const stringLength = view.getUint16(40, true);
  const bwPlaneCrc = view.getUint32(42, true);
  const redPlaneCrc = view.getUint32(46, true);

  if (planeCount !== 2 || pageHeight !== TN42_PAGE_HEIGHT || physicalWidth !== TN42_PHYSICAL_WIDTH ||
      physicalHeight !== TN42_PHYSICAL_HEIGHT || rowBytes !== TN42_ROW_BYTES || pageCount !== TN42_PAGE_COUNT ||
      descriptorBytes !== TN42_DESCRIPTOR_BYTES || totalSize !== bytes.length) {
    throw new Error('Header TN42 không khớp đặc tả firmware');
  }
  const actualPayloadCrc = crc32(bytes.subarray(TN42_HEADER_BYTES));
  if (actualPayloadCrc !== payloadCrc) throw new Error('payload CRC32 (offset 28) không khớp');

  const readPlane = tableRel => {
    const raw = new Uint8Array(TN42_ROW_BYTES * TN42_PHYSICAL_HEIGHT);
    for (let page = 0; page < pageCount; page++) {
      const at = TN42_HEADER_BYTES + tableRel + page * TN42_PAGE_ENTRY_BYTES;
      const dataOffset = view.getUint16(at, true);
      const size = view.getUint16(at + 2, true);
      const rawSize = view.getUint16(at + 4, true);
      const codec = bytes[at + 6];
      const body = bytes.subarray(TN42_HEADER_BYTES + dataOffset, TN42_HEADER_BYTES + dataOffset + size);
      const decoded = codec === TN42_CODEC_RAW ? body : unpackBits(body, rawSize);
      raw.set(decoded, page * TN42_PAGE_HEIGHT * TN42_ROW_BYTES);
    }
    return raw;
  };
  const bwPlane = readPlane(bwTableRel);
  const redPlane = readPlane(redTableRel);
  if (crc32(bwPlane) !== bwPlaneCrc) throw new Error('CRC32 plane BW (offset 42) không khớp');
  if (crc32(redPlane) !== redPlaneCrc) throw new Error('CRC32 plane RED (offset 46) không khớp');

  const descriptors = [];
  for (let i = 0; i < descriptorCount; i++) {
    descriptors.push(bytes.subarray(TN42_HEADER_BYTES + descriptorRel + i * TN42_DESCRIPTOR_BYTES,
      TN42_HEADER_BYTES + descriptorRel + (i + 1) * TN42_DESCRIPTOR_BYTES));
  }
  const strings = bytes.subarray(TN42_HEADER_BYTES + stringRel, TN42_HEADER_BYTES + stringRel + stringLength);

  return {
    version, portrait, logicalWidth, logicalHeight, physicalWidth, physicalHeight,
    packageId, payloadCrc, bwPlaneCrc, redPlaneCrc,
    bwPlane, redPlane, descriptors, strings, totalSize,
  };
}

function u32r(view, offset) { return view.getUint32(offset, true); }
