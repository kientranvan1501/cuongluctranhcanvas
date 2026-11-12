// Cơ sở dữ liệu SQLite tích hợp sẵn trong Node.js (>= 22.5) - không cần cài MySQL
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(path.join(__dirname, 'data', 'shop.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  image TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  show_home INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT DEFAULT '',
  slug TEXT UNIQUE NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price INTEGER DEFAULT 0,
  sale_price INTEGER DEFAULT 0,
  variants TEXT DEFAULT '[]',      -- JSON: [{"name":"40x60cm","price":920000}]
  images TEXT DEFAULT '[]',        -- JSON: ["/uploads/a.jpg", ...]
  short_desc TEXT DEFAULT '',
  description TEXT DEFAULT '',
  vendor TEXT DEFAULT '',
  featured INTEGER DEFAULT 0,
  is_new INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  meta_title TEXT DEFAULT '',
  meta_desc TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content TEXT DEFAULT '',
  footer_group TEXT DEFAULT '',     -- 'policy' => hiện ở cột Chính sách dưới footer
  active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT, phone TEXT, email TEXT, address TEXT, note TEXT,
  items TEXT DEFAULT '[]',
  total INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, phone TEXT, email TEXT,
  need TEXT DEFAULT '',             -- nhu cầu / không gian treo tranh
  note TEXT DEFAULT '',
  source TEXT DEFAULT '',           -- trang khách đăng ký
  status TEXT DEFAULT 'new',        -- new | contacted | done
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'orders',       -- 'admin' = toàn quyền, 'orders' = chỉ xem đơn hàng
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);
`);

// ---------- helpers ----------
function slugify(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function uniqueSlug(table, base, excludeId = 0) {
  let slug = slugify(base), i = 1;
  const stmt = db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`);
  while (stmt.get(slug, excludeId)) slug = `${slugify(base)}-${++i}`;
  return slug;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function getSettings() {
  const s = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = r.value;
  return s;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

function parseProduct(p) {
  if (!p) return p;
  try { p.images = JSON.parse(p.images || '[]'); } catch { p.images = []; }
  try { p.variants = JSON.parse(p.variants || '[]'); } catch { p.variants = []; }
  const prices = p.variants.map(v => +v.price).filter(n => n > 0);
  p.min_price = prices.length ? Math.min(...prices) : (p.sale_price || p.price);
  p.has_range = prices.length > 1 && Math.min(...prices) !== Math.max(...prices);
  p.thumb = p.images[0] || '/img/no-image.svg';
  return p;
}

// ---------- dữ liệu mẫu (chỉ chạy lần đầu) ----------
function seed() {
  if (db.prepare('SELECT COUNT(*) c FROM settings').get().c > 0) return;

  const defaults = {
    site_name: 'Canvas Art',
    logo: '',
    favicon: '',
    hotline: '0900.000.000',
    email: 'sales@example.com',
    address: 'Số 1 Đường ABC, Quận 1, TP. Hồ Chí Minh',
    company_name: 'CÔNG TY TNHH CANVAS ART',
    company_info: 'GPKD số: 0000000000 do Sở KH&ĐT TP.HCM cấp',
    about: 'Chúng tôi cung cấp dịch vụ in tranh canvas trọn gói tại nhà: tư vấn mẫu, in ấn, đóng khung và lắp đặt miễn phí.',
    facebook: '#', instagram: '#', youtube: '#', zalo: '',
    meta_title: 'Canvas Art - Tranh Đẹp Treo Tường',
    meta_desc: 'Hơn 20.000 mẫu tranh canvas, tranh sơn dầu, tranh tráng gương. Miễn phí vận chuyển và lắp đặt.',
    hero_title: 'Tạo Dấu Ấn Cho Không Gian Sống',
    hero_subtitle: 'TRANH ĐẸP TREO TƯỜNG',
    hero_button: 'Xem 20.000+ Bộ Tranh',
    hero_link: '/shop',
    hero_image: 'https://picsum.photos/seed/hero-canvas/1920/800',
    video_url: '',
    head_code: '<!-- Dán mã Google Tag Manager (phần <head>), Google Analytics, Facebook Pixel... vào đây -->',
    body_code: '<!-- Dán mã GTM (noscript) ngay sau thẻ <body> vào đây -->',
    footer_code: '<!-- Dán mã chat (Tawk, Zalo widget...), script cuối trang vào đây -->',
    custom_css: '',
    admin_user: process.env.ADMIN_USER || 'admin',
    admin_pass: hashPassword(process.env.ADMIN_PASS || 'admin123'),
  };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);

  const insCat = db.prepare('INSERT INTO categories(name, slug, parent_id, image, sort_order, show_home) VALUES(?,?,?,?,?,?)');
  const tree = {
    'Loài Hoa': ['Hoa Hồng', 'Hoa Mẫu Đơn', 'Hoa Sen', 'Hoa Tulip', 'Hướng Dương', 'Hoa Lan'],
    'Phong Cảnh': ['Tranh Núi', 'Tranh Rừng', 'Tranh Biển', 'Đồng Quê', 'Thác Nước'],
    'Trừu Tượng - Tối Giản': ['Tranh Trừu Tượng', 'Tranh Tối Giản'],
    'Phong Thủy': ['Mã Đáo Thành Công', 'Thuận Buồm Xuôi Gió', 'Cửu Ngư', 'Tùng Hạc'],
    'Tôn Giáo': ['Thiên Chúa', 'Phật Giáo'],
    'Cô Gái': ['Cá Tính', 'Dịu Dàng'],
    'Chủ Đề Khác': ['Động Vật', 'Địa Danh', 'Hoạt Hình', 'Động Lực'],
  };
  const canvas = insCat.run('Tranh Canvas', 'tranh-canvas', null, '', 1, 0).lastInsertRowid;
  let order = 0;
  const leafIds = [];
  for (const [parent, kids] of Object.entries(tree)) {
    const pid = insCat.run(parent, slugify(parent), canvas, `https://picsum.photos/seed/${slugify(parent)}/600/600`, ++order, 1).lastInsertRowid;
    for (const k of kids) leafIds.push(insCat.run(k, slugify(k), pid, `https://picsum.photos/seed/${slugify(k)}/600/600`, ++order, 0).lastInsertRowid);
  }
  const sonDau = insCat.run('Tranh Sơn Dầu', 'tranh-son-dau', null, 'https://picsum.photos/seed/son-dau/600/600', 2, 1).lastInsertRowid;
  const trangGuong = insCat.run('Tranh Tráng Gương', 'tranh-trang-guong', null, 'https://picsum.photos/seed/trang-guong/600/600', 3, 1).lastInsertRowid;

  const insP = db.prepare(`INSERT INTO products(name, code, slug, category_id, price, sale_price, variants, images, short_desc, description, vendor, featured, is_new)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const sizes = (base) => JSON.stringify([
    { name: '40x60cm', price: base }, { name: '60x90cm', price: Math.round(base * 1.45 / 10000) * 10000 },
    { name: '80x120cm', price: Math.round(base * 2.1 / 10000) * 10000 },
  ]);
  const desc = '<p>Tranh in trên chất liệu vải canvas cao cấp, mực in UV bền màu trên 10 năm, khung gỗ thông chắc chắn.</p><ul><li>Miễn phí vận chuyển toàn quốc</li><li>Hỗ trợ lắp đặt tận nhà trong 24h</li><li>Đổi trả nếu không hài lòng</li></ul>';
  const names = ['Hoa Sen Thanh Tịnh', 'Bình Minh Trên Núi', 'Sóng Biển Xanh', 'Hướng Dương Rực Rỡ', 'Rừng Thông Sương Mù', 'Tối Giản Đường Cong',
    'Cửu Ngư Quần Hội', 'Thuyền Buồm Hoàng Hôn', 'Mẫu Đơn Phú Quý', 'Đồng Lúa Chín', 'Trừu Tượng Sắc Màu', 'Thác Nước Hùng Vĩ',
    'Hươu Vàng May Mắn', 'Cô Gái Áo Dài', 'Hoa Tulip Hà Lan', 'Tùng Hạc Diên Niên'];
  names.forEach((n, i) => {
    const code = 'CV' + String(i + 1).padStart(3, '0');
    const base = 920000 + (i % 6) * 70000;
    insP.run(n, code, slugify(n + ' ' + code), leafIds[i % leafIds.length], base, 0, sizes(base),
      JSON.stringify([`https://picsum.photos/seed/${code}/800/800`, `https://picsum.photos/seed/${code}b/800/800`]),
      'Tranh canvas in UV cao cấp, khung gỗ thông, sẵn móc treo.', desc, 'Canvas Art', i < 8 ? 1 : 0, i >= 8 ? 1 : 0);
  });
  ['Góc Nhỏ Hiên Nhà', 'Phố Cổ Hội An', 'Sen Hồ Tây', 'Trừu Tượng Vàng Đồng', 'Hoa Cúc Dại', 'Chiều Quê', 'Thiếu Nữ Bên Hoa Huệ', 'Mùa Thu Vàng'].forEach((n, i) => {
    const code = 'SD' + String(i + 1).padStart(3, '0');
    insP.run('Tranh Sơn Dầu ' + n, code, slugify('tranh son dau ' + n + ' ' + code), sonDau, [5900000, 6900000, 8900000][i % 3], 0, '[]',
      JSON.stringify([`https://picsum.photos/seed/${code}/800/800`]), 'Tranh sơn dầu vẽ tay 100% bởi họa sĩ.',
      '<p>Tranh sơn dầu vẽ tay hoàn toàn, mỗi bức là một tác phẩm độc bản.</p>', 'Canvas Art', 0, 0);
  });
  ['Hoa Mẫu Đơn Tráng Gương', 'Phong Cảnh Tráng Gương', 'Mã Đáo Tráng Gương', 'Trừu Tượng Tráng Gương'].forEach((n, i) => {
    const code = 'TG' + String(i + 1).padStart(3, '0');
    insP.run(n, code, slugify(n + ' ' + code), trangGuong, 1500000, 1290000, '[]',
      JSON.stringify([`https://picsum.photos/seed/${code}/800/800`]), 'Tranh tráng gương bóng sang trọng.',
      '<p>Tranh tráng gương, bề mặt bóng, chống ẩm, dễ lau chùi.</p>', 'Canvas Art', 0, 1);
  });

  const insPage = db.prepare('INSERT INTO pages(title, slug, content, footer_group) VALUES(?,?,?,?)');
  insPage.run('Chính Sách Bán Hàng', 'chinh-sach-ban-hang', '<p>Nội dung chính sách bán hàng...</p>', 'policy');
  insPage.run('Chính Sách Đổi Trả', 'chinh-sach-doi-tra', '<p>Nội dung chính sách đổi trả...</p>', 'policy');
  insPage.run('Chính Sách Vận Chuyển', 'chinh-sach-van-chuyen', '<p>Nội dung chính sách vận chuyển...</p>', 'policy');
  insPage.run('Chính Sách Bảo Mật Thông Tin', 'chinh-sach-bao-mat', '<p>Nội dung chính sách bảo mật...</p>', 'policy');
  insPage.run('Liên Hệ', 'lien-he', '<p>Hotline, email, địa chỉ showroom...</p>', '');
  insPage.run('Về Chúng Tôi', 've-chung-toi', '<p>Giới thiệu công ty...</p>', '');
}
seed();

// Chuyển tài khoản admin cũ (lưu trong settings) sang bảng users
function migrateUsers() {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const s = getSettings();
  db.prepare("INSERT INTO users(username, password, name, role) VALUES(?, ?, 'Quản trị viên', 'admin')")
    .run(s.admin_user || process.env.ADMIN_USER || 'admin', s.admin_pass || hashPassword(process.env.ADMIN_PASS || 'admin123'));
  db.prepare("DELETE FROM settings WHERE key IN ('admin_user', 'admin_pass')").run();
}
migrateUsers();

module.exports = { db, slugify, uniqueSlug, hashPassword, verifyPassword, getSettings, setSetting, parseProduct };
