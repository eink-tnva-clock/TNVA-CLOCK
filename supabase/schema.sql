-- Kho giao diện cộng đồng TNVA -- schema Supabase (Postgres + RLS).
-- Dán TOÀN BỘ file này vào Supabase Dashboard -> SQL Editor -> Run.
-- Có thể chạy lại để cập nhật project R27 hiện có. Khối migration ma_xoa
-- bên dưới được viết idempotent: token cũ dạng rõ sẽ được đổi sang SHA-256
-- đúng một lần, token đã hash 64 hex sẽ không bị hash lại.

create extension if not exists pgcrypto with schema extensions; -- digest(), gen_random_uuid()

create table if not exists public.kho_giao_dien (
  id             uuid primary key default gen_random_uuid(),
  ten            text not null check (char_length(ten) between 1 and 40),
  tac_gia        text not null check (char_length(tac_gia) between 1 and 24),
  mo_ta          text check (char_length(mo_ta) <= 200),
  thiet_ke       jsonb not null,
  thumb_url      text,
  kich_thuoc_nen int  not null,          -- byte sau khi compile TNF1 (2.13" -- xem editor.js's compile())
  luot_tai       int  not null default 0,
  bao_cao        int  not null default 0,
  an             boolean not null default false,
  ma_xoa         text not null,          -- CHỈ lưu SHA-256 của token; token rõ chỉ ở trình duyệt tác giả
  ngay_tao       timestamptz not null default now()
);

create index if not exists idx_kho_sort on public.kho_giao_dien (an, luot_tai desc, ngay_tao desc);

/* R27.1 hardening: bản R27 đầu tiên từng lưu ma_xoa dạng rõ, trong khi RLS
 * SELECT theo hàng không che được từng cột. Nếu anon cố select=* thì token
 * xoá có thể bị lộ. Khối này chuyển mọi token cũ sang SHA-256 trước khi thu
 * hẹp quyền SELECT; regex làm cho chạy lại schema không hash lần thứ hai. */
update public.kho_giao_dien
   set ma_xoa = encode(extensions.digest(ma_xoa, 'sha256'), 'hex')
 where ma_xoa !~ '^[0-9a-f]{64}$';

/* Mọi INSERT mới gửi token rõ một lần; trigger đổi thành SHA-256 TRƯỚC khi
 * row được lưu. Client không bao giờ cần/được phép đọc lại ma_xoa. */
create or replace function public.kho_hash_ma_xoa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.ma_xoa := encode(extensions.digest(new.ma_xoa, 'sha256'), 'hex');
  return new;
end;
$$;

drop trigger if exists kho_hash_ma_xoa_before_insert on public.kho_giao_dien;
create trigger kho_hash_ma_xoa_before_insert
before insert on public.kho_giao_dien
for each row execute function public.kho_hash_ma_xoa();

alter table public.kho_giao_dien enable row level security;

drop policy if exists "doc_cong_khai" on public.kho_giao_dien;
drop policy if exists "dang_tu_do" on public.kho_giao_dien;

-- Ai cũng xem được, trừ bài bị ẩn.
create policy "doc_cong_khai" on public.kho_giao_dien
  for select using (an = false);

-- Ai cũng đăng được, KHÔNG CẦN DUYỆT -- validation đầy đủ nằm ở client
-- (weble/assets/js/kho-upload.js: compile thử, whitelist widget ID, render
-- thumbnail, rate limit) TRƯỚC khi gọi insert; policy này vẫn chặn các field
-- trạng thái/kích thước giả mạo ở tầng DB.
create policy "dang_tu_do" on public.kho_giao_dien
  for insert with check (
    an = false and luot_tai = 0 and bao_cao = 0
    and kich_thuoc_nen > 0 and kich_thuoc_nen <= 4096
  );

/* Không cho anon đọc cột ma_xoa/bao_cao/an, cũng không cho tự UPDATE/DELETE.
 * Chỉ grant đúng các cột UI cần. INSERT cũng chỉ nhận field tác giả được phép
 * đặt; id/counter/hidden flag phải dùng default DB. */
revoke all on table public.kho_giao_dien from anon, authenticated;
grant select (id, ten, tac_gia, mo_ta, thiet_ke, thumb_url, kich_thuoc_nen, luot_tai, ngay_tao)
  on table public.kho_giao_dien to anon, authenticated;
grant insert (ten, tac_gia, mo_ta, thiet_ke, thumb_url, kich_thuoc_nen, ma_xoa)
  on table public.kho_giao_dien to anon, authenticated;

-- KHÔNG có policy update/delete => client không tự sửa/xoá trực tiếp được.
-- Mọi thay đổi đi qua 3 hàm RPC security-definer bên dưới.

create or replace function public.tang_luot_tai(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kho_giao_dien
     set luot_tai = luot_tai + 1
   where id = p_id and an = false;
$$;

create or replace function public.bao_cao_giao_dien(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kho_giao_dien
     set bao_cao = bao_cao + 1,
         an      = (bao_cao + 1 >= 5)     -- 5 báo cáo thì tự ẩn
   where id = p_id and an = false;
$$;

-- p_ma là token RÕ tác giả giữ. DB chỉ có SHA-256; hàm hash p_ma rồi so sánh.
-- Trả false (không throw) khi id/ma không khớp để UI hiện "Mã không đúng.".
create or replace function public.xoa_giao_dien(p_id uuid, p_ma text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.kho_giao_dien
   where id = p_id
     and ma_xoa = encode(extensions.digest(p_ma, 'sha256'), 'hex');
  return found;
end;
$$;

/* PostgreSQL mặc định cấp EXECUTE function cho PUBLIC. Thu hồi trước rồi chỉ
 * cấp đúng role web của Supabase; tránh vô tình mở rộng quyền RPC. */
revoke all on function public.kho_hash_ma_xoa() from public, anon, authenticated;
revoke all on function public.tang_luot_tai(uuid) from public;
revoke all on function public.bao_cao_giao_dien(uuid) from public;
revoke all on function public.xoa_giao_dien(uuid, text) from public;
grant execute on function public.tang_luot_tai(uuid) to anon, authenticated;
grant execute on function public.bao_cao_giao_dien(uuid) to anon, authenticated;
grant execute on function public.xoa_giao_dien(uuid, text) to anon, authenticated;

-- ==== Storage: bucket "thumbs" cho ảnh xem trước PNG ====
-- Bucket không tạo được bằng SQL thuần trên mọi phiên bản Supabase -- xem
-- README.md mục 3 để tạo bằng Dashboard (Storage -> New bucket -> public
-- read, giới hạn 100 KB, chỉ nhận image/png). Nếu Dashboard của bạn hỗ trợ
-- storage.buckets qua SQL, khối dưới đây làm sẵn (bỏ qua nếu lỗi quyền):
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbs', 'thumbs', true, 102400, array['image/png'])
on conflict (id) do update set public = true, file_size_limit = 102400, allowed_mime_types = array['image/png'];

drop policy if exists "thumbs_doc_cong_khai" on storage.objects;
drop policy if exists "thumbs_upload_tu_do" on storage.objects;

create policy "thumbs_doc_cong_khai" on storage.objects
  for select using (bucket_id = 'thumbs');

create policy "thumbs_upload_tu_do" on storage.objects
  for insert with check (bucket_id = 'thumbs');
