-- =============================================================================
-- ASOFT POS — схема кассы столовой
-- Идемпотентна: можно выполнять повторно.
-- =============================================================================

-- ------------------------------- номенклатура -------------------------------

create table if not exists categories (
  id    text primary key,
  name  text not null,
  short text not null,               -- метка на плитке товара
  color text not null,               -- цвет группы в интерфейсе
  sort  int  not null default 0
);

create table if not exists products (
  id          text primary key,
  name        text not null,
  price       numeric(10,2) not null check (price >= 0),
  unit        text not null,
  category_id text not null references categories(id) on update cascade,
  is_hit      boolean not null default false,   -- «ходовые»
  is_weight   boolean not null default false,   -- продаётся на вес
  is_active   boolean not null default true,    -- снятое с продажи не удаляем: на него ссылаются чеки
  sort        int not null default 0
);
create index if not exists products_category_idx on products (category_id, sort);

create table if not exists discounts (
  id      text primary key,
  name    text not null,
  percent int  not null check (percent between 0 and 100),
  sort    int  not null default 0
);

-- ----------------------------- горячие клавиши ------------------------------
-- Дерево витрины: группа может содержать группы и товары.
-- Глубина ограничена в приложении (3 уровня), здесь — только целостность.

create table if not exists hotkeys (
  id         bigserial primary key,
  parent_id  bigint references hotkeys(id) on delete cascade,
  kind       text not null check (kind in ('group','item')),
  name       text,
  color      text,
  product_id text references products(id) on delete cascade,
  sort       int not null default 0,
  constraint hotkeys_shape check (
    (kind = 'group' and name is not null and product_id is null) or
    (kind = 'item'  and product_id is not null)
  )
);
create index if not exists hotkeys_parent_idx on hotkeys (parent_id, sort);

-- ---------------------------------- смены -----------------------------------

create table if not exists shifts (
  id           bigserial primary key,
  number       int not null unique,
  register     int not null default 13,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz,
  opening_cash numeric(12,2) not null default 0,
  counted_cash numeric(12,2)                      -- пересчёт при закрытии
);

-- Открытой смены может быть только одна: это инвариант кассы, а не забота UI.
create unique index if not exists shifts_single_open_idx
  on shifts ((true)) where closed_at is null;

-- ---------------------------------- чеки ------------------------------------

create table if not exists checks (
  id               bigserial primary key,
  shift_id         bigint not null references shifts(id) on delete cascade,
  number           int  not null,
  kind             text not null check (kind in ('sale','return')),
  subtotal         numeric(12,2) not null,
  discount_id      text references discounts(id),
  discount_percent int not null default 0,
  discount_sum     numeric(12,2) not null default 0,
  total            numeric(12,2) not null,
  change_sum       numeric(12,2) not null default 0,
  source_number    int,                            -- для возврата: номер исходного чека
  created_at       timestamptz not null default now()
);
create index if not exists checks_shift_idx on checks (shift_id, created_at desc);

-- Позиции хранят снимок названия и цены: переоценка товара
-- не должна задним числом менять уже пробитые чеки.
create table if not exists check_items (
  id         bigserial primary key,
  check_id   bigint not null references checks(id) on delete cascade,
  product_id text references products(id),
  name       text not null,
  price      numeric(10,2) not null,
  unit       text not null,
  qty        numeric(10,3) not null check (qty > 0),
  sum        numeric(12,2) not null,
  sort       int not null default 0
);
create index if not exists check_items_check_idx on check_items (check_id, sort);

create table if not exists payments (
  id       bigserial primary key,
  check_id bigint not null references checks(id) on delete cascade,
  method   text not null check (method in ('cash','card','qr','staff')),
  amount   numeric(12,2) not null
);
create index if not exists payments_check_idx on payments (check_id);

-- ------------------------- движение наличных и отложенные -------------------

create table if not exists cash_ops (
  id         bigserial primary key,
  shift_id   bigint not null references shifts(id) on delete cascade,
  kind       text not null check (kind in ('in','out')),
  amount     numeric(12,2) not null check (amount > 0),
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists cash_ops_shift_idx on cash_ops (shift_id);

-- Отложенный чек — незавершённая корзина. Хранится целиком,
-- потому что вне продажи её строки ни с чем не связаны.
create table if not exists parked_checks (
  id         bigserial primary key,
  shift_id   bigint not null references shifts(id) on delete cascade,
  number     int not null,
  total      numeric(12,2) not null,
  positions  int not null,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists parked_shift_idx on parked_checks (shift_id, created_at);
