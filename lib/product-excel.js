// Nhập / xuất sản phẩm hàng loạt bằng Excel (.xlsx)
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { db, slugify, uniqueSlug } = require('../db');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const MAX_ROWS = 2000;
const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

// Cột trong file mẫu. Khi đọc, cột được nhận theo TÊN tiêu đề (không theo vị trí) nên có thể bỏ bớt / đổi thứ tự cột.
const COLUMNS = [
  { key: 'code', label: 'Mã SP', width: 12, alias: ['ma', 'masp', 'masanpham', 'code', 'sku'],
    note: 'Mã sản phẩm. Nếu mã đã có trên web: cập nhật sản phẩm đó (hoặc bỏ qua, tùy lựa chọn khi nhập).' },
  { key: 'name', label: 'Tên sản phẩm *', width: 36, alias: ['ten', 'tensp', 'tensanpham', 'name'], note: 'Bắt buộc với sản phẩm mới.' },
  { key: 'category', label: 'Danh mục', width: 24, alias: ['danhmuc', 'category'],
    note: 'Chọn trong danh sách (xem sheet "Danh mục"). Gõ tên hoặc slug đều được. Trùng tên thì ghi "Cha > Con".' },
  { key: 'price', label: 'Giá gốc', width: 12, alias: ['gia', 'giagoc', 'giaban', 'price'], note: 'Số tiền, VD 1200000 hoặc 1.200.000' },
  { key: 'sale_price', label: 'Giá KM', width: 12, alias: ['giakm', 'giakhuyenmai', 'giagiam', 'saleprice'], note: 'Để trống nếu không giảm giá.' },
  { key: 'variants', label: 'Kích thước - Giá', width: 26, alias: ['kichthuocgia', 'kichthuoc', 'bienthe', 'variants', 'size'],
    note: 'Mỗi dòng 1 lựa chọn dạng "Tên | Giá" hoặc "Tên | Giá | Giá KM" (xuống dòng trong ô: Alt+Enter), hoặc cách nhau bằng dấu ;\nVD: 40x60cm | 920000 | 850000; 60x90cm | 1330000' },
  { key: 'images', label: 'Ảnh', width: 40, alias: ['anh', 'hinhanh', 'image', 'images'],
    note: 'Nhiều ảnh cách nhau bởi xuống dòng hoặc dấu phẩy, ảnh đầu là ảnh đại diện. Mỗi ảnh là:\n- tên file ảnh tải lên cùng lúc (VD hoa-hong-01.jpg), hoặc\n- link ảnh trên mạng (https://...) — web tự tải về, hoặc\n- đường dẫn ảnh đã có trên web (/uploads/...)' },
  { key: 'short_desc', label: 'Mô tả ngắn', width: 30, alias: ['motangan'] },
  { key: 'description', label: 'Mô tả chi tiết', width: 40, alias: ['motachitiet', 'mota', 'description'], note: 'Gõ chữ bình thường, xuống dòng trong ô: Alt+Enter. Dòng bắt đầu bằng - thành gạch đầu dòng.' },
  { key: 'vendor', label: 'Nhà cung cấp', width: 18, alias: ['nhacungcap', 'hoasi', 'vendor'] },
  { key: 'active', label: 'Hiển thị', width: 10, alias: ['hienthi', 'active'], bool: true, note: 'Có / Không (mặc định Có)' },
  { key: 'featured', label: 'Nổi bật', width: 10, alias: ['noibat', 'featured'], bool: true, note: 'Có / Không (mặc định Không)' },
  { key: 'is_new', label: 'BST mới', width: 10, alias: ['bstmoi', 'moi', 'new', 'isnew'], bool: true, note: 'Có / Không (mặc định Không)' },
  { key: 'meta_title', label: 'Meta title', width: 30, alias: ['metatitle', 'tieudeseo'] },
  { key: 'meta_desc', label: 'Meta description', width: 40, alias: ['metadescription', 'metadesc', 'motaseo'] },
  { key: 'slug', label: 'Slug', width: 24, alias: ['slug', 'duongdan'], note: 'Đường dẫn sản phẩm. Để trống sẽ tự tạo từ tên + mã.' },
];

