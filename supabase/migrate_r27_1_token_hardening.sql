-- R27.1 hotfix cho project Supabase ĐÃ chạy schema R27 đầu tiên.
-- Chạy TOÀN BỘ file này đúng 1 lần (chạy lại cũng an toàn) trong SQL Editor.
-- Mục tiêu: ma_xoa không còn nằm dạng rõ/không thể SELECT bằng publishable key.

create extension if not exists pgcrypto with schema extensions;

-- 1) Hash token cũ đúng một lần.
update public.kho_giao_dien
   set ma_xoa = encode(extensions.digest(ma_xoa, 'sha256'), 'hex')
 where ma_xoa !~ '^[0-9a-f]{64}$';

-- 2) Hash mọi token mới trước khi lưu.
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

-- 3) Anon/authenticated chỉ được đọc/insert đúng các cột cần cho web.
revoke all on table public.kho_giao_dien from anon, authenticated;
grant select (id, ten, tac_gia, mo_ta, thiet_ke, thumb_url, kich_thuoc_nen, luot_tai, ngay_tao)
  on table public.kho_giao_dien to anon, authenticated;
grant insert (ten, tac_gia, mo_ta, thiet_ke, thumb_url, kich_thuoc_nen, ma_xoa)
  on table public.kho_giao_dien to anon, authenticated;

-- 4) RPC có search_path cố định; xoa_giao_dien so token rõ với hash trong DB.
create or replace function public.tang_luot_tai(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.kho_giao_dien set luot_tai = luot_tai + 1
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
         an      = (bao_cao + 1 >= 5)
   where id = p_id and an = false;
$$;

create or replace function public.xoa_giao_dien(p_id uuid, p_ma text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.kho_giao_dien
   where id = p_id and ma_xoa = encode(extensions.digest(p_ma, 'sha256'), 'hex');
  return found;
end;
$$;

revoke all on function public.kho_hash_ma_xoa() from public, anon, authenticated;
revoke all on function public.tang_luot_tai(uuid) from public;
revoke all on function public.bao_cao_giao_dien(uuid) from public;
revoke all on function public.xoa_giao_dien(uuid, text) from public;
grant execute on function public.tang_luot_tai(uuid) to anon, authenticated;
grant execute on function public.bao_cao_giao_dien(uuid) to anon, authenticated;
grant execute on function public.xoa_giao_dien(uuid, text) to anon, authenticated;
