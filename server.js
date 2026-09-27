/* =============================================================================
   ASOFT POS — HTTP-сервер
   Отдаёт интерфейс кассы и API поверх PostgreSQL.
   Запуск: npm start
   ============================================================================= */

const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 8420;

app.use(express.json({ limit: '512kb' }));

/* --------------------------- статика интерфейса ---------------------------- */
/* Раздаём только каталоги фронтенда. Корень проекта отдавать нельзя:
   рядом лежат .env, server.js и node_modules. */
const noCache = { etag: false, setHeaders: r => r.setHeader('Cache-Control', 'no-store') };
app.use('/css', express.static(path.join(__dirname, 'css'), noCache));
app.use('/js',  express.static(path.join(__dirname, 'js'),  noCache));
app.use('/img', express.static(path.join(__dirname, 'img')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* Обёртка, чтобы не писать try/catch в каждом обработчике */
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const money = n => Math.round(Number(n) * 100) / 100;

/* ============================== НОМЕНКЛАТУРА =============================== */

app.get('/api/catalog', route(async (_req, res) => {
  const [categories, products, discounts] = await Promise.all([
    db.rows(`select id, name, short, color from categories order by sort, name`),
    db.rows(`select id, name, price, unit, category_id as cat,
                    is_hit as hit, is_weight as weight
               from products where is_active order by sort, name`),
    db.rows(`select id, name, percent from discounts order by sort, percent`),
  ]);
  res.json({ categories, products, discounts });
}));

/* ============================= ГОРЯЧИЕ КЛАВИШИ ============================= */

/* Плоский список из базы собираем в дерево того вида, с которым работает
   интерфейс: { id, kind:'group', name, color, items:[] } | { id, kind:'item', pid } */
function buildTree(flat) {
  const byId = new Map();
  flat.forEach(r => {
    byId.set(r.id, r.kind === 'group'
      ? { id: String(r.id), kind: 'group', name: r.name, color: r.color, items: [] }
      : { id: String(r.id), kind: 'item', pid: r.product_id });
  });
  const roots = [];
  flat.forEach(r => {
    const node = byId.get(r.id);
    const parent = r.parent_id ? byId.get(r.parent_id) : null;
    (parent ? parent.items : roots).push(node);
  });
  return roots;
}

app.get('/api/hotkeys', route(async (_req, res) => {
  const flat = await db.rows(
    `select id, parent_id, kind, name, color, product_id from hotkeys order by parent_id nulls first, sort, id`
  );
  res.json({ items: buildTree(flat) });
}));

/* Витрину сохраняем целиком: администратор правит черновик и жмёт «Сохранить»,
   частичных изменений в этой модели не бывает. */
app.put('/api/hotkeys', route(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items) return res.status(400).json({ error: 'Ожидался объект { items: [...] }' });

  const MAX_DEPTH = 3;
  await db.withTransaction(async c => {
    await c.query('delete from hotkeys');

    const insert = async (nodes, parentId, depth) => {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const isGroup = n.kind === 'group';
        /* Ограничение касается только вложенности групп: товары лежат
           на любом уровне, в том числе внутри самой глубокой подгруппы. */
        if (isGroup && depth > MAX_DEPTH) {
          throw new Error(`Превышена глубина витрины: максимум ${MAX_DEPTH} уровня групп`);
        }
        const { rows: [row] } = await c.query(
          `insert into hotkeys (parent_id, kind, name, color, product_id, sort)
           values ($1,$2,$3,$4,$5,$6) returning id`,
          [parentId, isGroup ? 'group' : 'item', isGroup ? (n.name || 'Без названия') : null,
           isGroup ? (n.color || null) : null, isGroup ? null : n.pid, i]
        );
        if (isGroup && Array.isArray(n.items)) await insert(n.items, row.id, depth + 1);
      }
    };
    await insert(items, null, 1);
  });

  const flat = await db.rows(
    `select id, parent_id, kind, name, color, product_id from hotkeys order by parent_id nulls first, sort, id`
  );
  res.json({ items: buildTree(flat) });
}));

/* ============================ СОСТОЯНИЕ СМЕНЫ ============================== */

/** Открытая смена. Если её нет — открывается новая: касса без смены бесполезна. */
async function currentShift() {
  const open = await db.one(`select * from shifts where closed_at is null order by id desc limit 1`);
  if (open) return open;
  return db.one(
    `insert into shifts (number, register, opening_cash)
     values ((select coalesce(max(number), 32) + 1 from shifts), 13, 0) returning *`
  );
}

