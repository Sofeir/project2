'use strict';
/* Тестовое хранилище «ASOFT Управление»: всё лежит в localStorage браузера.
   Настоящие данные придут из центральной БД (PostgreSQL, делает Ваня). Здесь только то, что нужно показать интерфейс.

   Структура: организация (org) → подразделение (unit) → столовая (hall, группа касс) → касса (kassa).
   Меню задаётся на организацию, подразделение или столовую, но не на одну кассу.
   Позиция (items) живёт на своём уровне (scope), нижний уровень может поменять цену или скрыть позицию (over). */

const STORE_KEY = 'asoft-mgr-v1';
const ME = 'Ирина';

const SECTIONS = ['Первые блюда', 'Вторые блюда', 'Гарниры', 'Салаты', 'Выпечка', 'Напитки', 'Прочее'];
const RIGHTS = [
  ['sale', 'Продажа'], ['refund', 'Возврат'], ['discount', 'Скидка'], ['cancel', 'Отмена чека'],
  ['correction', 'Коррекция'], ['shift', 'Открытие и закрытие смены'], ['xz', 'X- и Z-отчёты'],
  ['cashio', 'Внесение и изъятие'], ['price', 'Изменение цены в чеке'], ['settings', 'Настройки кассы'],
];
const KKT_MODELS = ['АТОЛ 30Ф', 'АТОЛ 91Ф', 'Штрих-М', 'Эвотор 7.3'];
const ACQ_MODELS = ['Сбер PAX S300', 'Т-Банк эквайринг', 'Без терминала'];
const CONNS = ['USB', 'COM', 'LAN', 'Wi-Fi'];

let D = null;

