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

// ---------- SEO helpers ----------
// Breadcrumb JSON-LD: items = [{ name, url }] (url tương đối)
const breadcrumbLd = (res, items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: res.locals.baseUrl + it.url })),
});
// Chuỗi danh mục cha -> con (để làm breadcrumb)
function categoryTrail(cat) {
  const trail = [];
  for (let c = cat, guard = 0; c && guard < 10; guard++) {
    trail.unshift(c);
    c = c.parent_id ? db.prepare('SELECT * FROM categories WHERE id = ?').get(c.parent_id) : null;
  }
  return trail;
}

router.get('/', (req, res) => {
  const featured = productList('p.featured = 1', [], 12);
  const newest = productList('p.is_new = 1', [], 12);
  const homeCats = db.prepare('SELECT * FROM categories WHERE show_home = 1 ORDER BY sort_order').all();
  const sonDau = db.prepare("SELECT * FROM categories WHERE slug = 'tranh-son-dau'").get();
  const sonDauProducts = sonDau ? productList(`p.category_id IN (${descendantIds(sonDau.id).join(',')})`, [], 8) : [];
  const s = res.locals.settings, base = res.locals.baseUrl;
  // Banner: slider (khi bật và có slide) hoặc 1 ảnh tĩnh
  let heroSlides = [];
  if (s.hero_mode === 'slider') { try { heroSlides = JSON.parse(s.hero_slides || '[]').filter(x => x && x.image); } catch (e) { /* JSON hỏng -> banner tĩnh */ } }
  const sameAs = [s.facebook, s.instagram, s.youtube].filter(u => /^https?:\/\//.test(u || ''));
  res.locals.seo = {
    canonical: '/',
    ...(heroSlides.length ? { image: heroSlides[0].image } : {}),
    jsonld: [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: s.site_name, url: base + '/' },
      {
        '@context': 'https://schema.org', '@type': 'Organization', name: s.company_name || s.site_name, url: base + '/',
        ...(s.logo ? { logo: res.locals.absUrl(s.logo) } : {}),
        ...(s.email ? { email: s.email } : {}),
        ...(s.hotline ? { telephone: s.hotline, contactPoint: [{ '@type': 'ContactPoint', telephone: s.hotline, contactType: 'customer service', areaServed: 'VN', availableLanguage: 'Vietnamese' }] } : {}),
        ...(s.address ? { address: { '@type': 'PostalAddress', streetAddress: s.address, addressCountry: 'VN' } } : {}),
        ...(sameAs.length ? { sameAs } : {}),
      },
    ],
  };
  res.render('home', { title: null, heroSlides, featured, newest, homeCats, sonDau, sonDauProducts });
});

function renderListing(res, req, { title, description = '', where = '', params = [], category = null, subcats = [], trail = [], seo = {} }) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const sorts = { new: 'p.id DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', name: 'p.name ASC' };
  const sort = sorts[req.query.sort] ? req.query.sort : 'new';
  const total = db.prepare(`SELECT COUNT(*) c FROM products p WHERE p.active = 1 ${where ? 'AND ' + where : ''}`).get(...params).c;
  const pages = Math.ceil(total / PER_PAGE);
  if (page > 1 && page > pages) { // trang phân trang không tồn tại
    res.locals.seo = { noindex: true, canonical: false };
    return res.status(404).render('404', { title: 'Không tìm thấy trang' });
  }
  const products = productList(where, params, PER_PAGE, (page - 1) * PER_PAGE, sorts[sort]);
  // Canonical bỏ tham số sắp xếp, giữ số trang; trang 2+ có tiêu đề riêng để không trùng lặp
  res.locals.seo = { canonical: req.path + (page > 1 ? '?page=' + page : ''), ...seo };
  res.render('category', { title: page > 1 ? `${title} - Trang ${page}` : title, heading: title, metaDesc: description ? res.locals.plain(description) : '',
    description: page > 1 ? '' : description, products, category, subcats, trail, page, pages, total, sort, q: req.query.q || '' });
}

const listingDesc = (res, what) => `${what} tại ${res.locals.settings.site_name}: tranh canvas in UV sắc nét, khung gỗ chắc chắn, nhiều kích thước. Giao hàng và lắp đặt tận nơi.`;
router.get('/shop', (req, res) => renderListing(res, req, { title: 'Tất Cả Sản Phẩm', seo: { description: listingDesc(res, 'Tất cả mẫu tranh treo tường đẹp'),
  jsonld: [breadcrumbLd(res, [{ name: 'Trang chủ', url: '/' }, { name: 'Tất Cả Sản Phẩm', url: '/shop' }])] } }));
router.get('/best-sellers', (req, res) => renderListing(res, req, { title: 'Sản Phẩm Nổi Bật', where: 'p.featured = 1',
  seo: { description: listingDesc(res, 'Những mẫu tranh bán chạy, được yêu thích nhất') } }));
router.get('/bst-moi', (req, res) => renderListing(res, req, { title: 'BST Tranh Mới', where: 'p.is_new = 1',
  seo: { description: listingDesc(res, 'Bộ sưu tập tranh treo tường mới nhất') } }));
router.get('/collections', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();
  res.locals.seo = { description: listingDesc(res, 'Bộ sưu tập tranh theo chủ đề: phong cảnh, hoa, phong thủy, trừu tượng'),
    jsonld: [breadcrumbLd(res, [{ name: 'Trang chủ', url: '/' }, { name: 'Bộ Sưu Tập', url: '/collections' }])] };
  res.render('collections', { title: 'Bộ Sưu Tập', cats });
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  // Trang kết quả tìm kiếm nội bộ không nên được Google index
  renderListing(res, req, { title: q ? `Kết quả tìm kiếm: "${q}"` : 'Tìm kiếm', where: '(p.name LIKE ? OR p.code LIKE ?)', params: [`%${q}%`, `%${q}%`],
    seo: { noindex: true, canonical: false } });
});

