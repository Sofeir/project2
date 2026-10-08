/* =============================================================================
   ДАННЫЕ КАССЫ В БРАУЗЕРЕ
   Единственное место, где интерфейс получает и сохраняет данные. Раньше здесь
   были запросы к серверу; теперь все таблицы (меню, витрина, смены, чеки,
   наличные, отложенные) живут в localStorage этого браузера. Сервер не нужен:
   касса одинаково работает с локального диска и с домена.

   Снаружи всё осталось как было: методы асинхронные, операции над сменой
   возвращают её полный снимок, ошибки приходят как Error с текстом для кассира.
   ============================================================================= */

const API = (() => {

  const KEY = 'asoft-pos-db-v1';
  const FORMAT = 'asoft-pos';
  const VERSION = 1;

  const money = n => Math.round(Number(n) * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const hhmm = iso => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const ddmmyyyy = iso => { const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
  const isoToRu = s => (s ? s.split('-').reverse().join('.') : null);   // '2026-09-29' → '29.09.2026'
  const clone = o => JSON.parse(JSON.stringify(o));
  const now = () => new Date().toISOString();

  /* ------------------------------ хранилище ------------------------------- */
  let db = null;

  function empty() {
    return { categories: [], products: [], discounts: [], hotkeys: [], shifts: [], checks: [], cashOps: [], parked: [] };
  }

  /* Первый запуск: меню и витрина из seed.js, открытая смена с разменом 3 000 ₽ */
  function seeded() {
    const d = empty();
    d.categories = clone(SEED.CATEGORIES);
    d.products = SEED.PRODUCTS.map(p => ({ ...p, active: true }));
    d.discounts = SEED.DISCOUNTS.filter(x => x.percent).map(x => ({ ...x }));  // «Без скидки» — это отсутствие записи
    d.hotkeys = renumber(SEED.hotkeysTree());
    d.shifts = [{ id: 1, number: 33, register: 13, opening_cash: 3000, counted_cash: null, opened_at: now(), closed_at: null }];
    return normalize(d);
  }

  /* Пропуска и настройки появились позже остальных таблиц: в данных, сохранённых
     прежней версией кассы, их нет — достраиваем, ничего не трогая в остальном.
     Вторая версия пропусков хранит начисления штуками, а не рублями:
     старые остатки в рублях не переводятся, пропуска берутся заново */
  const PASSES_VER = 2;
  const MENU_VER = 2;
  function normalize(d) {
    if (!Array.isArray(d.passes) || d.passesVer !== PASSES_VER) { d.passes = clone(SEED.PASSES); d.passesVer = PASSES_VER; }
    /* Меню дополняется новыми группами и блюдами из seed.js; существующие не трогаем */
    if (d.menuVer !== MENU_VER) {
      SEED.CATEGORIES.forEach(c => { if (!d.categories.some(x => x.id === c.id)) d.categories.push(clone(c)); });
      SEED.PRODUCTS.forEach(sp => {
        const have = d.products.find(x => x.name === sp.name);
        if (have) { if (sp.sub && !have.sub) have.sub = sp.sub; return; }
        const n = d.products.reduce((m, x) => Math.max(m, parseInt(String(x.id).replace(/\D/g, ''), 10) || 0), 0) + 1;
        d.products.push({ ...sp, id: 'p' + n, active: true });
      });
      d.menuVer = MENU_VER;
    }
    if (!d.settings || typeof d.settings !== 'object') d.settings = {};
    if (typeof d.settings.sbp !== 'boolean') d.settings.sbp = true;
    return d;
  }

  function load() {
    if (db) return db;
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (_) { /* хранилище недоступно */ }
    if (raw) {
      try { db = JSON.parse(raw); } catch (_) { db = null; }
    }
    if (!db || !Array.isArray(db.shifts)) { db = seeded(); save(); }
    else if (!Array.isArray(db.passes) || !db.settings || db.passesVer !== PASSES_VER || db.menuVer !== MENU_VER) { normalize(db); save(); }
    return db;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (err) {
      throw new Error('Браузер не дал сохранить данные кассы (' + err.name + '). Освободите место или сохраните данные в файл');
    }
  }

  const nextId = list => list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;

  /* Изменение данных: всё или ничего. Если посреди операции случилась ошибка,
     возвращаем копию, снятую до неё, — как откат транзакции. */
  function tx(fn) {
    load();
    const before = JSON.stringify(db);
    try {
      const r = fn(db);
      save();
      return r;
    } catch (err) {
      db = JSON.parse(before);
      throw err;
    }
  }

  /* Небольшая пауза, чтобы вызовы оставались асинхронными, как у сервера */
  const ok = v => Promise.resolve().then(() => v);
  const run = fn => Promise.resolve().then(fn);

  /* ============================ НОМЕНКЛАТУРА ============================== */
  function catalog() {
    const d = load();
    return {
      categories: d.categories.map(c => ({ id: c.id, name: c.name, short: c.short, color: c.color })),
      products: d.products.filter(p => p.active !== false)
        .map(p => ({ id: p.id, name: p.name, price: p.price, unit: p.unit, cat: p.cat, sub: p.sub || '', hit: !!p.hit, weight: !!p.weight })),
      discounts: d.discounts.map(x => ({ id: x.id, name: x.name, percent: x.percent })),
    };
  }

  /* ========================== ГОРЯЧИЕ КЛАВИШИ ============================= */
  function renumber(nodes) {
    let n = 0;
    const walk = list => list.map(x => x.kind === 'group'
      ? { id: String(++n), kind: 'group', name: x.name || 'Без названия', color: x.color || null, items: walk(x.items || []) }
      : { id: String(++n), kind: 'item', pid: x.pid });
    return walk(nodes);
  }

  function saveHotkeys(items) {
    if (!Array.isArray(items)) throw new Error('Ожидался список групп и товаров');
    const MAX_DEPTH = 3;
    /* Ограничение касается только вложенности групп: товары лежат на любом уровне */
    const check = (list, depth) => list.forEach(x => {
      if (x.kind !== 'group') return;
      if (depth > MAX_DEPTH) throw new Error(`Превышена глубина витрины: максимум ${MAX_DEPTH} уровня групп`);
      check(x.items || [], depth + 1);
    });
    check(items, 1);
    return tx(d => { d.hotkeys = renumber(items); return { items: clone(d.hotkeys) }; });
  }

  /* ============================ СОСТОЯНИЕ СМЕНЫ =========================== */

  /** Открытая смена. Если её нет — открывается новая: касса без смены бесполезна. */
  function currentShift(d) {
    const open = d.shifts.filter(s => !s.closed_at).pop();
    if (open) return open;
    const s = {
      id: nextId(d.shifts),
      number: d.shifts.reduce((m, x) => Math.max(m, x.number), 32) + 1,
      register: 13, opening_cash: 0, counted_cash: null, opened_at: now(), closed_at: null,
    };
    d.shifts.push(s);
    save();
    return s;
  }

  const isIncome = kind => kind === 'sale' || kind === 'correction_sale';
  /* прочая оплата — не деньги покупателя: списание и нефискальный расчёт */
  const OTHER_METHODS = ['writeoff', 'nonfiscal'];
  const benefitName = id => (SEED.BENEFITS.find(b => b.id === id) || { name: id }).name;

  /** Документ смены в том виде, в каком его ждёт интерфейс */
  function checkView(d, c) {
    let ref = null;
    if (c.source_check_id) {
      const sc = d.checks.find(x => x.id === c.source_check_id);
      const sh = sc && d.shifts.find(s => s.id === sc.shift_id);
      if (sc && sh) ref = `чек № ${pad4(sc.number)}, смена №${sh.number}`;
    }
    return {
      id: c.id, number: c.number, kind: c.kind, total: c.total, change: c.change_sum || 0,
      source_number: c.source_number ?? null,
      subtotal: c.subtotal, discount_percent: c.discount_percent || 0, discount_sum: c.discount_sum || 0,
      correction_type: c.correction_type ?? null, doc_date: isoToRu(c.doc_date), doc_number: c.doc_number ?? null,
      tax_system: c.tax_system ?? null, op_date: isoToRu(c.op_date), fiscal_sign: c.fiscal_sign ?? null,
      source_ref: ref,
      date: ddmmyyyy(c.created_at), time: hhmm(c.created_at),
      items: c.items.map(i => ({ id: i.id, name: i.name, price: i.price, unit: i.unit, qty: i.qty })),
      payments: c.payments.map(p => ({ m: p.m, kind: p.kind ?? null, qty: p.qty ?? null, amount: p.amount, vat: p.vat ?? null, vatSum: p.vatSum ?? null })),
      pass: c.pass ? { number: c.pass.number, owner: c.pass.owner } : null,
    };
  }
  const pad4 = n => String(n).padStart(4, '0');

  /** Все документы смены, новые сверху */
  function shiftChecksOf(d, shiftId) {
    return d.checks.filter(c => c.shift_id === shiftId)
      .sort((a, b) => (b.created_at.localeCompare(a.created_at)) || (b.id - a.id))
      .map(c => checkView(d, c));
  }

  /** Полный снимок смены — интерфейс обновляет им своё состояние после любой операции */
  function shiftState() {
    const d = load();
    const shift = currentShift(d);
    const mine = d.checks.filter(c => c.shift_id === shift.id);

    let revenue = 0, returns = 0, cash = 0, cashless = 0, pass = 0, other = 0;
    const passBy = {};
    mine.forEach(c => {
      revenue += isIncome(c.kind) ? c.total : -c.total;
      if (!isIncome(c.kind)) returns += c.total;
      c.payments.forEach(p => {
        const v = isIncome(c.kind) ? p.amount : -p.amount;
        if (p.m === 'cash') cash += v;
        else if (p.m === 'pass') {
          pass += v;
          const k = p.kind || 'pass';
          passBy[k] = money((passBy[k] || 0) + v);
        }
        else if (OTHER_METHODS.includes(p.m)) other += v;
        else cashless += v;
      });
    });
    const ops = d.cashOps.filter(o => o.shift_id === shift.id);
    const delta = ops.reduce((s, o) => s + (o.kind === 'in' ? o.amount : -o.amount), 0);

    return {
      shift: {
        id: shift.id, number: shift.number, register: shift.register,
        openedAt: hhmm(shift.opened_at), openingCash: money(shift.opening_cash),
      },
      nextCheckNumber: mine.reduce((m, c) => Math.max(m, c.number), 0) + 1,
      checks: shiftChecksOf(d, shift.id),
      cashOps: ops.slice().reverse().map(o => ({ type: o.kind, amount: o.amount, reason: o.reason, time: hhmm(o.created_at) })),
      parked: d.parked.filter(p => p.shift_id === shift.id)
        .map(p => ({ id: p.id, no: p.number, total: p.total, count: p.positions, time: hhmm(p.created_at), payload: clone(p.payload || {}) })),
      totals: {
        checks: mine.filter(c => c.kind === 'sale').length,
        revenue: money(revenue),
        returns: money(returns),
        cash: money(cash),
        cashless: money(cashless),
        pass: money(pass),
        passBy,
        other: money(other),
        drawer: money(shift.opening_cash + cash + delta),
      },
    };
  }

  /* ================================= ЧЕКИ ================================= */
  const nextNumber = (d, shiftId) => d.checks.filter(c => c.shift_id === shiftId).reduce((m, c) => Math.max(m, c.number), 0) + 1;

  function blankCheck(d, shift, kind) {
    return {
      id: nextId(d.checks), shift_id: shift.id, number: nextNumber(d, shift.id), kind,
      subtotal: 0, discount_id: null, discount_percent: 0, discount_sum: 0, total: 0, change_sum: 0,
      source_number: null, source_check_id: null, correction_type: null, doc_date: null, doc_number: null,
      tax_system: null, op_date: null, fiscal_sign: null, created_at: now(), items: [], payments: [],
    };
  }

  function saleOrReturn(body) {
    const kind = body.kind === 'return' ? 'return' : 'sale';
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) throw new Error('Чек без позиций');
    const payments = Array.isArray(body.payments) ? body.payments : [];
    if (!payments.length) throw new Error('Не указан способ оплаты');
    const byPass = payments.filter(p => p.m === 'pass');
    if (byPass.length && kind !== 'sale') throw new Error('Возврат на пропуск — только по чеку продажи');
    if (byPass.length && !body.pass) throw new Error('Пропуск не приложен');

    tx(d => {
      const shift = currentShift(d);
      /* Суммы пересчитываем по ценам из справочника, а не по тому, что прислал экран */
      const priced = items.map(it => {
        const p = d.products.find(x => x.id === it.id);
        const price = p ? Number(p.price) : Number(it.price);
        const qty = Number(it.qty);
        if (!(qty > 0)) throw new Error(`Некорректное количество для «${it.name}»`);
        return { id: p ? p.id : null, name: p ? p.name : it.name, unit: p ? p.unit : it.unit, price, qty, sum: money(price * qty) };
      });
      const subtotal = money(priced.reduce((s, i) => s + i.sum, 0));

      let discountId = null, percent = 0;
      const disc = body.discountId && d.discounts.find(x => x.id === body.discountId);
      if (disc) { discountId = disc.id; percent = disc.percent; }
      /* Скидка округляется до рубля — так же, как её видит кассир на экране */
      const discountSum = Math.round(subtotal * percent / 100);
      const total = money(subtotal - discountSum);

      const paid = money(payments.reduce((s, p) => s + Number(p.amount), 0));
      if (paid + 0.01 < total) throw new Error(`Внесено ${paid} ₽ при итоге ${total} ₽`);

      const c = blankCheck(d, shift, kind);
      Object.assign(c, { subtotal, discount_id: discountId, discount_percent: percent, discount_sum: discountSum,
        total, change_sum: money(body.change || 0), items: priced });

      let card = null;
      if (byPass.length) {
        card = d.passes.find(x => x.number === String(body.pass));
        if (!card) throw new Error('Пропуск не найден');
        c.pass = { number: card.number, owner: card.owner };
      }

      /* Сдача не является выручкой: наличными фиксируем ровно ту часть, что осталась в кассе */
      let rest = total;
      payments.forEach(p => {
        const amount = money(Math.min(Number(p.amount), rest));
        if (amount <= 0) return;
        if (p.m === 'pass') {
          /* начисление списывается с пропуска штуками в той же операции, что и чек;
             сумма — номинал × штуки, но не больше того, что осталось оплатить */
          const ben = SEED.BENEFITS.find(b => b.id === p.kind);
          const qty = Math.floor(Number(p.qty));
          const left = Math.floor(card.balances[p.kind] || 0);
          if (!ben || !(qty > 0)) throw new Error(`Некорректное начисление «${benefitName(p.kind)}»`);
          if (qty > left) throw new Error(`На пропуске не хватает начисления «${benefitName(p.kind)}»: осталось ${left} шт`);
          const sum = money(Math.min(qty * ben.price, rest));
          card.balances[p.kind] = left - qty;
          c.payments.push({ m: 'pass', kind: p.kind, qty, amount: sum, vat: null, vatSum: null });
          rest = money(rest - sum);
          return;
        } else {
          c.payments.push({ m: p.m, amount, vat: null, vatSum: null });
        }
        rest = money(rest - amount);
      });
      d.checks.push(c);
    });
    return shiftState();
  }

  /* Возврат по чеку: позиции и оплаты берутся из самого чека продажи */
  function returnCheck(sourceNumber) {
    tx(d => {
      const shift = currentShift(d);
      const src = d.checks.find(c => c.shift_id === shift.id && c.number === sourceNumber && c.kind === 'sale');
      if (!src) throw new Error(`Чек продажи № ${sourceNumber} в текущей смене не найден`);
      if (d.checks.some(c => c.shift_id === shift.id && c.kind === 'return' && c.source_number === sourceNumber)) {
        throw new Error(`По чеку № ${sourceNumber} возврат уже оформлен`);
      }
      const c = blankCheck(d, shift, 'return');
      Object.assign(c, {
        subtotal: src.subtotal, discount_percent: src.discount_percent, discount_sum: src.discount_sum,
        total: src.total, source_number: sourceNumber, items: clone(src.items), payments: clone(src.payments),
        pass: src.pass ? clone(src.pass) : null,
      });
      /* что было списано с пропуска, возвращается на него же */
      const card = src.pass && d.passes.find(x => x.number === src.pass.number);
      if (card) src.payments.filter(p => p.m === 'pass' && p.kind && p.qty).forEach(p => {
        card.balances[p.kind] = (card.balances[p.kind] || 0) + p.qty;
      });
      d.checks.push(c);
    });
    return shiftState();
  }

  /* Чек коррекции не содержит позиций: по 54-ФЗ он правит расчёты и несёт тип
     коррекции (тег 1173) и основание (тег 1174). Каждая сумма — отдельной строкой
     со своим способом расчёта и ставкой НДС. */
  const CORRECTION_TYPES = ['self', 'order'];
  const TAX_SYSTEMS = ['osn', 'usn', 'usn_dr', 'eshn', 'psn'];
  const VAT_RATES = { '22': 22, '20': 20, '10': 10, '0': 0, none: null };
  const METHODS = ['cash', 'card', 'qr', 'staff', 'pass', 'writeoff', 'nonfiscal'];
  const isIsoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

  function correctionCheck(body) {
    if (!CORRECTION_TYPES.includes(body.correctionType)) throw new Error('Не указан тип коррекции');
    if (!TAX_SYSTEMS.includes(body.taxSystem)) throw new Error('Не указана система налогообложения');
    if (!isIsoDate(body.opDate)) throw new Error('Не указана дата исходной операции');
    if (!isIsoDate(body.docDate)) throw new Error('Не указана дата документа-основания');
    const docNumber = String(body.docNumber || '').trim();
    if (!docNumber) throw new Error('Не указан номер документа-основания');
    const fiscalSign = String(body.fiscalSign || '').trim() || null;
    if (fiscalSign && !/^\d{1,10}$/.test(fiscalSign)) throw new Error('ФП ошибочного чека — до 10 цифр');

    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l, i) => {
      const amount = money(l.amount);
      if (!(amount > 0)) throw new Error(`Строка ${i + 1}: сумма должна быть больше нуля`);
      if (!METHODS.includes(l.method)) throw new Error(`Строка ${i + 1}: не указан способ расчёта`);
      if (!(l.vat in VAT_RATES)) throw new Error(`Строка ${i + 1}: не указана ставка НДС`);
      const rate = VAT_RATES[l.vat];
      return { m: l.method, amount, vat: l.vat, vatSum: rate ? money(amount * rate / (100 + rate)) : 0 };
    });
    if (!lines.length) throw new Error('Добавьте хотя бы одну сумму коррекции');

    tx(d => {
      /* коррекция продажи исправляет чек продажи, коррекция возврата — чек возврата */
      let sourceId = null;
      if (body.sourceCheckId) {
        const src = d.checks.find(c => c.id === Number(body.sourceCheckId));
        const need = body.kind === 'correction_sale' ? 'sale' : 'return';
        if (!src || src.kind !== need) throw new Error('Исходный чек для коррекции не найден');
        sourceId = src.id;
      }
      const total = money(lines.reduce((s, l) => s + l.amount, 0));
      const c = blankCheck(d, currentShift(d), body.kind);
      Object.assign(c, {
        subtotal: total, total, correction_type: body.correctionType, doc_date: body.docDate, doc_number: docNumber,
        tax_system: body.taxSystem, op_date: body.opDate, fiscal_sign: fiscalSign, source_check_id: sourceId, payments: lines,
      });
      d.checks.push(c);
    });
    return shiftState();
  }

  function postCheck(body) {
    body = body || {};
    if (body.kind === 'return' && body.sourceNumber) return returnCheck(Number(body.sourceNumber));
    if (body.kind === 'correction_sale' || body.kind === 'correction_return') return correctionCheck(body);
    return saleOrReturn(body);
  }

  /* =========================== НАЛИЧНЫЕ В КАССЕ =========================== */
  function cashOp({ kind, amount, reason } = {}) {
    if (!['in', 'out'].includes(kind)) throw new Error('Неизвестная операция с наличными');
    const sum = money(amount);
    if (!(sum > 0)) throw new Error('Сумма должна быть больше нуля');
    if (kind === 'out' && sum > shiftState().totals.drawer) throw new Error('В ящике недостаточно наличных');
    tx(d => {
      d.cashOps.push({ id: nextId(d.cashOps), shift_id: currentShift(d).id, kind, amount: sum, reason: reason || null, created_at: now() });
    });
    return shiftState();
  }

  /* ============================== ОТЛОЖЕННЫЕ ============================== */
  function park({ number, total, positions, payload } = {}) {
    tx(d => {
      d.parked.push({ id: nextId(d.parked), shift_id: currentShift(d).id, number, total: money(total),
        positions, payload: clone(payload ?? {}), created_at: now() });
    });
    return shiftState();
  }
  function unpark(id) {
    tx(d => { d.parked = d.parked.filter(p => p.id !== Number(id)); });
    return shiftState();
  }

  /* ================================ СМЕНЫ ================================= */
  function shifts() {
    const d = load();
    currentShift(d);
    const f = iso => (iso ? `${ddmmyyyy(iso)} ${hhmm(iso)}` : null);
    return d.shifts.slice().sort((a, b) => b.id - a.id).slice(0, 60)
      .map(s => ({ id: s.id, number: s.number, opened: f(s.opened_at), closed: f(s.closed_at) }));
  }

  /* Расход блюд: возврат уменьшает расход. Суммы — по цене позиции, до скидки.
     Считается по смене или по датам чеков (местное время кассы, обе даты включительно). */
  const localDay = iso => { const t = new Date(iso); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  function usage(id) { return usageOf(c => c.shift_id === Number(id)); }
  function usageRange(from, to) {
    if (!from || !to) throw new Error('Укажите обе даты периода');
    if (from > to) throw new Error('Дата начала позже даты конца');
    return usageOf(c => { const day = localDay(c.created_at); return day >= from && day <= to; });
  }
  function usageOf(pick) {
    const d = load();
    const acc = new Map();
    d.checks.filter(c => pick(c) && (c.kind === 'sale' || c.kind === 'return')).forEach(c => {
      const sign = c.kind === 'sale' ? 1 : -1;
      c.items.forEach(i => {
        const k = i.name + '\u0000' + i.unit;
        const r = acc.get(k) || { name: i.name, unit: i.unit, qty: 0, sum: 0 };
        r.qty += sign * i.qty; r.sum += sign * i.sum;
        acc.set(k, r);
      });
    });
    const items = [...acc.values()].filter(r => Math.abs(r.qty) > 1e-9)
      .map(r => ({ name: r.name, unit: r.unit, qty: Math.round(r.qty * 1000) / 1000, sum: money(r.sum) }))
      .sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name, 'ru'));
    return { items };
  }

  function closeShift(counted) {
    const state = shiftState();
    const closed = tx(d => {
      const shift = currentShift(d);
      shift.closed_at = now();
      shift.counted_cash = counted == null ? null : money(counted);
      /* Деньги остаются в ящике — новая смена начинается с фактического остатка */
      const carry = counted == null ? state.totals.drawer : money(counted);
      d.shifts.push({
        id: nextId(d.shifts), number: d.shifts.reduce((m, x) => Math.max(m, x.number), 0) + 1,
        register: shift.register, opening_cash: carry, counted_cash: null, opened_at: now(), closed_at: null,
      });
      return { number: shift.number, totals: state.totals, carry };
    });
    return { closed, ...shiftState() };
  }

  /* ================================ ПРОПУСК ================================ */
  /* Номер с ридера → владелец и начисления с ненулевым остатком, в порядке списка */
  function passInfo(number) {
    const n = String(number || '').trim();
    if (!n) throw new Error('Пустой номер пропуска');
    const card = load().passes.find(x => x.number === n || x.number === n.padStart(6, '0'));
    if (!card) throw new Error(`Пропуск № ${n} не найден`);
    return {
      number: card.number, owner: card.owner,
      benefits: SEED.BENEFITS.filter(b => Math.floor(card.balances[b.id] || 0) > 0)
        .map(b => ({ id: b.id, name: b.name, price: b.price, count: Math.floor(card.balances[b.id]) })),
    };
  }

  /* ============================== НАСТРОЙКИ =============================== */
  function setSettings(patch) {
    return tx(d => {
      if (patch && typeof patch.sbp === 'boolean') d.settings.sbp = patch.sbp;
      return clone(d.settings);
    });
  }

  /* Весы. Пока только тестовое устройство: случайный устойчивый вес.
     Реальные весы подключаются здесь — вернуть { grams, stable }. */
  function scale() {
    return new Promise(r => setTimeout(() => r({ grams: 50 + Math.floor(Math.random() * 230) * 5, stable: true, stub: true }), 600));
  }

  /* ========================= ЭКСПОРТ И ИМПОРТ ФАЙЛОМ ====================== */
  function exportData() {
    return { format: FORMAT, version: VERSION, exportedAt: now(), data: clone(load()) };
  }

  function importData(file) {
    const f = typeof file === 'string' ? JSON.parse(file) : file;
    if (!f || f.format !== FORMAT || !f.data) throw new Error('Это не файл данных ASOFT POS');
    if (f.version > VERSION) throw new Error('Файл сохранён более новой версией кассы');
    const d = { ...empty(), ...f.data };
    for (const k of Object.keys(empty())) {
      if (!Array.isArray(d[k])) throw new Error(`В файле повреждён раздел «${k}»`);
    }
    db = normalize(clone(d));
    save();
    return { shifts: d.shifts.length, checks: d.checks.length, products: d.products.length };
  }

  return {
    catalog:     ()   => run(catalog),
    state:       ()   => run(shiftState),

    sale:        p    => run(() => postCheck({ kind: 'sale', ...p })),
    refund:      no   => run(() => postCheck({ kind: 'return', sourceNumber: no })),
    /* возврат блюд: позиции набраны на витрине, исходного чека нет */
    refundItems: p    => run(() => postCheck({ kind: 'return', ...p })),
    correction:  p    => run(() => postCheck(p)),

    cash:        p    => run(() => cashOp(p)),

    park:        p    => run(() => park(p)),
    unpark:      id   => run(() => unpark(id)),

    closeShift:  cash => run(() => closeShift(cash)),
    shifts:      ()   => run(shifts),
    usage:       id   => run(() => usage(id)),
    usageRange:  (from, to) => run(() => usageRange(from, to)),
    shiftChecks: id   => run(() => ({ checks: shiftChecksOf(load(), Number(id)) })),

    scale,

    pass:        n    => run(() => passInfo(n)),
    settings:    ()   => run(() => clone(load().settings)),
    setSettings: p    => run(() => setSettings(p)),

    hotkeys:     ()    => run(() => ({ items: clone(load().hotkeys) })),
    saveHotkeys: items => run(() => saveHotkeys(items)),

    exportData:  ()   => ok(exportData()),
    importData:  f    => run(() => importData(f)),
  };
})();
