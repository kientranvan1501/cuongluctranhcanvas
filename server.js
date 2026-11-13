const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { db, getSettings, sessionSecret } = require('./db');
const { textToHtml } = require('./lib/rich-text');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
// Phiên đăng nhập lưu trong SQLite (bảng sessions): không mất khi web khởi động lại,
// dùng chung được khi hosting (Passenger) chạy nhiều tiến trình song song
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.q = {
      get: db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires > ?'),
      set: db.prepare('INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires'),
      touch: db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?'),
      del: db.prepare('DELETE FROM sessions WHERE sid = ?'),
      prune: db.prepare('DELETE FROM sessions WHERE expires <= ?'),
    };
    this.prune();
    setInterval(() => this.prune(), 60 * 60 * 1000).unref(); // dọn phiên hết hạn mỗi giờ
  }
  expiry(sess) { return sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000; }
  prune() { try { this.q.prune.run(Date.now()); } catch (e) { /* bỏ qua */ } }
  get(sid, cb) {
    try { const r = this.q.get.get(sid, Date.now()); cb(null, r ? JSON.parse(r.data) : null); } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { this.q.set.run(sid, JSON.stringify(sess), this.expiry(sess)); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) {
    try { this.q.touch.run(this.expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { this.q.del.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

app.use(session({
  store: new SqliteStore(),
  secret: sessionSecret(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
}));

// CSS/JS kèm ?v=<thời điểm sửa file>: trình duyệt được lưu cache lâu nhưng tự tải lại ngay khi file đổi
const fs = require('fs');
function asset(p) {
  try { return p + '?v=' + Math.floor(fs.statSync(path.join(__dirname, 'public', p)).mtimeMs).toString(36); } catch (e) { return p; }
}

// Biến dùng chung cho mọi view
app.use((req, res, next) => {
  const { smtp_pass, ...settings } = getSettings(); // không đưa mật khẩu SMTP ra view
  res.locals.settings = settings;
  // ---- SEO: URL gốc tuyệt đối (ưu tiên "Địa chỉ website" trong Cài đặt), mô tả rút gọn, dữ liệu SEO mặc định
  const siteUrl = String(settings.site_url || '').trim();
  res.locals.baseUrl = (siteUrl ? (/^https?:\/\//i.test(siteUrl) ? siteUrl : 'https://' + siteUrl) : `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  res.locals.absUrl = (u) => !u ? '' : /^https?:\/\//i.test(u) ? u : res.locals.baseUrl + (u.startsWith('/') ? '' : '/') + u;
  res.locals.plain = (html, n = 160) => {
    const t = textToHtml(String(html || '')).replace(/<[^>]*>/g, ' ') // nội dung dạng chữ thường (##, **…) -> HTML -> bỏ thẻ.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
  };
  res.locals.asset = asset;
  res.locals.richText = textToHtml; // mô tả gõ chữ thường -> HTML (giữ xuống dòng)
  res.locals.seo = {}; // từng route ghi đè: canonical, description, image, type, noindex, jsonld[]
  res.locals.formatPrice = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash; delete req.session.flash;
  next();
});

// Menu danh mục + trang chính sách cho header/footer (chỉ trang public)
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  // Danh mục bỏ tick "Hiện trên menu" bị ẩn khỏi header (cùng các mục con của nó); trang danh mục vẫn mở được
  const cats = db.prepare('SELECT * FROM categories WHERE show_menu = 1 ORDER BY sort_order, name').all();
  const byParent = {};
  cats.forEach(c => (byParent[c.parent_id || 0] ||= []).push(c));
  const build = (pid) => (byParent[pid] || []).map(c => ({ ...c, children: build(c.id) }));
  res.locals.menu = build(0);
  res.locals.footerPages = db.prepare("SELECT title, slug FROM pages WHERE active = 1 AND footer_group = 'policy' ORDER BY id").all();
  next();
});

app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/shop'));

app.use((req, res) => {
  res.locals.seo = { noindex: true, canonical: false };
  res.status(404).render('404', { title: 'Không tìm thấy trang' });
});
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Lỗi máy chủ: ' + (process.env.NODE_ENV === 'production' ? '' : err.message));
});

app.listen(PORT, () => {
  console.log(`Website:    http://localhost:${PORT}`);
  console.log(`Quản trị:   http://localhost:${PORT}/admin  (mặc định admin / admin123)`);
});
