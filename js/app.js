/* =============================================================================
   КАССА СТОЛОВОЙ — интерактивный прототип
   Вся логика клиентская, без бэкенда. Цель макета — проверить сценарии
   кассира: набор чека, правка позиций, скидка, оплата, смена, отчёты.
   ============================================================================= */

const S = {
  pin: '',
  shiftId: null,
  shiftNo: SHIFT.number,
  openedAt: SHIFT.openedAt,
  openingCash: SHIFT.openingCash,
  /* итоги смены считает база — клиент их только показывает */
  totals: { checks: 0, revenue: 0, cash: 0, cashless: 0, returns: 0, drawer: 0 },

  checkNo: 1,
  cart: [],          // {uid,id,name,price,unit,weight,qty}
  sel: null,         // uid выделенной строки
  discount: null,    // {id,name,percent}

  parked: [],        // {id,no,items,total,count,time}
  history: [],       // {no,time,total,items,payments,type:'sale'|'return'}
  cashOps: [],       // {type:'in'|'out',amount,time}

  view: 'hk',        // 'hk' — горячие клавиши, 'cat' — весь каталог
  cat: 'hits',
  pay: { method: 'cash', buf: '', splits: [] },
  qty: { uid: null, buf: '', mode: 'qty', pending: null },
  cash: { mode: 'in', buf: '' },
  lastSale: null,
};

let _uid = 0;

/* ------------------------------- утилиты -------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const nbsp = ' ';
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/\s/g, nbsp);
const money = n => fmt(n) + nbsp + '₽';
const kg = g => (g / 1000).toFixed(3).replace('.', ',');
/* склонение существительного при числе: 1 чек / 2 чека / 5 чеков */
function plural(n, a, b, c) {
  const m = n % 100, k = n % 10;
  if (m > 10 && m < 20) return c;
  if (k === 1) return a;
  if (k >= 2 && k <= 4) return b;
  return c;
}
const catOf = id => CATEGORIES.find(c => c.id === id) || { name: '', short: '', color: 'var(--tx-3)' };

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.innerHTML = `<span class="dot ${kind || ''}"></span>${msg}`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0'; el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 260);
  }, 2300);
}

const open  = id => $('#' + id).classList.remove('hidden');
const close = id => {
  const v = $('#' + id);
  v.classList.add('hidden');
  /* поле исчезло вместе с окном — виртуальная клавиатура не должна остаться */
  if (typeof VK !== 'undefined') VK.closeIfInside(v);
};
const topVeil = () => $$('.veil').filter(v => !v.classList.contains('hidden')).pop();

$$('.veil').forEach(v => {
  v.addEventListener('mousedown', e => { if (e.target === v && v.id !== 'modalDone') close(v.id); });
  $$('[data-close]', v).forEach(b => b.addEventListener('click', () => close(v.id)));
});

function ask(title, text, yesLabel, onYes) {
  $('#askTitle').textContent = title;
  $('#askText').innerHTML = text;
  const old = $('#btnAskYes');
  const btn = old.cloneNode(true);
  btn.textContent = yesLabel;
  old.parentNode.replaceChild(btn, old);
  btn.addEventListener('click', () => { close('modalAsk'); onYes(); });
  open('modalAsk');
}

/* ------------------------- состояние смены ------------------------------ */
/* Любая операция, меняющая смену, возвращает с сервера её полный снимок.
   Клиент не пересчитывает итоги сам — иначе два терминала разойдутся. */
function applyState(st) {
  if (!st) return;
  S.shiftId     = st.shift.id;
  S.shiftNo     = st.shift.number;
  S.openedAt    = st.shift.openedAt;
  S.openingCash = st.shift.openingCash;
  CASHIER.register = st.shift.register;
  S.checkNo     = st.nextCheckNumber;
  S.totals      = st.totals;

  S.history = st.checks.map(c => ({
    no: c.number,
    type: c.kind,
    total: Number(c.total),
    change: Number(c.change || 0),
    time: c.time,
    items: c.items || [],
    payments: (c.payments || []).map(p => ({ m: p.m, amount: Number(p.amount) })),
  }));

  S.cashOps = st.cashOps.map(o => ({ type: o.type, amount: Number(o.amount), time: o.time }));

  S.parked = st.parked.map(p => ({
    id: p.id,
    no: p.no,
    total: Number(p.total),
    count: p.count,
    time: p.time,
    items: p.payload?.items || [],
    discount: p.payload?.discount || null,
  }));

  const reg = $('#topRegister'); if (reg) reg.textContent = `Касса №${CASHIER.register}`;
}

/* ------------------------- выпадающие меню ------------------------------ */
function bindDrop(btnId, menuId) {
  $('#' + btnId).addEventListener('click', e => {
    e.stopPropagation();
    const m = $('#' + menuId);
    const wasOpen = !m.classList.contains('hidden');
    $$('.menu').forEach(x => x.classList.add('hidden'));
    $$('.tbtn').forEach(x => x.classList.remove('on'));
    if (!wasOpen) { m.classList.remove('hidden'); $('#' + btnId).classList.add('on'); }
  });
}
document.addEventListener('click', () => {
  $$('.menu').forEach(x => x.classList.add('hidden'));
  $$('.tbtn').forEach(x => x.classList.remove('on'));
});
bindDrop('btnShift', 'menuShift');
bindDrop('btnCheckMore', 'menuCheck');
bindDrop('btnSetup', 'menuSetup');

