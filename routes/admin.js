const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { db, uniqueSlug, hashPassword, verifyPassword, getSettings, setSetting, parseProduct } = require('../db');
const { sendTestMail } = require('../mailer');
const icon = require('../lib/icons');
const { htmlToText } = require('../lib/rich-text');

// ---------- Upload ảnh ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '..', 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(jpe?g|png|webp|gif|svg|ico)$/i.test(file.originalname)),
});

// ---------- Đăng nhập ----------
router.get('/login', (req, res) => res.render('admin/login', { error: null }));
router.post('/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(req.body.username || '').trim());
  if (u && verifyPassword(req.body.password || '', u.password)) {
    req.session.regenerate(() => {
      req.session.userId = u.id;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      res.redirect(u.role === 'admin' ? '/admin' : '/admin/orders');
    });
  } else res.render('admin/login', { error: 'Sai tên đăng nhập hoặc mật khẩu' });
});
router.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

// ---------- Trạng thái (nhãn + màu) ----------
// tone: blue | amber | violet | green | red | gray  → class .tone-<tone> trong admin.css
const ORDER_STATUSES = {
  new: { label: 'Mới', tone: 'blue' },
  processing: { label: 'Đang xử lý', tone: 'amber' },
  shipping: { label: 'Đang giao', tone: 'violet' },
  done: { label: 'Hoàn thành', tone: 'green' },
  cancelled: { label: 'Đã hủy', tone: 'red' },
};
const LEAD_STAGES = {
  new: { label: 'Mới đăng ký', tone: 'blue', hint: 'Chưa liên hệ khách' },
  contacted: { label: 'Đã liên hệ', tone: 'amber', hint: 'Đã gọi / nhắn Zalo' },
  consulting: { label: 'Đang tư vấn', tone: 'violet', hint: 'Đang gửi mẫu, báo giá' },
  done: { label: 'Đã chốt đơn', tone: 'green', hint: 'Khách đã mua' },
  lost: { label: 'Không thành công', tone: 'gray', hint: 'Không liên lạc được / không mua' },
};
// SQLite lưu giờ UTC ("YYYY-MM-DD HH:MM:SS") → hiển thị giờ Việt Nam
const parseDbDate = s => (s ? new Date(String(s).replace(' ', 'T') + (/[zZ+]/.test(String(s).slice(10)) ? '' : 'Z')) : null);
function fmtDate(s, withTime = true) {
  const d = parseDbDate(s);
  if (!d || isNaN(d)) return s || '';
  const o = { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' };
  if (withTime) Object.assign(o, { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Intl.DateTimeFormat('vi-VN', o).format(d).replace(',', '');
}
function timeAgo(s) {
  const d = parseDbDate(s);
  if (!d || isNaN(d)) return '';
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return m + ' phút trước';
  if (m < 1440) return Math.floor(m / 60) + ' giờ trước';
  if (m < 1440 * 30) return Math.floor(m / 1440) + ' ngày trước';
  return fmtDate(s, false);
}

// Bảo vệ toàn bộ trang admin bên dưới (đọc lại user mỗi request để khóa / đổi quyền có hiệu lực ngay)
router.use((req, res, next) => {
  const u = req.session.userId && db.prepare('SELECT id, username, name, role FROM users WHERE id = ? AND active = 1').get(req.session.userId);
  if (!u) return req.session.destroy(() => res.redirect('/admin/login'));
  req.user = res.locals.user = u;
  res.locals.isAdmin = u.role === 'admin';
  res.locals.csrf = req.session.csrf;
  res.locals.currentPath = req.path; // đường dẫn tương đối trong /admin, dùng cho menu active
  // Số mục mới để hiện chấm đếm trên menu
  res.locals.navCount = {
    orders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'new'").get().c,
    leads: res.locals.isAdmin ? db.prepare("SELECT COUNT(*) c FROM leads WHERE status = 'new'").get().c : 0,
  };
  res.locals.ORDER_STATUSES = ORDER_STATUSES;
  res.locals.LEAD_STAGES = LEAD_STAGES;
  res.locals.fmtDate = fmtDate;
  res.locals.timeAgo = timeAgo;
  res.locals.icon = icon;
  res.locals.htmlToText = htmlToText;
  res.locals.zaloLink = phone => {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.startsWith('84')) d = '0' + d.slice(2);
    return d ? 'https://zalo.me/' + d : '';
  };
  next();
});

// Phân quyền: tài khoản "Chỉ xem đơn hàng" chỉ được xem danh sách / chi tiết đơn và đổi mật khẩu của mình
const ORDER_VIEWER_ALLOWED = [
  ['GET', /^\/orders\/?$/], ['GET', /^\/orders\/\d+\/?$/],
  ['GET', /^\/account\/?$/], ['POST', /^\/account\/?$/],
];
router.use((req, res, next) => {
  if (req.user.role === 'admin') return next();
  if (ORDER_VIEWER_ALLOWED.some(([m, re]) => m === req.method && re.test(req.path))) return next();
  if (req.method === 'GET' && req.path === '/') return res.redirect('/admin/orders');
  res.status(403).send('Bạn không có quyền truy cập chức năng này. <a href="/admin/orders">Về trang đơn hàng</a>');
});
// Chống CSRF cho mọi POST (multer chạy trước để đọc được body multipart)
const csrfCheck = (req, res, next) =>
  req.body && req.body._csrf === req.session.csrf ? next() : res.status(403).send('CSRF token không hợp lệ, vui lòng tải lại trang.');
router.post(/.*/, (req, res, next) => (req.is('multipart/form-data') ? next() : csrfCheck(req, res, next)));

const flash = (req, type, msg) => (req.session.flash = { type, msg });
const allCats = () => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  const byParent = {};
  cats.forEach(c => (byParent[c.parent_id || 0] ||= []).push(c));
  const out = [];
  const walk = (pid, depth) => (byParent[pid] || []).forEach(c => { out.push({ ...c, depth }); walk(c.id, depth + 1); });
  walk(0, 0);
  return out;
};

// ---------- Dashboard ----------
router.get('/', (req, res) => {
  const stats = {
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    categories: db.prepare('SELECT COUNT(*) c FROM categories').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    newOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'new'").get().c,
  };
  stats.newLeads = db.prepare("SELECT COUNT(*) c FROM leads WHERE status = 'new'").get().c;
  stats.leads = db.prepare('SELECT COUNT(*) c FROM leads').get().c;
  stats.monthRevenue = db.prepare("SELECT COALESCE(SUM(total), 0) s FROM orders WHERE status = 'done' AND created_at >= date('now', 'start of month')").get().s;
  stats.activeProducts = db.prepare('SELECT COUNT(*) c FROM products WHERE active = 1').get().c;
  const recent = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 6').all();
  const recentLeads = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 6').all();
  res.render('admin/dashboard', { title: 'Tổng quan', stats, recent, recentLeads });
});

// ---------- Sản phẩm ----------
router.get('/products', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cat = parseInt(req.query.cat) || 0;
  const page = Math.max(1, parseInt(req.query.page) || 1), per = 30;
  const where = ['(p.name LIKE ? OR p.code LIKE ?)'], params = [`%${q}%`, `%${q}%`];
  if (cat) { where.push('p.category_id = ?'); params.push(cat); }
  const w = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) c FROM products p WHERE ${w}`).get(...params).c;
  const products = db.prepare(`SELECT p.*, c.name AS cat_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE ${w} ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...params, per, (page - 1) * per).map(parseProduct);
  res.render('admin/products', { title: 'Sản phẩm', products, q, cat, cats: allCats(), page, pages: Math.ceil(total / per), total });
});

