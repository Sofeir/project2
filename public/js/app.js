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
  cat: null,         // открытая группа каталога; null — список групп
  pay: { method: 'cash', buf: '', splits: [] },
  qty: { uid: null, buf: '', mode: 'qty', pending: null },
  cash: { mode: 'in', buf: '' },
  lastSale: null,
  op: 'sale',        // продажа | ret-items | corr-sale | corr-return
};

let _uid = 0;

/* ------------------------------- утилиты -------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const nbsp = ' ';
const round2 = n => Math.round(n * 100 + 1e-7) / 100;
/* рубли целыми, а если в сумме есть копейки (дробное количество) — с копейками */
const fmt = n => {
  const v = round2(n);
  return v.toLocaleString('ru-RU', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, nbsp);
};
const money = n => fmt(n) + nbsp + '₽';
/* количество штук: 0.5 → «0,5» */
const fmtQty = n => String(Math.round(n * 1000) / 1000).replace('.', ',');
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

/* Единственный канал сообщений кассиру: плашка сверху по центру.
   Кассир не закрывает её руками — она уходит сама, а ошибка висит дольше,
   потому что её нужно успеть прочитать. */
const TOAST_ICON = { ok: 'i-check', warn: 'i-info', bad: 'i-close' };

function toast(msg, kind) {
  const k = kind || 'ok';
  const el = document.createElement('div');
  el.className = 'toast ' + k;
  el.innerHTML = `<span class="ic"><svg><use href="#${TOAST_ICON[k]}"/></svg></span><span class="tx">${msg}</span>`;
  $('#toasts').appendChild(el);
  void el.offsetWidth;          /* вынуждаем пересчёт, иначе анимация не стартует */
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, k === 'bad' ? 3200 : 1700);
}

const syncPaying = () => document.body.classList.toggle('paying', !$('#sheetPay').classList.contains('hidden'));
/* ---------------------------- СВОИ СПИСКИ ------------------------------- */
/* Системный <select> на кассе выглядит чужеродно, поэтому выбор из списка —
   своя кнопка и меню в стиле остальных меню кассы. Меню позиционируется
   по экрану, чтобы его не обрезала прокрутка окна. */
function cselHTML(cls, opts, value, id) {
  const cur = opts.find(o => o[0] === value) || opts[0];
  return `<div class="csel ${cls}" ${id ? `id="${id}"` : ''} data-v="${cur[0]}">
    <button type="button" class="sel"><span class="cv">${cur[1]}</span></button>
    <div class="menu csel-menu hidden">${opts.map(([v, l]) =>
      `<button type="button" data-v="${v}" class="${v === cur[0] ? 'on' : ''}"><span class="mt">${l}</span><svg><use href="#i-check"/></svg></button>`).join('')}</div>
  </div>`;
}
function setCsel(c, v) {
  c.dataset.v = v;
  $$('.csel-menu [data-v]', c).forEach(b => {
    b.classList.toggle('on', b.dataset.v === v);
    if (b.dataset.v === v) $('.cv', c).textContent = $('.mt', b).textContent;
  });
}
function placeMenu(btn, m) {
  const r = btn.getBoundingClientRect();
  Object.assign(m.style, { position: 'fixed', left: r.left + 'px', right: 'auto', minWidth: r.width + 'px', top: '', bottom: '' });
  m.classList.remove('hidden');
  const h = m.offsetHeight, below = innerHeight - r.bottom;
  if (below < h + 12 && r.top > below) { m.style.top = 'auto'; m.style.bottom = (innerHeight - r.top + 6) + 'px'; }
  else { m.style.top = (r.bottom + 6) + 'px'; m.style.bottom = 'auto'; }
}
/* перехват на всплытии до общего «закрыть все меню» */
document.addEventListener('click', e => {
  const item = e.target.closest('.csel-menu [data-v]');
  if (item) {
    const c = item.closest('.csel');
    setCsel(c, item.dataset.v);
    c.dispatchEvent(new CustomEvent('csel', { bubbles: true }));
    return;
  }
  const btn = e.target.closest('.csel > .sel');
  if (!btn) return;
  e.stopPropagation();
  const m = btn.nextElementSibling;
  const was = !m.classList.contains('hidden');
  $$('.menu').forEach(x => x.classList.add('hidden'));
  if (!was) placeMenu(btn, m);
}, true);

const open  = id => { $('#' + id).classList.remove('hidden'); syncPaying(); };
const close = id => {
  const v = $('#' + id);
  v.classList.add('hidden');
  syncPaying();
  /* поле исчезло вместе с окном — виртуальная клавиатура не должна остаться */
  if (typeof VK !== 'undefined') VK.closeIfInside(v);
};
const topVeil = () => $$('.veil').filter(v => !v.classList.contains('hidden')).pop();

$$('.veil').forEach(v => {
  v.addEventListener('mousedown', e => { if (e.target === v && !('lock' in v.dataset)) close(v.id); });
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
/* Любая операция, меняющая смену, возвращает из хранилища её полный снимок.
   Экран не пересчитывает итоги сам — все суммы считаются в одном месте. */
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
    src: c.source_number,
    disc: Number(c.discount_sum || 0),
    discPct: c.discount_percent,
    items: c.items || [],
    doc: c.doc_number ? {
      type: c.correction_type, date: c.doc_date, no: c.doc_number,
      opDate: c.op_date, tax: c.tax_system, fp: c.fiscal_sign, ref: c.source_ref,
    } : null,
    payments: (c.payments || []).map(p => ({ m: p.m, amount: Number(p.amount), vat: p.vat })),
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
bindDrop('opBadge', 'menuOps');
bindDrop('btnCheckMore', 'menuCheck');
bindDrop('btnSetup', 'menuSetup');

/* --------------------------- режим операции ----------------------------- */
/* Касса делает не только продажи. Чтобы кассир никогда не гадал, что он сейчас
   пробивает, режим живёт в одном месте и подписан прямо над чеком. */
const OPS = {
  sale:          { badge: 'Продажа',            cls: '' },
  'ret-items':   { badge: 'Возврат блюд',       cls: 'bad' },
  'corr-sale':   { badge: 'Коррекция продажи',  cls: 'warn' },
  'corr-return': { badge: 'Коррекция возврата', cls: 'warn' },
};

function setOp(op) {
  const o = OPS[op] || OPS.sale;
  S.op = op;
  $('#opBadgeText').textContent = o.badge;
  $('#opBadge').className = 'op-badge' + (o.cls ? ' ' + o.cls : '');
  renderAll();
}

const isRefund = () => S.op === 'ret-items';

$('#menuOps').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'ret-check') { renderReturnList(); return open('modalReturn'); }
  if (a === S.op) return;
  if (S.cart.length) return toast('Сначала завершите или очистите текущий чек', 'warn');
  /* возврат блюд кассир набирает на витрине как обычную продажу;
     коррекция позиций не имеет — она правит итог смены, и ей нужно основание */
  setOp(a);
  if (a === 'corr-sale' || a === 'corr-return') openCorrPick(a);
});