/* ---------------------- доступ в режим настройки ------------------------ */
/* Кассир и администратор работают на одном терминале, поэтому вход в правку
   структуры закрыт коротким PIN — не бюрократия, а защита от случайного
   касания во время смены. */
let admBuf = '', admThen = null;

$('#menuSetup').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'keys') return open('modalKeys');
  if (b.dataset.act === 'hk') return requireAdmin(() => HK.openEditor());
});
function requireAdmin(then) {
  admBuf = ''; admThen = then; renderAdm(); open('modalPin');
}
function renderAdm() { $$('#admDots i').forEach((d, i) => d.classList.toggle('on', i < admBuf.length)); }
$('#admPad').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  admKey(b.dataset.k);
});
function admKey(k) {
  if (k === 'clear') admBuf = '';
  else if (k === 'back') admBuf = admBuf.slice(0, -1);
  else if (admBuf.length < 4) admBuf += k;
  renderAdm();
  if (admBuf.length === 4) {
    if (admBuf === CASHIER.pin) { close('modalPin'); const t = admThen; admThen = null; setTimeout(t, 120); }
    else {
      const d = $('#admDots');
      d.classList.add('err');
      setTimeout(() => { d.classList.remove('err'); admBuf = ''; renderAdm(); }, 340);
      toast('Неверный PIN администратора', 'bad');
    }
  }
}

/* -------------------------------- часы ---------------------------------- */
function tick() {
  const now = new Date();
  const t = now.toLocaleTimeString('ru-RU', { hour12: false });
  $('#loginClock').textContent = t.slice(0, 5);
  $('#clockTime').textContent = t;
}
setInterval(tick, 1000); tick();

/* ================================ ВХОД =================================== */
/* В интерфейсе показываем только рабочее место — имя кассира не выводится */
$('#loginRegister').textContent = `Касса №${CASHIER.register}`;
$('#topRegister').textContent = `Касса №${CASHIER.register}`;

function renderPin() {
  $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < S.pin.length));
}
$('#pinPad').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  pinKey(b.dataset.k);
});
function pinKey(k) {
  if (k === 'clear') S.pin = '';
  else if (k === 'back') S.pin = S.pin.slice(0, -1);
  else if (S.pin.length < 4) S.pin += k;
  renderPin();
  if (S.pin.length === 4) {
    if (S.pin === CASHIER.pin) setTimeout(enter, 130);
    else {
      const d = $('#pinDots');
      d.classList.add('err');
      setTimeout(() => { d.classList.remove('err'); S.pin = ''; renderPin(); }, 340);
      toast('Неверный PIN-код', 'bad');
    }
  }
}
async function enter() {
  S.pin = ''; renderPin();
  $('#screen-login').classList.add('hidden');
  $('#screen-main').classList.remove('hidden');
  renderCats(); renderAll();
  /* За время простоя смену мог изменить другой терминал — берём свежий снимок */
  try { applyState(await API.state()); renderAll(); } catch (_) { /* покажем то, что есть */ }
  toast(`Смена №${S.shiftNo} открыта`);
}
$('#btnLogout').addEventListener('click', () => {
  ask('Завершить сеанс?', 'Смена останется открытой. Незавершённый чек будет отложен автоматически.', 'Завершить', () => {
    if (S.cart.length) parkCurrent(true);
    $('#screen-main').classList.add('hidden');
    $('#screen-login').classList.remove('hidden');
    $('#loginTitle').textContent = 'Сеанс завершён';
    $('#loginSub').textContent = `Смена №${S.shiftNo} открыта в ${S.openedAt}. Введите PIN-код для продолжения`;
  });
});

/* ============================== КАТАЛОГ ================================== */
function renderCats() {
  const html = [`<button class="cat hits ${S.cat === 'hits' ? 'on' : ''}" data-cat="hits"><i></i><span>Ходовые</span></button>`]
    .concat(CATEGORIES.map(c =>
      `<button class="cat ${S.cat === c.id ? 'on' : ''}" data-cat="${c.id}" style="--c:${c.color}"><i></i><span>${c.name}</span></button>`
    ));
  $('#cats').innerHTML = html.join('');
}
$('#cats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  S.cat = b.dataset.cat;
  renderCats(); renderGrid();
  $('#grid').scrollTop = 0;
});

/* Витрина работает в двух режимах: собственные горячие клавиши заведения
   и полный каталог по категориям — как запасной путь, если позиции нет
   на витрине или её только что завели в номенклатуре. */
