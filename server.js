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

// Biến dùng chung cho mọi view
app.use((req, res, next) => {
  const { smtp_pass, ...settings } = getSettings(); // không đưa mật khẩu SMTP ra view
  res.locals.settings = settings;
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

app.use((req, res) => res.status(404).render('404', { title: 'Không tìm thấy trang' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Lỗi máy chủ: ' + (process.env.NODE_ENV === 'production' ? '' : err.message));
});

app.listen(PORT, () => {
  console.log(`Website:    http://localhost:${PORT}`);
  console.log(`Quản trị:   http://localhost:${PORT}/admin  (mặc định admin / admin123)`);
});