/* ---------- начальные данные ---------- */
function seedData() {
  const nodes = [];
  const unit = (id, org, name) => nodes.push({ id, org, parent: org, type: 'unit', name });
  const hall = (id, org, parent, name) => nodes.push({ id, org, parent, type: 'hall', name });
  const kassa = (id, org, parent, n, last, fnTill) => nodes.push({
    id, org, parent, type: 'kassa', name: 'Касса №' + n, last,
    eq: {
      kkt: { model: KKT_MODELS[n % 4], fn: String(9960440300000000 + n * 7331), fnTill, conn: 'USB', ip: '' },
      acq: { model: ACQ_MODELS[n % 2], conn: 'LAN' },
      printer: { model: 'Чековый принтер 80 мм', conn: 'USB' },
      scale: { on: n % 3 === 0, model: 'CAS AP-M', conn: 'COM' },
      display: { on: n % 2 === 0, conn: 'USB' },
      sbp: n !== 5,
    },
  });

  unit('u_ser', 'o1', 'Серов');
  hall('h_s1', 'o1', 'u_ser', 'Столовая 1');
  hall('h_buf', 'o1', 'u_ser', 'Буфет');
  kassa('k1', 'o1', 'h_s1', 1, 2, '2027-04-12');
  kassa('k3', 'o1', 'h_s1', 3, 5, '2027-02-03');
  kassa('k2', 'o1', 'h_buf', 2, 1, '2027-05-20');

  unit('u_kr', 'o1', 'Красноуральск');
  hall('h_kr', 'o1', 'u_kr', 'Столовая');
  kassa('k4', 'o1', 'h_kr', 4, 3, '2026-12-02');
  kassa('k5', 'o1', 'h_kr', 5, 7, '2027-06-01');

  unit('u_alt', 'o1', 'Алтай');
  hall('h_a1', 'o1', 'u_alt', 'Столовая 1');
  hall('h_a2', 'o1', 'u_alt', 'Столовая 2');
  kassa('k6', 'o1', 'h_a1', 6, 4, '2027-01-18');
  kassa('k7', 'o1', 'h_a1', 7, 9, '2026-11-19');
  kassa('k8', 'o1', 'h_a2', 8, 180, '2027-03-30');

  unit('u_pm', 'o1', 'Подмосковье');
  hall('h_pm', 'o1', 'u_pm', 'Столовая');
  kassa('k9', 'o1', 'h_pm', 9, 6, '2027-08-09');
  kassa('k10', 'o1', 'h_pm', 10, 1500, '2027-02-21');

  unit('u_ek', 'o2', 'Екатеринбург');
  hall('h_cafe', 'o2', 'u_ek', 'Кафе');
  kassa('k11', 'o2', 'h_cafe', 1, 4, '2027-07-07');

  const items = [
    ['i1', 'o1', 'Борщ', 'Первые блюда', 110], ['i2', 'o1', 'Суп-лапша', 'Первые блюда', 95],
    ['i3', 'o1', 'Котлета домашняя', 'Вторые блюда', 90], ['i4', 'o1', 'Гречка', 'Гарниры', 45],
    ['i5', 'o1', 'Картофельное пюре', 'Гарниры', 50], ['i6', 'o1', 'Салат «Витаминный»', 'Салаты', 70],
    ['i7', 'o1', 'Компот', 'Напитки', 30], ['i8', 'o1', 'Чай', 'Напитки', 20], ['i9', 'o1', 'Хлеб', 'Прочее', 8],
    ['i10', 'u_ser', 'Пирожок с капустой', 'Выпечка', 40], ['i11', 'u_ser', 'Булочка', 'Выпечка', 30],
    ['i12', 'h_buf', 'Кофе', 'Напитки', 60],
    ['i13', 'o2', 'Салат «Цезарь»', 'Салаты', 290], ['i14', 'o2', 'Паста карбонара', 'Вторые блюда', 380],
  ].map(([id, scope, name, section, price]) => ({ id, scope, name, section, price }));

  const over = [
    { scope: 'h_buf', item: 'i8', price: 25 },
    { scope: 'h_buf', item: 'i1', hidden: true },
    { scope: 'u_alt', item: 'i3', price: 95 },
  ];

  const profiles = [
    { id: 'p1', org: 'o1', name: 'Кассир', rights: ['sale', 'shift', 'cashio'] },
    { id: 'p2', org: 'o1', name: 'Старший кассир', rights: ['sale', 'refund', 'discount', 'cancel', 'shift', 'xz', 'cashio', 'price'] },
    { id: 'p3', org: 'o1', name: 'Администратор', rights: RIGHTS.map(r => r[0]) },
    { id: 'p4', org: 'o2', name: 'Кассир', rights: ['sale', 'shift'] },
  ];
  const users = [
    { id: 'us1', org: 'o1', name: 'Иванова Анна', pin: '1201', profile: 'p2', access: ['h_s1', 'h_buf'] },
    { id: 'us2', org: 'o1', name: 'Петров Андрей', pin: '3344', profile: 'p1', access: ['h_kr'] },
    { id: 'us3', org: 'o1', name: 'Смирнова Ольга', pin: '5610', profile: 'p1', access: ['u_alt'] },
    { id: 'us4', org: 'o1', name: 'Козлов Дмитрий', pin: '9000', profile: 'p3', access: ['u_ser', 'u_pm'] },
    { id: 'us5', org: 'o1', name: 'Никитина Елена', pin: '7788', profile: 'p1', access: ['h_s1'] },
  ];

  const now = Date.now(), m = 60000;
  const log = [
    { t: now - 12 * m, who: ME, act: 'Цена «Чай» → 25 ₽', scope: 'h_buf', org: 'o1' },
    { t: now - 95 * m, who: ME, act: 'Добавлен пользователь «Петров Андрей»', scope: 'h_kr', org: 'o1' },
    { t: now - 5 * 60 * m, who: 'Сергей', act: 'Цена «Котлета домашняя» → 95 ₽', scope: 'u_alt', org: 'o1' },
    { t: now - 26 * 60 * m, who: ME, act: 'Позиция «Борщ» скрыта', scope: 'h_buf', org: 'o1' },
    { t: now - 30 * 60 * m, who: 'Сергей', act: 'Касса №10: сменён терминал эквайринга', scope: 'k10', org: 'o1' },
    { t: now - 50 * 60 * m, who: ME, act: 'Создана столовая «Буфет»', scope: 'h_buf', org: 'o1' },
  ];

  return { v: 1, orgs: [{ id: 'o1', name: 'Столовая-Урал' }, { id: 'o2', name: 'Урал-Сервис' }], nodes, items, over, profiles, users, log };
}

function load() {
  try { D = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (_) { D = null; }
  if (!D || D.v !== 1) { D = seedData(); save(); }
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(D)); } catch (_) {} }
function resetData() { D = seedData(); save(); }
const uid = p => p + Math.random().toString(36).slice(2, 8);

/* ---------- дерево ---------- */
const isOrg = id => D.orgs.some(o => o.id === id);
const orgById = id => D.orgs.find(o => o.id === id);
const nodeById = id => D.nodes.find(n => n.id === id);
const nameOf = id => (orgById(id) || nodeById(id) || { name: '—' }).name;
const children = id => D.nodes.filter(n => n.parent === id);
function chain(id) { // от организации вниз до узла включительно
  if (isOrg(id)) return [id];
  const n = nodeById(id);
  return n ? chain(n.parent).concat(id) : [];
}
const related = (a, b) => chain(a).includes(b) || chain(b).includes(a);
function kassasUnder(id) {
  if (isOrg(id)) return D.nodes.filter(n => n.type === 'kassa' && n.org === id);
  const n = nodeById(id);
  if (!n) return [];
  if (n.type === 'kassa') return [n];
  return children(id).flatMap(c => kassasUnder(c.id));
}
function subtreeIds(id) { return [id].concat(children(id).flatMap(c => subtreeIds(c.id))); }
const hallOf = id => { const n = nodeById(id); return n && n.type === 'kassa' ? n.parent : id; };
const statusOf = k => k.last <= 15 ? 'online' : k.last <= 1440 ? 'late' : 'offline';
const TYPE_LABEL = { org: 'Организация', unit: 'Подразделение', hall: 'Столовая', kassa: 'Касса' };
const typeOf = id => isOrg(id) ? 'org' : (nodeById(id) || {}).type;
function pathNames(id) { return chain(id).map(nameOf); }