$('#viewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  setView(b.dataset.view);
});
function setView(v) {
  S.view = v;
  $$('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.view === v));
  $('#cats').classList.toggle('hidden', v !== 'cat');
  $('#crumbs').classList.toggle('hidden', v !== 'hk');
  renderGrid();
  $('#grid').scrollTop = 0;
}

function renderGrid() {
  if (S.view === 'hk') return HK.renderCashier();
  const items = S.cat === 'hits' ? PRODUCTS.filter(p => p.hit) : PRODUCTS.filter(p => p.cat === S.cat);
  if (!items.length) { $('#grid').innerHTML = `<div class="grid-none">В этой группе пока нет позиций</div>`; return; }
  $('#grid').innerHTML = items.map(p => {
    const c = catOf(p.cat);
    const inCart = S.cart.filter(r => r.id === p.id);
    const q = inCart.reduce((s, r) => s + r.qty, 0);
    const badge = q ? `<span class="qty num">${p.weight ? kg(q * 1000).replace(',000', '') : q}</span>` : '';
    return `<button class="tile ${p.cat === 'combo' ? 'combo' : ''} ${q ? 'in' : ''}" data-id="${p.id}" style="--c:${c.color}">
      ${badge}
      <span class="tag">${c.short}${p.weight ? `<span class="wt">ВЕС</span>` : ''}</span>
      <span class="nm">${p.name}</span>
      <span class="bot"><span class="pr num">${money(p.price)}</span><span class="un">/${nbsp}${p.unit}</span></span>
    </button>`;
  }).join('');
}
$('#grid').addEventListener('click', e => {
  if (S.view === 'hk') { HK.onGridClick(e); return; }
  const b = e.target.closest('[data-id]'); if (!b) return;
  addProduct(b.dataset.id);
});

/* ================================ ПОИСК ================================== */
const sInput = $('#searchInput');
const sRes = $('#searchRes');
let sHi = 0;

function renderSearch() {
  const q = sInput.value.trim().toLowerCase();
  $('#btnSearchClear').classList.toggle('hidden', !q);
  if (!q) { sRes.classList.add('hidden'); return; }
  const found = PRODUCTS.filter(p => p.name.toLowerCase().includes(q)).slice(0, 9);
  sHi = 0;
  sRes.innerHTML = found.length
    ? found.map((p, i) => {
        const c = catOf(p.cat);
        return `<div class="sr ${i === 0 ? 'hi' : ''}" data-id="${p.id}">
          <span class="tag" style="color:${c.color}">${c.short}</span>
          <span class="n">${p.name}</span>
          <span class="p num">${money(p.price)}</span></div>`;
      }).join('')
    : `<div class="sr-none">Ничего не найдено по запросу «${sInput.value.trim()}»</div>`;
  sRes.classList.remove('hidden');
}
sInput.addEventListener('input', renderSearch);
sInput.addEventListener('keydown', e => {
  const rows = $$('.sr', sRes);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!rows.length) return;
    sHi = (sHi + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('hi', i === sHi));
    rows[sHi].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const r = rows[sHi]; if (r) { addProduct(r.dataset.id); clearSearch(); }
  } else if (e.key === 'Escape') { clearSearch(); sInput.blur(); }
});
sRes.addEventListener('click', e => {
  const r = e.target.closest('[data-id]'); if (!r) return;
  addProduct(r.dataset.id); clearSearch();
});
function clearSearch() { sInput.value = ''; sRes.classList.add('hidden'); $('#btnSearchClear').classList.add('hidden'); }
$('#btnSearchClear').addEventListener('click', () => { clearSearch(); sInput.focus(); });
document.addEventListener('click', e => {
  if (!e.target.closest('.search-field') && !e.target.closest('#vk')) sRes.classList.add('hidden');
});

/* ================================= ЧЕК =================================== */
function addProduct(id) {
  const p = PRODUCTS.find(x => x.id === id); if (!p) return;
  if (p.weight) { openQtyForNew(p); return; }
  const row = S.cart.find(r => r.id === id);
  if (row) row.qty += 1;
  else S.cart.push({ uid: ++_uid, id: p.id, name: p.name, price: p.price, unit: p.unit, weight: false, qty: 1, fresh: true });
  S.sel = null;
  renderAll(true);
}

const lineSum = r => r.price * r.qty;
const subtotal = () => S.cart.reduce((s, r) => s + lineSum(r), 0);
const discountSum = () => S.discount ? Math.round(subtotal() * S.discount.percent / 100) : 0;
const total = () => subtotal() - discountSum();
const posCount = () => S.cart.length;

function renderCheck() {
  const list = $('#checkList');
  if (!S.cart.length) {
    list.innerHTML = `<div class="check-empty">
      <svg><use href="#i-cart"/></svg>
      <div class="t">Чек пуст</div>
      <div class="h">Выберите блюдо на витрине справа или начните вводить название — поиск откроется сам</div>
    </div>`;
    return;
  }
  list.innerHTML = S.cart.map(r => {
    const sel = S.sel === r.uid;
    const qtyText = r.weight ? `${kg(r.qty * 1000)}${nbsp}кг` : r.qty;
    const priceText = r.weight
      ? `<b class="num">${kg(r.qty * 1000)}${nbsp}кг</b> × ${money(r.price)}/кг`
      : `<b class="num">${r.qty}</b> × ${money(r.price)}`;
    const stepper = r.weight
      ? `<div class="stepper"><button class="q num" data-act="qty" data-uid="${r.uid}">${qtyText}</button></div>`
      : `<div class="stepper">
           <button data-act="dec" data-uid="${r.uid}" aria-label="Меньше">−</button>
           <button class="q num" data-act="qty" data-uid="${r.uid}">${qtyText}</button>
           <button data-act="inc" data-uid="${r.uid}" aria-label="Больше">+</button>
         </div>`;
    return `<div class="row ${sel ? 'sel' : ''} ${r.fresh ? 'new' : ''}" data-uid="${r.uid}">
      <div class="row-top">
        <div class="row-name">${r.name}</div>
        <div class="row-sum num">${money(lineSum(r))}</div>
      </div>
      <div class="row-bot">
        <div class="row-price">${priceText}</div>
        ${stepper}
      </div>
      ${sel ? `<div class="row-acts">
        <button data-act="qty" data-uid="${r.uid}"><svg><use href="#${r.weight ? 'i-scale' : 'i-plus'}"/></svg>${r.weight ? 'Указать вес' : 'Количество'}</button>
        <button class="danger" data-act="del" data-uid="${r.uid}"><svg><use href="#i-trash"/></svg>Удалить</button>
      </div>` : ''}
    </div>`;
  }).join('');
  S.cart.forEach(r => delete r.fresh);
}