/* ---------------------- доступ в режим настройки ------------------------ */
/* Кассир и администратор работают на одном терминале, поэтому вход в правку
   структуры закрыт коротким PIN — не бюрократия, а защита от случайного
   касания во время смены. */
let admBuf = '', admThen = null;

$('#menuSetup').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
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
  renderAll();
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
/* «Назад» и «Все группы» в каталоге; у горячих клавиш крошки ведёт сам HK */
$('#crumbs').addEventListener('click', e => {
  if (S.view !== 'cat') return;
  if (e.target.closest('#crumbUp') || e.target.closest('.cr:not(.last)')) { S.cat = null; renderGrid(); $('#grid').scrollTop = 0; }
});

/* Витрина работает в двух режимах: собственные горячие клавиши заведения
   и полный каталог по группам — как запасной путь, если позиции нет
   на витрине или её только что завели в номенклатуре. */
$('#viewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-view]'); if (!b) return;
  setView(b.dataset.view);
});
function setView(v) {
  S.view = v;
  $$('#viewSeg button').forEach(x => x.classList.toggle('on', x.dataset.view === v));
  S.cat = null;
  $('#crumbs').classList.remove('hidden');
  renderGrid();
  $('#grid').scrollTop = 0;
}

/* Каталог: сначала плитки групп (первой — «Ходовые»), по нажатию — блюда
   этой группы по алфавиту. Плитки те же, что у групп на витрине. */
