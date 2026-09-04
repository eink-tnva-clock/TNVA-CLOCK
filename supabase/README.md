# Kho giao diện cộng đồng — setup Supabase

Việc dưới đây cần project Supabase của bạn. Sau khi xong bước 1-4, web tĩnh
`weble/` dùng trực tiếp **Project URL + Publishable key**; tuyệt đối không đưa
DB password, `service_role`, secret key hay private signing key vào web.

> **Đã từng chạy schema R27 đầu tiên?** Bản R27.1 sửa một lỗi bảo mật quan
> trọng: `ma_xoa` trước đó có thể bị đọc trực tiếp qua REST nếu client cố ý
> query cột này. Với project đã tạo, chạy file
> `migrate_r27_1_token_hardening.sql` trong SQL Editor trước khi public Kho.
> Bản schema mới đã tích hợp sẵn hotfix này.

## 1. Tạo project

1. Vào https://supabase.com → đăng nhập → **New project**.
2. Chọn free tier, đặt tên project, tạo mật khẩu DB mạnh.
3. Đợi project khởi tạo xong.

## 2. Chạy schema

### Project mới

1. **SQL Editor** → **New query**.
2. Dán toàn bộ `schema.sql` → **Run**.
3. Kỳ vọng: tạo bảng `kho_giao_dien`, 3 RPC
   (`tang_luot_tai`, `bao_cao_giao_dien`, `xoa_giao_dien`), trigger hash mã
   xoá và bucket `thumbs` nếu project cho phép tạo Storage bằng SQL.

### Project đã chạy bản R27 cũ

Chỉ cần chạy toàn bộ `migrate_r27_1_token_hardening.sql`. Migration:

- hash các `ma_xoa` cũ đúng một lần;
- hash mọi token mới trước khi lưu;
- không cho `anon/authenticated` SELECT cột `ma_xoa`;
- thu hẹp quyền INSERT/SELECT đúng cột web cần;
- cố định `search_path` cho các RPC `security definer`.

Token xoá cũ mà tác giả đã lưu **vẫn dùng được**, vì DB hash giá trị cũ và
RPC hash token người dùng nhập trước khi so sánh.

## 3. Bucket Storage

Nếu `schema.sql` không tạo được bucket bằng SQL:

1. **Storage** → **New bucket** → tên `thumbs`.
2. Bật **Public bucket**.
3. Đặt file-size limit **100 KB** và MIME `image/png` nếu Dashboard cho chỉnh.
4. Policies cần có:
   - SELECT: `bucket_id = 'thumbs'`
   - INSERT: `bucket_id = 'thumbs'`

`schema.sql` cũng chứa hai policy này. Không mở UPDATE/DELETE công khai.

## 4. Lấy URL + publishable key

**Project Settings → API**. Copy:

- **Project URL** — dạng `https://xxxxx.supabase.co`
- **Publishable key** — thường bắt đầu `sb_publishable_...`

Project cũ có thể hiện `anon` public key JWT; cùng vai trò client-public.
**Không dùng `service_role`/secret key**.

Điền vào `weble/assets/js/kho-config.js`:

```js
export const KHO_URL = "https://xxxxx.supabase.co";
export const KHO_KEY = "sb_publishable_...";
```

## 5. Smoke test REST/RPC

Đặt biến:

```bash
export KHO_URL="https://xxxxx.supabase.co"
export KHO_KEY="sb_publishable_..."
```

### 5.1 — Insert hợp lệ

```bash
curl -s -X POST "$KHO_URL/rest/v1/kho_giao_dien?select=id,ten,tac_gia,luot_tai,ngay_tao" \
  -H "apikey: $KHO_KEY" -H "Authorization: Bearer $KHO_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"ten":"Test curl 1","tac_gia":"curl","thiet_ke":{"format":"TNVA_PROJECT","width":212,"height":104,"elements":[]},"kich_thuoc_nen":1200,"ma_xoa":"test-token-1"}'
```

Kỳ vọng: HTTP 201 và JSON có `id`. Ghi lại `id` làm `<id>` bên dưới.