// ---------- Nhập / xuất sản phẩm bằng Excel ----------
const productExcel = require('../lib/product-excel');
const os = require('os');
const fsp = require('fs');
const importUpload = multer({
  dest: path.join(os.tmpdir(), 'shop-import'),
  limits: { fileSize: 10 * 1024 * 1024, files: 301 },
  fileFilter: (req, file, cb) => cb(null, file.fieldname === 'excel'
    ? /\.xlsx$/i.test(file.originalname) : /\.(jpe?g|png|webp|gif)$/i.test(file.originalname)),
}).fields([{ name: 'excel', maxCount: 1 }, { name: 'images', maxCount: 300 }]);
const sendXlsx = (res, buf, name) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(Buffer.from(buf));
};
router.get('/products/import', (req, res) => res.render('admin/product-import', { title: 'Nhập sản phẩm từ Excel', result: null, opts: {} }));
router.get('/products/import/template.xlsx', async (req, res, next) => {
  try { sendXlsx(res, await productExcel.buildTemplate(), 'mau-nhap-san-pham.xlsx'); } catch (e) { next(e); }
});
router.get('/products/export.xlsx', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim(), cat = parseInt(req.query.cat) || 0;
    const products = db.prepare(`SELECT * FROM products WHERE (name LIKE ? OR code LIKE ?) ${cat ? 'AND category_id = ' + cat : ''} ORDER BY id`).all(`%${q}%`, `%${q}%`);
    sendXlsx(res, await productExcel.buildExport(products), `san-pham-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { next(e); }
});
// Bấm "Kiểm tra trước": file được giữ tạm (lưu trong phiên) để bấm "Nhập" ngay mà không phải chọn lại
const dropJob = job => job && [job.excel, ...job.images].forEach(f => fsp.unlink(f.path, () => {}));
router.post('/products/import', (req, res, next) => importUpload(req, res, err => {
  const uploaded = [].concat(...Object.values(req.files || {}));
  const render = (result, opts, hasJob = false) => res.render('admin/product-import', { title: 'Nhập sản phẩm từ Excel', result, opts, hasJob });
  const opts = { onDuplicate: req.body && req.body.on_duplicate === 'skip' ? 'skip' : 'update' };
  const fail = msg => { uploaded.forEach(f => fsp.unlink(f.path, () => {})); render({ error: msg }, opts); };
  if (err) return fail(err.code === 'LIMIT_FILE_SIZE' ? 'Có file lớn hơn 10MB.' : err.code === 'LIMIT_FILE_COUNT' ? 'Chọn tối đa 300 ảnh mỗi lần.' : 'Lỗi tải file: ' + err.message);
  if (!req.body || req.body._csrf !== req.session.csrf) { uploaded.forEach(f => fsp.unlink(f.path, () => {})); return res.status(403).send('CSRF token không hợp lệ, vui lòng tải lại trang.'); }
  const pick = f => ({ path: f.path, originalname: f.originalname });
  let job;
  const excel = req.files && req.files.excel && req.files.excel[0];
  if (excel) { dropJob(req.session.importJob); job = { excel: pick(excel), images: (req.files.images || []).map(pick), opts }; }
  else if (req.body.use_job && req.session.importJob && fsp.existsSync(req.session.importJob.excel.path)) job = req.session.importJob;
  else return fail('Chưa chọn file Excel (.xlsx).');
  const dryRun = req.body.mode !== 'import';
  productExcel.importProducts(job.excel.path, { ...job.opts, files: job.images, dryRun })
    .then(result => {
      if (dryRun) req.session.importJob = job;
      else { dropJob(job); delete req.session.importJob; }
      render(result, job.opts, dryRun);
    })
    .catch(e => { dropJob(job); delete req.session.importJob; render({ error: e.message }, job.opts); });
}));

router.get('/products/new', (req, res) =>
  res.render('admin/product-form', { title: 'Thêm sản phẩm', p: parseProduct({ active: 1, images: '[]', variants: '[]' }), cats: allCats() }));

router.get('/products/:id/edit', (req, res) => {
  const p = parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  if (!p) return res.redirect('/admin/products');
  // Số SP trực tiếp trong từng danh mục + tổng: để form hiện "sẽ áp dụng cho N sản phẩm"
  const catCounts = {};
  db.prepare('SELECT category_id, COUNT(*) c FROM products WHERE category_id IS NOT NULL GROUP BY category_id').all().forEach(r => (catCounts[r.category_id] = r.c));
  const totalProducts = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  res.render('admin/product-form', { title: 'Sửa sản phẩm', p, cats: allCats(), catCounts, totalProducts });
});

function productData(req, id = 0) {
  const b = req.body;
  const images = String(b.images || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  (req.files || []).forEach(f => images.push('/uploads/' + f.filename));
  const num = x => parseInt(String(x || '').replace(/\D/g, '')) || 0;
  const list = k => [].concat(b[k + '[]'] ?? b[k] ?? []);
  const vNames = list('v_name'), vPrices = list('v_price'), vSales = list('v_sale');
  const variants = vNames.map((n, i) => ({ name: String(n).trim(), price: num(vPrices[i]), sale_price: num(vSales[i]) }))
    .filter(v => v.name && v.price > 0)
    .map(v => (v.sale_price > 0 && v.sale_price < v.price ? v : { name: v.name, price: v.price }));
  // Có biến thể: giá chung lấy theo biến thể đầu tiên (để danh sách / sắp xếp theo giá vẫn đúng)
  const price = variants.length ? variants[0].price : num(b.price);
  const sale = variants.length ? (variants[0].sale_price || 0) : num(b.sale_price);
  return {
    name: b.name.trim(), code: (b.code || '').trim(),
    slug: uniqueSlug('products', b.slug || `${b.name} ${b.code || ''}`, id),
    category_id: parseInt(b.category_id) || null,
    price, sale_price: sale,
    variants: JSON.stringify(variants), images: JSON.stringify(images),
    short_desc: b.short_desc || '', description: String(b.description || '').replace(/\r\n?/g, '\n').trim(), vendor: b.vendor || '',
    featured: b.featured ? 1 : 0, is_new: b.is_new ? 1 : 0, active: b.active ? 1 : 0,
    meta_title: b.meta_title || '', meta_desc: b.meta_desc || '',
  };
}

router.post('/products', upload.array('upload', 10), csrfCheck, (req, res) => {
  if (!req.body.name) { flash(req, 'error', 'Tên sản phẩm là bắt buộc'); return res.redirect('/admin/products/new'); }
  const d = productData(req);
  const cols = Object.keys(d);
  db.prepare(`INSERT INTO products(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(d));
  flash(req, 'success', 'Đã thêm sản phẩm');
  res.redirect('/admin/products');
});