const norm = s => String(s || '').replace(/\(.*?\)/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');

// Lấy text từ ô Excel (rich text, hyperlink, công thức, số, ngày…)
function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.hyperlink) return String(v.text && typeof v.text === 'string' && /^https?:/i.test(v.text) ? v.text : v.hyperlink);
    if ('result' in v) return cellText(v.result);
    if (v.text) return cellText(v.text);
    if (v.error) return '';
    return '';
  }
  return String(v);
}
const toInt = s => { const n = parseInt(String(s).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : 0; };
function toBool(s) {
  const t = norm(s);
  if (!t) return null;
  if (['co', 'x', '1', 'yes', 'y', 'true', 'c', 'hien', 'bat', 'on'].includes(t)) return 1;
  if (['khong', '0', 'no', 'n', 'false', 'k', 'an', 'tat', 'off'].includes(t)) return 0;
  return undefined; // không hiểu
}
function parseVariants(s) {
  const out = [], bad = [];
  String(s).split(/\r?\n|;/).map(x => x.trim()).filter(Boolean).forEach(line => {
    // "Tên | Giá" hoặc "Tên | Giá | Giá KM"
    const m = line.match(/^(.+?)\s*[|:=]\s*([\d.,\s]+?)\s*(?:đ|d|vnd|vnđ)?(?:\s*\|\s*([\d.,\s]*?)\s*(?:đ|d|vnd|vnđ)?)?$/i);
    if (m && toInt(m[2]) > 0) {
      const v = { name: m[1].trim(), price: toInt(m[2]) }, sale = m[3] ? toInt(m[3]) : 0;
      if (sale > 0 && sale < v.price) v.sale_price = sale;
      out.push(v);
    }
    else bad.push(line);
  });
  return { out, bad };
}

// ---------- Danh mục: tra theo tên / slug / "Cha > Con" ----------
function categoryIndex() {
  const cats = db.prepare('SELECT id, name, slug, parent_id FROM categories ORDER BY sort_order, name').all();
  const byId = Object.fromEntries(cats.map(c => [c.id, c]));
  const pathOf = c => (c.parent_id && byId[c.parent_id] ? pathOf(byId[c.parent_id]) + ' > ' : '') + c.name;
  const byKey = {};
  const add = (k, c) => (byKey[k] ||= new Set()).add(c.id);
  cats.forEach(c => { add(norm(c.name), c); add(norm(c.slug), c); add(norm(pathOf(c)), c); add(String(c.id), c); });
  const nameCount = {};
  cats.forEach(c => { nameCount[norm(c.name)] = (nameCount[norm(c.name)] || 0) + 1; });
  return {
    cats, byId, pathOf,
    find(s) {
      const raw = String(s).trim();
      const ids = byKey[norm(raw)] || byKey[raw];
      if (!ids) return { error: `không có danh mục "${raw}"` };
      if (ids.size > 1) return { error: `có nhiều danh mục tên "${raw}", hãy ghi rõ dạng "Cha > Con"` };
      return { id: [...ids][0] };
    },
    label: c => (nameCount[norm(c.name)] > 1 ? pathOf(c) : c.name),
  };
}

// ---------- File mẫu ----------
const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D1A16' } };
const BOOL_VALIDATION = { type: 'list', allowBlank: true, formulae: ['"Có,Không"'] };

function addProductSheet(wb, rows, ci) {
  const ws = wb.addWorksheet('Sản phẩm', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2 }] });
  ws.columns = COLUMNS.map(c => ({ header: c.label, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell, i) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEAD_FILL;
    cell.alignment = { vertical: 'middle' };
    const note = COLUMNS[i - 1].note;
    if (note) cell.note = note;
  });
  rows.forEach(r => ws.addRow(r));
  const last = Math.max(rows.length + 1, 500);
  const col = k => ws.getColumn(COLUMNS.findIndex(c => c.key === k) + 1).letter;
  for (let r = 2; r <= last; r++) {
    COLUMNS.filter(c => c.bool).forEach(c => { ws.getCell(col(c.key) + r).dataValidation = BOOL_VALIDATION; });
    if (ci.cats.length) ws.getCell(col('category') + r).dataValidation = {
      type: 'list', allowBlank: true, showErrorMessage: false, formulae: [`'Danh mục'!$A$2:$A$${ci.cats.length + 1}`],
    };
  }
  ['variants', 'images', 'description', 'short_desc'].forEach(k => { ws.getColumn(col(k)).alignment = { wrapText: true, vertical: 'top' }; });
  ws.getColumn(col('price')).numFmt = '#,##0';
  ws.getColumn(col('sale_price')).numFmt = '#,##0';
  return ws;
}
function addCategorySheet(wb, ci) {
  const ws = wb.addWorksheet('Danh mục');
  ws.columns = [{ header: 'Tên danh mục (dùng cho cột Danh mục)', width: 36 }, { header: 'Slug', width: 26 }, { header: 'Thuộc nhóm', width: 30 }];
  ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = HEAD_FILL; });
  ci.cats.forEach(c => ws.addRow([ci.label(c), c.slug, c.parent_id ? ci.pathOf(ci.byId[c.parent_id]) : '']));
}
function addGuideSheet(wb) {
  const ws = wb.addWorksheet('Hướng dẫn');
  ws.getColumn(1).width = 22; ws.getColumn(2).width = 100;
  ws.addRow(['HƯỚNG DẪN NHẬP SẢN PHẨM HÀNG LOẠT']).font = { bold: true, size: 14 };
  ws.addRow([]);
  [
    ['Cách dùng', '1. Điền sản phẩm vào sheet "Sản phẩm", mỗi dòng 1 sản phẩm (xóa các dòng ví dụ).\n2. Vào Quản trị → Sản phẩm → Nhập Excel, chọn file này và (nếu có) chọn luôn các file ảnh.\n3. Bấm "Kiểm tra trước" để xem lỗi, sau đó bấm "Nhập sản phẩm".'],
    ['Cập nhật hàng loạt', 'Bấm "Xuất Excel" ở trang Sản phẩm để tải danh sách hiện có, sửa rồi nhập lại. Sản phẩm được nhận theo Mã SP.\nKhi cập nhật, ô để trống được GIỮ NGUYÊN giá trị cũ (muốn bỏ giá KM thì ghi 0).'],
    ['Ảnh', 'Cách 1: chọn các file ảnh cùng lúc với file Excel, trong cột Ảnh ghi đúng tên file (VD: hoa-hong-01.jpg).\nCách 2: dán link ảnh https://... — web sẽ tự tải ảnh về hosting.\nNhiều ảnh: cách nhau bằng xuống dòng (Alt+Enter) hoặc dấu phẩy. Ảnh đầu tiên là ảnh đại diện.'],
    ['Kích thước - Giá', 'Mỗi lựa chọn dạng "Tên | Giá" hoặc "Tên | Giá | Giá KM", nhiều lựa chọn xuống dòng hoặc cách nhau bởi dấu ;\nVD: 40x60cm | 920000 | 850000; 60x90cm | 1330000. Có kích thước thì giá lấy theo từng kích thước (cột Giá KM chung chỉ áp vào kích thước đầu tiên nếu kích thước đó chưa có giá KM).'],
    ['Lưu ý', 'Giữ nguyên dòng tiêu đề. Có thể xóa bớt các cột không dùng. Tối đa ' + MAX_ROWS + ' dòng mỗi lần. Dùng Google Sheets thì tải về dạng .xlsx (Tệp → Tải xuống → Microsoft Excel).'],
  ].forEach(([a, b]) => {
    const r = ws.addRow([a, b]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).alignment = { vertical: 'top' };
  });
}