const byRu = (a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' });
function catCrumbs() {
  const el = $('#crumbs');
  if (!S.cat) { el.innerHTML = ''; return; }
  const name = S.cat === 'hits' ? 'Ходовые' : catOf(S.cat).name;
  el.innerHTML = `<button class="up" id="crumbUp" title="К списку групп"><svg><use href="#i-back"/></svg></button>
    <button class="cr" data-i="-1">Все группы</button><span class="sl">›</span><button class="cr last">${name}</button>`;
}
function renderGrid() {
  if (S.view === 'hk') return HK.renderCashier();
  catCrumbs();
  if (!S.cat) {
    const n = c => PRODUCTS.filter(p => p.cat === c).length;
    const tile = (id, name, color, cnt) => `<button class="tile group" data-cat="${id}" style="--c:${color}">
      <span class="gi"><svg><use href="#i-folder"/></svg></span>
      <span class="nm">${name}</span>
      <span class="cnt">${cnt} ${plural(cnt, 'позиция', 'позиции', 'позиций')}</span>
    </button>`;
    const hits = PRODUCTS.filter(p => p.hit).length;
    $('#grid').innerHTML = `<div class="hk-section">Группы</div>` +
      tile('hits', 'Ходовые', 'var(--acc)', hits) +
      CATEGORIES.map(c => tile(c.id, c.name, c.color, n(c.id))).join('');
    return;
  }
  const items = (S.cat === 'hits' ? PRODUCTS.filter(p => p.hit) : PRODUCTS.filter(p => p.cat === S.cat)).slice().sort(byRu);
  if (!items.length) { $('#grid').innerHTML = `<div class="grid-none">В этой группе пока нет позиций</div>`; return; }
  $('#grid').innerHTML = items.map(p => {
    const c = catOf(p.cat);
    const inCart = S.cart.filter(r => r.id === p.id);
    const q = inCart.reduce((s, r) => s + r.qty, 0);
    const badge = q ? `<span class="qty num">${p.weight ? kg(q * 1000).replace(',000', '') : fmtQty(q)}</span>` : '';
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
  const cat = e.target.closest('[data-cat]');
  if (cat) { S.cat = cat.dataset.cat; renderGrid(); $('#grid').scrollTop = 0; return; }
  const b = e.target.closest('[data-id]'); if (!b) return;
  addProduct(b.dataset.id);
});

/* ================================ ПОИСК ================================== */
const sInput = $('#searchInput');
const sRes = $('#searchRes');
let sHi = -1;   // -1: ни одна строка не подсвечена (Enter берёт первую)

function renderSearch() {
  const q = sInput.value.trim().toLowerCase();
  $('#btnSearchClear').classList.toggle('hidden', !q);
  if (!q) { sRes.classList.add('hidden'); return; }
  const found = PRODUCTS.filter(p => p.name.toLowerCase().includes(q)).slice(0, 40);
  sHi = -1;
  sRes.innerHTML = found.length
    ? found.map((p, i) => {
        const c = catOf(p.cat);
        return `<div class="sr" data-id="${p.id}">
          <span class="tag" style="color:${c.color}">${c.short}</span>
          <span class="n">${p.name}</span>
          <span class="p num">${money(p.price)}</span></div>`;
      }).join('')
    : `<div class="sr-none">Ничего не найдено по запросу «${sInput.value.trim()}»</div>`;
  sRes.classList.remove('hidden');
}
/* список результатов открыт — витрина за ним затемняется */
new MutationObserver(() => $('.catalog').classList.toggle('searching', !sRes.classList.contains('hidden')))
  .observe(sRes, { attributes: true, attributeFilter: ['class'] });
sInput.addEventListener('input', renderSearch);
sInput.addEventListener('keydown', e => {
  const rows = $$('.sr', sRes);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!rows.length) return;
    sHi = sHi < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : (sHi + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
    rows.forEach((r, i) => r.classList.toggle('hi', i === sHi));
    rows[sHi].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    const r = rows[Math.max(sHi, 0)]; if (r) { addProduct(r.dataset.id); pickDone(); }
  } else if (e.key === 'Escape') { clearSearch(); sInput.blur(); }
});
sRes.addEventListener('click', e => {
  const r = e.target.closest('[data-id]'); if (!r) return;
  addProduct(r.dataset.id); pickDone();
});
/* блюдо выбрано — поиск свободен, а клавиатура больше не нужна */
function pickDone() { clearSearch(); sInput.blur(); VK.close(); }
/* клавиатура скрылась любым способом — поиск пустой, без остатков ввода */
document.addEventListener('vk:close', e => {
  if (e.detail.target === sInput) { clearSearch(); sInput.blur(); }
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

const lineSum = r => round2(r.price * r.qty);
const subtotal = () => round2(S.cart.reduce((s, r) => s + lineSum(r), 0));
const discountSum = () => S.discount ? Math.round(subtotal() * S.discount.percent / 100) : 0;
const total = () => round2(subtotal() - discountSum());
const posCount = () => S.cart.length;

function renderCheck() {
  const list = $('#checkList');
  if (!S.cart.length) {
    list.innerHTML = `<div class="check-empty">
      <svg><use href="#i-cart"/></svg>
      <div class="t">Чек пуст</div>
      <div class="h">Выберите блюдо на витрине справа или найдите его через поиск</div>
    </div>`;
    return;
  }
  list.innerHTML = S.cart.map(r => {
    const sel = S.sel === r.uid;
    const qtyText = r.weight ? `${kg(r.qty * 1000)}${nbsp}кг` : fmtQty(r.qty);
    const priceText = r.weight
      ? `<b class="num">${kg(r.qty * 1000)}${nbsp}кг</b> × ${money(r.price)}/кг`
      : `<b class="num">${fmtQty(r.qty)}</b> × ${money(r.price)}`;
    const stepper = r.weight
      ? `<div class="stepper"><button class="q num" data-act="qty" data-uid="${r.uid}">${qtyText}</button></div>`
      : `<div class="stepper">
           <button data-act="dec" data-uid="${r.uid}" aria-label="Меньше">−</button>
           <button class="q num" data-act="qty" data-uid="${r.uid}">${qtyText}</button>
           <button data-act="inc" data-uid="${r.uid}" aria-label="Больше">+</button>
         </div>`;
    return `<div class="row ${sel ? 'is-sel' : ''} ${r.fresh ? 'new' : ''}" data-uid="${r.uid}">
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
        ${r.weight ? '' : `<button class="half" data-act="half" data-uid="${r.uid}" aria-label="Половина порции">½</button>`}
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
    if (b.dataset.act === 'inc') { r.qty = Math.round((r.qty + 1) * 1000) / 1000; renderAll(); }
    if (b.dataset.act === 'dec') { r.qty = Math.round((r.qty - 1) * 1000) / 1000; if (r.qty <= 0) S.cart = S.cart.filter(x => x.uid !== uid); renderAll(); }
    if (b.dataset.act === 'half') { r.qty = 0.5; renderAll(); }
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
  const n = S.history.length;
  $('#clockMeta').textContent = `Смена №${S.shiftNo} · ${n} ${plural(n, 'чек', 'чека', 'чеков')}`;

  const d = $('#fDiscLine');
  if (S.discount) {
    d.classList.remove('hidden');
    $('#fDiscName').textContent = `Скидка · ${S.discount.name} ${S.discount.percent}%`;
    $('#fDiscVal').textContent = '−' + money(discountSum());
  } else d.classList.add('hidden');

  $('#fTotal').textContent = money(total());
  const ret = isRefund();
  $('#fTotalLabel').textContent = ret ? 'К возврату' : 'К оплате';
  $('#btnPay').firstChild.nodeValue = ret ? 'Оформить возврат' : 'Оплатить';
  $('#btnPay').classList.toggle('btn-danger', ret);
  $('#btnPark').classList.toggle('hidden', ret);
  $('#payRow').classList.toggle('one', ret);

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
  if (r.qty > 1 && !r.weight) r.qty = Math.round((r.qty - 1) * 1000) / 1000; else S.cart.pop();
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
    ask('Очистить чек?', `Из чека будет удалено <b>${posCount()}</b> поз. на сумму <b>${money(total())}</b>. Действие необратимо.`, 'Очистить', () => {
      S.cart = []; S.sel = null; S.discount = null; renderAll();
      toast('Чек очищен', 'warn');
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
  $('#qtyKeys').classList.toggle('dec', mode !== 'weight');
  $('#qtyTitle').textContent = mode === 'weight' ? 'Вес позиции' : 'Количество';
  $('#qtyItem').textContent = name;
  $('#qtyLabel').textContent = mode === 'weight' ? 'Вес' : 'Количество';
  const pre = $('#qtyPresets');
  pre.classList.toggle('hidden', mode !== 'weight');
  $('#btnScale').classList.remove('hidden');   // взвесить можно любую позицию
  if (mode === 'weight') pre.innerHTML = WEIGHT_PRESETS.map(g => `<button data-g="${g}">${g}${nbsp}г</button>`).join('');
  renderQty();
  open('modalQty');
}
function qtyValue() {
  if (S.qty.mode === 'weight') return parseInt(S.qty.buf || '0', 10) / 1000;
  return parseFloat((S.qty.buf || '0').replace(',', '.')) || 0;
}
function renderQty() {
  const v = qtyValue();
  $('#qtyVal').textContent = S.qty.mode === 'weight' ? kg(v * 1000) + nbsp + 'кг' : (S.qty.buf === '' ? '—' : S.qty.buf);
  $('#qtySum').textContent = money(v * S.qty.price);
  $('#btnQtyOk').disabled = v <= 0;
}
/* «Взвесить» — вес берётся с весов; пока это тестовое устройство */
$('#btnScale').addEventListener('click', async () => {
  const b = $('#btnScale'), t = $('span', b);
  b.disabled = true; t.textContent = 'Взвешиваю…';
  try {
    const w = await API.scale();
    if (!w.stable) return toast('Вес не установился, повторите', 'warn');
    /* весовая позиция набирается в граммах, штучная — числом с двумя знаками (кг) */
    S.qty.buf = S.qty.mode === 'weight' ? String(w.grams) : (w.grams / 1000).toFixed(2).replace('.', ',');
    renderQty();
  } catch (err) {
    toast('Весы недоступны: ' + err.message, 'bad');
  } finally {
    b.disabled = false; t.textContent = 'Взвесить';
  }
});
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
  else if (k === ',') {
    if (S.qty.mode === 'weight' || S.qty.buf.includes(',')) return;
    S.qty.buf = (S.qty.buf || '0') + ',';
  }
  else if (S.qty.mode === 'weight') { if (S.qty.buf.length < 5) S.qty.buf = (S.qty.buf + k).replace(/^0+(?=\d)/, ''); }
  else {
    const [whole, frac] = (S.qty.buf + k).split(',');
    if (whole.length > 4 || (frac !== undefined && frac.length > 2)) return;
    S.qty.buf = (S.qty.buf + k).replace(/^0+(?=\d)/, '');
  }
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
    if (r) r.qty = Math.round(v * 1000) / 1000;
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
  $('#parkedList').innerHTML = S.parked.length ? S.parked.map(p => {
    const items = p.items || [];
    const sub = round2(items.reduce((s, r) => s + r.price * r.qty, 0));
    const disc = p.discount && p.discount.percent ? Math.round(sub * p.discount.percent / 100) : 0;
    return `
    <div class="lc-x">
      <div class="lc tap" data-toggle>
        <div>
          <div class="t1 num">${p.time}</div>
          <div class="t2">${p.count} ${plural(p.count, 'позиция', 'позиции', 'позиций')}</div>
        </div>
        <div class="sum num">${money(p.total)}</div>
        <div class="acts">
          <button data-res="${p.id}">Выбрать</button>
          <button class="danger" data-del="${p.id}">Удалить</button>
        </div>
        <svg class="go"><use href="#i-chev"/></svg>
      </div>
      <div class="lc-body hidden">
        <div class="ck-cap first">Позиции</div>
        ${items.map(r => `
        <div class="ck-row">
          <div class="n">${r.name}<span class="q num">${r.weight ? `${kg(r.qty * 1000)}${nbsp}кг × ${money(r.price)}/кг` : `${fmtQty(r.qty)} × ${money(r.price)}`}</span></div>
          <b class="num">${money(round2(r.price * r.qty))}</b>
        </div>`).join('')}
        <div class="ck-sum">
          ${disc ? `<div class="fline"><span>Скидка · ${p.discount.name} ${p.discount.percent}%</span><b class="num">−${money(disc)}</b></div>` : ''}
          <div class="ck-total"><span>Итого</span><b class="num">${money(p.total)}</b></div>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="none">Отложенных чеков нет</div>`;
}
$('#parkedList').addEventListener('click', e => {
  const res = e.target.closest('[data-res]');
  const del = e.target.closest('[data-del]');

  /* нажатие на сам чек раскрывает его на месте: что в нём лежит */
  const tg = !res && !del && e.target.closest('[data-toggle]');
  if (tg) {
    const box = tg.closest('.lc-x');
    const was = box.classList.contains('open');
    $$('#parkedList .lc-x.open').forEach(x => { x.classList.remove('open'); $('.lc-body', x).classList.add('hidden'); });
    if (!was) {
      box.classList.add('open');
      $('.lc-body', box).classList.remove('hidden');
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    return;
  }

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
    ask('Удалить отложенный чек?', `Чек, отложенный в ${p.time}, на ${money(p.total)} будет удалён.`, 'Удалить', async () => {
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
const METHOD_ICON = { cash: 'i-cash', card: 'i-card', qr: 'i-qr', staff: 'i-badge' };
const pad4 = n => String(n).padStart(4, '0');

const paidSum   = () => S.pay.splits.reduce((s, x) => s + x.amount, 0);
const remainSum = () => Math.max(0, round2(total() - paidSum()));
const entered   = () => Number(S.pay.buf || '0');
/* пустой набор означает «ровно остаток» — так платят чаще всего */
const payGot    = () => (S.pay.buf === '' ? remainSum() : entered());

$('#btnPay').addEventListener('click', openPay);
function openPay() {
  if (!S.cart.length) return;
  S.pay = { method: 'cash', buf: '', splits: [] };
  const ret = isRefund();
  $('#payTitle').textContent = ret ? 'Возврат блюд' : 'Оплата чека';
  $('#sheetPay').classList.toggle('refund', ret);
  /* при возврате деньги отдают, а не принимают: ни сдачи, ни оплаты частями */
  ['#quickSums', '#ioGot', '#changeBox', '#payKeys', '#payParts']
    .forEach(q => $(q).classList.toggle('hidden', ret));
  $('#refundNote').classList.toggle('hidden', !ret);
  $('#payCheckNo').textContent = '№ ' + pad4(S.checkNo);
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
  renderPay();
}
function renderPay() {
  const rem = remainSum();
  const btn = $('#btnPayConfirm');
  if (isRefund()) {
    $('#payBoxLabel').textContent = 'К возврату';
    $('#payTotal').textContent = money(rem);
    btn.disabled = false;
    btn.textContent = 'Оформить возврат';
    return;
  }
  const cash = S.pay.method === 'cash';
  $('#payBoxLabel').textContent = S.pay.splits.length ? 'Осталось оплатить' : 'Итого к оплате';
  $('#payTotal').textContent = money(rem);

  /* быстрые суммы нужны только наличным: точная + ближайшие удобные купюры */
  $('#quickSums').classList.toggle('hidden', !cash);
  if (cash) {
    const ups = [Math.ceil(rem / 100) * 100, Math.ceil(rem / 500) * 500, 500, 1000, 2000, 5000]
      .filter(v => v > rem);
    const uniq = [...new Set(ups)].sort((a, b) => a - b).slice(0, 5);
    $('#quickSums').innerHTML =
      `<button data-s="${rem}">Без сдачи</button>` + uniq.map(v => `<button data-s="${v}" class="num">${fmt(v)}</button>`).join('');
  }

  const got = payGot();
  $('#gotLabel').textContent = cash ? 'Получено' : 'Сумма списания';
  $('#gotVal').textContent = money(got);

  const box = $('#changeBox');
  box.classList.remove('change', 'ok', 'bad', 'hidden');
  if (got < rem) {
    box.classList.add('change');
    $('#changeLabel').textContent = 'Остаток другим способом';
    $('#changeVal').textContent = money(round2(rem - got));
  } else if (got > rem && cash) {
    box.classList.add('change');
    $('#changeLabel').textContent = 'Сдача';
    $('#changeVal').textContent = money(round2(got - rem));
  } else if (got > rem) {
    box.classList.add('bad');
    $('#changeLabel').textContent = 'Больше, чем к оплате';
    $('#changeVal').textContent = money(round2(got - rem));
  } else {
    box.classList.add('ok');
    $('#changeLabel').textContent = cash ? 'Сдача' : 'Остаток';
    $('#changeVal').textContent = cash ? 'Без сдачи' : 'Нет';
  }

  $('#splits').innerHTML = S.pay.splits.map((s, i) => `
    <div class="split">
      <svg class="mi"><use href="#${METHOD_ICON[s.m]}"/></svg>
      <span class="m">${METHOD_NAME[s.m]}</span>
      <span class="a num">${money(s.amount)}</span>
      <button data-rm="${i}" title="Убрать"><svg><use href="#i-close"/></svg></button>
    </div>`).join('');
  $('#splitHint').classList.toggle('hidden', S.pay.splits.length > 0);

  const partial = got > 0 && got < rem;
  btn.disabled = got <= 0 || (!cash && got > rem);
  btn.textContent = partial ? `Внести ${money(got)} частично`
    : cash && got > rem ? 'Провести и выдать сдачу' : 'Провести оплату';
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
$('#btnDrawer').addEventListener('click', () => toast('Денежный ящик открыт'));

/* Чек считается пробитым только после записи в хранилище: пока запись не прошла,
   кассир не должен увидеть «оплачено» и отдать товар. */
$('#btnPayConfirm').addEventListener('click', async () => {
  const btn = $('#btnPayConfirm');
  const ret = isRefund();
  const rem = remainSum();
  const m = S.pay.method;
  const got = ret ? rem : payGot();

  /* Сумма меньше остатка — это часть смешанной оплаты: запоминаем её
     и ждём, чем покупатель доплатит остальное. */
  if (!ret && got < rem) {
    const same = S.pay.splits.find(x => x.m === m);
    if (same) same.amount = round2(same.amount + got);
    else S.pay.splits.push({ m, amount: got });
    S.pay.buf = '';
    return renderPay();
  }

  const parts = ret ? [{ m, amount: rem }] : S.pay.splits.concat([{ m, amount: rem }]);
  const change = !ret && m === 'cash' ? Math.max(0, round2(got - rem)) : 0;

  const label = btn.textContent;
  btn.disabled = true;
  try {
    /* безналичные части проходят через терминал до записи чека:
       не приложили карту — чек не пробивается */
    for (const p of parts) {
      if (p.m !== 'cash' && !(await terminal(p.m, p.amount, ret))) {
        toast(ret ? 'Возврат прерван' : 'Оплата прервана', 'warn');
        return;
      }
    }
    btn.textContent = ret ? 'Оформляю возврат…' : 'Провожу оплату…';
    const body = {
      items: S.cart.map(r => ({ id: r.id, name: r.name, price: r.price, unit: r.unit, qty: r.qty })),
      discountId: S.discount ? S.discount.id : null,
      payments: parts,
      change,
    };
    const st = ret ? await API.refundItems(body) : await API.sale(body);

    applyState(st);
    S.lastSale = st.checks[0];

    close('sheetPay');
    showPaid(ret ? 'Возврат оформлен' : 'Оплата проведена', ret);
    setOp('sale');

    S.cart = []; S.sel = null; S.discount = null;
    HK.goRoot();   /* следующий покупатель начинает с первого экрана витрины */
    renderAll();
  } catch (err) {
    toast((ret ? 'Возврат не проведён: ' : 'Чек не проведён: ') + err.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

/* «Оплата проведена» — не окно, а та же плашка сверху: кассир не тратит время
   на закрытие, а чек уже обнулён и готов к следующему покупателю */
function showPaid(text, warn) {
  toast(text || 'Оплата проведена', warn ? 'warn' : 'ok');
}

/* =============================== ТЕРМИНАЛ ================================ */
/* Банковского терминала в прототипе нет: окно ждёт пару секунд и считает
   операцию одобренной. Кассир может отменить, если покупатель передумал. */
const TERM = {
  card:  { icon: 'i-card',  t: ['Приложите карту к терминалу', 'Приложите карту для возврата'],
                            h: ['Ждём ответ банка', 'Деньги вернутся на карту покупателя'] },
  qr:    { icon: 'i-qr',    t: ['Покажите QR-код покупателю', 'Возврат через СБП'],
                            h: ['Ждём уведомление об оплате', 'Отправляем возврат в банк покупателя'] },
  staff: { icon: 'i-badge', t: ['Приложите карту сотрудника', 'Приложите карту сотрудника'],
                            h: ['Сумма спишется с лицевого счёта', 'Сумма вернётся на лицевой счёт'] },
};
function terminal(m, amount, refund) {
  const t = TERM[m], k = refund ? 1 : 0;
  $('#termIcon').setAttribute('href', '#' + t.icon);
  $('#termSum').textContent = (refund ? '−' : '') + money(amount);
  $('#termTitle').textContent = t.t[k];
  $('#termText').textContent = t.h[k];
  open('modalTerminal');
  return new Promise(resolve => {
    const done = ok => {
      clearTimeout(timer);
      $('#btnTermCancel').onclick = null;
      close('modalTerminal');
      resolve(ok);
    };
    const timer = setTimeout(() => done(true), 2200);
    $('#btnTermCancel').onclick = () => done(false);
  });
}

/* ============================== ЧЕКИ СМЕНЫ =============================== */
/* Виды документов смены: продажа, возврат и две коррекции. Коррекция и возврат
   уменьшают выручку, поэтому в списке они идут со знаком минус. */
const DOC_NAME = {
  sale: 'Чек',
  return: 'Возврат',
  correction_sale: 'Коррекция продажи',
  correction_return: 'Коррекция возврата',
};
const minus = t => t === 'return' || t === 'correction_return';
const isReturned = no => S.history.some(h => h.type === 'return' && h.src === no);
const payNames = h => h.payments.map(p => METHOD_NAME[p.m]).join(', ');

function renderHistory() {
  const sales = S.history.filter(h => h.type === 'sale');
  $('#histSub').textContent = `${sales.length} ${plural(sales.length, 'чек', 'чека', 'чеков')} · выручка ${money(revenue())}`;
  $('#historyList').innerHTML = S.history.length ? S.history.map(h => `
    <div class="lc tap" data-open="${h.no}">
      <div>
        <div class="t1 num">${DOC_NAME[h.type] || 'Чек'} № ${pad4(h.no)}</div>
        <div class="t2">${h.time} · ${h.doc
          ? `${h.doc.ref ? 'по ' + h.doc.ref : 'за ' + (h.doc.opDate || h.doc.date)} · ${h.doc.type === 'order' ? 'предписание' : 'самостоятельно'} № ${h.doc.no}`
          : `${h.items.length} поз.`} · ${payNames(h)}</div>
      </div>
      <div class="sum num" ${minus(h.type) ? 'style="color:var(--bad)"' : ''}>${minus(h.type) ? '−' : ''}${money(h.total)}</div>
      <div class="acts">
        <button data-copy="${h.no}">Копия</button>
        ${h.type === 'sale' && !isReturned(h.no) ? `<button class="danger" data-ret="${h.no}">Возврат</button>` : ''}
      </div>
    </div>`).join('') : `<div class="none">В этой смене ещё не было чеков</div>`;
}
$('#historyList').addEventListener('click', e => {
  const c = e.target.closest('[data-copy]');
  const r = e.target.closest('[data-ret]');
  const o = e.target.closest('[data-open]');
  if (c) return toast('Копия чека отправлена на печать');
  if (r) return openCheckCard(+r.dataset.ret);
  if (o) openCheckCard(+o.dataset.open);
});

/* ============================ ВОЗВРАТ ПО ЧЕКУ ============================ */
/* Кассир не выбирает, как вернуть деньги: возврат идёт теми же способами
   и теми же суммами, какими платил покупатель. Поэтому сначала он видит
   сам чек — позиции и оплаты, — и только потом подтверждает возврат. */
function renderReturnList() {
  const sales = S.history.filter(h => h.type === 'sale');
  $('#returnList').innerHTML = sales.length ? sales.map(h => {
    const done = isReturned(h.no);
    return `
    <div class="lc tap ${done ? 'done' : ''}" data-open="${h.no}">
      <div>
        <div class="t1 num">Чек № ${pad4(h.no)}</div>
        <div class="t2">${h.time} · ${h.items.length} поз. · ${payNames(h)}</div>
      </div>
      <div class="sum num">${money(h.total)}</div>
      ${done ? '<span class="tag-done">Возвращён</span>' : '<svg class="go"><use href="#i-chev"/></svg>'}
    </div>`;
  }).join('') : `<div class="none">Возврат возможен только по чеку текущей смены.<br>Чеков пока нет.</div>`;
}
$('#returnList').addEventListener('click', e => {
  const r = e.target.closest('[data-open]'); if (!r) return;
  openCheckCard(+r.dataset.open);
});

const VAT_NAME = { '22': 'НДС 22%', '20': 'НДС 20%', '10': 'НДС 10%', '0': 'НДС 0%', none: 'без НДС' };
const TAX_NAME = { osn: 'ОСН', usn: 'УСН «Доходы»', usn_dr: 'УСН «Доходы минус расходы»', eshn: 'ЕСХН', psn: 'ПСН' };

let _card = null;
function openCheckCard(no) {
  const h = S.history.find(x => x.no === no); if (!h) return;
  _card = h;
  const done = h.type === 'sale' && isReturned(no);
  $('#ckTitle').textContent = `${DOC_NAME[h.type] || 'Чек'} № ${pad4(no)}`;
  $('#ckSub').textContent = h.doc
    ? `${h.time} · ${h.doc.ref ? 'по ' + h.doc.ref : 'за ' + (h.doc.opDate || h.doc.date)} · ${TAX_NAME[h.doc.tax] || ''} · основание № ${h.doc.no} от ${h.doc.date}`
    : `${h.time} · смена №${S.shiftNo}${done ? ' · возврат уже оформлен' : ''}${h.src ? ` · по чеку № ${pad4(h.src)}` : ''}`;

  $('#ckItems').innerHTML = h.items.length ? h.items.map(i => `
    <div class="ck-row">
      <div class="n">${i.name}<span class="q num">${fmtQty(Number(i.qty))} × ${money(Number(i.price))}</span></div>
      <b class="num">${money(Number(i.price) * Number(i.qty))}</b>
    </div>`).join('') : `<div class="ck-none">Документ без позиций: коррекция правит сумму расчёта</div>`;

  $('#ckSum').innerHTML =
    (h.disc ? `<div class="fline"><span>Скидка ${h.discPct}%</span><b class="num">−${money(h.disc)}</b></div>` : '') +
    `<div class="ck-total"><span>Итого</span><b class="num">${money(h.total)}</b></div>`;

  $('#ckPays').innerHTML = h.payments.map(p => `
    <div class="ck-pay"><svg><use href="#${METHOD_ICON[p.m]}"/></svg><span>${METHOD_NAME[p.m]}${p.vat ? ` · ${VAT_NAME[p.vat]}` : ''}</span><b class="num">${money(p.amount)}</b></div>`).join('') +
    (h.change ? `<div class="ck-pay mute"><span>Сдача</span><b class="num">${money(h.change)}</b></div>` : '');

  $('#btnCkReturn').classList.toggle('hidden', h.type !== 'sale' || done);
  open('modalCheck');
}

$('#btnCkReturn').addEventListener('click', async () => {
  const h = _card; if (!h) return;
  const btn = $('#btnCkReturn');
  btn.disabled = true;
  try {
    for (const p of h.payments) {
      if (p.m !== 'cash' && !(await terminal(p.m, p.amount, true))) {
        toast('Возврат прерван', 'warn');
        return;
      }
    }
    applyState(await API.refund(h.no));
    close('modalCheck');
    close('modalReturn');
    if (!$('#modalHistory').classList.contains('hidden')) renderHistory();
    renderAll();
    const cash = round2(h.payments.filter(p => p.m === 'cash').reduce((s, p) => s + p.amount, 0));
    showPaid(cash ? `Возврат оформлен · выдайте ${money(cash)}` : 'Возврат оформлен', true);
  } catch (err) {
    toast('Возврат не проведён: ' + err.message, 'bad');
  } finally {
    btn.disabled = false;
  }
});

/* ============================== КОРРЕКЦИЯ =============================== */
/* Чек коррекции не содержит блюд: он исправляет расчёт, который не был пробит
   или пробит неверно. Закон требует тип коррекции (1173), основание (1174),
   систему налогообложения и НДС, а каждую сумму — отдельной строкой. */
const CORR_TITLE = { 'corr-sale': 'Коррекция продажи', 'corr-return': 'Коррекция возврата' };
const CORR_SUB = {
  'corr-sale': 'Коррекция прихода — выручка, не пробитая вовремя',
  'corr-return': 'Коррекция возврата прихода — лишняя выручка или непробитый возврат',
};
const VAT_RATE = { '22': 22, '20': 20, '10': 10, '0': 0, none: null };
const defaultVat = tax => (tax === 'osn' ? '22' : 'none');
const vatOf = (amount, v) => { const r = VAT_RATE[v]; return r ? round2(amount * r / (100 + r)) : 0; };
const parseAmt = v => {
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
};

const TAX_OPTS = [['osn', 'Общая (ОСН)'], ['usn', 'УСН «Доходы»'], ['usn_dr', 'УСН «Доходы минус расходы»'],
                  ['eshn', 'ЕСХН'], ['psn', 'Патентная (ПСН)']];
const VAT_OPTS = [['22', 'НДС 22%'], ['20', 'НДС 20%'], ['10', 'НДС 10%'], ['0', 'НДС 0%'], ['none', 'Без НДС']];
const METHOD_OPTS = () => Object.keys(METHOD_NAME).map(k => [k, METHOD_NAME[k]]);
const corrTax = () => $('#corrTax').dataset.v;

/* src — исправляемый чек: суммы и способы оплаты берутся из него, кассир
   правит только то, что было пробито неверно */
function openCorrection(op, src) {
  const tax = 'osn';
  const vat = defaultVat(tax);
  S.corr = {
    op, type: 'self', src,
    lines: src && src.payments.length
      ? src.payments.map(p => ({ amount: String(Number(p.amount)).replace('.', ','), method: p.m, vat }))
      : [{ amount: '', method: 'cash', vat }],
  };
  $('#corrTitle').textContent = CORR_TITLE[op];
  $('#corrSub').textContent = src
    ? `По ${src.kind === 'sale' ? 'чеку' : 'возврату'} № ${pad4(src.number)} · смена №${src.shiftNumber} · ${src.date} ${src.time}`
    : CORR_SUB[op] + ' · без исходного чека';
  $('#corrTaxBox').innerHTML = cselHTML('', TAX_OPTS, tax, 'corrTax');
  $('#corrOpDate').value = src ? src.date : '';
  $('#corrFp').value = '';
  $('#corrNo').value = '';
  $('#corrDate').value = new Date().toLocaleDateString('ru-RU');
  $$('#corrTypes .opt').forEach(b => b.classList.toggle('on', b.dataset.t === 'self'));
  renderCorrLines();
  open('modalCorr');
}

function renderCorrLines() {
  const one = S.corr.lines.length === 1;
  $('#corrLines').innerHTML = S.corr.lines.map((l, i) => `
    <div class="cl" data-i="${i}">
      <span class="cl-n num">${i + 1}</span>
      <input type="text" class="cl-sum num" inputmode="numeric" data-vk-extra="," placeholder="Сумма, ₽" value="${l.amount}" autocomplete="off">
      ${cselHTML('cl-m', METHOD_OPTS(), l.method)}
      ${cselHTML('cl-vat', VAT_OPTS, l.vat)}
      <span class="cl-vs num"></span>
      <button class="ibtn cl-rm" ${one ? 'disabled' : ''} title="Убрать строку"><svg><use href="#i-close"/></svg></button>
    </div>`).join('');
  renderCorrTotal();
}
function renderCorrTotal() {
  let sum = 0, vat = 0;
  $$('#corrLines .cl').forEach((row, i) => {
    const l = S.corr.lines[i];
    const a = parseAmt(l.amount), v = vatOf(a, l.vat);
    sum += a; vat += v;
    $('.cl-vs', row).textContent = l.vat === 'none' ? 'без НДС' : 'НДС ' + money(v);
  });
  $('#corrTotal').textContent = money(round2(sum));
  $('#corrVat').textContent = vat ? 'в т. ч. НДС ' + money(round2(vat)) : '';
}

$('#corrLines').addEventListener('input', e => {
  const inp = e.target.closest('.cl-sum'); if (!inp) return;
  /* рубли и не больше двух знаков копеек после запятой */
  const [w, ...rest] = inp.value.replace(/\./g, ',').replace(/[^\d,]/g, '').split(',');
  inp.value = rest.length ? w.slice(0, 7) + ',' + rest.join('').slice(0, 2) : w.slice(0, 7);
  S.corr.lines[+inp.closest('.cl').dataset.i].amount = inp.value;
  renderCorrTotal();
});
$('#corrLines').addEventListener('csel', e => {
  const row = e.target.closest('.cl'); if (!row) return;
  const l = S.corr.lines[+row.dataset.i];
  if (e.target.classList.contains('cl-m')) l.method = e.target.dataset.v;
  if (e.target.classList.contains('cl-vat')) l.vat = e.target.dataset.v;
  renderCorrTotal();
});
$('#corrLines').addEventListener('click', e => {
  const b = e.target.closest('.cl-rm'); if (!b || b.disabled) return;
  S.corr.lines.splice(+b.closest('.cl').dataset.i, 1);
  renderCorrLines();
});
$('#btnCorrAdd').addEventListener('click', () => {
  const last = S.corr.lines[S.corr.lines.length - 1];
  S.corr.lines.push({ amount: '', method: last.method, vat: last.vat });
  renderCorrLines();
});
/* смена системы налогообложения меняет ставку по умолчанию во всех строках */
$('#corrTaxBox').addEventListener('csel', () => {
  const v = defaultVat(corrTax());
  S.corr.lines.forEach(l => { l.vat = v; });
  renderCorrLines();
});
$('#corrTypes').addEventListener('click', e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  S.corr.type = b.dataset.t;
  $$('#corrTypes .opt').forEach(x => x.classList.toggle('on', x === b));
});

/* На кассе нет физической клавиатуры, а экранная цифровая — без точки.
   Поэтому дату кассир набирает восемью цифрами, а точки ставятся сами. */
$$('.date-in').forEach(inp => inp.addEventListener('input', () => {
  const d = inp.value.replace(/\D/g, '').slice(0, 8);
  inp.value = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('.');
}));
$('#corrFp').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); });

/* ДД.ММ.ГГГГ — как кассир читает документ — в ISO, как его хранит база */
function isoDate(v) {
  const m = String(v).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  /* Date молча превращает 31.02 в 3 марта — чек коррекции такого не прощает */
  if (Number.isNaN(d.getTime()) || d.getMonth() + 1 !== Number(mm) || d.getDate() !== Number(dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
}
const todayIso = () => isoDate(new Date().toLocaleDateString('ru-RU'));

$('#btnCorrOk').addEventListener('click', async () => {
  const lines = S.corr.lines.map(l => ({ amount: parseAmt(l.amount), method: l.method, vat: l.vat }));
  if (lines.some(l => !l.amount)) return toast('Укажите сумму в каждой строке', 'warn');

  const opDate = isoDate($('#corrOpDate').value);
  if (!opDate) return toast('Дата исходной операции — в виде ДД.ММ.ГГГГ', 'warn');
  if (opDate > todayIso()) return toast('Дата исходной операции не может быть в будущем', 'warn');

  const docDate = isoDate($('#corrDate').value);
  if (!docDate) return toast('Дата акта или предписания — в виде ДД.ММ.ГГГГ', 'warn');

  const docNumber = $('#corrNo').value.trim();
  if (!docNumber) return toast('Укажите номер акта или предписания', 'warn');

  const btn = $('#btnCorrOk');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Провожу…';
  try {
    applyState(await API.correction({
      kind: S.corr.op === 'corr-sale' ? 'correction_sale' : 'correction_return',
      correctionType: S.corr.type,
      taxSystem: corrTax(),
      sourceCheckId: S.corr.src ? S.corr.src.id : null,
      opDate, docDate, docNumber,
      fiscalSign: $('#corrFp').value.trim(),
      lines,
    }));
    close('modalCorr');
    showPaid('Коррекция проведена', true);
    setOp('sale');
  } catch (err) {
    toast('Коррекция не проведена: ' + err.message, 'bad');
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
});

/* отказ от коррекции возвращает кассу в обычную продажу */
$('#modalCorr').addEventListener('click', e => {
  if (e.target.closest('[data-close]') || e.target === $('#modalCorr')) setOp('sale');
});

/* ======================= КОРРЕКЦИЯ: ВЫБОР ЧЕКА ========================== */
/* Коррекция продажи исправляет чек продажи, коррекция возврата — чек возврата.
   Ошибку обычно находят позже, поэтому сначала выбирается смена, потом чек. */
const CORR_KIND = { 'corr-sale': 'sale', 'corr-return': 'return' };
let _cp = null;

function openCorrPick(op) {
  _cp = { op, shift: null, checks: [] };
  $('#cpTitle').textContent = CORR_TITLE[op];
  open('modalCorrPick');
  cpShifts();
}
async function cpShifts() {
  _cp.shift = null;
  $('#btnCpBack').classList.add('hidden');
  $('#cpSub').textContent = 'Выберите смену, в которой был чек';
  $('#cpList').innerHTML = `<div class="none">Загружаю…</div>`;
  try {
    S.shifts = await API.shifts();
  } catch (err) {
    $('#cpList').innerHTML = `<div class="none">${err.message}</div>`;
    return;
  }
  $('#cpList').innerHTML = S.shifts.map(s => `
    <div class="lc tap" data-shift="${s.id}">
      <div>
        <div class="t1">Смена №${s.number}${s.closed ? '' : ' <span class="cp-now">текущая</span>'}</div>
        <div class="t2">${s.closed ? `${s.opened} — ${s.closed}` : `открыта ${s.opened}`}</div>
      </div>
      <svg class="go"><use href="#i-chev"/></svg>
    </div>`).join('');
}
async function cpChecks(sh) {
  _cp.shift = sh;
  const kind = CORR_KIND[_cp.op];
  $('#btnCpBack').classList.remove('hidden');
  $('#cpSub').textContent = `Смена №${sh.number} · ${kind === 'sale' ? 'чеки продажи' : 'чеки возврата'}`;
  $('#cpList').innerHTML = `<div class="none">Загружаю…</div>`;
  let list;
  try {
    list = (await API.shiftChecks(sh.id)).checks.filter(c => c.kind === kind);
  } catch (err) {
    $('#cpList').innerHTML = `<div class="none">${err.message}</div>`;
    return;
  }
  if (_cp.shift !== sh) return;
  _cp.checks = list;
  $('#cpList').innerHTML = list.length ? list.map(c => {
    const disc = Number(c.discount_sum) || 0;
    const change = Number(c.change) || 0;
    return `
    <div class="lc-x" data-check="${c.id}">
      <div class="lc tap" data-toggle="${c.id}">
        <div>
          <div class="t1 num">${kind === 'sale' ? 'Чек' : 'Возврат'} № ${pad4(c.number)}</div>
          <div class="t2">${c.date} ${c.time} · ${c.items.length} поз. · ${c.payments.map(p => METHOD_NAME[p.m]).join(', ')}</div>
        </div>
        <div class="sum num">${money(Number(c.total))}</div>
        <svg class="go"><use href="#i-chev"/></svg>
      </div>
      <div class="lc-body hidden">
        <div class="ck-cap first">Дата и время</div>
        <div class="lc-date num">${c.date} · ${c.time}</div>
        <div class="ck-cap">Позиции</div>
        ${c.items.length ? c.items.map(i => `
        <div class="ck-row">
          <div class="n">${i.name}<span class="q num">${fmtQty(Number(i.qty))} × ${money(Number(i.price))}</span></div>
          <b class="num">${money(Number(i.price) * Number(i.qty))}</b>
        </div>`).join('') : `<div class="ck-none">Документ без позиций</div>`}
        <div class="ck-sum">
          ${disc ? `<div class="fline"><span>Скидка ${Number(c.discount_percent) || 0}%</span><b class="num">−${money(disc)}</b></div>` : ''}
          <div class="ck-total"><span>Итого</span><b class="num">${money(Number(c.total))}</b></div>
        </div>
        <div class="ck-cap">Оплата</div>
        <div class="ck-pays">
          ${c.payments.map(p => `<div class="ck-pay"><svg><use href="#${METHOD_ICON[p.m]}"/></svg><span>${METHOD_NAME[p.m]}</span><b class="num">${money(Number(p.amount))}</b></div>`).join('')}
          ${change ? `<div class="ck-pay mute"><span>Сдача</span><b class="num">${money(change)}</b></div>` : ''}
        </div>
        <button class="btn btn-primary lc-pick" data-pick="${c.id}">Выбрать этот чек</button>
      </div>
    </div>`;
  }).join('')
    : `<div class="none">В этой смене нет ${kind === 'sale' ? 'чеков продажи' : 'чеков возврата'}</div>`;
}
$('#cpList').addEventListener('click', e => {
  const s = e.target.closest('[data-shift]');
  if (s) return cpChecks(S.shifts.find(x => String(x.id) === s.dataset.shift));
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const src = _cp.checks.find(x => String(x.id) === pick.dataset.pick);
    close('modalCorrPick');
    return openCorrection(_cp.op, { ...src, shiftNumber: _cp.shift.number });
  }
  /* нажатие на чек раскрывает его на месте: позиции, оплата, итог */
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const box = t.closest('.lc-x');
    const wasOpen = box.classList.contains('open');
    $$('#cpList .lc-x.open').forEach(x => { x.classList.remove('open'); $('.lc-body', x).classList.add('hidden'); });
    if (!wasOpen) {
      box.classList.add('open');
      $('.lc-body', box).classList.remove('hidden');
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});
$('#btnCpBack').addEventListener('click', cpShifts);
$('#btnCpNoCheck').addEventListener('click', () => { close('modalCorrPick'); openCorrection(_cp.op, null); });
/* отказ от выбора возвращает кассу в обычную продажу */
$('#modalCorrPick').addEventListener('click', e => {
  if (e.target.closest('[data-close]') || e.target === $('#modalCorrPick')) setOp('sale');
});

/* ============================== РАСХОД БЛЮД ============================== */
/* Сколько каждого блюда ушло за смену — для кухни и склада. Смену можно
   выбрать любую из последних: расход часто сверяют на следующий день. */
let _usage = null;
async function openUsage() {
  try {
    S.shifts = await API.shifts();
    $('#menuUsage').innerHTML = S.shifts.map(s => `
      <button data-id="${s.id}"><svg><use href="#i-shift"/></svg><span>
        <span class="mt">Смена №${s.number}</span>
        <span class="mh">${s.opened}${s.closed ? ' — ' + s.closed : ' · открыта'}</span></span></button>`).join('');
    open('modalUsage');
    await loadUsage(S.shifts.find(s => String(s.id) === String(S.shiftId)) || S.shifts[0]);
  } catch (err) {
    toast('Расход блюд недоступен: ' + err.message, 'bad');
  }
}
async function loadUsage(sh) {
  _usage = sh;
  $('#usageShiftText').textContent = `Смена №${sh.number}`;
  $('#usageSub').textContent = sh.closed ? `${sh.opened} — ${sh.closed}` : `Открыта ${sh.opened}`;
  $('#usageList').innerHTML = `<div class="none">Загружаю…</div>`;
  const { items } = await API.usage(sh.id);
  if (_usage !== sh) return;
  const sum = round2(items.reduce((s, i) => s + i.sum, 0));
  $('#usageList').innerHTML = items.length ? `
    <div class="usage-head"><span>Блюдо</span><span>Количество</span><span>Сумма</span></div>
    ${items.map(i => `
      <div class="usage-row"><span class="n">${i.name}</span><span class="num">${fmtQty(i.qty)}${nbsp}${i.unit}</span><b class="num">${money(i.sum)}</b></div>`).join('')}
    <div class="usage-row total"><span class="n">Итого · ${items.length} ${plural(items.length, 'блюдо', 'блюда', 'блюд')}</span><span></span><b class="num">${money(sum)}</b></div>`
    : `<div class="none">За эту смену блюда не продавались</div>`;
}
bindDrop('usageShiftBtn', 'menuUsage');
$('#menuUsage').addEventListener('click', e => {
  const b = e.target.closest('[data-id]'); if (!b) return;
  const sh = S.shifts.find(s => String(s.id) === b.dataset.id);
  loadUsage(sh).catch(err => toast(err.message, 'bad'));
});
$('#btnUsagePrint').addEventListener('click', () => {
  close('modalUsage');
  toast(`Расход блюд за смену №${_usage.number} отправлен на печать`);
});

/* ============================ ДЕНЬГИ И СМЕНА ============================= */
/* Все суммы смены посчитаны в хранилище (js/api.js) — здесь только чтение снимка. */
const revenue    = () => S.totals.revenue;
const byMethod   = kind => (kind === 'cash' ? S.totals.cash : S.totals.cashless);
const returnsSum = () => S.totals.returns;
const drawerCash = () => S.totals.drawer;

$('#menuShift').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act;
  if (a === 'drawer') return toast('Денежный ящик открыт');
  if (a === 'history') { renderHistory(); return open('modalHistory'); }
  if (a === 'usage') return openUsage();
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

/* ================================ СТАРТ ================================== */
/* Порядок важен: сначала справочники и смена из хранилища, потом первая отрисовка —
   иначе интерфейс успеет нарисовать пустую витрину. */
async function boot() {
  try {
    applyCatalog(await API.catalog());
    applyState(await API.state());
    await HK.init();
    setView('hk');
    renderAll();
  } catch (err) {
    console.error('[boot]', err);
    $('#loginTitle').textContent = 'Касса недоступна';
    $('#loginSub').textContent = err.message + '. Обновите страницу; если не поможет — загрузите данные из сохранённого файла.';
    $('#pinPad').style.opacity = '.3';
    $('#pinPad').style.pointerEvents = 'none';
  }
}
boot();
