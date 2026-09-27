/* =============================================================================
   ПРОВЕРКА ПОДКЛЮЧЕНИЯ К БАЗЕ
   Запуск:  npm run db:check
   Показывает, доступен ли сервер, та ли это база и что в ней уже есть.
   ============================================================================= */

const db = require('../db');

(async () => {
  const { CONFIG } = db;
  console.log(`Подключение: ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}/${CONFIG.database}`);

  try {
    const started = Date.now();
    const info = await db.ping();
    const ms = Date.now() - started;

    console.log('\n  Соединение установлено');
    console.log(`  База ..... ${info.database}`);
    console.log(`  Пользователь ${info.user}`);
    console.log(`  Сервер ... ${info.version.split(',')[0]}`);
    console.log(`  Отклик ... ${ms} мс`);

    const tables = await db.rows(`
      select table_name,
             (select count(*) from information_schema.columns c
               where c.table_schema = t.table_schema and c.table_name = t.table_name) as columns
        from information_schema.tables t
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name
    `);

    if (tables.length) {
      console.log(`\n  Таблиц в схеме public: ${tables.length}`);
      tables.forEach(t => console.log(`    · ${t.table_name} (${t.columns} колонок)`));
    } else {
      console.log('\n  Схема public пуста — таблицы ещё не созданы.');
    }

    process.exitCode = 0;
  } catch (err) {
    console.error('\n  Подключиться не удалось.');
    console.error(`  ${err.message}`);

    const hint = {
      '28P01': 'Неверный пароль пользователя postgres — проверьте PGPASSWORD в .env',
      '3D000': `База «${CONFIG.database}» не существует. Создать: createdb -h ${CONFIG.host} -p ${CONFIG.port} -U ${CONFIG.user} ${CONFIG.database}`,
      ECONNREFUSED: `Сервер не отвечает на ${CONFIG.host}:${CONFIG.port} — проверьте, запущена ли служба PostgreSQL и верен ли порт`,
      ETIMEDOUT: 'Таймаут соединения — вероятно, порт закрыт брандмауэром',
    }[err.code];
    if (hint) console.error(`  → ${hint}`);

    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