async function buildTemplate() {
  const ci = categoryIndex();
  const wb = new ExcelJS.Workbook();
  const pick = (...names) => { for (const n of names) { const c = ci.cats.find(x => norm(x.name) === norm(n)); if (c) return ci.label(c); } return ci.cats[0] ? ci.label(ci.cats[0]) : ''; };
  addProductSheet(wb, [
    { code: 'CL001', name: 'Tranh Hoa Hồng Đỏ', category: pick('Hoa Hồng'), price: 950000, sale_price: '',
      variants: '40x60cm | 950000\n60x90cm | 1350000\n80x120cm | 1950000', images: 'hoa-hong-do-1.jpg\nhoa-hong-do-2.jpg',
      short_desc: 'Tranh canvas hoa hồng đỏ, khung gỗ, sẵn đinh treo.', description: 'Tranh in canvas cao cấp, mực UV bền màu.\nPhù hợp phòng khách, phòng ngủ.',
      vendor: 'Cường Lực Tranh Canvas', active: 'Có', featured: 'Không', is_new: 'Có', meta_title: '', meta_desc: '', slug: '' },
    { code: 'CL002', name: 'Tranh Phong Cảnh Núi Rừng', category: pick('Tranh Núi', 'Phong Cảnh'), price: 1200000, sale_price: 990000,
      variants: '', images: 'https://example.com/anh-tranh-nui.jpg', short_desc: '', description: '', vendor: '',
      active: 'Có', featured: 'Có', is_new: 'Không', meta_title: '', meta_desc: '', slug: '' },
  ], ci);
  addCategorySheet(wb, ci);
  addGuideSheet(wb);
  return wb.xlsx.writeBuffer();
}