// Áp dụng mô tả ngắn / mô tả chi tiết (nội dung đang gõ trong form sửa SP) cho nhiều sản phẩm: tất cả hoặc theo danh mục
// Nút nằm trong form sửa SP (formaction) nên nhận cả form multipart; ảnh chọn kèm (nếu có) bị bỏ qua.
const bulkBody = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10 } }).any();
router.post('/products/bulk-desc', bulkBody, csrfCheck, (req, res) => {
  const b = req.body;
  const back = /^\d+$/.test(b.pid || '') ? `/admin/products/${b.pid}/edit` : '/admin/products';
  const fields = [].concat(b['bulk_fields[]'] ?? b.bulk_fields ?? []);
  const sets = {};
  if (fields.includes('short')) sets.short_desc = String(b.short_desc || '').trim();
  if (fields.includes('long')) sets.description = String(b.description || '').replace(/\r\n?/g, '\n').trim();
  if (!Object.keys(sets).length) { flash(req, 'error', 'Chưa chọn áp dụng Mô tả ngắn hay Mô tả chi tiết.'); return res.redirect(back); }

  let where = '', params = [];
  if (b.bulk_scope !== 'all') {
    // danh mục được chọn + toàn bộ danh mục con cháu
    const picked = new Set([].concat(b['bulk_cats[]'] ?? b.bulk_cats ?? []).map(Number).filter(Boolean));
    if (!picked.size) { flash(req, 'error', 'Chưa chọn danh mục nào để áp dụng.'); return res.redirect(back); }
    const cats = db.prepare('SELECT id, parent_id FROM categories').all();
    let grew = true;
    while (grew) { grew = false; cats.forEach(c => { if (c.parent_id && picked.has(c.parent_id) && !picked.has(c.id)) { picked.add(c.id); grew = true; } }); }
    params = [...picked];
    where = ` WHERE category_id IN (${params.map(() => '?').join(',')})`;
  }
  const cols = Object.keys(sets);
  const n = db.prepare(`UPDATE products SET ${cols.map(k => k + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP${where}`)
    .run(...cols.map(k => sets[k]), ...params).changes;
  const what = cols.length === 2 ? 'mô tả ngắn và mô tả chi tiết' : cols[0] === 'short_desc' ? 'mô tả ngắn' : 'mô tả chi tiết';
  flash(req, 'success', `Đã áp dụng ${what} cho ${n} sản phẩm.`);
  res.redirect(back);
});

