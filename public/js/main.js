(function () {
  const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = () => { try { return JSON.parse(localStorage.getItem('cart') || '[]'); } catch (e) { return []; } };
  const save = (c) => { try { localStorage.setItem('cart', JSON.stringify(c)); } catch (e) {} updateCount(); };
  function updateCount() {
    const el = document.getElementById('cartCount');
    if (el) el.textContent = load().reduce((s, i) => s + i.qty, 0);
  }
  updateCount();

  // Thông báo nhỏ (toast) ở giữa phía trên màn hình, tự ẩn sau vài giây
  function showToast(msg, type) {
    let box = document.getElementById('toastBox');
    if (!box) { box = document.createElement('div'); box.id = 'toastBox'; box.className = 'toast-box'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast toast-' + (type || 'ok');
    t.innerHTML = '<span class="toast-ic" aria-hidden="true">' + (type === 'err' ? '!' : '✓') + '</span><span>' + esc(msg) + '</span>';
    box.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, type === 'err' ? 5000 : 4000);
  }

  // Nút kính lúp (điện thoại): mở / đóng ô tìm kiếm dưới header
  const sToggle = document.getElementById('searchToggle');
  sToggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('search-open');
    sToggle.setAttribute('aria-expanded', open);
    if (open) { document.body.classList.remove('nav-open'); document.querySelector('#searchForm input')?.focus(); }
  });

  // Carousel
  document.querySelectorAll('.carousel').forEach((car) => {
    const track = car.querySelector('.car-track');
    car.querySelector('.prev')?.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth }));
    car.querySelector('.next')?.addEventListener('click', () => track.scrollBy({ left: track.clientWidth }));
    // Ít thẻ, không cần cuộn -> ẩn nút ‹ ›
    const fit = () => car.querySelectorAll('.car-btn').forEach((b) => { b.hidden = track.scrollWidth <= track.clientWidth + 2; });
    fit(); window.addEventListener('resize', fit);
  });

  // Banner slider trang chủ: tự chạy, dừng khi rê chuột/ẩn tab, vuốt trên điện thoại
  document.querySelectorAll('.hero-slider').forEach((hero) => {
    const slides = [...hero.querySelectorAll('.hero-slide')];
    if (slides.length < 2) return;
    const dots = [...hero.querySelectorAll('.hero-dots button')];
    const delay = parseInt(hero.dataset.interval) || 5000;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cur = 0, timer = null, paused = false;
    function go(n) {
      cur = (n + slides.length) % slides.length;
      slides.forEach((s, i) => {
        const on = i === cur;
        s.classList.toggle('is-active', on);
        s.toggleAttribute('aria-hidden', !on);
        s.querySelectorAll('a').forEach((a) => (on ? a.removeAttribute('tabindex') : a.setAttribute('tabindex', '-1')));
        if (on) s.querySelector('img[loading=lazy]')?.removeAttribute('loading');
      });
      dots.forEach((d, i) => (i === cur ? d.setAttribute('aria-current', 'true') : d.removeAttribute('aria-current')));
      // tải trước ảnh slide kế tiếp để chuyển mượt
      slides[(cur + 1) % slides.length].querySelector('img[loading=lazy]')?.removeAttribute('loading');
      restart();
    }
    function restart() {
      clearTimeout(timer);
      if (!reduce && !paused && !document.hidden) timer = setTimeout(() => go(cur + 1), delay);
    }
    hero.querySelector('.prev').addEventListener('click', () => go(cur - 1));
    hero.querySelector('.next').addEventListener('click', () => go(cur + 1));
    dots.forEach((d, i) => d.addEventListener('click', () => go(i)));
    const pause = (v) => { paused = v; restart(); };
    hero.addEventListener('mouseenter', () => pause(true));
    hero.addEventListener('mouseleave', () => pause(false));
    hero.addEventListener('focusin', () => pause(true));
    hero.addEventListener('focusout', () => pause(false));
    document.addEventListener('visibilitychange', restart);
    let x0 = null;
    hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
    });
    // Sau khi trang tải xong mới tải ảnh các slide sau (không làm chậm lần hiển thị đầu)
    const loadRest = () => hero.querySelectorAll('img[loading=lazy]').forEach((img) => img.removeAttribute('loading'));
    if (document.readyState === 'complete') loadRest(); else window.addEventListener('load', loadRest);
    restart();
  });

  // Trang sản phẩm: ảnh + biến thể + thêm giỏ
  const mainImg = document.getElementById('mainImg');
  document.querySelectorAll('.thumbs img').forEach((t) => t.addEventListener('click', () => {
    mainImg.src = t.dataset.full;
    document.querySelectorAll('.thumbs img').forEach((x) => x.classList.toggle('active', x === t));
  }));
  // Xem ảnh lớn: bấm ảnh chính -> mở ảnh gốc toàn màn hình, bấm tiếp để xem 100%
  const viewer = document.getElementById('imgViewer');
  if (viewer && mainImg) {
    const stage = viewer.querySelector('.iv-stage'), big = document.getElementById('ivImg');
    document.getElementById('mainImgBox').addEventListener('click', () => {
      big.src = mainImg.currentSrc || mainImg.src;
      stage.classList.remove('full');
      document.body.classList.add('iv-open');
      viewer.showModal();
    });
    big.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = big.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      stage.classList.toggle('full');
      if (stage.classList.contains('full')) { // giữ đúng chỗ vừa bấm ở giữa màn hình
        stage.scrollLeft = big.offsetWidth * fx - stage.clientWidth / 2;
        stage.scrollTop = big.offsetHeight * fy - stage.clientHeight / 2;
      }
    });
    stage.addEventListener('click', () => viewer.close()); // bấm nền tối để đóng
    viewer.querySelector('.iv-close').addEventListener('click', () => viewer.close());
    viewer.addEventListener('close', () => document.body.classList.remove('iv-open'));
  }

  const addBtn = document.getElementById('addCart');
  document.querySelectorAll('.variant').forEach((v) => v.addEventListener('click', () => {
    document.querySelectorAll('.variant').forEach((x) => x.classList.toggle('active', x === v));
    const cmp = +v.dataset.compare;
    document.getElementById('priceBox').innerHTML = cmp ? '<span class="sale">' + fmt(v.dataset.price) + '</span> <del>' + fmt(cmp) + '</del>' : fmt(v.dataset.price);
    addBtn.dataset.price = v.dataset.price;
    addBtn.dataset.variant = v.dataset.name;
  }));
  addBtn?.addEventListener('click', () => {
    const d = addBtn.dataset;
    const qty = Math.max(1, parseInt(document.getElementById('qty').value) || 1);
    const cart = load();
    const found = cart.find((i) => i.id == d.id && i.variant === d.variant);
    if (found) found.qty += qty;
    else cart.push({ id: +d.id, name: d.name, img: d.img, slug: d.slug, variant: d.variant, price: +d.price, qty });
    save(cart);
    addBtn.textContent = 'Đã thêm ✓';
    setTimeout(() => { addBtn.textContent = 'Thêm vào giỏ'; }, 1500);
    showCartPop({ name: d.name, img: d.img, variant: d.variant, price: +d.price, qty }, cart);
  });

  // Thông báo sổ xuống từ icon giỏ hàng sau khi thêm sản phẩm
  const pop = document.getElementById('cartPop');
  let popTimer = null;
  function hidePop() {
    if (!pop || pop.hidden) return;
    pop.classList.remove('show');
    clearTimeout(popTimer);
    setTimeout(() => { if (!pop.classList.contains('show')) pop.hidden = true; }, 250);
  }
  function showCartPop(item, cart) {
    if (!pop) return;
    const count = cart.reduce((s, i) => s + i.qty, 0), total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    pop.innerHTML = `
      <div class="cp-head"><span class="cp-ok" aria-hidden="true">✓</span>Đã thêm vào giỏ hàng<button type="button" class="cp-close" aria-label="Đóng">×</button></div>
      <div class="cp-item">
        <img src="${esc(item.img)}" alt="">
        <div><div class="cp-name">${esc(item.name)}</div>
          ${item.variant ? `<div class="cp-var">Kích thước: ${esc(item.variant)}</div>` : ''}
          <div class="cp-price">${item.qty} × <b>${fmt(item.price)}</b></div></div>
      </div>
      <div class="cp-sum"><span>Giỏ hàng (${count} sản phẩm)</span><b>${fmt(total)}</b></div>
      <div class="cp-btns"><a class="btn btn-outline" href="/gio-hang">Xem giỏ hàng</a><a class="btn" href="/gio-hang#dat-hang">Đặt hàng</a></div>`;
    pop.querySelector('.cp-close').addEventListener('click', hidePop);
    pop.hidden = false;
    requestAnimationFrame(() => pop.classList.add('show'));
    // Điện thoại: khung cố định ngay dưới thanh header (header dính trên cùng)
    const header = document.querySelector('.site-header');
    pop.style.top = header && window.matchMedia('(max-width: 600px)').matches ? Math.max(0, header.getBoundingClientRect().bottom) + 10 + 'px' : '';
    clearTimeout(popTimer);
    popTimer = setTimeout(hidePop, 6000);
  }
  if (pop) {
    pop.addEventListener('mouseenter', () => clearTimeout(popTimer)); // rê chuột vào thì giữ lại
    pop.addEventListener('mouseleave', () => { popTimer = setTimeout(hidePop, 3000); });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== addBtn) hidePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });
  }

  // Giỏ hàng: link "Đặt hàng" (#dat-hang) -> cuộn tới form và đặt con trỏ vào ô họ tên
  if (location.hash === '#dat-hang') {
    const f = document.getElementById('checkoutForm');
    if (f) setTimeout(() => { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); f.querySelector('input[name="customer_name"]')?.focus({ preventScroll: true }); }, 300);
  }

  // Số lượng: nút - / +
  const qtyInput = document.getElementById('qty');
  const getQty = () => Math.min(99, Math.max(1, parseInt(qtyInput.value) || 1));
  const syncQty = () => {
    document.querySelectorAll('.qty-btn').forEach((b) => { b.disabled = +b.dataset.step < 0 ? getQty() <= 1 : getQty() >= 99; });
  };
  document.querySelectorAll('.qty-btn').forEach((b) => b.addEventListener('click', () => {
    qtyInput.value = Math.min(99, Math.max(1, getQty() + +b.dataset.step));
    syncQty();
  }));
  qtyInput?.addEventListener('input', syncQty);
  qtyInput?.addEventListener('change', () => { qtyInput.value = getQty(); syncQty(); });
  if (qtyInput) syncQty();

  // Đặt nhanh: popup để lại tên, SĐT, địa chỉ -> tạo đơn hàng
  const qo = document.getElementById('quickOrder');
  if (qo && addBtn) {
    const phone = document.getElementById('qoPhone'), err = document.getElementById('qoPhoneErr');
    const close = () => { qo.close(); };
    qo.addEventListener('close', () => document.body.classList.remove('qo-open'));
    document.getElementById('quickOrderBtn').addEventListener('click', () => {
      const d = addBtn.dataset, q = getQty();
      document.getElementById('qoMeta').innerHTML = (d.variant ? esc(d.variant) + ' · ' : '') + 'SL ' + q + ' · <b>' + fmt(+d.price * q) + '</b>';
      document.getElementById('qoItems').value = JSON.stringify([{ id: +d.id, variant: d.variant, qty: q }]);
      document.body.classList.add('qo-open');
      qo.showModal();
      qo.querySelector('input[name="customer_name"]').focus();
    });
    document.getElementById('qoClose').addEventListener('click', close);
    qo.addEventListener('click', (e) => { if (e.target === qo) close(); }); // bấm ra ngoài để đóng
    // SĐT: chỉ cho gõ số, tối đa 11 số; sai (khác 10 - 11 số) thì không cho gửi
    const checkPhone = (show) => {
      const ok = /^[0-9]{10,11}$/.test(phone.value);
      phone.setCustomValidity(ok ? '' : 'Số điện thoại phải gồm 10 – 11 chữ số');
      if (show || ok) { err.hidden = ok; phone.classList.toggle('invalid', !ok); }
      return ok;
    };
    phone.addEventListener('input', () => { phone.value = phone.value.replace(/\D/g, '').slice(0, 11); checkPhone(false); });
    phone.addEventListener('blur', () => { if (phone.value) checkPhone(true); });
    phone.addEventListener('invalid', () => checkPhone(true)); // trình duyệt chặn gửi -> hiện thêm dòng báo lỗi
    const qoForm = document.getElementById('qoForm');
    qoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!checkPhone(true)) { phone.focus(); return; }
      const b = document.getElementById('qoSubmit'), label = b.textContent;
      b.disabled = true; b.textContent = 'Đang gửi…'; document.getElementById('qoFormErr').hidden = true;
      try {
        // Gửi ngầm, ở lại trang sản phẩm
        const r = await fetch(qoForm.action, { method: 'POST', body: new URLSearchParams(new FormData(qoForm)), headers: { 'x-requested-with': 'fetch' } });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) throw new Error(data.error || 'Gửi chưa được, vui lòng thử lại.');
        qo.close();
        qoForm.reset(); err.hidden = true; phone.classList.remove('invalid');
        showToast('Đã gửi thông tin đặt hàng! Chúng tôi sẽ gọi lại cho bạn sớm nhất.', 'ok');
      } catch (ex) {
        const fe = document.getElementById('qoFormErr'); // báo lỗi ngay trong popup (toast sẽ bị popup che)
        fe.textContent = ex.message === 'Failed to fetch' ? 'Mất kết nối mạng, vui lòng thử lại.' : ex.message; fe.hidden = false;
      } finally { b.disabled = false; b.textContent = label; }
    });
  }

  // Trang giỏ hàng
  const box = document.getElementById('cartItems');
  function renderCart() {
    const cart = load();
    document.getElementById('itemsField').value = JSON.stringify(cart.map(({ id, variant, qty }) => ({ id, variant, qty })));
    document.getElementById('cartTotal').textContent = fmt(cart.reduce((s, i) => s + i.price * i.qty, 0));
    if (!cart.length) { box.innerHTML = '<p class="empty">Giỏ hàng trống. <a href="/shop"><u>Xem sản phẩm</u></a></p>'; return; }
    box.innerHTML = cart.map((i, idx) => `
      <div class="cart-item">
        <a href="/san-pham/${esc(i.slug)}"><img src="${esc(i.img)}" alt=""></a>
        <div><div class="ci-name">${esc(i.name)}</div>${i.variant ? `<div class="ci-var">Kích thước: ${esc(i.variant)}</div>` : ''}
          <div>${fmt(i.price)} × <input type="number" min="1" max="99" value="${i.qty}" data-idx="${idx}"></div></div>
        <div><strong>${fmt(i.price * i.qty)}</strong><br><button class="ci-remove" data-idx="${idx}">Xóa</button></div>
      </div>`).join('');
  }
  if (box) {
    renderCart();
    box.addEventListener('change', (e) => {
      if (!e.target.dataset.idx) return;
      const cart = load(); cart[e.target.dataset.idx].qty = Math.max(1, parseInt(e.target.value) || 1); save(cart); renderCart();
    });
    box.addEventListener('click', (e) => {
      if (!e.target.classList.contains('ci-remove')) return;
      const cart = load(); cart.splice(e.target.dataset.idx, 1); save(cart); renderCart();
    });
    document.getElementById('checkoutForm').addEventListener('submit', (e) => {
      if (!load().length) { e.preventDefault(); alert('Giỏ hàng trống'); }
    });
  }
  // ---- Gallery: bấm ảnh xem lớn, chuyển ảnh bằng nút ‹ ›, phím ← →, vuốt trên điện thoại
  const gGrid = document.getElementById('galleryGrid'), gBox = document.getElementById('galleryBox');
  if (gGrid && gBox) {
    const items = [...gGrid.querySelectorAll('.gallery-item')];
    const gImg = document.getElementById('gbImg'), gCap = document.getElementById('gbCap'), gCount = document.getElementById('gbCount');
    let cur = 0;
    const show = (i) => {
      cur = (i + items.length) % items.length;
      const a = items[cur];
      gImg.src = a.getAttribute('href');
      gImg.alt = a.querySelector('img').alt;
      gCap.textContent = a.dataset.caption || '';
      gCount.textContent = (cur + 1) + ' / ' + items.length;
      const pre = items[(cur + 1) % items.length]; if (pre) new Image().src = pre.getAttribute('href'); // tải trước ảnh kế tiếp
    };
    items.forEach((a, i) => a.addEventListener('click', (e) => {
      e.preventDefault(); show(i); document.body.classList.add('iv-open'); gBox.showModal();
    }));
    gBox.querySelector('.gb-prev').addEventListener('click', () => show(cur - 1));
    gBox.querySelector('.gb-next').addEventListener('click', () => show(cur + 1));
    gBox.querySelector('.gb-close').addEventListener('click', () => gBox.close());
    gBox.addEventListener('click', (e) => { if (e.target === gBox || e.target.tagName === 'FIGURE') gBox.close(); }); // bấm nền tối để đóng
    gBox.addEventListener('close', () => document.body.classList.remove('iv-open'));
    gBox.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
    let sx = null;
    gBox.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    gBox.addEventListener('touchend', (e) => {
      if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1));
    });
    if (items.length < 2) gBox.querySelectorAll('.gb-nav').forEach((b) => { b.hidden = true; });
  }
})();
