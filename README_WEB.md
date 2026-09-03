# TNVA CLOCK Carnival Studio

Web chạy trực tiếp bằng trình duyệt, không cần máy chủ để mở kho có sẵn, thiết kế, xử lý ảnh hoặc tạo đếm ngược. Chỉ các thao tác gửi dữ liệu vào đồng hồ mới cần kết nối Web Bluetooth.

## Chạy tại máy

Mở PowerShell tại thư mục source và chạy:

```powershell
py -m http.server 5500 --directory weble
```

Sau đó mở:

```text
http://127.0.0.1:5500/
```

## Kích hoạt thiết bị

Không còn máy chủ nào cả. Kết nối đồng hồ, mở mục **Kích hoạt thiết bị**,
sao chép mã thiết bị hiện trên màn hình rồi gửi qua Zalo (`zalo.me/0349816027`).
Người bán ký mã bằng `tools/tnva-sign/sign_activation.py` trên PC, gửi lại
mã dài qua Zalo, khách dán vào ô trong panel. Xem `docs/license-and-ota.md`.

## Cập nhật phần mềm (OTA)

Chọn file `.bin` phần mềm và file chữ ký (`.ota-sig.bin`, do
`tools/ota-sign/sign_ota.py` tạo ra) trong mục **Cập nhật phần mềm**, bấm
Cập nhật qua Bluetooth. Không cần mạng, không cần máy chủ.

## Màn hình

- Ngang: 212 × 104 pixel.
- Dọc: 104 × 212 pixel.
- Gói giao diện: TNF1, tối đa 4096 byte.
- Ảnh xem trước và dữ liệu gửi sang đồng hồ đều được dựng ở đúng kích thước E-Ink.