router.post('/products/:id', upload.array('upload', 10), csrfCheck, (req, res) => {
  const id = +req.params.id;
  if (!req.body.name) { flash(req, 'error', 'Tên sản phẩm là bắt buộc'); return res.redirect(`/admin/products/${id}/edit`); }
  const d = productData(req, id);
  db.prepare(`UPDATE products SET ${Object.keys(d).map(k => k + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...Object.values(d), id);
  flash(req, 'success', 'Đã lưu sản phẩm');
  res.redirect(`/admin/products/${id}/edit`);
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Đã xóa sản phẩm');
  res.redirect('/admin/products');
});

router.post('/products/:id/duplicate', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (p) {
    delete p.id; delete p.created_at; delete p.updated_at;
    p.name += ' (bản sao)'; p.slug = uniqueSlug('products', p.name); p.active = 0;
    const cols = Object.keys(p);
    const id = db.prepare(`INSERT INTO products(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(p)).lastInsertRowid;
    flash(req, 'success', 'Đã nhân bản (đang ẩn)');
    return res.redirect(`/admin/products/${id}/edit`);
  }
  res.redirect('/admin/products');
});

// ---------- Danh mục ----------
router.get('/categories', (req, res) => {
  const counts = {};
  db.prepare('SELECT category_id, COUNT(*) c FROM products GROUP BY category_id').all().forEach(r => (counts[r.category_id] = r.c));
  res.render('admin/categories', { title: 'Danh mục', cats: allCats(), counts });
});
router.get('/categories/new', (req, res) => res.render('admin/category-form', { title: 'Thêm danh mục', c: {}, cats: allCats() }));
router.get('/categories/:id/edit', (req, res) => {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/admin/categories');
  res.render('admin/category-form', { title: 'Sửa danh mục', c, cats: allCats().filter(x => x.id !== c.id) });
});
function catData(req, id = 0) {
  const b = req.body;
  let parent = parseInt(b.parent_id) || null;
  if (parent === id) parent = null;
  return {
    name: b.name.trim(), slug: uniqueSlug('categories', b.slug || b.name, id), parent_id: parent,
    image: req.file ? '/uploads/' + req.file.filename : (b.image || ''),
    description: String(b.description || '').replace(/\r\n?/g, '\n').trim(), sort_order: parseInt(b.sort_order) || 0, show_home: b.show_home ? 1 : 0,
    show_menu: b.show_menu ? 1 : 0,
  };
}
router.post('/categories', upload.single('upload'), csrfCheck, (req, res) => {
  if (!req.body.name) return res.redirect('/admin/categories/new');
  const d = catData(req);
  db.prepare(`INSERT INTO categories(${Object.keys(d).join(',')}) VALUES(${Object.keys(d).map(() => '?').join(',')})`).run(...Object.values(d));
  flash(req, 'success', 'Đã thêm danh mục');
  res.redirect('/admin/categories');
});
router.post('/categories/:id', upload.single('upload'), csrfCheck, (req, res) => {
  const id = +req.params.id;
  const d = catData(req, id);
  db.prepare(`UPDATE categories SET ${Object.keys(d).map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...Object.values(d), id);
  flash(req, 'success', 'Đã lưu danh mục');
  res.redirect('/admin/categories');
});
router.post('/categories/:id/delete', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Đã xóa danh mục (sản phẩm và danh mục con được giữ lại, không còn gắn danh mục này)');
  res.redirect('/admin/categories');
});

// ---------- Đơn hàng ----------
// Danh sách có lọc theo trạng thái + tìm kiếm, kèm số lượng từng trạng thái cho thanh tab
function listWithStatus(table, statuses, req, searchCols) {
  const status = statuses[req.query.status] ? req.query.status : '';
  const q = String(req.query.q || '').trim();
  const where = [], params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (q) { where.push('(' + searchCols.map(c => c + ' LIKE ?').join(' OR ') + ')'); searchCols.forEach(() => params.push('%' + q + '%')); }
  const rows = db.prepare(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 1000`).all(...params);
  const counts = { all: 0 };
  db.prepare(`SELECT status, COUNT(*) c FROM ${table} GROUP BY status`).all().forEach(r => { counts[r.status] = r.c; counts.all += r.c; });
  return { rows, counts, status, q };
}
router.get('/orders', (req, res) => {
  const { rows, counts, status, q } = listWithStatus('orders', ORDER_STATUSES, req, ['customer_name', 'phone', 'CAST(id AS TEXT)']);
  res.render('admin/orders', { title: 'Đơn hàng', orders: rows, counts, status, q });
});
router.get('/orders/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.redirect('/admin/orders');
  o.items = JSON.parse(o.items || '[]');
  res.render('admin/order', { title: 'Đơn hàng #' + o.id, o });
});
router.post('/orders/:id', (req, res) => {
  if (ORDER_STATUSES[req.body.status]) db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
  flash(req, 'success', 'Đã cập nhật trạng thái');
  res.redirect('/admin/orders/' + req.params.id);
});
router.post('/orders/:id/delete', (req, res) => {
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Đã xóa đơn hàng');
  res.redirect('/admin/orders');
});