$('#checkList').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (b) {
    const uid = +b.dataset.uid;
    const r = S.cart.find(x => x.uid === uid); if (!r) return;
    if (b.dataset.act === 'inc') { r.qty++; renderAll(); }
    if (b.dataset.act === 'dec') { r.qty--; if (r.qty <= 0) S.cart = S.cart.filter(x => x.uid !== uid); renderAll(); }
    if (b.dataset.act === 'qty') openQtyForRow(r);
    if (b.dataset.act === 'del') { S.cart = S.cart.filter(x => x.uid !== uid); S.sel = null; renderAll(); }
    return;
  }
  const row = e.target.closest('.row'); if (!row) return;
  const uid = +row.dataset.uid;
  S.sel = S.sel === uid ? null : uid;
  renderCheck();
});

function renderTotals() {
  $('#fCount').textContent = posCount();
  $('#checkNo').textContent = '№ ' + String(S.checkNo).padStart(4, '0');
  $('#clockMeta').textContent = `Смена №${S.shiftNo} · Чек №${String(S.checkNo).padStart(4, '0')}`;

  const d = $('#fDiscLine');
  if (S.discount) {
    d.classList.remove('hidden');
    $('#fDiscName').textContent = `Скидка · ${S.discount.name} ${S.discount.percent}%`;
    $('#fDiscVal').textContent = '−' + money(discountSum());
  } else d.classList.add('hidden');

  $('#fTotal').textContent = money(total());
  const empty = !S.cart.length;
  $('#btnPay').disabled = empty;
  $('#btnPark').disabled = empty;
  $('#btnUndo').style.opacity = empty ? .4 : 1;
  const amt = $('#payAmt');
  amt.classList.toggle('hidden', empty);
  amt.textContent = empty ? '' : '· ' + money(total());

  $('#parkedBadge').textContent = S.parked.length;
  $('#parkedBadge').classList.toggle('hidden', !S.parked.length);
}

function renderAll(scroll) {
  renderCheck(); renderTotals(); renderGrid();
  if (scroll) { const l = $('#checkList'); l.scrollTop = l.scrollHeight; }
}

/* отмена последней позиции */
$('#btnUndo').addEventListener('click', () => {
  if (!S.cart.length) return;
  const r = S.cart[S.cart.length - 1];
  if (r.qty > 1 && !r.weight) r.qty--; else S.cart.pop();
  S.sel = null; renderAll();
  toast('Последняя позиция отменена');
});

/* меню чека */
$('#menuCheck').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'disc') openDiscount();
  if (a === 'kitchen') {
    if (!S.cart.length) return toast('Чек пуст', 'warn');
    toast('Заказ отправлен на раздачу');
  }
  if (a === 'void') {
    if (!S.cart.length) return toast('Чек пуст', 'warn');
    ask('Аннулировать чек?', `Из чека будет удалено <b>${posCount()}</b> поз. на сумму <b>${money(total())}</b>. Действие необратимо.`, 'Аннулировать', () => {
      S.cart = []; S.sel = null; S.discount = null; renderAll();
      toast('Чек аннулирован', 'warn');
    });
  }
});

/* ============================ КОЛИЧЕСТВО / ВЕС =========================== */
const WEIGHT_PRESETS = [100, 150, 200, 250, 300, 500];

function openQtyForNew(p) {
  S.qty = { uid: null, buf: '', mode: 'weight', pending: p };
  showQty(p.name, p.price, 'weight');
}
function openQtyForRow(r) {
  S.qty = { uid: r.uid, buf: '', mode: r.weight ? 'weight' : 'qty', pending: null };
  showQty(r.name, r.price, r.weight ? 'weight' : 'qty');
}
function showQty(name, price, mode) {
  S.qty.price = price;
  $('#qtyTitle').textContent = mode === 'weight' ? 'Вес позиции' : 'Количество';
  $('#qtyItem').textContent = name;
  $('#qtyLabel').textContent = mode === 'weight' ? 'Вес' : 'Количество';
  const pre = $('#qtyPresets');
  pre.classList.toggle('hidden', mode !== 'weight');
  if (mode === 'weight') pre.innerHTML = WEIGHT_PRESETS.map(g => `<button data-g="${g}">${g}${nbsp}г</button>`).join('');
  renderQty();
  open('modalQty');
}
function qtyValue() {
  const n = parseInt(S.qty.buf || '0', 10);
  return S.qty.mode === 'weight' ? n / 1000 : n;
}
function renderQty() {
  const v = qtyValue();
  $('#qtyVal').textContent = S.qty.mode === 'weight' ? kg(v * 1000) + nbsp + 'кг' : (S.qty.buf === '' ? '—' : v);
  $('#qtySum').textContent = money(v * S.qty.price);
  $('#btnQtyOk').disabled = v <= 0;
}
$('#qtyPresets').addEventListener('click', e => {
  const b = e.target.closest('[data-g]'); if (!b) return;
  S.qty.buf = b.dataset.g; renderQty();
});
$('#qtyKeys').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  qtyKey(b.dataset.k);
});
function qtyKey(k) {
  if (k === 'clear') S.qty.buf = '';
  else if (k === 'back') S.qty.buf = S.qty.buf.slice(0, -1);
  else if (S.qty.buf.length < 5) S.qty.buf = (S.qty.buf + k).replace(/^0+(?=\d)/, '');
  renderQty();
}
$('#btnQtyOk').addEventListener('click', applyQty);
function applyQty() {
  const v = qtyValue();
  if (v <= 0) return;
  if (S.qty.pending) {
    const p = S.qty.pending;
    S.cart.push({ uid: ++_uid, id: p.id, name: p.name, price: p.price, unit: p.unit, weight: true, qty: v, fresh: true });
  } else {
    const r = S.cart.find(x => x.uid === S.qty.uid);
    if (r) r.qty = v;
  }
  close('modalQty');
  renderAll(true);
}

