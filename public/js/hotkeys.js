/* =============================================================================
   ГОРЯЧИЕ КЛАВИШИ — витрина кассира и её настройка
   -----------------------------------------------------------------------------
   Идея: номенклатура и витрина — разные вещи. Каталог хранит всё, что вообще
   можно продать; горячие клавиши — это то, что реально продаётся сегодня,
   в порядке, удобном конкретной столовой. Поэтому структуру собирает
   администратор заведения, а не разработчик.

   Структура хранится в браузере вместе с остальными данными кассы
   (js/api.js); на другой терминал её переносят файлом данных.

   Ограничения, которые держат систему в рамках:
   • глубина не больше трёх уровней групп — дальше кассир начинает «блуждать»;
   • правка возможна только в отдельном режиме, под PIN администратора.
   ============================================================================= */

const HK = (() => {

  const MAX_DEPTH = 3;
  const COLORS = ['#22C98A', '#D8A64B', '#E07A6A', '#D98A6A', '#7BA9D8', '#6FB9A8', '#C98FAE', '#9B95CC', '#7FBE8C', '#B3A184'];

  let uid = 0;
  const nid = () => 'n' + (++uid) + '_' + Math.random().toString(36).slice(2, 6);

  const group = (name, color, items) => ({ id: nid(), kind: 'group', name, color, items: items || [] });
  const item = pid => ({ id: nid(), kind: 'item', pid });

  /* ------------------------------- данные -------------------------------- */
  let data = { items: [] };        // рабочая (сохранённая) структура
  let draft = null;                // копия на время правки
  let undoStack = [];
  let dirty = false;

  let path = [];                   // путь кассира
  let editPath = [];               // путь в редакторе

  const clone = o => JSON.parse(JSON.stringify(o));

  /* --------------------------- загрузка и сохранение ---------------------- */
  async function load() {
    const res = await API.hotkeys();
    data = { items: res.items || [] };
  }

  /* ------------------------------ обход дерева ---------------------------- */
  function nodeByPath(root, p) {
    let cur = { items: root.items };
    for (const id of p) {
      const nx = cur.items.find(n => n.kind === 'group' && n.id === id);
      if (!nx) return cur;
      cur = nx;
    }
    return cur;
  }
  function parentOf(root, id, cur) {
    cur = cur || { items: root.items };
    for (const n of cur.items) {
      if (n.id === id) return cur;
      if (n.kind === 'group') { const r = parentOf(root, id, n); if (r) return r; }
    }
    return null;
  }
  function findNode(root, id, cur) {
    cur = cur || { items: root.items };
    for (const n of cur.items) {
      if (n.id === id) return n;
      if (n.kind === 'group') { const r = findNode(root, id, n); if (r) return r; }
    }
    return null;
  }
  function pathTo(root, id, cur, acc) {
    cur = cur || { items: root.items }; acc = acc || [];
    for (const n of cur.items) {
      if (n.id === id) return acc;
      if (n.kind === 'group') { const r = pathTo(root, id, n, acc.concat(n.id)); if (r) return r; }
    }
    return null;
  }
  function allGroups(root, cur, lvl, acc) {
    cur = cur || { items: root.items }; lvl = lvl || 0; acc = acc || [];
    cur.items.forEach(n => {
      if (n.kind === 'group') { acc.push({ node: n, lvl: lvl + 1 }); allGroups(root, n, lvl + 1, acc); }
    });
    return acc;
  }
  function height(n) {
    if (n.kind !== 'group') return 0;
    const subs = n.items.filter(x => x.kind === 'group');
    return 1 + (subs.length ? Math.max(...subs.map(height)) : 0);
  }
  function countAll(n) {
    if (n.kind === 'item') return 1;
    return n.items.reduce((s, x) => s + countAll(x), 0);
  }
  const prod = pid => PRODUCTS.find(p => p.id === pid);

  /* ========================== ВИТРИНА КАССИРА ============================= */
  /* o = { extra, edit, nid } */
  function tileProduct(p, o) {
    o = o || {};
    const c = catOf(p.cat);
    const inCart = o.edit ? 0 : S.cart.filter(r => r.id === p.id).reduce((s, r) => s + r.qty, 0);
    const badge = inCart ? `<span class="qty num">${p.weight ? String(inCart).replace('.', ',') : fmtQty(inCart)}</span>` : '';
    const cls = ['tile', 'dish', p.cat === 'combo' ? 'combo' : '', inCart ? 'in' : '', o.edit ? 'edit' : ''].filter(Boolean).join(' ');
    const at = o.edit ? `data-nid="${o.nid}" draggable="true"` : `data-pid="${p.id}"`;
    return `<button class="${cls}" ${at} style="--c:${c.color}">
      ${o.extra || ''}
      <span class="nm">${p.name}</span>
      <span class="bot"><span class="pr num">${money(p.price)}</span><span class="un">/&nbsp;${p.unit}</span>${badge}</span>
    </button>`;
  }
  function tileGroup(g, o) {
    o = o || {};
    const n = countAll(g);
    const subs = g.items.filter(x => x.kind === 'group').length;
    const cls = 'tile group' + (o.edit ? ' edit' : '');
    const at = o.edit ? `data-nid="${g.id}" draggable="true"` : `data-gid="${g.id}"`;
    return `<button class="${cls}" ${at} style="--c:${g.color}">
      ${o.extra || ''}
      <span class="gi"><svg><use href="#i-folder"/></svg></span>
      <span class="nm">${g.name}</span>
      <span class="cnt">${subs ? subs + ' ' + plural(subs, 'группа', 'группы', 'групп') + ' · ' : ''}${n} ${plural(n, 'позиция', 'позиции', 'позиций')}</span>
    </button>`;
  }
  function renderCrumbs() {
    const el = document.getElementById('crumbs');
    if (!path.length) { el.innerHTML = ''; return; }
    let html = `<button class="up" id="crumbUp" title="На уровень выше"><svg><use href="#i-back"/></svg></button>`;
    html += `<button class="cr" data-i="-1">Все группы</button>`;
    path.forEach((id, i) => {
      const g = findNode(data, id);
      if (!g) return;
      html += `<span class="sl">›</span><button class="cr ${i === path.length - 1 ? 'last' : ''}" data-i="${i}">${g.name}</button>`;
    });
    el.innerHTML = html;
  }

  function renderCashier() {
    renderCrumbs();
    const grid = document.getElementById('grid');
    const cur = nodeByPath(data, path);

    /* У кассира внутри уровня сначала идут группы, потом блюда, и те и другие
       по алфавиту (числа в названиях — по значению: «№ 2» раньше «№ 10»).
       Редактор администратора показывает порядок, в котором плитки заведены. */
    const label = n => n.kind === 'group' ? n.name : ((prod(n.pid) || {}).name || '');
    const byName = (x, y) => label(x).localeCompare(label(y), 'ru', { numeric: true, sensitivity: 'base' });
    const rest = [
      ...cur.items.filter(n => n.kind === 'group').sort(byName),
      ...cur.items.filter(n => n.kind !== 'group').sort(byName),
    ];

    if (!rest.length) {
      const inside = path.length ? findNode(data, path[path.length - 1]) : null;
      grid.innerHTML = `<div class="hk-empty">
        <svg><use href="#i-${inside ? 'folder' : 'grip'}"/></svg>
        <div class="t">${inside ? `В группе «${inside.name}» пока нет блюд` : 'Горячие клавиши не настроены'}</div>
        <div class="h">${inside
          ? 'Наполнить группу может администратор в режиме настройки. А сейчас блюдо быстрее найти поиском или во вкладке «Весь каталог».'
          : 'Соберите витрину под своё меню: группы, подгруппы и блюда в нужном порядке. Настройка открывается шестерёнкой в правом верхнем углу.'}</div>
      </div>`;
      return;
    }

    /* На первом экране витрина подписана; внутри группы её называют крошки */
    let html = path.length ? '' : `<div class="hk-section">Витрина</div>`;
    html += rest.map(n => {
      if (n.kind === 'group') return tileGroup(n);
      const p = prod(n.pid);
      return p ? tileProduct(p) : '';
    }).join('');
    grid.innerHTML = html;
  }

  function up() { if (path.length) { path.pop(); renderCashier(); } }
  function goRoot() { path = []; }

  /* обработчики витрины навешивает app.js через делегирование */
  function onGridClick(e) {
    const g = e.target.closest('[data-gid]');
    if (g) { path.push(g.dataset.gid); renderCashier(); document.getElementById('grid').scrollTop = 0; return true; }
    const p = e.target.closest('[data-pid]');
    if (p) { addProduct(p.dataset.pid); return true; }
    return false;
  }
  function onCrumbClick(e) {
    if (S.view !== 'hk') return;   // в каталоге крошками ведает app.js
    if (e.target.closest('#crumbUp')) { up(); return; }
    const c = e.target.closest('.cr');
    if (!c) return;
    const i = +c.dataset.i;
    path = i < 0 ? [] : path.slice(0, i + 1);
    renderCashier();
  }


  /* ====================== ПЕРЕНОС МЕЖДУ КАССАМИ ============================ */
  /* Витрину переносят файлом: на одной кассе «Передать» сохраняет его,
     на другой «Принять» читает. В файле у блюда лежит и номер, и название:
     номера на разных кассах могут не совпасть, тогда блюдо ищется по названию. */
  const FILE_FORMAT = 'asoft-pos-hotkeys';
  const FILE_VERSION = 1;
  /* имена приходят из файла и попадают в разметку — убираем всё, что её ломает */
  const cleanName = v => String(v == null ? '' : v).replace(/[<>&"'`]/g, '').trim().slice(0, 60);

  function exportFile() {
    const strip = list => list.map(n => n.kind === 'group'
      ? { kind: 'group', name: n.name, color: n.color, items: strip(n.items) }
      : { kind: 'item', pid: n.pid, name: (prod(n.pid) || {}).name || '' });
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const blob = new Blob([JSON.stringify({
      format: FILE_FORMAT, version: FILE_VERSION, exportedAt: d.toISOString(),
      register: CASHIER.register, items: strip(data.items),
    }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `goryachie-klavishi-kassa${CASHIER.register}-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return a.download;
  }

  /* Разбор файла: проверяем форму, сопоставляем блюда с каталогом этой кассы.
     Возвращает готовое дерево и счётчики для окна приёма. */
  function parseFile(text) {
    let f;
    try { f = JSON.parse(text); } catch (_) { throw new Error('Файл не читается — это не файл горячих клавиш'); }
    if (!f || f.format !== FILE_FORMAT || !Array.isArray(f.items)) throw new Error('Это не файл горячих клавиш ASOFT POS');
    if (f.version > FILE_VERSION) throw new Error('Файл сохранён более новой версией кассы');

    const byName = new Map(PRODUCTS.map(p => [p.name.toLowerCase(), p]));
    let skipped = 0, count = 0;
    const walk = (list, depth) => {
      if (!Array.isArray(list)) throw new Error('В файле повреждена структура витрины');
      const out = [];
      list.forEach(n => {
        if (!n || typeof n !== 'object') return;
        if (n.kind === 'group') {
          if (depth > MAX_DEPTH) throw new Error(`В файле больше ${MAX_DEPTH} уровней групп — такую витрину принять нельзя`);
          const color = /^#[0-9a-fA-F]{6}$/.test(n.color) ? n.color : COLORS[0];
          out.push(group(cleanName(n.name) || 'Без названия', color, walk(n.items || [], depth + 1)));
        } else if (n.kind === 'item') {
          const p = prod(String(n.pid)) || byName.get(cleanName(n.name).toLowerCase());
          if (p) { out.push(item(p.id)); count++; } else skipped++;
        }
      });
      return out;
    };
    const items = walk(f.items, 1);
    return {
      items, count, skipped,
      groups: allGroups({ items }).length,
      top: items.filter(n => n.kind === 'group').map(n => n.name),
      register: f.register || null,
      exportedAt: f.exportedAt || null,
    };
  }

  /* mode: 'replace' — принятая витрина вместо текущей, 'add' — после текущих групп */
  async function applyFile(parsed, mode) {
    const items = mode === 'add' ? clone(data.items).concat(parsed.items) : parsed.items;
    const res = await API.saveHotkeys(items);   // глубину и нумерацию проверяет хранилище
    data = { items: res.items || [] };
    path = [];
    if (S.view === 'hk') renderCashier();
  }

  /* ============================ РЕЖИМ НАСТРОЙКИ =========================== */
  function snapshot() {
    undoStack.push(JSON.stringify(draft));
    if (undoStack.length > 40) undoStack.shift();
  }
  function syncTopButtons() {
    dirty = JSON.stringify(draft) !== JSON.stringify(data);
    document.getElementById('hkUndo').disabled = !undoStack.length;
    document.getElementById('hkSave').disabled = !dirty;
  }

  function openEditor() {
    draft = clone(data);
    undoStack = []; dirty = false;
    editPath = path.slice().filter(id => findNode(draft, id));
    document.getElementById('hkEditor').classList.remove('hidden');
    syncTopButtons();
    renderEditor();
  }
  function closeEditor(force) {
    if (dirty && !force) {
      ask('Выйти без сохранения?', 'Изменения структуры горячих клавиш будут потеряны.', 'Выйти без сохранения', () => closeEditor(true));
      return;
    }
    document.getElementById('hkEditor').classList.add('hidden');
    hideTileMenu();
  }
  async function save() {
    const btn = document.getElementById('hkSave');
    btn.disabled = true; btn.textContent = 'Сохраняю…';
    try {
      /* Хранилище возвращает витрину уже со своими идентификаторами —
         принимаем её как есть, иначе следующая правка уйдёт в никуда. */
      const res = await API.saveHotkeys(draft.items);
      data = { items: res.items || [] };
      draft = clone(data);
      undoStack = [];
      editPath = editPath.filter(id => findNode(draft, id));
      path = path.filter(id => findNode(data, id));
      renderEditor();
      renderGrid();
      toast('Горячие клавиши сохранены');
    } catch (err) {
      toast('Не сохранено: ' + err.message, 'bad');
    } finally {
      btn.textContent = 'Сохранить';
      syncTopButtons();
    }
  }
  function undo() {
    if (!undoStack.length) return;
    draft = JSON.parse(undoStack.pop());
    if (editPath.length && !findNode(draft, editPath[editPath.length - 1])) editPath = [];
    renderEditor();
    toast('Последнее изменение отменено');
  }

  function renderEditor() { syncTopButtons(); renderTree(); renderEditGrid(); renderEditCrumbs(); }

  /* ------------------------------- дерево --------------------------------- */
  function renderTree() {
    const cur = editPath[editPath.length - 1] || 'root';
    let html = `<button class="tr ${cur === 'root' ? 'on' : ''}" data-gid="root" style="padding-left:10px">
      <span class="grip" style="visibility:hidden"><svg><use href="#i-grip"/></svg></span>
      <span class="cd" style="--c:var(--acc)"></span>
      <span class="nm">Все группы</span>
      <span class="cnt">${draft.items.filter(n => n.kind === 'group').length}</span>
    </button>`;
    const walk = (node, lvl) => {
      node.items.filter(n => n.kind === 'group').forEach(g => {
        html += `<button class="tr ${cur === g.id ? 'on' : ''}" data-gid="${g.id}" draggable="true"
            style="padding-left:${10 + lvl * 18}px; --c:${g.color}">
          <span class="grip"><svg><use href="#i-grip"/></svg></span>
          <span class="cd"></span>
          <span class="nm">${g.name}</span>
          <span class="cnt">${countAll(g)}</span>
        </button>`;
        walk(g, lvl + 1);
      });
    };
    walk({ items: draft.items }, 1);
    document.getElementById('hkTree').innerHTML = html;
  }

  function renderEditCrumbs() {
    const el = document.getElementById('hkCrumbs');
    let html = `<button class="cr ${editPath.length ? '' : 'last'}" data-i="-1">Все группы</button>`;
    editPath.forEach((id, i) => {
      const g = findNode(draft, id); if (!g) return;
      html += `<span class="sl">›</span><button class="cr ${i === editPath.length - 1 ? 'last' : ''}" data-i="${i}">${g.name}</button>`;
    });
    el.innerHTML = html;

    const deep = editPath.length >= MAX_DEPTH;
    const b = document.getElementById('hkAddGroup');
    b.disabled = deep;
    b.title = deep ? `Глубже ${MAX_DEPTH} уровней кассиру неудобно — добавьте сюда товары` : '';
    document.getElementById('hkHintText').textContent = deep
      ? `Это третий, самый глубокий уровень. Дальше вкладывать группы нельзя — так кассир не потеряется. Добавляйте сюда блюда.`
      : `Порядок меняется перетаскиванием плитки — или через «···» → «Сдвинуть», если работаете пальцем. Бросьте плитку на группу, чтобы перенести её внутрь.`;
  }

  function renderEditGrid() {
    const cur = nodeByPath(draft, editPath);
    const menu = `<span class="em" data-menu><svg style="width:17px;height:17px"><use href="#i-dots"/></svg></span>`;
    let html = cur.items.map(n => {
      if (n.kind === 'group') return tileGroup(n, { edit: true, extra: menu });
      const p = prod(n.pid); if (!p) return '';
      return tileProduct(p, { edit: true, nid: n.id, extra: menu });
    }).join('');

    html += `<button class="tile add" id="hkAddTile">
      <svg><use href="#i-plus"/></svg><span class="l">Добавить товары</span>
    </button>`;

    if (!cur.items.length) {
      html = `<div class="hk-empty">
        <svg><use href="#i-folder"/></svg>
        <div class="t">${editPath.length ? 'В этой группе пока пусто' : 'Витрина пуста'}</div>
        <div class="h">Добавьте блюда из каталога или создайте подгруппу.
        Быстрее всего — «Собрать из групп»: готовые группы появятся за один шаг.</div>
      </div>` + html;
    }
    document.getElementById('hkGrid').innerHTML = html;
  }

  /* --------------------------- меню плитки -------------------------------- */
  let menuTarget = null;
  function hideTileMenu() { document.getElementById('menuTile').classList.add('hidden'); menuTarget = null; }

  function showTileMenu(nid_, x, y) {
    const node = findNode(draft, nid_); if (!node) return;
    menuTarget = nid_;
    const par = parentOf(draft, nid_);
    const i = par.items.indexOf(node);
    const isGroup = node.kind === 'group';
    const el = document.getElementById('menuTile');
    el.innerHTML = `
      ${isGroup ? `<button data-a="rename"><svg><use href="#i-pencil"/></svg><span class="mt">Переименовать и цвет</span></button>
      <button data-a="dup"><svg><use href="#i-copy"/></svg><span class="mt">Дублировать группу</span></button>` : ''}
      <button data-a="move"><svg><use href="#i-move"/></svg><span class="mt">Переместить в…</span></button>
      <div class="menu-sep"></div>
      <button data-a="left" ${i === 0 ? 'disabled style="opacity:.35"' : ''}><svg><use href="#i-back"/></svg><span class="mt">Сдвинуть левее</span></button>
      <button data-a="right" ${i === par.items.length - 1 ? 'disabled style="opacity:.35"' : ''}><svg style="transform:rotate(180deg)"><use href="#i-back"/></svg><span class="mt">Сдвинуть правее</span></button>
      <div class="menu-sep"></div>
      <button data-a="del" class="danger"><svg><use href="#i-trash"/></svg><span class="mt">Убрать с витрины</span></button>`;
    el.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(x, innerWidth - r.width - 12) + 'px';
    el.style.top = Math.min(y, innerHeight - r.height - 12) + 'px';
  }

  function tileMenuAction(a) {
    const nid_ = menuTarget; hideTileMenu();
    const node = findNode(draft, nid_); if (!node) return;
    const par = parentOf(draft, nid_);
    const i = par.items.indexOf(node);

    if (a === 'rename') return openGroupModal(node);
    if (a === 'dup') {
      snapshot();
      const copy = clone(node);
      const rid = n => { n.id = nid(); if (n.items) n.items.forEach(rid); };
      rid(copy); copy.name = copy.name + ' (копия)';
      par.items.splice(i + 1, 0, copy);
      renderEditor(); toast('Группа продублирована'); return;
    }
    if (a === 'move') return openMoveModal(node);
    if (a === 'left' || a === 'right') {
      const j = a === 'left' ? i - 1 : i + 1;
      if (j < 0 || j >= par.items.length) return;
      snapshot();
      par.items.splice(j, 0, par.items.splice(i, 1)[0]);
      renderEditor(); return;
    }
    if (a === 'del') {
      const isGroup = node.kind === 'group';
      const n = isGroup ? countAll(node) : 0;
      const what = isGroup
        ? `Группа «${node.name}»${n ? ` и ${n} ${plural(n, 'позиция', 'позиции', 'позиций')} внутри неё` : ''} исчезнет с витрины кассира.`
        : `Товар «${prod(node.pid).name}» исчезнет с витрины кассира.`;
      ask('Убрать с витрины?', `${what} Сами блюда останутся в каталоге — их можно вернуть в любой момент.`, 'Убрать', () => {
        snapshot();
        par.items.splice(i, 1);
        if (isGroup && editPath.includes(nid_)) editPath = editPath.slice(0, editPath.indexOf(nid_));
        renderEditor(); toast('Убрано с витрины', 'warn');
      });
    }
  }

  /* ------------------------- создание/правка группы ----------------------- */
  let grpEditing = null;
  let grpColor = COLORS[0];

  function openGroupModal(node) {
    grpEditing = node || null;
    grpColor = node ? node.color : COLORS[(allGroups(draft).length) % COLORS.length];
    document.getElementById('grpTitle').textContent = node ? 'Название и цвет группы' : 'Новая группа';
    document.getElementById('grpName').value = node ? node.name : '';
    document.getElementById('grpColors').innerHTML = COLORS.map(c =>
      `<button data-c="${c}" class="${c === grpColor ? 'on' : ''}" style="--c:${c}"></button>`).join('');
    open('modalGroup');
    setTimeout(() => document.getElementById('grpName').focus(), 60);
  }
  function saveGroup() {
    const name = document.getElementById('grpName').value.trim();
    if (!name) return toast('Введите название группы', 'warn');
    snapshot();
    if (grpEditing) { grpEditing.name = name; grpEditing.color = grpColor; }
    else {
      const g = group(name, grpColor, []);
      nodeByPath(draft, editPath).items.push(g);
    }
    close('modalGroup');
    renderEditor();
    toast(grpEditing ? 'Группа обновлена' : 'Группа создана');
  }

  /* ------------------------------ перемещение ----------------------------- */
  let moveNode = null;
  function openMoveModal(node) {
    moveNode = node;
    const h = node.kind === 'group' ? height(node) : 0;
    const own = node.kind === 'group' ? [node.id].concat(allGroups(draft, node).map(x => x.node.id)) : [];
    const par = parentOf(draft, node.id);
    const curId = par === draft || !par.id ? 'root' : par.id;

    document.getElementById('moveWhat').textContent = node.kind === 'group' ? `Группа «${node.name}»` : prod(node.pid).name;
    const rows = [{ node: { id: 'root', name: 'Все группы', color: 'var(--acc)' }, lvl: 0 }]
      .concat(allGroups(draft))
      .filter(r => !own.includes(r.node.id))
      .filter(r => node.kind !== 'group' || r.lvl + h <= MAX_DEPTH);

    document.getElementById('moveList').innerHTML = rows.map(r => `
      <button data-t="${r.node.id}" class="${r.node.id === curId ? 'cur' : ''}" style="--c:${r.node.color}; padding-left:${14 + r.lvl * 16}px">
        <span class="cd"></span>${r.node.name}
        <span class="lv">${r.node.id === curId ? 'здесь сейчас' : ''}</span>
      </button>`).join('');
    open('modalMove');
  }
  function doMove(targetId) {
    const par = parentOf(draft, moveNode.id);
    const i = par.items.indexOf(moveNode);
    snapshot();
    par.items.splice(i, 1);
    const target = targetId === 'root' ? { items: draft.items } : findNode(draft, targetId);
    target.items.push(moveNode);
    close('modalMove');
    renderEditor();
    toast('Перемещено');
  }

  /* --------------------------- подбор товаров ----------------------------- */
  let pickSel = new Set();
  let pickCat = 'all';

  function openPicker() {
    pickSel = new Set(); pickCat = 'all';
    const cur = nodeByPath(draft, editPath);
    document.getElementById('pickDest').textContent = 'В группу: ' +
      (editPath.length ? editPath.map(id => findNode(draft, id).name).join(' › ') : 'Все группы (первый экран)');
    document.getElementById('pickInput').value = '';
    document.getElementById('pickTabs').innerHTML =
      `<button class="on" data-c="all">Все</button>` +
      CATEGORIES.map(c => `<button data-c="${c.id}">${c.name}</button>`).join('');
    renderPicker();
    open('modalPick');
    setTimeout(() => document.getElementById('pickInput').focus(), 60);
  }
  function pickerResults() {
    const q = document.getElementById('pickInput').value.trim().toLowerCase();
    return PRODUCTS.filter(p =>
      (pickCat === 'all' || p.cat === pickCat) &&
      (!q || p.name.toLowerCase().includes(q))
    );
  }
  function renderPicker() {
    const cur = nodeByPath(draft, editPath);
    const here = new Set(cur.items.filter(n => n.kind === 'item').map(n => n.pid));
    const list = pickerResults();
    document.getElementById('pickList').innerHTML = list.length ? list.map(p => {
      const c = catOf(p.cat);
      const added = here.has(p.id);
      return `<button class="pk ${pickSel.has(p.id) ? 'on' : ''} ${added ? 'dis' : ''}" data-p="${p.id}" ${added ? 'disabled' : ''}>
        <span class="cb"><svg><use href="#i-check"/></svg></span>
        <span class="tg" style="color:${c.color}">${c.short}</span>
        <span class="nm">${p.name}</span>
        ${added ? '<span class="added">уже в группе</span>' : `<span class="pr num">${money(p.price)}</span>`}
      </button>`;
    }).join('') : `<div class="none">Ничего не найдено. Попробуйте другое слово или снимите фильтр группы.</div>`;
    document.getElementById('pickCount').textContent = pickSel.size;
    document.getElementById('pickAdd').disabled = !pickSel.size;
    document.getElementById('pickAdd').textContent = pickSel.size ? `Добавить ${pickSel.size}` : 'Добавить';
  }
  function pickerAdd() {
    if (!pickSel.size) return;
    snapshot();
    const cur = nodeByPath(draft, editPath);
    pickSel.forEach(pid => cur.items.push(item(pid)));
    const n = pickSel.size;
    close('modalPick');
    renderEditor();
    toast(`Добавлено ${n} ${plural(n, 'товар', 'товара', 'товаров')}`);
  }

  /* ---------------------- быстрая сборка из групп --------------------- */
  let catSel = new Set();
  function openFromCat() {
    catSel = new Set();
    renderFromCat();
    open('modalFromCat');
  }
  function renderFromCat() {
    document.getElementById('catPickList').innerHTML = CATEGORIES.map(c => {
      const n = PRODUCTS.filter(p => p.cat === c.id).length;
      return `<button class="pk ${catSel.has(c.id) ? 'on' : ''}" data-c="${c.id}">
        <span class="cb"><svg><use href="#i-check"/></svg></span>
        <span class="tg" style="color:${c.color}">${c.short}</span>
        <span class="nm">${c.name}</span>
        <span class="added">${n} ${plural(n, 'позиция', 'позиции', 'позиций')}</span>
      </button>`;
    }).join('');
    const b = document.getElementById('catPickAdd');
    b.disabled = !catSel.size;
    b.textContent = catSel.size ? `Создать ${catSel.size} ${plural(catSel.size, 'группу', 'группы', 'групп')}` : 'Создать группы';
  }
  function fromCatAdd() {
    if (!catSel.size) return;
    if (editPath.length >= MAX_DEPTH) return toast('Здесь уже максимальная глубина', 'warn');
    snapshot();
    const cur = nodeByPath(draft, editPath);
    CATEGORIES.filter(c => catSel.has(c.id)).forEach(c => {
      cur.items.push(group(c.name, c.color, PRODUCTS.filter(p => p.cat === c.id).map(p => item(p.id))));
    });
    const n = catSel.size;
    close('modalFromCat');
    renderEditor();
    toast(`Создано ${n} ${plural(n, 'группа', 'группы', 'групп')}`);
  }

  /* ------------------------------ drag & drop ----------------------------- */
  let dragId = null;

  function dragStart(e, id, el) { dragId = id; e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); }
  function dragEnd(e) {
    dragId = null;
    document.querySelectorAll('.dragging,.over,.into').forEach(el => el.classList.remove('dragging', 'over', 'into'));
  }
  function canDropInto(dragged, target) {
    if (!dragged || !target || target.kind !== 'group') return false;
    if (dragged.id === target.id) return false;
    if (dragged.kind === 'group') {
      const own = [dragged.id].concat(allGroups(draft, dragged).map(x => x.node.id));
      if (own.includes(target.id)) return false;
      const tp = pathTo(draft, target.id) || [];
      if (tp.length + 1 + height(dragged) > MAX_DEPTH) return false;
    }
    return true;
  }
  function dropOn(targetId, into) {
    if (!dragId || dragId === targetId) return;
    const dragged = findNode(draft, dragId);
    const target = findNode(draft, targetId);
    if (!dragged || !target) return;
    snapshot();
    const from = parentOf(draft, dragId);
    from.items.splice(from.items.indexOf(dragged), 1);
    if (into) target.items.push(dragged);
    else {
      const to = parentOf(draft, targetId);
      to.items.splice(to.items.indexOf(target), 0, dragged);
    }
    renderEditor();
  }

  /* ------------------------------- события -------------------------------- */
  function bind() {
    /* витрина кассира */
    document.getElementById('crumbs').addEventListener('click', onCrumbClick);

    /* редактор: верхняя панель */
    document.getElementById('hkSave').addEventListener('click', save);
    document.getElementById('hkUndo').addEventListener('click', undo);
    document.getElementById('hkExit').addEventListener('click', () => closeEditor());
    document.getElementById('hkAddRootGroup').addEventListener('click', () => { editPath = []; renderEditor(); openGroupModal(null); });
    document.getElementById('hkAddGroup').addEventListener('click', () => openGroupModal(null));
    document.getElementById('hkAddItems').addEventListener('click', openPicker);
    document.getElementById('hkFromCat').addEventListener('click', openFromCat);

    /* дерево */
    const tree = document.getElementById('hkTree');
    tree.addEventListener('click', e => {
      const r = e.target.closest('[data-gid]'); if (!r) return;
      const id = r.dataset.gid;
      editPath = id === 'root' ? [] : (pathTo(draft, id) || []).concat(id);
      renderEditor();
    });
    tree.addEventListener('dragstart', e => {
      const r = e.target.closest('[data-gid]'); if (!r || r.dataset.gid === 'root') return e.preventDefault();
      dragStart(e, r.dataset.gid, r);
    });
    tree.addEventListener('dragend', dragEnd);
    tree.addEventListener('dragover', e => {
      const r = e.target.closest('[data-gid]'); if (!r) return;
      e.preventDefault();
      tree.querySelectorAll('.over,.into').forEach(x => x.classList.remove('over', 'into'));
      const id = r.dataset.gid;
      const dragged = findNode(draft, dragId);
      if (id === 'root') { r.classList.add('into'); return; }
      const target = findNode(draft, id);
      const rect = r.getBoundingClientRect();
      const into = (e.clientY - rect.top) > rect.height * 0.35 && canDropInto(dragged, target);
      r.classList.add(into ? 'into' : 'over');
    });
    tree.addEventListener('drop', e => {
      const r = e.target.closest('[data-gid]'); if (!r || !dragId) return;
      e.preventDefault();
      const into = r.classList.contains('into');
      if (r.dataset.gid === 'root') {
        const dragged = findNode(draft, dragId);
        snapshot();
        const from = parentOf(draft, dragId);
        from.items.splice(from.items.indexOf(dragged), 1);
        draft.items.push(dragged);
        renderEditor();
      } else dropOn(r.dataset.gid, into);
      dragEnd(e);
    });

    /* сетка редактора */
    const grid = document.getElementById('hkGrid');
    grid.addEventListener('click', e => {
      if (e.target.closest('#hkAddTile')) return openPicker();
      const m = e.target.closest('[data-menu]');
      if (m) {
        e.stopPropagation();
        const t = m.closest('[data-nid]');
        const r = m.getBoundingClientRect();
        showTileMenu(t.dataset.nid, r.right - 240, r.bottom + 6);
        return;
      }
      const t = e.target.closest('[data-nid]'); if (!t) return;
      const node = findNode(draft, t.dataset.nid);
      if (node && node.kind === 'group') { editPath = editPath.concat(node.id); renderEditor(); }
    });
    grid.addEventListener('dragstart', e => {
      const t = e.target.closest('[data-nid]'); if (!t) return;
      dragStart(e, t.dataset.nid, t);
    });
    grid.addEventListener('dragend', dragEnd);
    grid.addEventListener('dragover', e => {
      const t = e.target.closest('[data-nid]'); if (!t || !dragId) return;
      e.preventDefault();
      grid.querySelectorAll('.over,.into').forEach(x => x.classList.remove('over', 'into'));
      if (t.dataset.nid === dragId) return;
      const into = canDropInto(findNode(draft, dragId), findNode(draft, t.dataset.nid));
      t.classList.add(into ? 'into' : 'over');
    });
    grid.addEventListener('drop', e => {
      const t = e.target.closest('[data-nid]'); if (!t || !dragId) return;
      e.preventDefault();
      dropOn(t.dataset.nid, t.classList.contains('into'));
      dragEnd(e);
    });

    /* крошки редактора */
    document.getElementById('hkCrumbs').addEventListener('click', e => {
      const c = e.target.closest('.cr'); if (!c) return;
      const i = +c.dataset.i;
      editPath = i < 0 ? [] : editPath.slice(0, i + 1);
      renderEditor();
    });

    /* меню плитки */
    document.getElementById('menuTile').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      tileMenuAction(b.dataset.a);
    });
    document.addEventListener('click', e => { if (!e.target.closest('#menuTile')) hideTileMenu(); });

    /* группа */
    document.getElementById('grpColors').addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      grpColor = b.dataset.c;
      document.querySelectorAll('#grpColors button').forEach(x => x.classList.toggle('on', x.dataset.c === grpColor));
    });
    document.getElementById('grpOk').addEventListener('click', saveGroup);
    document.getElementById('grpName').addEventListener('keydown', e => { if (e.key === 'Enter') saveGroup(); });

    /* перемещение */
    document.getElementById('moveList').addEventListener('click', e => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      doMove(b.dataset.t);
    });

    /* подбор товаров */
    document.getElementById('pickInput').addEventListener('input', renderPicker);
    document.getElementById('pickTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      pickCat = b.dataset.c;
      document.querySelectorAll('#pickTabs button').forEach(x => x.classList.toggle('on', x.dataset.c === pickCat));
      renderPicker();
    });
    document.getElementById('pickList').addEventListener('click', e => {
      const b = e.target.closest('[data-p]'); if (!b || b.disabled) return;
      const id = b.dataset.p;
      pickSel.has(id) ? pickSel.delete(id) : pickSel.add(id);
      renderPicker();
    });
    document.getElementById('pickAll').addEventListener('click', () => {
      const cur = nodeByPath(draft, editPath);
      const here = new Set(cur.items.filter(n => n.kind === 'item').map(n => n.pid));
      pickerResults().filter(p => !here.has(p.id)).forEach(p => pickSel.add(p.id));
      renderPicker();
    });
    document.getElementById('pickAdd').addEventListener('click', pickerAdd);

    /* сборка из групп */
    document.getElementById('catPickList').addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      catSel.has(b.dataset.c) ? catSel.delete(b.dataset.c) : catSel.add(b.dataset.c);
      renderFromCat();
    });
    document.getElementById('catPickAdd').addEventListener('click', fromCatAdd);
  }

  return {
    async init() { bind(); await load(); },
    renderCashier, onGridClick, up, goRoot,
    openEditor, exportFile, parseFile, applyFile,
    exit: () => closeEditor(),
    isEditing: () => !document.getElementById('hkEditor').classList.contains('hidden'),
    hasPath: () => path.length > 0,
  };
})();