/* ---------- меню с наследованием ---------- */
// skipOverAt: не учитывать правки этого уровня (нужно, чтобы узнать «базовую» цену)
function effectiveMenu(scopeId, skipOverAt) {
  const scope = hallOf(scopeId);
  const map = new Map();
  for (const sc of chain(scope)) {
    for (const it of D.items.filter(i => i.scope === sc)) {
      map.set(it.id, { item: it, price: it.price, from: sc, priceFrom: sc, hidden: false, hiddenFrom: null });
    }
    if (sc === skipOverAt) continue;
    for (const o of D.over.filter(o => o.scope === sc)) {
      const r = map.get(o.item);
      if (!r) continue;
      if (o.price != null) { r.price = o.price; r.priceFrom = sc; }
      if (o.hidden != null) { r.hidden = o.hidden; r.hiddenFrom = o.hidden ? sc : null; }
    }
  }
  return [...map.values()].sort((a, b) => SECTIONS.indexOf(a.item.section) - SECTIONS.indexOf(b.item.section) || a.item.name.localeCompare(b.item.name, 'ru'));
}
function overAt(scope, item) { return D.over.find(o => o.scope === scope && o.item === item); }
function setOver(scope, item, patch) {
  let o = overAt(scope, item);
  if (!o) { o = { scope, item }; D.over.push(o); }
  Object.assign(o, patch);
  if (o.price == null && o.hidden == null) D.over.splice(D.over.indexOf(o), 1);
}

/* ---------- журнал ---------- */
function logAct(act, scope, org) { D.log.unshift({ t: Date.now(), who: ME, act, scope, org }); D.log.length = Math.min(D.log.length, 300); }

/* ---------- демо-продажи (псевдослучайные, но стабильные) ---------- */
function rng(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
function periodDays(p) {
  const n = { today: 1, yesterday: 1, week: 7, month: 30 }[p] || 1, shift = p === 'yesterday' ? 1 : 0, out = [];
  for (let i = 0; i < n; i++) { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - shift - i); out.push(ymd(d)); }
  return out.reverse();
}
function daySales(kassaId, date) {
  const r = rng(kassaId + date);
  let frac = 1;
  if (date === ymd(new Date())) { const now = new Date(); frac = Math.min(1, Math.max(.05, (now.getHours() + now.getMinutes() / 60 - 8) / 9)); }
  const checks = Math.round((90 + r() * 130) * frac), sum = Math.round(checks * (280 + r() * 140));
  const card = Math.round(sum * (.42 + r() * .16)), qr = Math.round(sum * (.08 + r() * .1));
  return { checks, sum, card, qr, cash: sum - card - qr };
}
function salesFor(scope, period) {
  const days = periodDays(period), ks = kassasUnder(scope), n = nodeById(scope);
  const tot = { checks: 0, sum: 0, cash: 0, card: 0, qr: 0 }, groups = new Map();
  const depth = chain(scope).length;
  const add = (a, b) => { for (const k of ['checks', 'sum', 'cash', 'card', 'qr']) a[k] += b[k]; };
  for (const k of ks) {
    for (const d of days) {
      const s = daySales(k.id, d);
      add(tot, s);
      const key = n && n.type === 'kassa' ? d : chain(k.id)[depth];
      if (!groups.has(key)) groups.set(key, { key, checks: 0, sum: 0, cash: 0, card: 0, qr: 0 });
      add(groups.get(key), s);
    }
  }
  const rows = [...groups.values()].map(g => ({ ...g, name: n && n.type === 'kassa' ? g.key.split('-').reverse().join('.') : nameOf(g.key), avg: g.checks ? Math.round(g.sum / g.checks) : 0 }));
  if (n && n.type === 'kassa') rows.sort((a, b) => b.key.localeCompare(a.key)); else rows.sort((a, b) => b.sum - a.sum);
  const org = (isOrg(scope) ? scope : nodeById(scope).org);
  const top = D.items.filter(i => i.scope === org).map(i => {
    const qty = Math.round(tot.checks * (.03 + rng(i.id + scope)() * .16));
    return { name: i.name, qty, sum: qty * i.price };
  }).sort((a, b) => b.qty - a.qty).slice(0, 8);
  return { tot, rows, top, levelLabel: n && n.type === 'kassa' ? 'Дни' : { org: 'Подразделения', unit: 'Столовые', hall: 'Кассы' }[typeOf(scope)], avg: tot.checks ? Math.round(tot.sum / tot.checks) : 0, kassas: ks.length };
}
