/*
 * Kho giao diện cộng đồng (2026-09) -- cấu hình Supabase.
 *
 * Studio host trên GitHub Pages là site TĨNH, không backend riêng. Kho dùng
 * Supabase (Postgres + RLS + Storage) làm dịch vụ ngoài, gọi thẳng từ trình
 * duyệt bằng anon key -- key này CÔNG KHAI theo thiết kế của Supabase, an
 * toàn vì mọi quyền đọc/ghi thật đều do Row Level Security + các hàm RPC
 * security-definer ở tools/../weble/supabase/schema.sql quyết định, không
 * phải do giấu key. Xem weble/supabase/README.md để tạo project + chạy
 * schema.sql + tạo bucket `thumbs`, rồi điền 2 hằng số URL/KEY bên dưới.
 *
 * Điền 2026-09-04: project Supabase do người dùng tự tạo + tự chạy
 * schema.sql + tự tạo bucket `thumbs` (xem weble/supabase/README.md). Key
 * dưới đây là "publishable key" (định dạng mới sb_publishable_..., thay thế
 * JWT anon key cũ) -- cùng vai trò: public-safe, bảo vệ bằng RLS.
 */
export const KHO_URL = 'https://bcduolehonuzjyfpipas.supabase.co';
export const KHO_KEY = 'sb_publishable_l-rLBN_Bf4q_07Jx_Vo6XQ_DOyiEXoV';

/* true khi cả URL lẫn anon key đã được điền giá trị thật (không phải chuỗi
 * rỗng và không còn placeholder ví dụ dạng "xxxxx.supabase.co"). */
export function isKhoConfigured() {
  return Boolean(KHO_URL) && Boolean(KHO_KEY) && !/xxxxx/.test(KHO_URL);
}

/* Ngân sách/luật chơi của Kho -- một nguồn duy nhất, khớp schema.sql's
 * CHECK constraint (kich_thuoc_nen <= 4096) và slot flash face 2.13" thật
 * (panel_profiles.js's PANEL_PROFILES['212x104'].maxPackageBytes). */
export const KHO_MAX_PACKAGE_BYTES = 4096;
export const KHO_MAX_THUMB_BYTES = 100 * 1024;
export const KHO_RATE_LIMIT_PER_DAY = 5;
export const KHO_REPORT_THRESHOLD = 5;
export const KHO_PAGE_SIZE = 24;

/* Cùng quy ước cảnh báo console với config.js's FW_MANIFEST_URL -- không
 * alert/chặn UI, chỉ log để người dò lỗi biết vì sao tab Cộng đồng trống. */
if (!isKhoConfigured()) {
  console.warn('[TNVA] kho-config.js chưa điền KHO_URL/KHO_KEY thật -- tab Cộng đồng sẽ hiện "Không kết nối được kho" cho tới khi điền (xem weble/supabase/README.md).');
}