// ---------- Khách đăng ký nhận ưu đãi ----------
router.get('/leads', (req, res) => {
  const { rows, counts, status, q } = listWithStatus('leads', LEAD_STAGES, req, ['name', 'phone', 'email', 'note']);
  const pages = {};
  db.prepare('SELECT slug, title FROM pages').all().forEach(p => { pages[p.slug] = p.title; });
  res.render('admin/leads', { title: 'Đăng ký ưu đãi', leads: rows, counts, status, q, pages });
});
// quay lại đúng bộ lọc đang xem (chỉ cho phép đường dẫn /admin/leads…)
const backTo = (req, def) => (/^\/admin\/leads(\?[^\s]*)?$/.test(req.body.back || '') ? req.body.back : def);
router.post('/leads/:id', (req, res) => {
  if (LEAD_STAGES[req.body.status]) {
    db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(req.body.status, req.params.id);
    flash(req, 'success', 'Đã chuyển sang "' + LEAD_STAGES[req.body.status].label + '"');
  }
  res.redirect(backTo(req, '/admin/leads'));
});
router.post('/leads/:id/delete', (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Đã xóa đăng ký');
  res.redirect(backTo(req, '/admin/leads'));
});

// ---------- Trang nội dung (chính sách, liên hệ...) ----------
// ---------- Đánh giá khách hàng ----------
const productOptions = () => db.prepare("SELECT id, name, code FROM products ORDER BY active DESC, name").all();
router.get('/reviews', (req, res) => {
  const reviews = db.prepare(`SELECT r.*, p.name AS product_name, p.slug AS product_slug FROM reviews r
    LEFT JOIN products p ON p.id = r.product_id ORDER BY r.sort_order, r.id DESC`).all();
  res.render('admin/reviews', { title: 'Đánh giá khách hàng', reviews });
});
router.get('/reviews/new', (req, res) =>
  res.render('admin/review-form', { title: 'Thêm đánh giá', r: { rating: 5, show_home: 1, active: 1 }, products: productOptions() }));
