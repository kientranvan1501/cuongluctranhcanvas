// Cơ sở dữ liệu SQLite tích hợp sẵn trong Node.js (>= 22.5) - không cần cài MySQL
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const fs = require('fs');

// Thư mục dữ liệu & ảnh không nằm trong Git -> tự tạo khi chạy lần đầu trên máy/hosting mới
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'shop.db'));
// WAL: đọc & ghi song song; busy_timeout: nhiều tiến trình cùng ghi thì chờ thay vì báo lỗi "database is locked"
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER NOT NULL
)`);

// Khóa bí mật ký cookie đăng nhập: lấy từ biến môi trường SESSION_SECRET, nếu không có thì tạo 1 lần và lưu vào file
// (không lưu trong bảng settings vì settings được đưa ra giao diện)
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (e) { /* chưa có */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, s, { mode: 0o600 });
  return s;
}

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
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT DEFAULT '',
  rating INTEGER DEFAULT 5,
  content TEXT NOT NULL,
  image TEXT DEFAULT '',
  product_id INTEGER,
  show_home INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
// Thêm cột mới cho DB đã có sẵn (hosting) — chạy được nhiều lần
const addColumn = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn('categories', 'show_menu', 'INTEGER DEFAULT 1'); // hiện trên menu header

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

// Ảnh nhỏ cho thẻ sản phẩm: nếu có file "<tên>-sm.<đuôi>" cạnh ảnh gốc thì dùng (nhẹ hơn nhiều), không thì dùng ảnh gốc
const smCache = new Map();
function smallImage(img) {
  if (!img || !img.startsWith('/uploads/')) return img;
  if (!smCache.has(img)) {
    const sm = img.replace(/(\.\w+)$/, '-sm$1');
    smCache.set(img, fs.existsSync(path.join(__dirname, 'public', sm)) ? sm : img);
  }
  return smCache.get(img);
}
// Chiều rộng thật của ảnh JPEG/PNG (đọc phần đầu file, có cache) — dùng cho srcset
const wCache = new Map();
function imageWidth(img) {
  if (!img || !img.startsWith('/uploads/')) return 0;
  if (!wCache.has(img)) {
    let w = 0;
    try {
      const fd = fs.openSync(path.join(__dirname, 'public', img), 'r'), b = Buffer.alloc(65536);
      const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd);
      if (b[0] === 0x89 && b[1] === 0x50) w = b.readUInt32BE(16); // PNG
      else for (let i = 2; i + 9 < n;) { // JPEG: tìm khung SOF
        if (b[i] !== 0xFF) break;
        const m = b[i + 1];
        if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) { w = b.readUInt16BE(i + 7); break; }
        i += 2 + b.readUInt16BE(i + 2);
      }
    } catch (e) { /* không đọc được -> 0 */ }
    wCache.set(img, w);
  }
  return wCache.get(img);
}
// srcset "ảnh nhỏ 800w, ảnh gốc <rộng>w": trình duyệt tự chọn ảnh gốc khi màn hình cần nét hơn
function imageSrcset(img) {
  const sm = smallImage(img);
  if (!sm || sm === img) return '';
  const w = imageWidth(img), ws = imageWidth(sm);
  return w > ws && ws ? `${sm} ${ws}w, ${img} ${w}w` : '';
}

function parseProduct(p) {
  if (!p) return p;
  try { p.images = JSON.parse(p.images || '[]'); } catch { p.images = []; }
  try { p.variants = JSON.parse(p.variants || '[]'); } catch { p.variants = []; }
  // Giá bán thực tế: giá KM nếu có và nhỏ hơn giá gốc
  const finalOf = (price, sale) => (+sale > 0 && +sale < +price ? +sale : +price);
  p.variants.forEach(v => { v.price = +v.price || 0; v.sale_price = +v.sale_price || 0; v.final = finalOf(v.price, v.sale_price); });
  const priced = p.variants.filter(v => v.final > 0);
  if (priced.length) {
    const cheapest = priced.reduce((a, b) => (b.final < a.final ? b : a));
    p.min_price = cheapest.final;
    p.compare_price = cheapest.final < cheapest.price ? cheapest.price : 0; // giá gạch ngang
    p.has_range = priced.some(v => v.final !== cheapest.final);
  } else {
    p.min_price = finalOf(p.price, p.sale_price);
    p.compare_price = p.min_price < p.price ? p.price : 0;
    p.has_range = false;
  }
  p.thumb = p.images[0] || '/img/no-image.svg';
  p.card = smallImage(p.thumb);
  p.cardSrcset = imageSrcset(p.thumb);
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
    const pid = insCat.run(parent, slugify(parent), canvas, '', ++order, 1).lastInsertRowid;
    for (const k of kids) leafIds.push(insCat.run(k, slugify(k), pid, '', ++order, 0).lastInsertRowid);
  }
  const sonDau = insCat.run('Tranh Sơn Dầu', 'tranh-son-dau', null, '', 2, 1).lastInsertRowid;
  const trangGuong = insCat.run('Tranh Tráng Gương', 'tranh-trang-guong', null, '', 3, 1).lastInsertRowid;

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

// Dọn ảnh minh họa tạm (picsum.photos) của danh mục từ dữ liệu mẫu cũ: danh mục không có ảnh sẽ tự lấy ảnh tranh trong danh mục
db.prepare("UPDATE categories SET image = '' WHERE image LIKE 'https://picsum.photos/%'").run();
// Bản cũ: SP có biến thể thì giá KM chung bị bỏ qua -> chuyển giá KM đó vào biến thể đầu tiên
for (const r of db.prepare("SELECT id, sale_price, variants FROM products WHERE sale_price > 0 AND variants LIKE '[{%'").all()) {
  let vs; try { vs = JSON.parse(r.variants); } catch { continue; }
  if (!vs.length || vs.some(v => +v.sale_price > 0) || !(r.sale_price < +vs[0].price)) continue;
  vs[0].sale_price = r.sale_price;
  db.prepare('UPDATE products SET variants = ? WHERE id = ?').run(JSON.stringify(vs), r.id);
}

module.exports = { db, sessionSecret, slugify, uniqueSlug, hashPassword, verifyPassword, getSettings, setSetting, parseProduct, smallImage, imageSrcset };