/* ================================ СКИДКА ================================= */
function openDiscount() {
  if (!S.cart.length) return toast('Сначала добавьте позиции', 'warn');
  $('#discOpts').innerHTML = DISCOUNTS.map(d => {
    const on = (S.discount ? S.discount.id : 'none') === d.id;
    const sum = d.percent ? '−' + money(subtotal() * d.percent / 100) : '';
    return `<button class="opt ${on ? 'on' : ''}" data-d="${d.id}">
      ${d.name}<span class="pc num">${d.percent ? d.percent + '%' : ''}${sum ? nbsp + nbsp + sum : ''}</span></button>`;
  }).join('');
  open('modalDisc');
}
$('#discOpts').addEventListener('click', e => {
  const b = e.target.closest('[data-d]'); if (!b) return;
  const d = DISCOUNTS.find(x => x.id === b.dataset.d);
  S.discount = d.percent ? d : null;
  close('modalDisc'); renderTotals();
  toast(d.percent ? `Скидка «${d.name}» ${d.percent}%` : 'Скидка снята');
});
$('#btnDiscClear').addEventListener('click', () => { S.discount = null; renderTotals(); toast('Скидка снята'); });

/* ============================== ОТЛОЖЕННЫЕ =============================== */
$('#btnPark').addEventListener('click', () => parkCurrent());
async function parkCurrent(silent) {
  if (!S.cart.length) return;
  const payload = { items: S.cart.slice(), discount: S.discount };
  try {
    applyState(await API.park({
      number: S.checkNo, total: total(), positions: posCount(), payload,
    }));
    S.cart = []; S.sel = null; S.discount = null;
    renderAll();
    if (!silent) toast('Чек отложен');
  } catch (err) {
    toast('Не удалось отложить: ' + err.message, 'bad');
  }
}
$('#btnParked').addEventListener('click', () => { renderParked(); open('modalParked'); });
function renderParked() {
  $('#parkedList').innerHTML = S.parked.length ? S.parked.map(p => `
    <div class="lc">
      <div>
        <div class="t1 num">Чек № ${String(p.no).padStart(4, '0')}</div>
        <div class="t2">${p.time} · ${p.count} поз.</div>
      </div>
      <div class="sum num">${money(p.total)}</div>
      <div class="acts">
        <button data-res="${p.id}">Продолжить</button>
        <button class="danger" data-del="${p.id}">Удалить</button>
      </div>
    </div>`).join('') : `<div class="none">Отложенных чеков нет</div>`;
}
$('#parkedList').addEventListener('click', e => {
  const res = e.target.closest('[data-res]');
  const del = e.target.closest('[data-del]');

  if (res) {
    const p = S.parked.find(x => x.id === +res.dataset.res);
    const restore = async () => {
      const items = p.items, disc = p.discount;
      try {
        applyState(await API.unpark(p.id));
        S.cart = items; S.discount = disc; S.sel = null;
        close('modalParked'); renderAll(); toast('Чек восстановлен');
      } catch (err) {
        toast('Не удалось восстановить: ' + err.message, 'bad');
      }
    };
    if (S.cart.length) ask('Заменить текущий чек?', 'Текущий чек будет отложен, а выбранный — открыт для продолжения.', 'Продолжить', async () => { await parkCurrent(true); restore(); });
    else restore();
  }

  if (del) {
    const p = S.parked.find(x => x.id === +del.dataset.del);
    ask('Удалить отложенный чек?', `Чек № ${String(p.no).padStart(4, '0')} на ${money(p.total)} будет удалён.`, 'Удалить', async () => {
      try {
        applyState(await API.unpark(p.id));
        renderParked(); renderTotals(); toast('Отложенный чек удалён', 'warn');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });
  }
});

/* ================================ ОПЛАТА ================================= */
const METHOD_NAME = { cash: 'Наличные', card: 'Банковская карта', qr: 'СБП по QR', staff: 'Карта сотрудника' };

const paidSum  = () => S.pay.splits.reduce((s, x) => s + x.amount, 0);
const remainSum = () => Math.max(0, total() - paidSum());
const entered = () => parseInt(S.pay.buf || '0', 10);

$('#btnPay').addEventListener('click', openPay);
function openPay() {
  if (!S.cart.length) return;
  S.pay = { method: 'cash', buf: '', splits: [] };
  $('#payCheckNo').textContent = '№ ' + String(S.checkNo).padStart(4, '0');
  setMethod('cash');
  open('sheetPay');
}
$('#methods').addEventListener('click', e => {
  const b = e.target.closest('[data-m]'); if (!b) return;
  setMethod(b.dataset.m);
});
function setMethod(m) {
  S.pay.method = m; S.pay.buf = '';
  $$('#methods .method').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('#uiCash').classList.toggle('hidden', m !== 'cash');
  $('#uiTerminal').classList.toggle('hidden', m === 'cash');
  $('#terminalText').textContent = m === 'card'
    ? 'Передайте сумму на банковский терминал и дождитесь подтверждения операции'
    : m === 'qr'
      ? 'Покажите покупателю QR-код на дисплее и дождитесь уведомления об оплате'
      : 'Приложите карту сотрудника к считывателю — сумма спишется с лицевого счёта';
  renderPay();
}
function renderPay() {
  const rem = remainSum();
  $('#payBoxLabel').textContent = S.pay.splits.length ? 'Осталось оплатить' : 'Итого к оплате';
  $('#payTotal').textContent = money(rem);

  /* быстрые суммы: точная + ближайшие удобные номиналы */
  const ups = [Math.ceil(rem / 100) * 100, Math.ceil(rem / 500) * 500, 500, 1000, 2000, 5000]
    .filter(v => v > rem);
  const uniq = [...new Set(ups)].sort((a, b) => a - b).slice(0, 5);
  $('#quickSums').innerHTML =
    `<button data-s="${rem}">Без сдачи</button>` + uniq.map(v => `<button data-s="${v}" class="num">${fmt(v)}</button>`).join('');

  const got = S.pay.buf === '' ? rem : entered();
  $('#gotVal').textContent = money(got);

  const box = $('#changeBox');
  box.classList.remove('change', 'ok');
  if (got > rem) { box.classList.add('change'); $('#changeLabel').textContent = 'Сдача'; $('#changeVal').textContent = money(got - rem); }
  else if (got === rem) { box.classList.add('ok'); $('#changeLabel').textContent = 'Сдача'; $('#changeVal').textContent = 'Без сдачи'; }
  else { box.classList.add('change'); $('#changeLabel').textContent = 'Не хватает'; $('#changeVal').textContent = money(rem - got); }

  const partial = S.pay.method === 'cash' && S.pay.buf !== '' && got > 0 && got < rem;
  $('#btnSplit').classList.toggle('hidden', !partial);

  $('#splits').innerHTML = S.pay.splits.map((s, i) => `
    <div class="split">
      <span class="m">${METHOD_NAME[s.m]}</span>
      <span class="a num">${money(s.amount)}</span>
      <button data-rm="${i}"><svg><use href="#i-close"/></svg></button>
    </div>`).join('');

  $('#btnPayConfirm').disabled = S.pay.method === 'cash' && got < rem;
  $('#btnPayConfirm').textContent = S.pay.method === 'cash' && got > rem
    ? 'Провести и выдать сдачу' : 'Провести оплату';
}
$('#quickSums').addEventListener('click', e => {
  const b = e.target.closest('[data-s]'); if (!b) return;
  S.pay.buf = b.dataset.s; renderPay();
});
$('#payKeys').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  payKey(b.dataset.k);
});
function payKey(k) {
  if (k === 'clear') S.pay.buf = '';
  else if (k === 'back') S.pay.buf = S.pay.buf.slice(0, -1);
  else if (S.pay.buf.length < 7) S.pay.buf = (S.pay.buf + k).replace(/^0+(?=\d)/, '');
  renderPay();
}
$('#splits').addEventListener('click', e => {
  const b = e.target.closest('[data-rm]'); if (!b) return;
  S.pay.splits.splice(+b.dataset.rm, 1); renderPay();
});
$('#btnSplit').addEventListener('click', () => {
  S.pay.splits.push({ m: S.pay.method, amount: entered() });
  S.pay.buf = ''; renderPay();
  toast('Частичная оплата внесена');
});
$('#btnDrawer').addEventListener('click', () => toast('Денежный ящик открыт'));