router.get('/reviews/:id/edit', (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!r) return res.redirect('/admin/reviews');
  res.render('admin/review-form', { title: 'Sửa đánh giá', r, products: productOptions() });
});
function reviewData(req) {
  const b = req.body;
  const pid = parseInt(b.product_id) || null;
  return {
    name: String(b.name || '').trim().slice(0, 100), location: String(b.location || '').trim().slice(0, 100),
    rating: Math.min(5, Math.max(1, parseInt(b.rating) || 5)),
    content: String(b.content || '').replace(/\r\n?/g, '\n').trim().slice(0, 2000),
    image: req.file ? '/uploads/' + req.file.filename : (b.remove_image ? '' : String(b.image || '').trim()),
    product_id: pid && db.prepare('SELECT 1 FROM products WHERE id = ?').get(pid) ? pid : null,
    show_home: b.show_home ? 1 : 0, active: b.active ? 1 : 0, sort_order: parseInt(b.sort_order) || 0,
  };
}
router.post('/reviews', upload.single('upload'), csrfCheck, (req, res) => {
  const d = reviewData(req);
  if (!d.name || !d.content) { flash(req, 'error', 'Cần nhập tên khách hàng và nội dung đánh giá'); return res.redirect('/admin/reviews/new'); }
  db.prepare(`INSERT INTO reviews(${Object.keys(d).join(',')}) VALUES(${Object.keys(d).map(() => '?').join(',')})`).run(...Object.values(d));
  flash(req, 'success', 'Đã thêm đánh giá');
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id', upload.single('upload'), csrfCheck, (req, res) => {
  const id = +req.params.id, d = reviewData(req);
  if (!d.name || !d.content) { flash(req, 'error', 'Cần nhập tên khách hàng và nội dung đánh giá'); return res.redirect(`/admin/reviews/${id}/edit`); }
  db.prepare(`UPDATE reviews SET ${Object.keys(d).map(k => k + ' = ?').join(', ')} WHERE id = ?`).run(...Object.values(d), id);
  flash(req, 'success', 'Đã lưu đánh giá');
  res.redirect('/admin/reviews');
});
router.post('/reviews/:id/delete', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Đã xóa đánh giá');
  res.redirect('/admin/reviews');
});

router.get('/pages', (req, res) => res.render('admin/pages', { title: 'Trang nội dung', pages: db.prepare('SELECT * FROM pages ORDER BY id').all() }));
router.get('/pages/new', (req, res) => res.render('admin/page-form', { title: 'Thêm trang', pg: { active: 1 } }));
router.get('/pages/:id/edit', (req, res) => {
  const pg = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!pg) return res.redirect('/admin/pages');
  res.render('admin/page-form', { title: 'Sửa trang', pg });
});
const pageData = (b, id = 0) => [b.title.trim(), uniqueSlug('pages', b.slug || b.title, id), String(b.content || '').replace(/\r\n?/g, '\n').trim(), b.footer_group || '', b.active ? 1 : 0];
router.post('/pages', (req, res) => {
  if (!req.body.title) return res.redirect('/admin/pages/new');
  db.prepare('INSERT INTO pages(title, slug, content, footer_group, active) VALUES(?,?,?,?,?)').run(...pageData(req.body));
  flash(req, 'success', 'Đã thêm trang');
  res.redirect('/admin/pages');
});
router.post('/pages/:id', (req, res) => {
  db.prepare('UPDATE pages SET title=?, slug=?, content=?, footer_group=?, active=? WHERE id=?').run(...pageData(req.body, +req.params.id), req.params.id);
  flash(req, 'success', 'Đã lưu trang');
  res.redirect('/admin/pages');
});
router.post('/pages/:id/delete', (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  flash(req, 'success', 'Đã xóa trang');
  res.redirect('/admin/pages');
});

// ---------- Cài đặt chung + Mã nhúng Header/Footer ----------
const SETTING_KEYS = ['site_name', 'hotline', 'email', 'address', 'company_name', 'company_info', 'about',
  'facebook', 'instagram', 'youtube', 'zalo', 'meta_title', 'meta_desc', 'video_url', 'site_url'];
