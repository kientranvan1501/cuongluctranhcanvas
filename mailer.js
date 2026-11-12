// Gửi email thông báo đơn hàng qua SMTP (cấu hình tại Quản trị → Cấu hình email)
const nodemailer = require('nodemailer');
const { getSettings } = require('./db');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const splitEmails = (s) => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

function transport(s) {
  const port = parseInt(s.smtp_port) || 587;
  return nodemailer.createTransport({
    host: s.smtp_host,
    port,
    secure: s.smtp_secure === '1' || port === 465,
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
  });
}
const fromAddr = (s) => `"${(s.mail_from_name || s.site_name || 'Website').replace(/"/g, '')}" <${s.mail_from || s.smtp_user}>`;

function orderHtml(o, s, forCustomer) {
  const rows = o.items.map(i => `<tr>
    <td style="padding:6px;border:1px solid #ddd">${esc(i.name)} <small style="color:#888">${esc(i.code)}</small></td>
    <td style="padding:6px;border:1px solid #ddd">${esc(i.variant || '—')}</td>
    <td style="padding:6px;border:1px solid #ddd;text-align:right">${money(i.price)}</td>
    <td style="padding:6px;border:1px solid #ddd;text-align:center">${i.qty}</td>
    <td style="padding:6px;border:1px solid #ddd;text-align:right">${money(i.price * i.qty)}</td></tr>`).join('');
  const intro = forCustomer
    ? `<p>Xin chào <b>${esc(o.customer_name)}</b>,</p><p>Cảm ơn bạn đã đặt hàng tại ${esc(s.site_name)}. Chúng tôi sẽ liên hệ xác nhận trong thời gian sớm nhất.</p>`
    : `<p>Có đơn hàng mới trên website <b>${esc(s.site_name)}</b>.</p>`;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px">
    <h2 style="margin:0 0 12px">Đơn hàng #${o.id}</h2>${intro}
    <table style="border-collapse:collapse;margin:12px 0">
      <tr><td style="padding:3px 12px 3px 0;color:#666">Họ tên</td><td><b>${esc(o.customer_name)}</b></td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#666">Điện thoại</td><td>${esc(o.phone)}</td></tr>
      ${o.email ? `<tr><td style="padding:3px 12px 3px 0;color:#666">Email</td><td>${esc(o.email)}</td></tr>` : ''}
      ${o.address ? `<tr><td style="padding:3px 12px 3px 0;color:#666">Địa chỉ</td><td>${esc(o.address)}</td></tr>` : ''}
      ${o.note ? `<tr><td style="padding:3px 12px 3px 0;color:#666">Ghi chú</td><td>${esc(o.note)}</td></tr>` : ''}
    </table>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#f3f4f6"><th style="padding:6px;border:1px solid #ddd;text-align:left">Sản phẩm</th><th style="padding:6px;border:1px solid #ddd">Kích thước</th><th style="padding:6px;border:1px solid #ddd">Đơn giá</th><th style="padding:6px;border:1px solid #ddd">SL</th><th style="padding:6px;border:1px solid #ddd">Thành tiền</th></tr>
      ${rows}
      <tr><td colspan="4" style="padding:6px;border:1px solid #ddd;text-align:right"><b>Tổng cộng</b></td><td style="padding:6px;border:1px solid #ddd;text-align:right"><b>${money(o.total)}</b></td></tr>
    </table>
    ${forCustomer ? `<p style="margin-top:16px">Hotline: ${esc(s.hotline)}</p>` : ''}
  </div>`;
}

// Gửi thông báo đơn mới. Không ném lỗi ra ngoài - lỗi gửi mail không được làm hỏng việc đặt hàng.
async function sendOrderMail(order, baseUrl = '') {
  const s = getSettings();
  if (s.mail_enabled !== '1' || !s.smtp_host) return;
  const t = transport(s);
  const to = splitEmails(s.mail_to);
  try {
    if (to.length) {
      await t.sendMail({
        from: fromAddr(s), to, replyTo: order.email || undefined,
        subject: `[${s.site_name}] Đơn hàng mới #${order.id} - ${order.customer_name} - ${money(order.total)}`,
        html: orderHtml(order, s, false) + (baseUrl ? `<p><a href="${esc(baseUrl)}/admin/orders/${order.id}">Xem đơn trong trang quản trị</a></p>` : ''),
      });
    }
    if (s.mail_customer === '1' && splitEmails(order.email).length) {
      await t.sendMail({
        from: fromAddr(s), to: splitEmails(order.email)[0],
        subject: `[${s.site_name}] Xác nhận đơn hàng #${order.id}`,
        html: orderHtml(order, s, true),
      });
    }
  } catch (e) {
    console.error('Gửi email đơn hàng #' + order.id + ' thất bại:', e.message);
  }
}

// Thông báo khách đăng ký nhận ưu đãi
async function sendLeadMail(lead, baseUrl = '') {
  const s = getSettings();
  const to = splitEmails(s.mail_to);
  if (s.mail_enabled !== '1' || !s.smtp_host || !to.length) return;
  const row = (k, v) => v ? `<tr><td style="padding:3px 12px 3px 0;color:#666">${k}</td><td>${esc(v)}</td></tr>` : '';
  try {
    await transport(s).sendMail({
      from: fromAddr(s), to, replyTo: lead.email || undefined,
      subject: `[${s.site_name}] Khách đăng ký nhận ưu đãi - ${lead.name} - ${lead.phone}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">
        <h2 style="margin:0 0 12px">Đăng ký nhận ưu đãi #${lead.id}</h2>
        <table style="border-collapse:collapse">${row('Họ tên', lead.name)}${row('Điện thoại', lead.phone)}${row('Email', lead.email)}
        ${row('Không gian', lead.need)}${row('Ghi chú', lead.note)}${row('Trang', lead.source)}</table>
        ${baseUrl ? `<p><a href="${esc(baseUrl)}/admin/leads">Xem trong trang quản trị</a></p>` : ''}</div>`,
    });
  } catch (e) {
    console.error('Gửi email đăng ký ưu đãi #' + lead.id + ' thất bại:', e.message);
  }
}

// Gửi thử - ném lỗi để hiển thị cho admin
async function sendTestMail() {
  const s = getSettings();
  if (!s.smtp_host) throw new Error('Chưa nhập máy chủ SMTP');
  const to = splitEmails(s.mail_to);
  if (!to.length) throw new Error('Chưa nhập email nhận thông báo');
  await transport(s).sendMail({
    from: fromAddr(s), to,
    subject: `[${s.site_name}] Email thử nghiệm`,
    html: `<p>Cấu hình email của website <b>${esc(s.site_name)}</b> hoạt động bình thường.</p>`,
  });
  return to;
}

module.exports = { sendOrderMail, sendLeadMail, sendTestMail };