async function buildExport(products) {
  const ci = categoryIndex();
  const wb = new ExcelJS.Workbook();
  const yn = v => (v ? 'Có' : 'Không');
  addProductSheet(wb, products.map(p => ({
    code: p.code, name: p.name, category: p.category_id && ci.byId[p.category_id] ? ci.label(ci.byId[p.category_id]) : '',
    price: p.price || '', sale_price: p.sale_price || '',
    variants: JSON.parse(p.variants || '[]').map(v => `${v.name} | ${v.price}` + (+v.sale_price > 0 ? ` | ${v.sale_price}` : '')).join('\n'),
    images: JSON.parse(p.images || '[]').join('\n'), short_desc: p.short_desc, description: p.description, vendor: p.vendor,
    active: yn(p.active), featured: yn(p.featured), is_new: yn(p.is_new), meta_title: p.meta_title, meta_desc: p.meta_desc, slug: p.slug,
  })), ci);
  addCategorySheet(wb, ci);
  addGuideSheet(wb);
  return wb.xlsx.writeBuffer();
}

// ---------- Đọc file ----------
async function readRows(file) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(file); } catch (e) { throw new Error('Không đọc được file. Hãy lưu file dạng Excel .xlsx (không dùng .xls cũ hoặc .csv).'); }
  const ws = wb.worksheets.find(w => norm(w.name) === 'sanpham') || wb.worksheets[0];
  if (!ws) throw new Error('File không có sheet nào.');
  // tìm dòng tiêu đề trong 5 dòng đầu
  let headRow = 0, map = {};
  for (let r = 1; r <= Math.min(5, ws.rowCount) && !headRow; r++) {
    const m = {};
    ws.getRow(r).eachCell((cell, col) => {
      const k = norm(cellText(cell.value));
      const c = COLUMNS.find(x => x.alias.includes(k));
      if (c && !(c.key in m)) m[c.key] = col;
    });
    if (Object.keys(m).length >= 2) { headRow = r; map = m; }
  }
  if (!headRow) throw new Error('Không tìm thấy dòng tiêu đề (cần các cột như "Mã SP", "Tên sản phẩm", "Giá gốc"…). Hãy dùng file mẫu.');
  if (!('name' in map) && !('code' in map)) throw new Error('File cần có cột "Tên sản phẩm" hoặc "Mã SP".');
  const rows = [];
  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const d = {};
    for (const [k, col] of Object.entries(map)) d[k] = cellText(row.getCell(col).value).trim();
    if (Object.values(d).every(v => !v)) continue;
    rows.push({ line: r, d });
    if (rows.length > MAX_ROWS) throw new Error(`File có hơn ${MAX_ROWS} dòng sản phẩm, hãy chia nhỏ.`);
  }
  return { rows, columns: Object.keys(map) };
}

// ---------- Ảnh ----------
function saveName(base, ext) {
  const stem = (slugify(base) || 'anh').slice(0, 60);
  let name = stem + ext, i = 2;
  while (fs.existsSync(path.join(UPLOAD_DIR, name))) name = `${stem}-${i++}${ext}`;
  return name;
}
async function downloadImage(url, base) {
  const res = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMG_EXT[type];
  if (!ext) throw new Error(`không phải ảnh (${type || 'không rõ'})`);
  const len = +res.headers.get('content-length') || 0;
  if (len > 10 * 1024 * 1024) throw new Error('ảnh lớn hơn 10MB');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new Error('ảnh lớn hơn 10MB');
  const name = saveName(base, ext);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}

