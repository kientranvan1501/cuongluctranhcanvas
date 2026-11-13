// Nội dung do admin gõ dạng chữ thường -> HTML khi hiển thị. Cú pháp đơn giản:
//   Enter = xuống dòng · dòng trống = đoạn mới · "- " đầu dòng = gạch đầu dòng
//   "## " đầu dòng = tiêu đề · **chữ** = in đậm · [chữ](link) = liên kết
//   "> " đầu dòng = khung nổi bật
//   Link https://…, email, số điện thoại tự thành liên kết · [form_uu_dai] đứng riêng 1 dòng = chèn form
// Dữ liệu cũ đã là HTML (chưa sửa lại) vẫn hiển thị nguyên như cũ.
const BLOCK = /<(p|div|ul|ol|li|h[1-6]|table|br|section|figure|blockquote)\b/i;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BULLET = /^\s*[-•*+]\s+/;
const HEADING = /^\s*(#{2,3})\s+(.+)$/;
const SHORTCODE = /^\s*\[[a-z_]+\]\s*$/;
const BOX = /^\s*>\s?/; // "> " đầu dòng = khung nổi bật (VD khối thông tin liên hệ)

const safeUrl = u => /^(https?:\/\/|tel:|mailto:|\/(?!\/)|#)/i.test(u) ? u : null;
const anchor = (href, text) => `<a href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;

// Định dạng trong 1 dòng: escape -> link -> tự nhận link/email/SĐT -> in đậm
function inline(raw) {
  const tokens = [];
  const keep = html => '\u0000' + (tokens.push(html) - 1) + '\u0000';
  let s = String(raw);
  // [chữ](link) — xử lý trước khi escape để giữ nguyên URL
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const ok = safeUrl(u.trim()); return ok ? keep(anchor(ok, esc(t))) : m; });
  s = esc(s);
  s = s.replace(/\bhttps?:\/\/[^\s<\u0000]+[^\s<.,;:!?)\u0000]/g, u => keep(anchor(u.replace(/&amp;/g, '&'), u)));
  s = s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, e => keep(anchor('mailto:' + e, e)));
  s = s.replace(/(?<![\d.,])(?:\+84 ?|0)\d{2,3}[ .]?\d{3}[ .]?\d{3,4}(?![\d.,])/g, p => {
    const d = p.replace(/\D/g, '').replace(/^84/, '0');
    return d.length >= 10 && d.length <= 11 ? keep(anchor('tel:' + d, p)) : p;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[+i]);
}

// opts.listClass: class cho <ul> (trang nội dung dùng "check-list" có dấu ✓)
function textToHtml(s, opts = {}) {
  s = String(s || '').replace(/\r\n?/g, '\n').trim();
  if (!s) return '';
  if (BLOCK.test(s)) return s; // đã là HTML
  const ul = opts.listClass ? `<ul class="${esc(opts.listClass)}">` : '<ul>';
  return s.split(/\n\s*\n/).map(block => {
    const out = []; let list = null, para = null, box = null;
    const flush = () => {
      if (para) { out.push('<p>' + para.join('<br>') + '</p>'); para = null; }
      if (list) { out.push(ul + list.join('') + '</ul>'); list = null; }
      if (box) { out.push('<div class="contact-card">' + box.map(x => '<p>' + x + '</p>').join('') + '</div>'); box = null; }
    };
    block.split('\n').forEach(line => {
      let m;
      if (BOX.test(line)) { if (!box) flush(); (box ||= []).push(inline(line.replace(BOX, '').trim())); return; }
      if (box) flush();
      if (SHORTCODE.test(line)) { flush(); out.push(line.trim()); }
      else if ((m = line.match(HEADING))) { flush(); const tag = m[1].length === 2 ? 'h2' : 'h3'; out.push(`<${tag}>${inline(m[2].trim())}</${tag}>`); }
      else if (BULLET.test(line)) {
        if (para) { out.push('<p>' + para.join('<br>') + '</p>'); para = null; }
        (list ||= []).push('<li>' + inline(line.replace(BULLET, '').trim()) + '</li>');
      } else {
        if (list) { out.push(ul + list.join('') + '</ul>'); list = null; }
        (para ||= []).push(inline(line.trim()));
      }
    });
    flush();
    return out.join('\n');
  }).join('\n');
}

const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&');

// HTML cũ -> chữ thường (giữ tiêu đề, in đậm, link, gạch đầu dòng) để sửa trong ô nhập
function htmlToText(s) {
  s = String(s || '');
  if (!BLOCK.test(s)) return s;
  return decode(s.replace(/\r?\n/g, ' ')
    .replace(/\s*(\[[a-z_]+\])\s*/g, '<p>$1</p>') // mã chèn [form_uu_dai] đứng riêng 1 dòng
    // khung nổi bật -> các dòng "> …"
    .replace(/<div\b[^>]*class="[^"]*contact-card[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, (m, inner) =>
      '<p>' + inner.replace(/<\/p>/gi, '').split(/<p\b[^>]*>/i).map(x => x.trim()).filter(Boolean).map(x => '\u0001' + x).join('<br>') + '</p>')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => {
      const t = inner.replace(/<[^>]+>/g, '').trim(), h = decode(href);
      // tel:/mailto:/link trùng chữ -> để chữ, khi hiển thị tự thành link
      if (/^(tel:|mailto:)/i.test(h) || h === decode(t)) return t;
      return `[${t}](${h})`;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) => inner.trim() ? `**${inner.trim()}**` : '')
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
    .replace(/<h[3-6]\b[^>]*>([\s\S]*?)<\/h[3-6]>/gi, '\n\n### $1\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '')
    .replace(/<\/(p|div|ul|ol|table|section|figure|blockquote)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/\u0001\s*/g, '> ')
    .replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { textToHtml, htmlToText };