/* Чек считается пробитым только после ответа базы: пока запись не прошла,
   кассир не должен увидеть «оплачено» и отдать товар. */
$('#btnPayConfirm').addEventListener('click', async () => {
  const btn = $('#btnPayConfirm');
  const rem = remainSum();
  const got = S.pay.method === 'cash' ? (S.pay.buf === '' ? rem : entered()) : rem;
  const change = S.pay.method === 'cash' ? Math.max(0, got - rem) : 0;
  const splits = S.pay.splits.concat([{ m: S.pay.method, amount: rem }]);

  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Провожу оплату…';

  try {
    const st = await API.sale({
      items: S.cart.map(r => ({ id: r.id, name: r.name, price: r.price, unit: r.unit, qty: r.qty })),
      discountId: S.discount ? S.discount.id : null,
      payments: splits.map(x => ({ m: x.m, amount: x.amount })),
      change,
    });

    const saved = st.checks[0];
    applyState(st);
    S.lastSale = saved;

    close('sheetPay');
    $('#doneSub').textContent = `Чек № ${String(saved.number).padStart(4, '0')} · ${money(saved.total)} · ${splits.map(x => METHOD_NAME[x.m]).join(' + ')}`;
    $('#doneChange').classList.toggle('hidden', !change);
    $('#doneChangeVal').textContent = money(change);
    open('modalDone');

    S.cart = []; S.sel = null; S.discount = null;
    HK.goRoot();   /* следующий покупатель начинает с первого экрана витрины */
    renderAll();
  } catch (err) {
    toast('Чек не проведён: ' + err.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});
$('#btnNewCheck').addEventListener('click', () => { close('modalDone'); sInput.blur(); });
$('#btnPrintCopy').addEventListener('click', () => toast('Копия чека отправлена на печать'));

/* ============================== ЧЕКИ СМЕНЫ =============================== */
$('#btnHistory').addEventListener('click', () => { renderHistory(); open('modalHistory'); });
function renderHistory() {
  const sales = S.history.filter(h => h.type === 'sale');
  $('#histSub').textContent = `${sales.length} ${plural(sales.length, 'чек', 'чека', 'чеков')} · выручка ${money(revenue())}`;
  $('#historyList').innerHTML = S.history.length ? S.history.map(h => `
    <div class="lc">
      <div>
        <div class="t1 num">${h.type === 'return' ? 'Возврат по чеку' : 'Чек'} № ${String(h.no).padStart(4, '0')}</div>
        <div class="t2">${h.time} · ${h.items.length} поз. · ${h.payments.map(p => METHOD_NAME[p.m]).join(', ')}</div>
      </div>
      <div class="sum num" ${h.type === 'return' ? 'style="color:var(--bad)"' : ''}>${h.type === 'return' ? '−' : ''}${money(h.total)}</div>
      <div class="acts">
        <button data-copy="${h.no}">Копия</button>
        ${h.type === 'sale' ? `<button class="danger" data-ret="${h.no}">Возврат</button>` : ''}
      </div>
    </div>`).join('') : `<div class="none">В этой смене ещё не было чеков</div>`;
}
$('#historyList').addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  const r = e.target.closest('[data-ret]');
  if (c) toast('Копия чека отправлена на печать');
  if (r) { close('modalHistory'); doReturn(+r.dataset.ret); }
});