const CODE_KEYS = ['head_code', 'body_code', 'footer_code', 'custom_css'];

router.get('/settings', (req, res) => res.render('admin/settings', { title: 'Cài đặt website' }));
router.post('/settings', upload.none(), csrfCheck, (req, res) => {
  SETTING_KEYS.forEach(k => setSetting(k, req.body[k]));
  flash(req, 'success', 'Đã lưu cài đặt');
  res.redirect('/admin/settings');
});

// ---------- Logo & Banner ----------
// Ảnh: tải file mới > nhập URL > giữ nguyên; tick "Xóa" để bỏ ảnh
const BRAND_IMAGES = { logo: 'logo_file', favicon: 'favicon_file', hero_image: 'hero_file', hero_image_mobile: 'hero_mobile_file' };
const BRAND_TEXT = ['hero_title', 'hero_subtitle', 'hero_button', 'hero_link', 'hero_alt'];
const clampInt = (v, min, max, def) => { const n = parseInt(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
router.get('/branding', (req, res) => res.render('admin/branding', { title: 'Logo & Banner' }));
// Slider: mỗi slide có mã riêng (slide_id[]), trường đặt tên slide_<field>_<id>, giữ đúng thứ tự trên form
const SLIDE_TEXT = ['alt', 'title', 'subtitle', 'button', 'link'];
const toArr = v => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
router.post('/branding', upload.any(), csrfCheck, (req, res) => {
  const f = {}, b = req.body;
  (req.files || []).forEach(x => { f[x.fieldname] = '/uploads/' + x.filename; });
  // Ảnh: file mới > tick xóa > URL nhập
  const pickImage = (urlName, fileName, removeName) =>
    f[fileName] || (b[removeName] ? '' : String(b[urlName] || '').trim());
  for (const [key, field] of Object.entries(BRAND_IMAGES)) {
    if (f[field] || b['remove_' + key] || b[key] !== undefined) setSetting(key, pickImage(key, field, 'remove_' + key));
  }
  BRAND_TEXT.forEach(k => setSetting(k, String(b[k] || '').trim()));

  const slides = toArr(b.slide_id).map(id => String(id).replace(/[^a-z0-9]/gi, '')).filter(Boolean).map(id => {
    const s = {
      image: pickImage(`slide_image_${id}`, `slide_file_${id}`, `slide_remove_image_${id}`),
      image_mobile: pickImage(`slide_image_mobile_${id}`, `slide_mfile_${id}`, `slide_remove_image_mobile_${id}`),
    };
    SLIDE_TEXT.forEach(k => { s[k] = String(b[`slide_${k}_${id}`] || '').trim(); });
    return s;
  }).filter(s => s.image); // slide không có ảnh thì bỏ
  setSetting('hero_slides', JSON.stringify(slides));
  setSetting('hero_mode', b.hero_mode === 'slider' ? 'slider' : 'static');
  setSetting('hero_interval', clampInt(b.hero_interval, 3, 15, 5));
  setSetting('logo_height', clampInt(b.logo_height, 24, 90, 48));
  setSetting('hero_overlay', clampInt(b.hero_overlay, 0, 85, 55));
  setSetting('hero_height', clampInt(b.hero_height, 40, 100, 78));
  if (b.hero_mode === 'slider' && !slides.length) flash(req, 'warn', 'Đã lưu, nhưng slider chưa có slide nào có ảnh nên trang chủ đang hiện banner tĩnh');
  else flash(req, 'success', 'Đã lưu logo & banner');
  res.redirect('/admin/branding');
});

router.get('/code', (req, res) => res.render('admin/code', { title: 'Mã nhúng Header / Footer' }));
router.post('/code', (req, res) => {
  CODE_KEYS.forEach(k => setSetting(k, req.body[k]));
  flash(req, 'success', 'Đã lưu mã nhúng');
  res.redirect('/admin/code');
});

// ---------- Cấu hình email thông báo đơn hàng ----------
const MAIL_KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'mail_from', 'mail_from_name', 'mail_to'];
router.get('/mail', (req, res) => res.render('admin/mail', { title: 'Cấu hình email', hasPass: !!getSettings().smtp_pass }));
router.post('/mail', (req, res) => {
  MAIL_KEYS.forEach(k => setSetting(k, String(req.body[k] || '').trim()));
  setSetting('mail_enabled', req.body.mail_enabled ? '1' : '0');
  setSetting('mail_customer', req.body.mail_customer ? '1' : '0');
  setSetting('smtp_secure', req.body.smtp_secure ? '1' : '0');
  if (req.body.smtp_pass) setSetting('smtp_pass', req.body.smtp_pass); // để trống = giữ mật khẩu cũ
  flash(req, 'success', 'Đã lưu cấu hình email');
  res.redirect('/admin/mail');
});
router.post('/mail/test', async (req, res) => {
  try {
    const to = await sendTestMail();
    flash(req, 'success', 'Đã gửi email thử tới: ' + to.join(', '));
  } catch (e) {
    flash(req, 'error', 'Gửi thử thất bại: ' + e.message);
  }
  res.redirect('/admin/mail');
});

// ---------- Người dùng & phân quyền ----------
const ROLES = { admin: 'Quản trị (toàn quyền)', orders: 'Chỉ xem đơn hàng' };
const adminCount = (excludeId = 0) => db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(excludeId).c;

router.get('/users', (req, res) =>
  res.render('admin/users', { title: 'Người dùng', users: db.prepare('SELECT * FROM users ORDER BY id').all(), ROLES }));
router.get('/users/new', (req, res) => res.render('admin/user-form', { title: 'Thêm người dùng', u: { role: 'orders', active: 1 }, ROLES }));
router.get('/users/:id/edit', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.redirect('/admin/users');
  res.render('admin/user-form', { title: 'Sửa người dùng', u, ROLES });
});
router.post('/users', (req, res) => {
  const b = req.body, username = String(b.username || '').trim();
  const back = (msg) => { flash(req, 'error', msg); res.redirect('/admin/users/new'); };
  if (!username) return back('Tên đăng nhập là bắt buộc');
  if (!b.password || b.password.length < 6) return back('Mật khẩu tối thiểu 6 ký tự');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return back('Tên đăng nhập đã tồn tại');
  db.prepare('INSERT INTO users(username, password, name, role, active) VALUES(?,?,?,?,?)')
    .run(username, hashPassword(b.password), String(b.name || '').trim(), ROLES[b.role] ? b.role : 'orders', b.active ? 1 : 0);
  flash(req, 'success', 'Đã thêm người dùng ' + username);
  res.redirect('/admin/users');
});
router.post('/users/:id', (req, res) => {
  const id = +req.params.id, b = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.redirect('/admin/users');
  const back = (msg) => { flash(req, 'error', msg); res.redirect(`/admin/users/${id}/edit`); };
  const username = String(b.username || '').trim();
  const role = ROLES[b.role] ? b.role : 'orders', active = b.active ? 1 : 0;
  if (!username) return back('Tên đăng nhập là bắt buộc');
  if (db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id)) return back('Tên đăng nhập đã tồn tại');
  if (b.password && b.password.length < 6) return back('Mật khẩu tối thiểu 6 ký tự');
  if ((role !== 'admin' || !active) && u.role === 'admin' && !adminCount(id)) return back('Phải còn ít nhất một tài khoản quản trị đang hoạt động');
  db.prepare('UPDATE users SET username = ?, name = ?, role = ?, active = ? WHERE id = ?').run(username, String(b.name || '').trim(), role, active, id);
  if (b.password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(b.password), id);
  flash(req, 'success', 'Đã lưu người dùng');
  res.redirect('/admin/users');
});
router.post('/users/:id/delete', (req, res) => {
  const id = +req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) return res.redirect('/admin/users');
  if (id === req.user.id) flash(req, 'error', 'Không thể xóa tài khoản đang đăng nhập');
  else if (u.role === 'admin' && !adminCount(id)) flash(req, 'error', 'Phải còn ít nhất một tài khoản quản trị');
  else { db.prepare('DELETE FROM users WHERE id = ?').run(id); flash(req, 'success', 'Đã xóa người dùng ' + u.username); }
  res.redirect('/admin/users');
});

// ---------- Tài khoản của tôi ----------
router.get('/account', (req, res) => res.render('admin/account', { title: 'Tài khoản' }));
router.post('/account', (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { username, current, password, confirm } = req.body;
  const newName = String(username || '').trim();
  if (!verifyPassword(current || '', me.password)) flash(req, 'error', 'Mật khẩu hiện tại không đúng');
  else if (password && password.length < 6) flash(req, 'error', 'Mật khẩu mới tối thiểu 6 ký tự');
  else if (password !== confirm) flash(req, 'error', 'Xác nhận mật khẩu không khớp');
  else if (newName && db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newName, me.id)) flash(req, 'error', 'Tên đăng nhập đã tồn tại');
  else {
    if (newName) db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newName, me.id);
    if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), me.id);
    flash(req, 'success', 'Đã cập nhật tài khoản');
  }
  res.redirect('/admin/account');
});

module.exports = router;