/** Полный снимок смены — интерфейс обновляет им своё состояние после любой операции. */
async function shiftState() {
  const shift = await currentShift();

  const checks = await db.rows(`
    select c.number, c.kind, c.total, c.change_sum as change, c.source_number,
           to_char(c.created_at, 'HH24:MI') as time,
           coalesce(i.items, '[]'::json)    as items,
           coalesce(p.payments, '[]'::json) as payments
      from checks c
      left join lateral (
        select json_agg(json_build_object(
                 'id', ci.product_id, 'name', ci.name, 'price', ci.price,
                 'unit', ci.unit, 'qty', ci.qty) order by ci.sort) as items
          from check_items ci where ci.check_id = c.id) i on true
      left join lateral (
        select json_agg(json_build_object('m', pm.method, 'amount', pm.amount) order by pm.id) as payments
          from payments pm where pm.check_id = c.id) p on true
     where c.shift_id = $1
     order by c.created_at desc, c.id desc`, [shift.id]);

  const cashOps = await db.rows(`
    select kind as type, amount, reason, to_char(created_at,'HH24:MI') as time
      from cash_ops where shift_id = $1 order by id desc`, [shift.id]);

  const parked = await db.rows(`
    select id, number as no, total, positions as count,
           to_char(created_at,'HH24:MI') as time, payload
      from parked_checks where shift_id = $1 order by id`, [shift.id]);

  const t = await db.one(`
    select
      count(*) filter (where kind = 'sale')                                   as checks,
      coalesce(sum(case when kind = 'sale' then total else -total end), 0)    as revenue,
      coalesce(sum(case when kind = 'return' then total else 0 end), 0)       as returns
    from checks where shift_id = $1`, [shift.id]);

  const m = await db.one(`
    select
      coalesce(sum(case when p.method =  'cash' then (case when c.kind='sale' then p.amount else -p.amount end) end), 0) as cash,
      coalesce(sum(case when p.method <> 'cash' then (case when c.kind='sale' then p.amount else -p.amount end) end), 0) as cashless
    from checks c join payments p on p.check_id = c.id
   where c.shift_id = $1`, [shift.id]);

  const ops = await db.one(`
    select coalesce(sum(case when kind='in' then amount else -amount end), 0) as delta
      from cash_ops where shift_id = $1`, [shift.id]);

  const next = await db.one(
    `select coalesce(max(number), 0) + 1 as n from checks where shift_id = $1`, [shift.id]);

  return {
    shift: {
      id: shift.id,
      number: shift.number,
      register: shift.register,
      openedAt: new Date(shift.opened_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      openingCash: money(shift.opening_cash),
    },
    nextCheckNumber: next.n,
    checks,
    cashOps,
    parked,
    totals: {
      checks: t.checks,
      revenue: money(t.revenue),
      returns: money(t.returns),
      cash: money(m.cash),
      cashless: money(m.cashless),
      drawer: money(Number(shift.opening_cash) + Number(m.cash) + Number(ops.delta)),
    },
  };
}

app.get('/api/state', route(async (_req, res) => res.json(await shiftState())));

/* ================================== ЧЕКИ =================================== */

app.post('/api/checks', route(async (req, res) => {
  const body = req.body || {};

  if (body.kind === 'return') {
    const state = await returnCheck(Number(body.sourceNumber));
    return res.json(state);
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return res.status(400).json({ error: 'Чек без позиций' });

  const payments = Array.isArray(body.payments) ? body.payments : [];
  if (!payments.length) return res.status(400).json({ error: 'Не указан способ оплаты' });

  await db.withTransaction(async c => {
    const shift = await currentShift();

    /* Суммы пересчитываем по ценам из базы: касса не должна верить
       тому, что пришло с клиента. */
    const priced = [];
    for (const it of items) {
      const { rows: [p] } = await c.query(
        'select id, name, price, unit from products where id = $1', [it.id]);
      const price = p ? Number(p.price) : Number(it.price);
      const qty = Number(it.qty);
      if (!(qty > 0)) throw new Error(`Некорректное количество для «${it.name}»`);
      priced.push({
        id: p?.id ?? null,
        name: p?.name ?? it.name,
        unit: p?.unit ?? it.unit,
        price, qty, sum: money(price * qty),
      });
    }

    const subtotal = money(priced.reduce((s, i) => s + i.sum, 0));

    let discountId = null, percent = 0;
    if (body.discountId) {
      const { rows: [d] } = await c.query('select id, percent from discounts where id = $1', [body.discountId]);
      if (d) { discountId = d.id; percent = d.percent; }
    }
    /* Скидка округляется до рубля — так же, как её видит кассир на экране.
       Иначе итог сервера разойдётся с итогом в чеке на копейки. */
    const discountSum = Math.round(subtotal * percent / 100);
    const total = money(subtotal - discountSum);

    const paid = money(payments.reduce((s, p) => s + Number(p.amount), 0));
    if (paid + 0.01 < total) throw new Error(`Внесено ${paid} ₽ при итоге ${total} ₽`);

    const { rows: [{ number }] } = await c.query(
      'select coalesce(max(number), 0) + 1 as number from checks where shift_id = $1', [shift.id]);

    const { rows: [chk] } = await c.query(
      `insert into checks (shift_id, number, kind, subtotal, discount_id, discount_percent,
                           discount_sum, total, change_sum)
       values ($1,$2,'sale',$3,$4,$5,$6,$7,$8) returning id`,
      [shift.id, number, subtotal, discountId, percent, discountSum, total, money(body.change || 0)]);

    for (let i = 0; i < priced.length; i++) {
      const it = priced[i];
      await c.query(
        `insert into check_items (check_id, product_id, name, price, unit, qty, sum, sort)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [chk.id, it.id, it.name, it.price, it.unit, it.qty, it.sum, i]);
    }

    /* Сдача не является выручкой: наличными фиксируем ровно ту часть,
       что осталась в кассе. */
    let rest = total;
    for (const p of payments) {
      const amount = money(Math.min(Number(p.amount), rest));
      if (amount <= 0) continue;
      await c.query('insert into payments (check_id, method, amount) values ($1,$2,$3)',
        [chk.id, p.m, amount]);
      rest = money(rest - amount);
    }
  });

  res.json(await shiftState());
}));

async function returnCheck(sourceNumber) {
  await db.withTransaction(async c => {
    const shift = await currentShift();
    const { rows: [src] } = await c.query(
      `select * from checks where shift_id = $1 and number = $2 and kind = 'sale'`,
      [shift.id, sourceNumber]);
    if (!src) throw new Error(`Чек продажи № ${sourceNumber} в текущей смене не найден`);

    const { rows: [already] } = await c.query(
      `select 1 from checks where shift_id = $1 and kind = 'return' and source_number = $2`,
      [shift.id, sourceNumber]);
    if (already) throw new Error(`По чеку № ${sourceNumber} возврат уже оформлен`);

    const { rows: [{ number }] } = await c.query(
      'select coalesce(max(number), 0) + 1 as number from checks where shift_id = $1', [shift.id]);

    const { rows: [ret] } = await c.query(
      `insert into checks (shift_id, number, kind, subtotal, discount_percent, discount_sum,
                           total, source_number)
       values ($1,$2,'return',$3,$4,$5,$6,$7) returning id`,
      [shift.id, number, src.subtotal, src.discount_percent, src.discount_sum, src.total, sourceNumber]);

    await c.query(
      `insert into check_items (check_id, product_id, name, price, unit, qty, sum, sort)
       select $1, product_id, name, price, unit, qty, sum, sort from check_items where check_id = $2`,
      [ret.id, src.id]);
    await c.query(
      `insert into payments (check_id, method, amount)
       select $1, method, amount from payments where check_id = $2`,
      [ret.id, src.id]);
  });
  return shiftState();
}

/* ============================ НАЛИЧНЫЕ В КАССЕ ============================= */

app.post('/api/cash', route(async (req, res) => {
  const { kind, amount, reason } = req.body || {};
  if (!['in', 'out'].includes(kind)) return res.status(400).json({ error: 'kind должен быть in или out' });
  const sum = money(amount);
  if (!(sum > 0)) return res.status(400).json({ error: 'Сумма должна быть больше нуля' });

  const shift = await currentShift();
  if (kind === 'out') {
    const st = await shiftState();
    if (sum > st.totals.drawer) return res.status(409).json({ error: 'В ящике недостаточно наличных' });
  }
  await db.query('insert into cash_ops (shift_id, kind, amount, reason) values ($1,$2,$3,$4)',
    [shift.id, kind, sum, reason || null]);

  res.json(await shiftState());
}));

/* ============================== ОТЛОЖЕННЫЕ ================================= */

app.post('/api/parked', route(async (req, res) => {
  const { number, total, positions, payload } = req.body || {};
  const shift = await currentShift();
  await db.query(
    `insert into parked_checks (shift_id, number, total, positions, payload)
     values ($1,$2,$3,$4,$5)`,
    [shift.id, number, money(total), positions, JSON.stringify(payload ?? {})]);
  res.json(await shiftState());
}));

app.delete('/api/parked/:id', route(async (req, res) => {
  await db.query('delete from parked_checks where id = $1', [Number(req.params.id)]);
  res.json(await shiftState());
}));

/* ================================= СМЕНА =================================== */

app.post('/api/shift/close', route(async (req, res) => {
  const counted = req.body?.countedCash;
  const closed = await db.withTransaction(async c => {
    const shift = await currentShift();
    const state = await shiftState();

    await c.query('update shifts set closed_at = now(), counted_cash = $2 where id = $1',
      [shift.id, counted == null ? null : money(counted)]);

    /* Деньги остаются в ящике — новая смена начинается с фактического остатка */
    const carry = counted == null ? state.totals.drawer : money(counted);
    await c.query(
      `insert into shifts (number, register, opening_cash)
       values ((select coalesce(max(number), 0) + 1 from shifts), $1, $2)`,
      [shift.register, carry]);

    return { number: shift.number, totals: state.totals, carry };
  });

  res.json({ closed, ...(await shiftState()) });
}));

/* ================================ СЛУЖЕБНОЕ ================================ */

app.get('/api/health', route(async (_req, res) => res.json(await db.ping())));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Метод не найден' }));

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

const server = app.listen(PORT, () => {
  console.log(`ASOFT POS: http://localhost:${PORT}`);
  console.log(`База: ${db.CONFIG.user}@${db.CONFIG.host}:${db.CONFIG.port}/${db.CONFIG.database}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(async () => { await db.close(); process.exit(0); });
  });
}
