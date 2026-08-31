import { serviceApiBase } from './config.js';
import { saveCommunitySubmission, listCommunitySubmissions } from './storage.js';
import { cachedActivation } from './activation.js';
import { PANEL_PROFILES, DEFAULT_PROFILE_KEY } from './panel_profiles.js';

/* R25.13 Bước 2: kho cộng đồng hiện chỉ nhận gói TNF1 (2.13", xem
 * publishFace() bên dưới -- editor.compile() luôn xuất TNF1 bất kể
 * profile), nên fallback khi không lấy lại được kích thước từ máy chủ là
 * đúng profile mặc định, không phải số cứng riêng ở đây. */
const FALLBACK_SCREEN = PANEL_PROFILES[DEFAULT_PROFILE_KEY];

export function publicStoreConfigured() {
  try { return Boolean(serviceApiBase({ required:false })); } catch { return false; }
}

function dataUrlToBlob(dataUrl) {
  const [meta, encoded] = String(dataUrl || '').split(',');
  if (!encoded) return null;
  const type = /data:([^;]+)/.exec(meta)?.[1] || 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function listPublicFaces(search = '') {
  const base = serviceApiBase();
  const params = new URLSearchParams();
  if (search.trim()) params.set('q', search.trim());
  const response = await fetch(`${base}/api/v1/designs?${params}`, { cache:'no-store' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không tải được kho cộng đồng');
  return result.designs || [];
}

export async function publishFace({ title, author, width, height, preview, packageBytes }) {
  const base = serviceApiBase();
  const form = new FormData();
  form.set('title', title || 'Không tên');
  form.set('author', author || 'Ẩn danh');
  form.set('orientation', width < height ? 'portrait' : 'landscape');
  form.set('package', new File([packageBytes], `${Date.now()}.tnvafacebin`, { type:'application/octet-stream' }));
  const previewBlob = dataUrlToBlob(preview);
  if (previewBlob) form.set('preview', new File([previewBlob], `${Date.now()}.png`, { type:'image/png' }));
  /* R25.6 (Phase F): the only feature in this whole app gated on device
   * activation. Everything else community.js/ble.js does stays free. */
  const activation = cachedActivation();
  if (activation) {
    form.set('device_id', activation.deviceId);
    form.set('activation_code', activation.code);
  }
  const response = await fetch(`${base}/api/v1/designs/submit`, { method:'POST', body:form });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || 'Không gửi được giao diện');
  await saveCommunitySubmission({
    id:result.id, token:result.submit_token, title, author, status:result.status,
    packageBytes:new Uint8Array(packageBytes), preview
  });
  return result;
}

export async function listOwnSubmissions() {
  const base = serviceApiBase();
  const local = await listCommunitySubmissions();
  const all = [];
  for (const item of local) {
    try {
      const response = await fetch(`${base}/api/v1/designs/mine?token=${encodeURIComponent(item.token)}`, { cache:'no-store' });
      const result = await response.json();
      if (response.ok && result.ok) {
        all.push(...result.designs.map(row => ({
          ...row, mine:true,
          packageBytes:String(row.id) === String(item.id) ? item.packageBytes : undefined,
          localPreview:String(row.id) === String(item.id) ? item.preview : undefined
        })));
        continue;
      }
    } catch { /* Giữ bản cục bộ để chủ thiết kế vẫn có thể dùng. */ }
    all.push({ ...item, mine:true, screen_width:FALLBACK_SCREEN.width, screen_height:FALLBACK_SCREEN.height, preview_url:item.preview });
  }
  return all;
}

export async function fetchFacePackage(row) {
  if (row?.packageBytes) return new Uint8Array(row.packageBytes);
  if (!row?.download_url) throw new Error('Bản gửi chưa tải được từ dịch vụ');
  const response = await fetch(row.download_url, { cache:'no-store' });
  if (!response.ok) throw new Error('Không tải được gói giao diện');
  return new Uint8Array(await response.arrayBuffer());
}

export async function incrementDownload(_id) { /* Máy chủ tăng lượt tải khi gửi file. */ }