### 5.2 — Gói >4096 phải bị DB chặn

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$KHO_URL/rest/v1/kho_giao_dien" \
  -H "apikey: $KHO_KEY" -H "Authorization: Bearer $KHO_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ten":"Test qua kho","tac_gia":"curl","thiet_ke":{},"kich_thuoc_nen":5000,"ma_xoa":"test-token-2"}'
```

Kỳ vọng: không phải 2xx; RLS `dang_tu_do` chặn vì `kich_thuoc_nen > 4096`.

### 5.3 — Đọc danh sách công khai đúng thứ tự

```bash
curl -s "$KHO_URL/rest/v1/kho_giao_dien?select=id,ten,luot_tai,ngay_tao&order=luot_tai.desc,ngay_tao.desc" \
  -H "apikey: $KHO_KEY"
```

Kỳ vọng: mảng JSON; lượt tải cao hơn đứng trước.

### 5.4 — Tăng lượt tải

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$KHO_URL/rest/v1/rpc/tang_luot_tai" \
  -H "apikey: $KHO_KEY" -H "Authorization: Bearer $KHO_KEY" \
  -H "Content-Type: application/json" -d '{"p_id":"<id>"}'
```

Kỳ vọng: HTTP 200/204; gọi lại 5.3 thấy `luot_tai` tăng 1.

### 5.5 — Sai mã xoá phải trả `false`

> Chạy **mã sai trước**, khi hàng test vẫn còn. Nếu xoá đúng trước rồi mới
> thử sai thì `false` không chứng minh được logic kiểm tra mã.

```bash
curl -s -X POST "$KHO_URL/rest/v1/rpc/xoa_giao_dien" \
  -H "apikey: $KHO_KEY" -H "Authorization: Bearer $KHO_KEY" \
  -H "Content-Type: application/json" -d '{"p_id":"<id>","p_ma":"sai-ma"}'
```

Kỳ vọng: `false`, hàng vẫn tồn tại.

### 5.6 — Đúng mã xoá phải trả `true` và cleanup hàng test

```bash
curl -s -X POST "$KHO_URL/rest/v1/rpc/xoa_giao_dien" \
  -H "apikey: $KHO_KEY" -H "Authorization: Bearer $KHO_KEY" \
  -H "Content-Type: application/json" -d '{"p_id":"<id>","p_ma":"test-token-1"}'
```

Kỳ vọng: `true`; gọi lại 5.3 không còn hàng test.

### 5.7 — Không được đọc cột mã xoá

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "$KHO_URL/rest/v1/kho_giao_dien?select=ma_xoa" \
  -H "apikey: $KHO_KEY" -H "Authorization: Bearer $KHO_KEY"
```

Kỳ vọng: **không phải 2xx** (thường 401/403). Publishable key không được đọc
`ma_xoa`; DB cũng chỉ lưu SHA-256 của token, không lưu token rõ.

5.1-5.7 chứng minh schema/RLS/RPC và hotfix mã xoá ở tầng API. Chúng chưa
chứng minh UI/browser hoặc thiết bị thật.

## 6. Việc cần test trong trình duyệt thật

Theo checklist `docs/KHO_CONG_DONG_TNVA.md`:

- Tab **Cộng đồng** render đúng trên desktop và màn 390 px.
- Upload project hợp lệ; >4096 byte bị chặn trước khi gọi API.
- Tải từ Kho → Studio → compile/gửi BLE bình thường.
- Mất mạng/Supabase lỗi không làm hỏng tab Thiết kế/BLE.
- SHA-256 gói TNF1 compile trước/sau vòng upload-download khớp khi compiler
  và asset không đổi.
- Báo cáo/xoá hiển thị đúng UX.

## 7. Giới hạn chống spam

`localStorage` chỉ là rate-limit mềm. Vì Kho chưa dùng Auth/Captcha/Edge
Function, người cố ý vẫn có thể gọi RPC báo cáo/tăng lượt tải trực tiếp.
Không coi cơ chế “5 báo cáo tự ẩn” là chống lạm dụng mạnh. Nếu public rộng,
nên thêm Auth/Captcha/Edge Function hoặc moderation server-side.
