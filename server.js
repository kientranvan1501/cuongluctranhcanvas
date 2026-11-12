const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { db, getSettings } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
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
    const t = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
  };
  res.locals.asset = asset;
  res.locals.seo = {}; // từng route ghi đè: canonical, description, image, type, noindex, jsonld[]
  res.locals.formatPrice = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
  res.locals.currentPath = req.path;
  res.locals.flash = req.session.flash; delete req.session.flash;
  next();
});

// Menu danh mục + trang chính sách cho header/footer (chỉ trang public)
app.use((req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
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
