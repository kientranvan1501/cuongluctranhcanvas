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

  // Carousel
  document.querySelectorAll('.carousel').forEach((car) => {
    const track = car.querySelector('.car-track');
    car.querySelector('.prev')?.addEventListener('click', () => track.scrollBy({ left: -track.clientWidth }));
    car.querySelector('.next')?.addEventListener('click', () => track.scrollBy({ left: track.clientWidth }));
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
  const addBtn = document.getElementById('addCart');
  document.querySelectorAll('.variant').forEach((v) => v.addEventListener('click', () => {
    document.querySelectorAll('.variant').forEach((x) => x.classList.toggle('active', x === v));
    document.getElementById('priceBox').textContent = fmt(v.dataset.price);
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
  });

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
})();