// ---------- Nhập ----------
// opts: { files: [{originalname, path}], dryRun, onDuplicate: 'update'|'skip' }
async function importProducts(excelPath, opts) {
  const { rows, columns } = await readRows(excelPath);
  const has = k => columns.includes(k);
  const ci = categoryIndex();
  const fileMap = {};
  (opts.files || []).forEach(f => { fileMap[f.originalname.toLowerCase()] = f; fileMap[path.basename(f.originalname).toLowerCase()] = f; });
  const byCode = db.prepare('SELECT * FROM products WHERE code = ? COLLATE NOCASE');
  const seenCodes = new Map();
  const results = [];

  // 1) Kiểm tra từng dòng
  for (const { line, d } of rows) {
    const errors = [], warns = [];
    const code = d.code || '';
    const existing = code ? byCode.get(code) : null;
    let action = existing ? (opts.onDuplicate === 'skip' ? 'skip' : 'update') : 'insert';
    if (code) {
      if (seenCodes.has(code.toLowerCase())) { errors.push(`mã ${code} bị lặp (trùng dòng ${seenCodes.get(code.toLowerCase())})`); }
      else seenCodes.set(code.toLowerCase(), line);
    }
    const p = {};
    if (d.name) p.name = d.name; else if (action === 'insert') errors.push('thiếu tên sản phẩm');
    if (d.category) { const f = ci.find(d.category); if (f.error) errors.push(f.error); else p.category_id = f.id; }
    if (d.price) { p.price = toInt(d.price); if (!p.price && d.price.replace(/\D/g, '') !== '0') errors.push(`giá gốc "${d.price}" không hợp lệ`); }
    if (d.sale_price) p.sale_price = toInt(d.sale_price);
    if (d.variants) {
      const v = parseVariants(d.variants);
      if (v.bad.length) errors.push(`kích thước không đúng dạng "Tên | Giá" hoặc "Tên | Giá | Giá KM": ${v.bad.join('; ')}`);
      // Giá KM chung + có kích thước: áp vào kích thước đầu tiên (giống trang sửa sản phẩm)
      const v0 = v.out[0];
      if (v0 && p.sale_price && !v.out.some(x => x.sale_price) && p.sale_price < v0.price) v0.sale_price = p.sale_price;
      if (v0) { p.price = v0.price; p.sale_price = v0.sale_price || 0; }
      p.variants = JSON.stringify(v.out);
    }
    if (action === 'insert' && !p.price && !(p.variants && p.variants !== '[]')) errors.push('thiếu giá (giá gốc hoặc kích thước - giá)');
    if (p.sale_price && p.price && p.sale_price >= p.price) warns.push('giá KM không nhỏ hơn giá gốc');
    for (const k of ['short_desc', 'meta_title', 'meta_desc', 'vendor']) if (d[k]) p[k] = d[k];
    if (d.description) p.description = String(d.description).replace(/\r\n?/g, '\n').trim(); // web tự đổi xuống dòng khi hiển thị
    for (const k of ['active', 'featured', 'is_new']) {
      if (!d[k]) continue;
      const b = toBool(d[k]);
      if (b === undefined) errors.push(`cột ${COLUMNS.find(c => c.key === k).label} chỉ nhận Có/Không (đang ghi "${d[k]}")`);
      else p[k] = b;
    }
    if (d.slug) p.slug_wanted = d.slug;
    // ảnh
    const imgs = [];
    if (d.images) {
      d.images.split(/\r?\n|,(?=\s*(?:https?:|\/|[^,]*\.(?:jpe?g|png|webp|gif)\b))|;/i).map(s => s.trim()).filter(Boolean).forEach(s => {
        if (/^https?:\/\//i.test(s)) imgs.push({ url: s });
        else if (s.startsWith('/uploads/') || s.startsWith('/img/')) {
          let rel = s.split('?')[0]; try { rel = decodeURIComponent(rel); } catch (e) { /* giữ nguyên */ }
          if (rel.includes('..') || !fs.existsSync(path.join(__dirname, '..', 'public', rel))) warns.push(`ảnh ${s} không còn trên web`);
          imgs.push({ keep: s });
        } else {
          const f = fileMap[s.toLowerCase()] || fileMap[path.basename(s).toLowerCase()];
          if (f) imgs.push({ file: f }); else errors.push(`chưa chọn file ảnh "${s}"`);
        }
      });
    }
    if (action === 'insert' && !imgs.length && !errors.length) warns.push('chưa có ảnh');
    results.push({ line, code, name: d.name || (existing && existing.name) || '', action: errors.length ? 'error' : action,
      existingId: existing && existing.id, errors, warns, p, imgs, catName: p.category_id ? ci.byId[p.category_id].name : '' });
  }
  const summary = () => ({
    insert: results.filter(r => r.action === 'insert').length, update: results.filter(r => r.action === 'update').length,
    skip: results.filter(r => r.action === 'skip').length, error: results.filter(r => r.action === 'error').length,
  });
  if (opts.dryRun) return { results, summary: summary(), columns, dryRun: true };

  // 2) Chuẩn bị ảnh (tải link về, chép file đã chọn) cho các dòng hợp lệ
  const urlCache = new Map(), fileCache = new Map();
  const todo = results.filter(r => r.action === 'insert' || r.action === 'update');
  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const r = todo[next++];
      const base = (r.p.name || r.name) + (r.code ? ' ' + r.code : '');
      const out = [];
      for (const [i, im] of r.imgs.entries()) {
        const nameBase = base + (i ? ' ' + (i + 1) : '');
        try {
          if (im.keep) out.push(im.keep);
          else if (im.file) {
            if (!fileCache.has(im.file.path)) {
              const name = saveName(nameBase, path.extname(im.file.originalname).toLowerCase() || '.jpg');
              fs.copyFileSync(im.file.path, path.join(UPLOAD_DIR, name));
              fileCache.set(im.file.path, '/uploads/' + name);
            }
            out.push(fileCache.get(im.file.path));
          } else if (im.url) {
            if (!urlCache.has(im.url)) urlCache.set(im.url, downloadImage(im.url, nameBase));
            out.push(await urlCache.get(im.url));
          }
        } catch (e) {
          r.warns.push(`không tải được ảnh ${im.url || ''}: ${e.cause && e.cause.code || e.message}`);
          if (im.url) urlCache.delete(im.url);
        }
      }
      if (r.imgs.length) r.p.images = JSON.stringify(out);
    }
  }
  await Promise.all([worker(), worker(), worker()]);

  // 3) Ghi vào database trong 1 giao dịch
  db.exec('BEGIN');
  try {
    for (const r of todo) {
      const p = { ...r.p };
      const wanted = p.slug_wanted; delete p.slug_wanted;
      if (r.action === 'insert') {
        const row = {
          name: p.name, code: r.code, slug: uniqueSlug('products', wanted || `${p.name} ${r.code}`),
          category_id: p.category_id || null, price: p.price || 0, sale_price: p.sale_price || 0,
          variants: p.variants || '[]', images: p.images || '[]', short_desc: p.short_desc || '', description: p.description || '',
          vendor: p.vendor || '', featured: p.featured ?? 0, is_new: p.is_new ?? 0, active: p.active ?? 1,
          meta_title: p.meta_title || '', meta_desc: p.meta_desc || '',
        };
        const cols = Object.keys(row);
        r.id = db.prepare(`INSERT INTO products(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).run(...Object.values(row)).lastInsertRowid;
        r.slug = row.slug;
      } else {
        if (wanted) p.slug = uniqueSlug('products', wanted, r.existingId);
        const keys = Object.keys(p);
        if (keys.length) db.prepare(`UPDATE products SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(...Object.values(p), r.existingId);
        r.id = r.existingId;
        r.slug = db.prepare('SELECT slug FROM products WHERE id = ?').get(r.id).slug;
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { results, summary: summary(), columns, dryRun: false };
}

module.exports = { buildTemplate, buildExport, importProducts };