router.get('/danh-muc/:slug', (req, res, next) => {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return next();
  const subcats = db.prepare('SELECT * FROM categories WHERE parent_id = ? ORDER BY sort_order').all(category.id);
  const trail = categoryTrail(category);
  renderListing(res, req, { title: category.name, description: category.description, category, subcats, trail,
    where: `p.category_id IN (${descendantIds(category.id).join(',')})`,
    seo: {
      description: category.description || listingDesc(res, `Mẫu ${category.name} đẹp, giá tốt`), image: category.image,
      jsonld: [breadcrumbLd(res, [{ name: 'Trang chủ', url: '/' }, ...trail.map(c => ({ name: c.name, url: '/danh-muc/' + c.slug }))])],
    } });
});

router.get('/san-pham/:slug', (req, res, next) => {
  const product = parseProduct(db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug));
  if (!product) return next();
  const category = product.category_id ? db.prepare('SELECT * FROM categories WHERE id = ?').get(product.category_id) : null;
  const related = product.category_id ? productList('p.category_id = ? AND p.id != ?', [product.category_id, product.id], 8) : [];
  const { baseUrl, absUrl, plain, settings: s } = res.locals;
  const trail = category ? categoryTrail(category) : [];
  const url = baseUrl + '/san-pham/' + product.slug;
  const prices = product.variants.map(v => +v.price).filter(n => n > 0);
  const single = product.sale_price > 0 && product.sale_price < product.price ? product.sale_price : product.price;
  const offerBase = { priceCurrency: 'VND', availability: 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition', url };
  const offers = prices.length > 1
    ? { '@type': 'AggregateOffer', lowPrice: Math.min(...prices), highPrice: Math.max(...prices), offerCount: prices.length, ...offerBase }
    : { '@type': 'Offer', price: prices[0] || single, ...offerBase };
  // Mô tả: ưu tiên meta_desc; nếu không có thì ghép mô tả ngắn + mô tả chi tiết cho đủ ~150 ký tự
  const desc = product.meta_desc || plain([product.short_desc, product.description].filter(Boolean).join(' '), 160);
  res.locals.seo = {
    type: 'product', image: product.thumb, preloadImage: product.thumb,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'Product', name: product.name, url,
        image: product.images.map(absUrl), description: plain(product.short_desc || product.description, 500),
        ...(product.code ? { sku: product.code } : {}),
        brand: { '@type': 'Brand', name: product.vendor || s.site_name },
        ...(category ? { category: category.name } : {}),
        ...((prices[0] || single) > 0 ? { offers } : {}),
      },
      breadcrumbLd(res, [{ name: 'Trang chủ', url: '/' }, ...trail.map(c => ({ name: c.name, url: '/danh-muc/' + c.slug })),
        { name: product.name, url: '/san-pham/' + product.slug }]),
    ],
  };
  res.render('product', { title: product.meta_title || product.name, metaDesc: desc, product, category, trail, related });
});

router.get('/trang/:slug', (req, res, next) => {
  const page = db.prepare('SELECT * FROM pages WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!page) return next();
  const promoMsg = req.session.promoMsg; delete req.session.promoMsg;
  res.locals.seo = {
    description: res.locals.plain(page.content.replace('[form_uu_dai]', '').replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ')), // bỏ tiêu đề để mô tả không lặp
    jsonld: [breadcrumbLd(res, [{ name: 'Trang chủ', url: '/' }, { name: page.title, url: '/trang/' + page.slug }])],
  };
  res.render('page', { title: page.title, page, promoMsg });
});

// ---------- robots.txt & sitemap.xml ----------
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send([
    'User-agent: *', 'Allow: /',
    'Disallow: /admin', 'Disallow: /gio-hang', 'Disallow: /dat-hang', 'Disallow: /dang-ky-uu-dai',
    '', `Sitemap: ${res.locals.baseUrl}/sitemap.xml`, '',
  ].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const base = res.locals.baseUrl;
  const xmlEsc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const day = (d) => (d ? String(d).slice(0, 10) : '');
  const urls = [
    { loc: '/' }, { loc: '/shop' }, { loc: '/collections' }, { loc: '/best-sellers' }, { loc: '/bst-moi' },
    ...db.prepare('SELECT slug FROM categories ORDER BY sort_order').all().map(c => ({ loc: '/danh-muc/' + c.slug })),
    ...db.prepare('SELECT slug, updated_at, images FROM products WHERE active = 1 ORDER BY id DESC').all().map(p => {
      let imgs = []; try { imgs = JSON.parse(p.images || '[]'); } catch {}
      return { loc: '/san-pham/' + p.slug, lastmod: day(p.updated_at), images: imgs.slice(0, 5) };
    }),
    ...db.prepare('SELECT slug FROM pages WHERE active = 1').all().map(p => ({ loc: '/trang/' + p.slug })),
  ];
  const body = urls.map(u => `<url><loc>${xmlEsc(base + u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${
    (u.images || []).map(i => `<image:image><image:loc>${xmlEsc(res.locals.absUrl(i))}</image:loc></image:image>`).join('')}</url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>`);
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
router.get('/gio-hang', (req, res) => {
  res.locals.seo = { noindex: true };
  res.render('cart', { title: 'Giỏ hàng' });
});

router.post('/dat-hang', (req, res) => {
  res.locals.seo = { noindex: true, canonical: false };
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