/* ================================ ВОЗВРАТ ================================ */
$('#btnReturn').addEventListener('click', () => { renderReturnList(); open('modalReturn'); });
function renderReturnList() {
  const sales = S.history.filter(h => h.type === 'sale');
  $('#returnList').innerHTML = sales.length ? sales.map(h => `
    <div class="lc">
      <div>
        <div class="t1 num">Чек № ${String(h.no).padStart(4, '0')}</div>
        <div class="t2">${h.time} · ${h.items.length} поз. · ${h.payments.map(p => METHOD_NAME[p.m]).join(', ')}</div>
      </div>
      <div class="sum num">${money(h.total)}</div>
      <div class="acts"><button class="danger" data-ret="${h.no}">Оформить возврат</button></div>
    </div>`).join('') : `<div class="none">Возврат возможен только по чеку текущей смены.<br>Чеков пока нет.</div>`;
}
$('#returnList').addEventListener('click', e => {
  const r = e.target.closest('[data-ret]'); if (!r) return;
  close('modalReturn'); doReturn(+r.dataset.ret);
});
function doReturn(no) {
  const h = S.history.find(x => x.no === no && x.type === 'sale'); if (!h) return;
  ask('Оформить возврат?', `Будет пробит чек возврата на <b>${money(h.total)}</b> по чеку № ${String(no).padStart(4, '0')}. Деньги выдаются тем же способом: ${h.payments.map(p => METHOD_NAME[p.m]).join(', ')}.`, 'Оформить возврат', async () => {
    try {
      applyState(await API.refund(no));
      renderAll();
      toast('Возврат оформлен, чек напечатан', 'warn');
    } catch (err) {
      toast('Возврат не проведён: ' + err.message, 'bad');
    }
  });
}

/* ============================ ДЕНЬГИ И СМЕНА ============================= */
/* Все суммы смены посчитаны запросами к базе — здесь только чтение снимка. */
const revenue    = () => S.totals.revenue;
const byMethod   = kind => (kind === 'cash' ? S.totals.cash : S.totals.cashless);
const returnsSum = () => S.totals.returns;
const drawerCash = () => S.totals.drawer;

$('#menuShift').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'drawer') return toast('Денежный ящик открыт');
  if (a === 'in' || a === 'out') return openCash(a);
  if (a === 'x') return openReport('x');
  if (a === 'z') return openReport('z');
});

