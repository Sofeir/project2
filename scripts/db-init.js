/* =============================================================================
   РАЗВЁРТЫВАНИЕ БАЗЫ
   Запуск:  npm run db:init          — создать схему и залить номенклатуру
            npm run db:init -- --reset — предварительно снести все таблицы

   Скрипт идемпотентен: повторный запуск не плодит дубликаты.
   ============================================================================= */

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { CATEGORIES, PRODUCTS, DISCOUNTS } = require('../sql/seed-data');

const RESET = process.argv.includes('--reset');

/* Стартовая витрина: те же группы, что были зашиты в интерфейсе.
   Дальше администратор правит её в режиме настройки, и правки идут в базу. */
function hotkeysTree() {
  const byCat = c => PRODUCTS.filter(p => p.cat === c).map(p => ({ kind: 'item', pid: p.id }));
  const pick = names => names
    .map(n => PRODUCTS.find(p => p.name.startsWith(n)))
    .filter(Boolean)
    .map(p => ({ kind: 'item', pid: p.id }));
  const g = (name, color, items) => ({ kind: 'group', name, color, items });

  return [
    g('Обеды', '#D8A64B', [
      ...byCat('combo'),
      g('Первые блюда', '#D98A6A', byCat('soup')),
      g('Второе', '#E07A6A', [
        g('Горячее', '#E07A6A', byCat('hot')),
        g('Гарниры', '#C9B26A', byCat('garnir')),
      ]),
    ]),
    g('Завтраки', '#E0A36B', byCat('zavtrak')),
    g('Салаты и закуски', '#7FBE8C', [
      g('Салаты', '#7FBE8C', byCat('salat')),
      g('Закуски', '#6FB9A8', byCat('zakuska')),
    ]),
    g('Выпечка', '#CFA372', [
      ...byCat('vypechka'),
      g('Кондитерская', '#C98FAE', byCat('konditer')),
    ]),
    g('Напитки', '#7BA9D8', [
      g('Горячие', '#E07A6A', pick(['Чай чёрный', 'Чай зелёный', 'Кофе растворимый', 'Кофе зерновой', 'Капучино'])),
      g('Холодные', '#7BA9D8', pick(['Компот', 'Морс', 'Кисель', 'Вода', 'Сок', 'Молоко'])),
    ]),
    g('Буфет и хлеб', '#9B95CC', [...byCat('bufet'), ...byCat('hleb')]),
  ];
}

async function insertTree(client, nodes, parentId) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const { rows: [row] } = await client.query(
      `insert into hotkeys (parent_id, kind, name, color, product_id, sort)
       values ($1,$2,$3,$4,$5,$6) returning id`,
      [parentId, n.kind, n.name ?? null, n.color ?? null, n.pid ?? null, i]
    );
    if (n.kind === 'group' && n.items?.length) await insertTree(client, n.items, row.id);
  }
}

(async () => {
  try {
    if (RESET) {
      console.log('Сношу существующие таблицы…');
      await db.query(`
        drop table if exists payments, check_items, checks, cash_ops, parked_checks,
                             hotkeys, products, categories, discounts, shifts cascade
      `);
    }

    console.log('Создаю схему…');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'sql', '001_schema.sql'), 'utf8');
    await db.query(schema);

    await db.withTransaction(async c => {
      console.log('Заливаю категории…');
      for (let i = 0; i < CATEGORIES.length; i++) {
        const cat = CATEGORIES[i];
        await c.query(
          `insert into categories (id, name, short, color, sort) values ($1,$2,$3,$4,$5)
           on conflict (id) do update set name = excluded.name, short = excluded.short,
                                          color = excluded.color, sort = excluded.sort`,
          [cat.id, cat.name, cat.short, cat.color, i]
        );
      }

      console.log('Заливаю товары…');
      for (let i = 0; i < PRODUCTS.length; i++) {
        const p = PRODUCTS[i];
        await c.query(
          `insert into products (id, name, price, unit, category_id, is_hit, is_weight, sort)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (id) do update set name = excluded.name, price = excluded.price,
                                          unit = excluded.unit, category_id = excluded.category_id,
                                          is_hit = excluded.is_hit, is_weight = excluded.is_weight,
                                          sort = excluded.sort`,
          [p.id, p.name, p.price, p.unit, p.cat, p.hit, p.weight, i]
        );
      }

      console.log('Заливаю скидки…');
      for (let i = 0; i < DISCOUNTS.length; i++) {
        const d = DISCOUNTS[i];
        if (!d.percent) continue;              // «Без скидки» — это отсутствие записи
        await c.query(
          `insert into discounts (id, name, percent, sort) values ($1,$2,$3,$4)
           on conflict (id) do update set name = excluded.name, percent = excluded.percent`,
          [d.id, d.name, d.percent, i]
        );
      }

      const { rows: [{ n }] } = await c.query('select count(*)::int as n from hotkeys');
      if (n === 0) {
        console.log('Собираю стартовую витрину горячих клавиш…');
        await insertTree(c, hotkeysTree(), null);
      } else {
        console.log(`Витрина уже настроена (${n} узлов) — не трогаю.`);
      }

      const { rows: [{ open }] } = await c.query(
        'select count(*)::int as open from shifts where closed_at is null'
      );
      if (open === 0) {
        const { rows: [{ next }] } = await c.query(
          'select coalesce(max(number), 32) + 1 as next from shifts'
        );
        await c.query(
          'insert into shifts (number, register, opening_cash) values ($1, $2, $3)',
          [next, 13, 3000]
        );
        console.log(`Открыл смену №${next} с разменом 3 000 ₽.`);
      }
    });

    const stat = await db.one(`
      select (select count(*) from categories) as categories,
             (select count(*) from products)   as products,
             (select count(*) from discounts)  as discounts,
             (select count(*) from hotkeys)    as hotkeys,
             (select count(*) from shifts)     as shifts
    `);
    console.log('\nГотово:');
    Object.entries(stat).forEach(([k, v]) => console.log(`  ${k.padEnd(12)} ${v}`));
  } catch (err) {
    console.error('\nОшибка развёртывания:', err.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
