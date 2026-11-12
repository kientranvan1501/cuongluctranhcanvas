# Canvas Shop — Website bán tranh + Trang quản trị

Website bán tranh treo tường (bố cục lấy cảm hứng từ các shop tranh canvas), viết bằng **Node.js + Express + EJS + SQLite** (SQLite có sẵn trong Node, không cần cài MySQL).

## Cài đặt & chạy

Yêu cầu: **Node.js 22.5 trở lên** (khuyên dùng Node 24).

```bash
npm install
npm start
```

- Website: http://localhost:3000
- Quản trị: http://localhost:3000/admin — tài khoản mặc định **admin / admin123** (hãy đổi ngay tại mục *Tài khoản*)

Lần chạy đầu tiên sẽ tự tạo `data/shop.db` kèm dữ liệu mẫu (danh mục, sản phẩm, trang chính sách). Muốn làm lại từ đầu: tắt server, xóa `data/shop.db`, chạy lại.

Biến môi trường (tùy chọn):

| Biến | Ý nghĩa |
|---|---|
| `PORT` | Cổng chạy (mặc định 3000) |
| `SESSION_SECRET` | Chuỗi bí mật cho phiên đăng nhập — **nên đặt khi chạy thật**, nếu không mỗi lần khởi động lại sẽ bị đăng xuất |
| `ADMIN_USER`, `ADMIN_PASS` | Tài khoản admin khởi tạo (chỉ dùng ở lần chạy đầu) |

## Tính năng

**Trang khách**
- Thanh hotline, header cố định, menu nhiều cấp (mega menu) sinh tự động từ danh mục
- Trang chủ: banner, Sản phẩm nổi bật, BST mới, Bộ sưu tập, Tranh sơn dầu (dạng trượt), 4 khối cam kết, video, CTA
- Trang danh mục (lọc theo danh mục con, sắp xếp, phân trang), tìm kiếm theo tên/mã
- Trang sản phẩm: nhiều ảnh, chọn kích thước có giá riêng, sản phẩm liên quan
- Giỏ hàng + đặt hàng (giá được tính lại ở server)
- Trang nội dung (chính sách, liên hệ…), nút gọi / Zalo nổi, responsive mobile

**Trang quản trị `/admin`**
- **Sản phẩm**: thêm / sửa / xóa / nhân bản, tải nhiều ảnh, biến thể kích thước–giá, nổi bật / mới / ẩn, SEO
- **Danh mục**: thêm / sửa / xóa, phân cấp cha–con, ảnh, thứ tự, hiện ở trang chủ
- **Đơn hàng**: xem chi tiết, đổi trạng thái, xóa
- **Trang nội dung**: thêm / sửa / xóa trang chính sách, giới thiệu…
- **Cài đặt website**: tên, logo, favicon, hotline, email, địa chỉ, banner, mạng xã hội, SEO
- **Mã Header / Footer**: dán mã Google Tag Manager, Google Analytics, Facebook Pixel, Search Console, widget chat… vào `<head>`, sau `<body>`, trước `</body>`, cùng ô CSS tùy chỉnh
- **Cấu hình email**: SMTP (Gmail, Zoho, mail hosting…), danh sách email nhận thông báo khi có đơn mới, tùy chọn gửi email xác nhận cho khách, nút gửi thử
- **Người dùng**: tạo nhiều tài khoản với 2 quyền — *Quản trị* (toàn quyền) và *Chỉ xem đơn hàng* (chỉ xem danh sách / chi tiết đơn, không sửa, không xóa)
- **Tài khoản**: đổi tên đăng nhập / mật khẩu của chính mình

### Dán Google Tag Manager
1. Vào **Quản trị → Mã Header / Footer**
2. Đoạn `<script>` thứ nhất của GTM → ô **① head**
3. Đoạn `<noscript>` thứ hai → ô **② sau body**
4. Lưu, mở website và kiểm tra bằng GTM Preview / Tag Assistant

## Cấu trúc thư mục

```
server.js            Khởi tạo Express, session, biến dùng chung
db.js                Tạo bảng SQLite, dữ liệu mẫu, hàm tiện ích
routes/shop.js       Các trang khách
routes/admin.js      Trang quản trị (CRUD, cài đặt, mã nhúng)
views/               Giao diện EJS (views/admin/ cho quản trị)
public/css, js       CSS/JS; đổi màu chủ đạo ở biến --accent trong style.css
public/uploads/      Ảnh tải lên
data/shop.db         Cơ sở dữ liệu
```

## Đưa lên hosting
- VPS/hosting hỗ trợ Node.js: chạy `npm install --omit=dev` rồi dùng `pm2 start server.js --name canvas-shop`, đặt Nginx làm reverse proxy + SSL.
- Sao lưu định kỳ thư mục `data/` và `public/uploads/`.

## Lưu ý
- Ảnh sản phẩm mẫu lấy từ picsum.photos (ảnh ngẫu nhiên) — thay bằng ảnh thật của bạn.
- Tên thương hiệu, logo, thông tin công ty đều là dữ liệu mẫu, sửa trong *Cài đặt website*.
