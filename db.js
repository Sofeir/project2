/* =============================================================================
   ПОДКЛЮЧЕНИЕ К POSTGRESQL
   -----------------------------------------------------------------------------
   Серверный модуль (Node.js). В браузер он не попадает и не должен: драйвер pg
   работает по TCP напрямую с сервером БД, а страница кассы обращается к данным
   только через HTTP-API, который поднимается поверх этого модуля.

   Параметры берутся из переменных окружения — пароль в репозитории не хранится.
   Запуск: node --env-file=.env <файл>   (Node 20.6+)
   ============================================================================= */

const { Pool, types } = require('pg');

/* По умолчанию pg отдаёт numeric и bigint строками — чтобы не потерять точность
   на больших значениях. Суммы в кассе укладываются в безопасный диапазон,
   поэтому переводим их в числа сразу: иначе они уедут в JSON как "285.00". */
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));  // numeric
types.setTypeParser(20,   v => (v === null ? null : parseInt(v, 10))); // int8

const CONFIG = {
  host:     process.env.PGHOST     || 'localhost',
  port:     Number(process.env.PGPORT) || 1122,
  database: process.env.PGDATABASE || 'kassa',
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD,

  /* Касса — один терминал с редкими короткими запросами, большой пул не нужен */
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: 'asoft-pos',
};

if (CONFIG.password === undefined || CONFIG.password === '') {
  throw new Error(
    'Не задан пароль к PostgreSQL.\n' +
    'Впишите его в файл .env в строку PGPASSWORD=... и запускайте команду с флагом --env-file=.env\n' +
    '(например: node --env-file=.env scripts/db-check.js)'
  );
}

const pool = new Pool(CONFIG);

/* Клиент может «умереть» в простое — например, если сервер БД перезапустили.
   Без этого обработчика такая ошибка роняет весь процесс. */
pool.on('error', err => {
  console.error('[db] ошибка простаивающего соединения:', err.message);
});

/**
 * Запрос с параметрами. Значения подставляются только через $1, $2 —
 * никакой склейки SQL со строками, иначе открывается SQL-инъекция.
 *   query('select * from products where cat = $1', ['soup'])
 */
async function query(text, params) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    if (process.env.PGDEBUG === '1') {
      const sql = text.replace(/\s+/g, ' ').trim().slice(0, 70);
      console.log(`[db] ${Date.now() - started} мс · ${res.rowCount} стр · ${sql}`);
    }
    return res;
  } catch (err) {
    console.error(`[db] запрос не выполнен: ${err.message}\n     SQL: ${text.replace(/\s+/g, ' ').trim()}`);
    throw err;
  }
}

/** Первая строка результата или null — для выборок по идентификатору. */
async function one(text, params) {
  const res = await query(text, params);
  return res.rows[0] ?? null;
}

/** Только строки — самый частый случай. */
async function rows(text, params) {
  return (await query(text, params)).rows;
}

/**
 * Транзакция. Чек и его позиции должны записываться целиком либо никак —
 * поэтому любой обрыв внутри откатывает всё.
 *   await withTransaction(async c => {
 *     const { rows:[chk] } = await c.query('insert into checks ... returning id');
 *     for (const it of items) await c.query('insert into check_items ...', [chk.id, ...]);
 *   });
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch (_) { /* соединение уже потеряно */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Проверка живости: возвращает сведения о сервере или бросает понятную ошибку. */
async function ping() {
  const res = await pool.query(
    'select current_database() as database, current_user as "user", version() as version, now() as now'
  );
  return res.rows[0];
}

/** Аккуратное завершение — вызывать при остановке сервера. */
async function close() {
  await pool.end();
}

module.exports = { pool, query, one, rows, withTransaction, ping, close, CONFIG };
