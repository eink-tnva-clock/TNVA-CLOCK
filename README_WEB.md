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

## Máy chủ Pi (tùy chọn)

Pi chỉ dùng cho kho cộng đồng và phát hành bản cập nhật. Mở mục **Máy chủ Pi** trên thanh đầu trang, nhập địa chỉ gốc như:

```text
http://192.168.1.202:8080
```

Không cần thêm `/admin`. Nếu nhập nhầm `/admin` hoặc `/api/health`, web tự sửa về địa chỉ gốc.

## Màn hình

- Ngang: 212 × 104 pixel.
- Dọc: 104 × 212 pixel.
- Gói giao diện: TNF1, tối đa 4096 byte.
- Ảnh xem trước và dữ liệu gửi sang đồng hồ đều được dựng ở đúng kích thước E-Ink.