function openCash(mode) {
  S.cash = { mode, buf: '' };
  $('#cashTitle').textContent = mode === 'in' ? 'Внести наличные' : 'Изъять наличные';
  renderCash(); open('modalCash');
}
function renderCash() {
  $('#cashVal').textContent = money(parseInt(S.cash.buf || '0', 10));
  $('#btnCashOk').disabled = !parseInt(S.cash.buf || '0', 10);
}
$('#cashKeys').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const k = b.dataset.k;
  if (k === 'clear') S.cash.buf = '';
  else if (k === 'back') S.cash.buf = S.cash.buf.slice(0, -1);
  else if (S.cash.buf.length < 7) S.cash.buf = (S.cash.buf + k).replace(/^0+(?=\d)/, '');
  renderCash();
});
$('#btnCashOk').addEventListener('click', async () => {
  const amount = parseInt(S.cash.buf || '0', 10);
  if (!amount) return;
  const btn = $('#btnCashOk');
  btn.disabled = true;
  try {
    applyState(await API.cash({ kind: S.cash.mode, amount }));
    close('modalCash');
    renderTotals();
    toast(S.cash.mode === 'in' ? `Внесено ${money(amount)}` : `Изъято ${money(amount)}`);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
});

function openReport(mode) {
  const z = mode === 'z';
  $('#repTitle').textContent = z ? 'Закрытие смены · Z-отчёт' : 'X-отчёт';
  $('#repSub').textContent = `Смена №${S.shiftNo} · открыта в ${S.openedAt} · касса №${CASHIER.register}`;
  $('#repChecks').textContent = S.history.filter(h => h.type === 'sale').length;
  $('#repRevenue').textContent = money(revenue());
  $('#repCash').textContent = money(byMethod('cash'));
  $('#repCashless').textContent = money(byMethod('cashless'));
  $('#repReturns').textContent = money(returnsSum());
  $('#repDrawer').textContent = money(drawerCash());
  $('#repCloseArea').classList.toggle('hidden', !z);
  $('#repRecount').value = '';
  $('#repVerdict').innerHTML = '';
  $('#repFoot').innerHTML = z
    ? `<button class="btn" data-close style="flex:1">Отмена</button><button class="btn btn-danger" id="btnZ" style="flex:1.4">Закрыть смену</button>`
    : `<button class="btn" data-close style="flex:1"><svg><use href="#i-print"/></svg>Печать X-отчёта</button><button class="btn btn-primary" data-close style="flex:1">Готово</button>`;
  $$('#repFoot [data-close]').forEach(b => b.addEventListener('click', () => close('modalReport')));
  const zb = $('#btnZ');
  if (zb) zb.addEventListener('click', closeShift);
  open('modalReport');
}
$('#repRecount').addEventListener('input', e => {
  const v = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
  e.target.value = v ? fmt(v) : '';
  const diff = v - drawerCash();
  $('#repVerdict').innerHTML = !v ? '' : diff === 0
    ? `<div class="verdict ok"><span>Расхождений нет</span><span class="num">${money(v)}</span></div>`
    : `<div class="verdict warn"><span>${diff > 0 ? 'Излишек' : 'Недостача'}</span><span class="num">${money(Math.abs(diff))}</span></div>`;
});
function closeShift() {
  const counted = parseInt(($('#repRecount').value || '').replace(/\D/g, ''), 10);
  close('modalReport');
  ask('Закрыть смену?', `Будет напечатан Z-отчёт, выручка <b>${money(revenue())}</b> зафиксирована. Открыть новую смену можно сразу после закрытия.`, 'Закрыть смену', async () => {
    try {
      const res = await API.closeShift(Number.isFinite(counted) ? counted : null);
      applyState(res);
      S.cart = []; S.discount = null; S.sel = null;
      $('#screen-main').classList.add('hidden');
      $('#screen-login').classList.remove('hidden');
      $('#loginTitle').textContent = 'Смена закрыта';
      $('#loginSub').textContent = `Z-отчёт напечатан. Смена №${res.closed.number} закрыта, выручка ${money(res.closed.totals.revenue)}. Введите PIN-код, чтобы начать новую`;
      renderAll();
    } catch (err) {
      toast('Смена не закрыта: ' + err.message, 'bad');
    }
  });
}

/* ============================ КЛАВИАТУРА ================================= */
/* Кассир работает и с сенсорным экраном, и с внешней клавиатурой:
   горячие клавиши повторяют самые частые действия. */
document.addEventListener('keydown', e => {
  const loginVisible = !$('#screen-login').classList.contains('hidden');
  if (loginVisible) {
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('back');
    else if (e.key === 'Escape') pinKey('clear');
    return;
  }

  const veil = topVeil();
  if (veil) {
    if (e.key === 'Escape') { if (veil.id !== 'modalDone') close(veil.id); return; }
    if (veil.id === 'modalPin') {
      if (/^\d$/.test(e.key)) { admKey(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { admKey('back'); e.preventDefault(); }
      return;
    }
    if (veil.id === 'sheetPay' && S.pay.method === 'cash') {
      if (/^\d$/.test(e.key)) { payKey(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { payKey('back'); e.preventDefault(); }
      else if (e.key === 'Enter' && !$('#btnPayConfirm').disabled) $('#btnPayConfirm').click();
    } else if (veil.id === 'modalQty') {
      if (/^\d$/.test(e.key)) { qtyKey(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { qtyKey('back'); e.preventDefault(); }
      else if (e.key === 'Enter') applyQty();
    } else if (veil.id === 'modalDone' && e.key === 'Enter') $('#btnNewCheck').click();
    return;
  }

  /* режим настройки живёт своими правилами — кассовые клавиши в нём молчат */
  if (HK.isEditing()) {
    if (e.key === 'Escape') HK.exit();
    return;
  }

  if (e.key === 'Backspace' && document.activeElement !== sInput && S.view === 'hk') {
    e.preventDefault(); HK.up(); return;
  }
  if (e.key === 'F2') { e.preventDefault(); if (!$('#btnPay').disabled) openPay(); return; }
  if (e.key === 'F3') { e.preventDefault(); sInput.focus(); sInput.select(); return; }
  if (e.key === 'F4') { e.preventDefault(); const r = S.cart.find(x => x.uid === S.sel); if (r) openQtyForRow(r); return; }
  if (e.key === 'F6') { e.preventDefault(); openDiscount(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#btnUndo').click(); return; }
  if (e.key === 'Delete' && S.sel) {
    S.cart = S.cart.filter(x => x.uid !== S.sel); S.sel = null; renderAll(); return;
  }
  if (e.key === 'Escape') { S.sel = null; renderCheck(); return; }

  /* печать любого символа — сразу в поиск, без клика по полю */
  if (document.activeElement !== sInput && e.key.length === 1 && !e.ctrlKey && !e.altKey) {
    sInput.focus();
  }
});

/* ================================ СТАРТ ================================== */
/* Порядок важен: сначала справочники и смена из базы, потом первая отрисовка —
   иначе интерфейс успеет нарисовать пустую витрину. */
async function boot() {
  try {
    applyCatalog(await API.catalog());
    applyState(await API.state());
    await HK.init();
    renderCats();
    setView('hk');
    renderAll();
  } catch (err) {
    console.error('[boot]', err);
    $('#loginTitle').textContent = 'Касса недоступна';
    $('#loginSub').textContent = err.message + '. Проверьте, запущен ли сервер (npm start), и обновите страницу.';
    $('#pinPad').style.opacity = '.3';
    $('#pinPad').style.pointerEvents = 'none';
  }
}
boot();
