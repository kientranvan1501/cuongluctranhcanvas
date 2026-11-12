const router = require('express').Router();
const { db, parseProduct } = require('../db');
const { sendOrderMail, sendLeadMail } = require('../mailer');

const PER_PAGE = 24;
const productList = (where, params = [], limit = 12, offset = 0, order = 'p.id DESC') =>
  db.prepare(`SELECT p.* FROM products p WHERE p.active = 1 ${where ? 'AND ' + where : ''} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(parseProduct);

// Lấy id danh mục và toàn bộ danh mục con
function descendantIds(id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++)
    db.prepare('SELECT id FROM categories WHERE parent_id = ?').all(ids[i]).forEach(r => ids.push(r.id));
  return ids;
}

router.get('/', (req, res) => {
  const featured = productList('p.featured = 1', [], 12);
  const newest = productList('p.is_new = 1', [], 12);
  const homeCats = db.prepare('SELECT * FROM categories WHERE show_home = 1 ORDER BY sort_order').all();
  const sonDau = db.prepare("SELECT * FROM categories WHERE slug = 'tranh-son-dau'").get();
  const sonDauProducts = sonDau ? productList(`p.category_id IN (${descendantIds(sonDau.id).join(',')})`, [], 8) : [];
  res.render('home', { title: null, featured, newest, homeCats, sonDau, sonDauProducts });
});

function renderListing(res, req, { title, description = '', where = '', params = [], category = null, subcats = [] }) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const sorts = { new: 'p.id DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', name: 'p.name ASC' };
  const sort = sorts[req.query.sort] ? req.query.sort : 'new';
  const total = db.prepare(`SELECT COUNT(*) c FROM products p WHERE p.active = 1 ${where ? 'AND ' + where : ''}`).get(...params).c;
  const products = productList(where, params, PER_PAGE, (page - 1) * PER_PAGE, sorts[sort]);
  res.render('category', { title, description, products, category, subcats, page, pages: Math.ceil(total / PER_PAGE), total, sort, q: req.query.q || '' });
}

router.get('/shop', (req, res) => renderListing(res, req, { title: 'Tất Cả Sản Phẩm' }));
router.get('/best-sellers', (req, res) => renderListing(res, req, { title: 'Sản Phẩm Nổi Bật', where: 'p.featured = 1' }));
router.get('/bst-moi', (req, res) => renderListing(res, req, { title: 'BST Tranh Mới', where: 'p.is_new = 1' }));
router.get('/collections', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  res.render('collections', { title: 'Bộ Sưu Tập', cats });
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  renderListing(res, req, { title: q ? `Kết quả tìm kiếm: "${q}"` : 'Tìm kiếm', where: '(p.name LIKE ? OR p.code LIKE ?)', params: [`%${q}%`, `%${q}%`] });
});

router.get('/danh-muc/:slug', (req, res, next) => {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return next();
  const subcats = db.prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order').all(category.id);
  renderListing(res, req, { title: category.name, description: category.description, category, subcats,
    where: `p.category_id IN (${descendantIds(category.id).join(',')})` });
});

router.get('/san-pham/:slug', (req, res, next) => {
  const product = parseProduct(db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug));
  if (!product) return next();
  const category = product.category_id ? db.prepare('SELECT * FROM categories WHERE id = ?').get(product.category_id) : null;
  const related = product.category_id ? productList('p.category_id = ? AND p.id != ?', [product.category_id, product.id], 8) : [];
  res.render('product', { title: product.meta_title || product.name, metaDesc: product.meta_desc || product.short_desc, product, category, related });
});

router.get('/trang/:slug', (req, res, next) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!page) return next();
  const promoMsg = req.session.promoMsg; delete req.session.promoMsg;
  res.render('page', { title: page.title, page, promoMsg });
});

// Form đăng ký nhận ưu đãi (mã [form_uu_dai] trong trang nội dung)
const leadHits = new Map(); // chống spam đơn giản: tối đa 5 lần / 10 phút / IP
router.post('/dang-ky-uu-dai', (req, res) => {
  const b = req.body;
  const src = /^[a-z0-9-]{1,100}$/.test(b.source || '') ? b.source : '';
  const back = (type, msg) => { req.session.promoMsg = { type, msg }; res.redirect((src ? '/trang/' + src : '/') + '#uu-dai'); };
  if (b.website) return back('success', 'Cảm ơn bạn đã đăng ký!'); // bẫy bot (ô ẩn)
  const now = Date.now(), hits = (leadHits.get(req.ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (hits.length >= 5) return back('error', 'Bạn đã gửi quá nhiều lần, vui lòng thử lại sau ít phút.');
  const lead = {
    name: String(b.name || '').trim().slice(0, 100), phone: String(b.phone || '').trim().slice(0, 20),
    email: String(b.email || '').trim().slice(0, 120), need: String(b.need || '').trim().slice(0, 50),
    note: String(b.note || '').trim().slice(0, 1000), source: src,
  };
  if (!lead.name || !/^[0-9 .+]{8,15}$/.test(lead.phone)) return back('error', 'Vui lòng nhập họ tên và số điện thoại hợp lệ.');
  hits.push(now); leadHits.set(req.ip, hits);
  lead.id = db.prepare('INSERT INTO leads(name, phone, email, need, note, source) VALUES(?,?,?,?,?,?)')
    .run(lead.name, lead.phone, lead.email, lead.need, lead.note, lead.source).lastInsertRowid;
  sendLeadMail(lead, `${req.protocol}://${req.get('host')}`);
  back('success', 'Cảm ơn bạn đã đăng ký! Chúng tôi sẽ liên hệ và gửi ưu đãi trong thời gian sớm nhất.');
});

// Giỏ hàng lưu ở trình duyệt (localStorage); trang này chỉ hiển thị + gửi đơn
router.get('/gio-hang', (req, res) => res.render('cart', { title: 'Giỏ hàng' }));

router.post('/dat-hang', (req, res) => {
  const { customer_name, phone, email, address, note } = req.body;
  let items = [];
  try { items = JSON.parse(req.body.items || '[]'); } catch {}
  if (!customer_name || !phone || !items.length) {
    return res.status(400).render('cart', { title: 'Giỏ hàng', error: 'Vui lòng nhập họ tên, số điện thoại và chọn sản phẩm.' });
  }
  // Tính lại giá phía server, không tin giá từ trình duyệt
  const clean = [];
  let total = 0;
  for (const it of items.slice(0, 50)) {
    const p = parseProduct(db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(+it.id));
    if (!p) continue;
    const v = p.variants.find(v => v.name === it.variant);
    const price = v ? +v.price : (p.sale_price || p.price);
    const qty = Math.max(1, Math.min(99, parseInt(it.qty) || 1));
    clean.push({ id: p.id, name: p.name, code: p.code, variant: v ? v.name : '', price, qty });
    total += price * qty;
  }
  if (!clean.length) return res.status(400).render('cart', { title: 'Giỏ hàng', error: 'Sản phẩm không hợp lệ.' });
  const id = db.prepare('INSERT INTO orders(customer_name, phone, email, address, note, items, total) VALUES(?,?,?,?,?,?,?)')
    .run(customer_name, phone, email || '', address || '', note || '', JSON.stringify(clean), total).lastInsertRowid;
  // Gửi mail chạy nền, không bắt khách chờ
  sendOrderMail({ id, customer_name, phone, email: email || '', address: address || '', note: note || '', items: clean, total },
    `${req.protocol}://${req.get('host')}`);
  res.render('thank-you', { title: 'Đặt hàng thành công', orderId: id });
});

module.exports = router;
