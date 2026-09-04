/*
 * Kho giao diện cộng đồng (2026-09) -- lớp mỏng gọi Supabase.
 *
 * QUAN TRỌNG (Phần 5 lệnh gốc): "Kho lỗi tuyệt đối không được làm hỏng
 * luồng thiết kế/gửi BLE". supabase-js nạp bằng import() ĐỘNG (không phải
 * `import ... from` tĩnh ở đầu file) -- nếu nạp tĩnh và người dùng đang
 * offline, cả module graph của app.js sẽ fail load (trình duyệt coi lỗi
 * nạp 1 static import là lỗi nạp toàn bộ đồ thị module), kéo sập luôn tab
 * Thiết kế/BLE dù họ không hề đụng tới tab Cộng đồng. import() động chỉ
 * chạy khi có người thật sự mở tab Cộng đồng/bấm nút liên quan, và mọi lỗi
 * (mất mạng, CDN down, chưa điền KHO_URL/KHO_KEY) được bắt gọn ở đây, không
 * lan ra ngoài.
 */
import { KHO_URL, KHO_KEY, isKhoConfigured } from './kho-config.js';

const SUPABASE_CDN_URL = 'https://esm.sh/@supabase/supabase-js@2';

let clientPromise = null;
function getClient() {
  if (!isKhoConfigured()) return Promise.reject(new Error('Kho chưa được cấu hình.'));
  if (!clientPromise) {
    clientPromise = import(/* webpackIgnore: true */ SUPABASE_CDN_URL)
      .then(({ createClient }) => createClient(KHO_URL, KHO_KEY))
      .catch(error => { clientPromise = null; throw error; }); // cho phép thử lại nếu mạng chập chờn
  }
  return clientPromise;
}

/* Câu thông báo dùng chung cho mọi lỗi mạng/Supabase -- đúng Phần 5. */
export const KHO_OFFLINE_MESSAGE = 'Không kết nối được kho. Kiểm tra mạng rồi thử lại.';

function wrapOffline(error) {
  console.error('[Kho]', error);
  const wrapped = new Error(KHO_OFFLINE_MESSAGE);
  wrapped.cause = error;
  return wrapped;
}

/**
 * @param {{sort:'luot_tai'|'moi_nhat', from:number, to:number}} options
 * @returns {Promise<Array>}
 */
export async function khoList({ sort = 'luot_tai', from = 0, to = 23 } = {}) {
  try {
    const supabase = await getClient();
    let query = supabase
      .from('kho_giao_dien')
      .select('id,ten,tac_gia,mo_ta,thumb_url,luot_tai,ngay_tao,thiet_ke,kich_thuoc_nen');
    query = sort === 'moi_nhat'
      ? query.order('ngay_tao', { ascending: false })
      : query.order('luot_tai', { ascending: false }).order('ngay_tao', { ascending: false });
    const { data, error } = await query.range(from, to);
    if (error) throw error;
    return data || [];
  } catch (error) { throw wrapOffline(error); }
}

/* Cố tình KHÔNG await ở phía gọi (app.js) -- "không chờ kết quả, không
 * chặn UI" (Phần 3.2 mục 1). Lỗi bị nuốt im lặng đúng quy ước Phần 5 (log
 * lỗi ra console, không phiền người dùng vì một lượt +1 không tăng được). */
export async function khoIncrementDownload(id) {
  try {
    const supabase = await getClient();
    await supabase.rpc('tang_luot_tai', { p_id: id });
  } catch (error) { console.error('[Kho] tang_luot_tai thất bại (bỏ qua, không chặn UI):', error); }
}

export async function khoReport(id) {
  try {
    const supabase = await getClient();
    const { error } = await supabase.rpc('bao_cao_giao_dien', { p_id: id });
    if (error) throw error;
  } catch (error) { throw wrapOffline(error); }
}

/* token = "<id>::<ma_xoa>" -- xem editor.js/kho-upload.js's storeDeleteCode()
 * và ghi chú trong schema.sql's xoa_giao_dien(). Trả về true/false, không
 * throw khi mã sai (đúng UX "Mã không đúng." yêu cầu Phần 3.4) -- chỉ throw
 * khi thật sự mất kết nối/token sai định dạng. */
export async function khoDeleteByToken(token) {
  const parts = String(token || '').split('::');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Mã không đúng định dạng.');
  const [id, ma] = parts;
  try {
    const supabase = await getClient();
    const { data, error } = await supabase.rpc('xoa_giao_dien', { p_id: id, p_ma: ma });
    if (error) throw error;
    return Boolean(data);
  } catch (error) {
    if (error?.message === KHO_OFFLINE_MESSAGE) throw error;
    throw wrapOffline(error);
  }
}

/**
 * @param {{ten:string, tac_gia:string, mo_ta:string, thiet_ke:object, thumb_url:string, kich_thuoc_nen:number, ma_xoa:string}} row
 */
export async function khoUpload(row) {
  try {
    const supabase = await getClient();
    const { data, error } = await supabase.from('kho_giao_dien').insert(row)
      .select('id,ten,tac_gia,mo_ta,thumb_url,luot_tai,ngay_tao,thiet_ke,kich_thuoc_nen').single();
    if (error) throw error;
    return data;
  } catch (error) { throw wrapOffline(error); }
}

/** Upload blob PNG thumbnail, trả về URL công khai. */
export async function khoUploadThumb(blob, filename) {
  try {
    const supabase = await getClient();
    const path = `${Date.now()}-${filename}`;
    const { error } = await supabase.storage.from('thumbs').upload(path, blob, { contentType: 'image/png' });
    if (error) throw error;
    const { data } = supabase.storage.from('thumbs').getPublicUrl(path);
    return data.publicUrl;
  } catch (error) { throw wrapOffline(error); }
}
