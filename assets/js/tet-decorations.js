/* PHẦN 5 -- Trang trí Tết: catalog cho bộ chữ thư pháp Tết dựng sẵn dạng
 * bitmap 1-bit (KHÔNG phải font vector -- xem docs/FONT_ATLAS_TNVA.md và
 * tools/generate_tet_decorations.mjs cho lý do + cách dựng). File này CHỈ
 * chứa dữ liệu tĩnh (đường dẫn PNG + kích thước thật đã đo), không có logic
 * vẽ -- editor.js's `addDecoration()` đọc catalog này để chèn phần tử
 * `type:'image'` bình thường vào canvas.
 *
 * `width`/`height` là kích thước PIXEL THẬT của từng PNG (đo từ ảnh đã
 * dựng, không phải suy đoán) -- dùng làm `w`/`h` ban đầu của phần tử để
 * chèn đúng 1:1, không co giãn làm mờ nét. Cụm dài ("Chúc Mừng Năm Mới",
 * "Vạn Sự Như Ý", "An Khang Thịnh Vượng") chỉ có 2 cỡ -- cỡ thứ 3 sẽ vượt
 * quá 212px ngang màn hoặc cần làm đậm nét tới mức bết chữ, xem
 * generate_tet_decorations.mjs's CATALOG cho số liệu đã tinh chỉnh tay.
 */

export const TET_DECORATIONS = [
  {
    id: 'tai-loc', label: 'Tài Lộc', font: 'greatVibes',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/tai-loc-small.png', w: 94, h: 37 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/tai-loc-medium.png', w: 137, h: 53 },
      { key: 'large', label: 'Lớn', url: 'assets/decorations/tai-loc-large.png', w: 193, h: 73 },
    ],
  },
  {
    id: 'chuc-mung-nam-moi', label: 'Chúc Mừng Năm Mới', font: 'greatVibes',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/chuc-mung-nam-moi-small.png', w: 172, h: 28 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/chuc-mung-nam-moi-medium.png', w: 198, h: 32 },
    ],
  },
  {
    id: 'van-su-nhu-y', label: 'Vạn Sự Như Ý', font: 'dancingScript',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/van-su-nhu-y-small.png', w: 113, h: 27 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/van-su-nhu-y-medium.png', w: 129, h: 31 },
    ],
  },
  {
    id: 'an-khang-thinh-vuong', label: 'An Khang Thịnh Vượng', font: 'dancingScript',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/an-khang-thinh-vuong-small.png', w: 173, h: 26 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/an-khang-thinh-vuong-medium.png', w: 199, h: 29 },
    ],
  },
  {
    id: 'phuc', label: 'Phúc', font: 'playball',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/phuc-small.png', w: 54, h: 26 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/phuc-medium.png', w: 79, h: 37 },
      { key: 'large', label: 'Lớn', url: 'assets/decorations/phuc-large.png', w: 115, h: 52 },
    ],
  },
  {
    id: 'loc', label: 'Lộc', font: 'playball',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/loc-small.png', w: 45, h: 29 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/loc-medium.png', w: 65, h: 41 },
      { key: 'large', label: 'Lớn', url: 'assets/decorations/loc-large.png', w: 95, h: 59 },
    ],
  },
  {
    id: 'tho', label: 'Thọ', font: 'playball',
    sizes: [
      { key: 'small', label: 'Nhỏ', url: 'assets/decorations/tho-small.png', w: 42, h: 30 },
      { key: 'medium', label: 'Vừa', url: 'assets/decorations/tho-medium.png', w: 61, h: 43 },
      { key: 'large', label: 'Lớn', url: 'assets/decorations/tho-large.png', w: 88, h: 62 },
    ],
  },
];

export function tetDecorationById(id) {
  return TET_DECORATIONS.find(item => item.id === id) || null;
}
export function tetDecorationSize(id, sizeKey) {
  const item = tetDecorationById(id);
  return item ? (item.sizes.find(s => s.key === sizeKey) || null) : null;
}
