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
  /* Витрина хранится по режимам (завтрак, обед, ужин…): у каждого своя структура.
     Кассир видит активный режим, администратор правит выбранный — это разные вещи.
     Первый режим в списке — «Основной»: с него касса начинает при каждом входе. */
  let modes = [];                  // [{ id, name, items }]
  let activeId = null;             // режим на витрине кассира
  let editId = null;               // режим в редакторе
  const modeOf = id => modes.find(m => m.id === id) || modes[0];
  const treeOf = id => ({ items: modeOf(id).items });

  let data = { items: [] };        // рабочая (сохранённая) структура активного режима
  let draft = null;                // копия правимого режима на время правки
  let undoStack = [];
  let dirty = false;

  let path = [];                   // путь кассира
  let editPath = [];               // путь в редакторе

  const clone = o => JSON.parse(JSON.stringify(o));

  /* --------------------------- загрузка и сохранение ---------------------- */
  async function load() {
    const res = await API.hotkeys();
    applyModes(res.modes || []);
    useMode(modes[0].id);
  }
  /* список режимов пришёл из хранилища: витрина кассира остаётся на своём режиме, если он жив */
  function applyModes(list) {
    modes = list.length ? list : [{ id: 'm1', name: 'Основной', items: [] }];
    const m = modeOf(activeId);
    activeId = m.id;
    data = { items: m.items };
    path = path.filter(id => findNode(data, id));
  }
  function useMode(id) {
    const m = modeOf(id);
    activeId = m.id;
    data = { items: m.items };
    path = [];
    renderModeChip();
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
  const label = n => n.kind === 'group' ? n.name : ((prod(n.pid) || {}).name || '');
  const byName = (x, y) => label(x).localeCompare(label(y), 'ru', { numeric: true, sensitivity: 'base' });

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
    const cls = 'tile group' + (o.edit ? ' edit' : '');
    const at = o.edit ? `data-nid="${g.id}" draggable="true"` : `data-gid="${g.id}"`;
    return `<button class="${cls}" ${at} style="--c:${g.color}">
      ${o.extra || ''}
      <span class="gi"><svg><use href="#i-folder"/></svg></span>
      <span class="nm">${g.name}</span>
    </button>`;
  }
  /* Лента групп: внутри открытой группы показывает группы первого уровня,
     чтобы перейти в соседнюю, не выходя на главный экран. Нужна, когда групп больше одной. */
  function renderRibbon(roots, rb, p) {
    rb = rb || document.getElementById('ribbon');
    p = p || path;
    const on = p.length > 0 && roots.length > 1;
    rb.classList.toggle('hidden', !on);
    if (!on) { rb.innerHTML = ''; return false; }
    const prev = rb.querySelector('.rb-list');
    const keep = prev ? prev.scrollLeft : 0;   /* лента перерисовывается при каждом переходе — положение не должно сбрасываться */
    rb.innerHTML = `<div class="rb-list">` +
      roots.map(g => `<button class="rb ${g.id === p[0] ? 'on' : ''}" data-gid="${g.id}" style="--c:${g.color}"><i></i><span>${esc(g.name)}</span></button>`).join('') + `</div>`;
    /* активная группа не должна прятаться за краем: прокручиваем ровно настолько, чтобы она была видна целиком */
    const list = rb.querySelector('.rb-list'), cur = rb.querySelector('.rb.on');
    list.scrollLeft = keep;
    if (cur) {
      const l = cur.offsetLeft - list.offsetLeft, r = l + cur.offsetWidth;
      if (l < list.scrollLeft) list.scrollLeft = l;
      else if (r > list.scrollLeft + list.clientWidth) list.scrollLeft = r - list.clientWidth;
    }
    return true;
  }
  /* Лента листается: пальцем — само (touch-action:pan-x), мышью — зажатой кнопкой (левой или правой) и влево-вправо.
     Протащили — нажатие на чип не засчитывается. Навешено на сами ленты, потому что внутри они перерисовываются. */
  function dragScroll(rb) {
    let list = null, x0 = 0, s0 = 0, moved = false;
    rb.addEventListener('pointerdown', e => {
      list = e.target.closest('.rb-list');
      if (!list || e.pointerType !== 'mouse' || (e.button !== 0 && e.button !== 2)) { list = null; return; }
      x0 = e.clientX; s0 = list.scrollLeft; moved = false;
    });
    window.addEventListener('pointermove', e => {
      if (!list) return;
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < 6) return;
      moved = true;
      list.scrollLeft = s0 - dx;
    });
    window.addEventListener('pointerup', () => { list = null; });
    rb.addEventListener('click', e => { if (moved) { e.stopImmediatePropagation(); e.preventDefault(); moved = false; } }, true);
    rb.addEventListener('contextmenu', e => e.preventDefault());   // правая кнопка тянет ленту, меню браузера не нужно
  }
  function renderCrumbs() {
    const el = document.getElementById('crumbs');
    const ribbon = renderRibbon(data.items.filter(n => n.kind === 'group').sort(byName));
    renderModeChip();
    if (!path.length || (ribbon && path.length === 1)) { el.innerHTML = ''; return; }
    let html = ribbon ? '' : `<button class="up" id="crumbUp" title="На уровень выше"><svg><use href="#i-back"/></svg></button>`;
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

    let html = rest.map(n => {
      if (n.kind === 'group') return tileGroup(n);
      const p = prod(n.pid);
      return p ? tileProduct(p) : '';
    }).join('');
    grid.innerHTML = html;
  }

  function up() { if (path.length) { path.pop(); renderCashier(); } }
  function goRoot() { path = []; }

  /* ---------------------------- режим на витрине -------------------------- */
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  /* кнопка режима видна только на вкладке «Горячие клавиши» и только если режимов больше одного */
  function renderModeChip() {
    const b = document.getElementById('btnMode');
    if (!b) return;
    const m = modes.length ? modeOf(activeId) : null;
    document.getElementById('modeRow').classList.toggle('hidden', !m || modes.length < 2 || S.view !== 'hk' || path.length > 0);
    if (m) b.querySelector('.mn').textContent = m.name;
  }
  function hideModeMenu() { document.getElementById('menuMode').classList.add('hidden'); }
  function toggleModeMenu() {
    const el = document.getElementById('menuMode');
    if (!el.classList.contains('hidden')) return hideModeMenu();
    el.innerHTML = modes.map(m => `<button data-m="${m.id}" class="${m.id === activeId ? 'on' : ''}">
      <svg ${m.id === activeId ? '' : 'style="opacity:0"'}><use href="#i-check"/></svg><span class="mt">${esc(m.name)}</span></button>`).join('');
    el.classList.remove('hidden');
    const r = document.getElementById('btnMode').getBoundingClientRect(), w = el.getBoundingClientRect();
    el.style.left = Math.max(12, Math.min(r.left, innerWidth - w.width - 12)) + 'px';
    el.style.top = (r.bottom + 6) + 'px';
  }
  function setMode(id) {
    hideModeMenu();
    if (id === activeId) return;
    useMode(id);
    renderCashier();
    document.getElementById('grid').scrollTop = 0;
  }
  /* новый вход в смену: витрина начинается с основного режима */
  function resetMode() { if (modes.length) { useMode(modes[0].id); if (S.view === 'hk') renderCashier(); } }

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


  /* ============================ РЕЖИМ НАСТРОЙКИ =========================== */
  function snapshot() {
    undoStack.push(JSON.stringify(draft));
    if (undoStack.length > 40) undoStack.shift();
  }
  function syncTopButtons() {
    dirty = JSON.stringify(draft) !== JSON.stringify(treeOf(editId));
    document.getElementById('hkUndo').disabled = !undoStack.length;
    document.getElementById('hkSave').disabled = !dirty;
  }

  function openEditor() {
    editId = activeId;
    draft = clone(treeOf(editId));
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
      const res = await API.saveHotkeyModes(modes.map(m => m.id === editId ? { ...m, items: draft.items } : m));
      applyModes(res.modes);
      draft = clone(treeOf(editId));
      undoStack = [];
      editPath = editPath.filter(id => findNode(draft, id));
      path = path.filter(id => findNode(data, id));
      renderEditor();
      renderGrid();
      renderModeChip();
      toast(`Горячие клавиши сохранены · режим «${modeOf(editId).name}»`);
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

  function renderEditor() { syncTopButtons(); renderEditMode(); renderTree(); renderEditGrid(); renderEditCrumbs(); }

  /* ---------------------------- режимы в редакторе ------------------------- */
  function renderEditMode() {
    document.getElementById('hkMode').querySelector('.mn').textContent = modeOf(editId).name;
  }
  function switchEdit(id) {
    editId = id;
    draft = clone(treeOf(editId));
    undoStack = []; dirty = false; editPath = [];
    renderEditor();
    renderModes();
  }
  function renderModes() {
    const total = m => countAll({ kind: 'group', items: m.items });
    document.getElementById('modeList').innerHTML = modes.map((m, i) => {
      const n = total(m);
      return `<div class="mrow ${m.id === editId ? 'on' : ''}" data-id="${m.id}">
        <button class="mpick" data-a="pick">
          <span class="mr"><svg><use href="#i-check"/></svg></span>
          <span class="mt"><b>${esc(m.name)}</b><span>${n ? `${n} ${plural(n, 'позиция', 'позиции', 'позиций')}` : 'пока пусто'}${i === 0 ? ' · при входе в смену' : ''}</span></span>
        </button>
        <button class="ibtn" data-a="rename" title="Переименовать"><svg><use href="#i-pencil"/></svg></button>
        <button class="ibtn" data-a="copy" title="Сделать копию"><svg><use href="#i-copy"/></svg></button>
        <button class="ibtn danger" data-a="del" title="Удалить режим" ${modes.length < 2 ? 'disabled' : ''}><svg><use href="#i-trash"/></svg></button>
      </div>`;
    }).join('');
  }
  function openModes() { renderModes(); open('modalModes'); }

  const needSaved = () => { if (dirty) { toast('Сначала сохраните или отмените изменения витрины', 'warn'); return true; } return false; };
  const newModeId = () => 'm' + (modes.reduce((mx, m) => Math.max(mx, parseInt(String(m.id).replace(/\D/g, ''), 10) || 0), 0) + 1);

  async function saveModes(next, after) {
    try {
      const res = await API.saveHotkeyModes(next);
      applyModes(res.modes);
      if (after) after();
      if (!modes.some(m => m.id === editId)) switchEdit(modes[0].id);
      renderModes(); renderEditMode(); renderModeChip();
      if (S.view === 'hk') renderCashier();
      return true;
    } catch (err) { toast('Не сохранено: ' + err.message, 'bad'); return false; }
  }

  let naming = null;   // { id } — переименование; { copyOf } — копия; {} — новый режим
  function openModeName(ctx) {
    naming = ctx;
    const base = ctx.id ? modeOf(ctx.id).name : ctx.copyOf ? modeOf(ctx.copyOf).name + ' (копия)' : '';
    document.getElementById('modeNameTitle').textContent = ctx.id ? 'Переименовать режим' : ctx.copyOf ? 'Копия режима' : 'Новый режим';
    document.getElementById('modeNameInput').value = base;
    open('modalModeName');
    setTimeout(() => document.getElementById('modeNameInput').focus(), 60);
  }
  async function modeNameOk() {
    const name = document.getElementById('modeNameInput').value.trim();
    if (!name) return toast('Введите название режима', 'warn');
    if (modes.some(m => m.name.toLowerCase() === name.toLowerCase() && m.id !== (naming.id || ''))) return toast(`Режим «${name}» уже есть`, 'warn');
    let next, pick = null;
    if (naming.id) next = modes.map(m => m.id === naming.id ? { ...m, name } : m);
    else {
      const id = newModeId(); pick = id;
      next = modes.concat({ id, name, items: naming.copyOf ? clone(modeOf(naming.copyOf).items) : [] });
    }
    close('modalModeName');
    const ok = await saveModes(next);
    if (ok && pick) { switchEdit(pick); toast(`Режим «${name}» создан`); }
    if (ok && naming && naming.id) toast('Режим переименован');
  }
  function modeAction(a, id) {
    if (a === 'pick') {
      if (id === editId) return close('modalModes');
      const go = () => { switchEdit(id); close('modalModes'); };
      if (dirty) ask('Перейти без сохранения?', `Изменения в режиме «${esc(modeOf(editId).name)}» будут потеряны.`, 'Перейти', go);
      else go();
      return;
    }
    if (needSaved()) return;
    if (a === 'rename') return openModeName({ id });
    if (a === 'copy') return openModeName({ copyOf: id });
    if (a === 'del') {
      const m = modeOf(id);
      ask('Удалить режим «' + esc(m.name) + '»?', 'Его витрина пропадёт. Блюда останутся в каталоге.', 'Удалить', async () => {
        if (await saveModes(modes.filter(x => x.id !== id))) toast('Режим удалён', 'warn');
      });
    }
  }

  /* ------------------------------- дерево --------------------------------- */
  const treeOpen = new Set();   // раскрытые группы дерева
  function renderTree() {
    const cur = editPath[editPath.length - 1] || 'root';
    editPath.slice(0, -1).forEach(id => treeOpen.add(id));   // путь к выбранной группе всегда виден
    let html = `<button class="tr ${cur === 'root' ? 'on' : ''}" data-gid="root" style="padding-left:10px">
      <span class="grip" style="visibility:hidden"><svg><use href="#i-grip"/></svg></span>
      <span class="cd" style="--c:var(--acc)"></span>
      <span class="nm">Все группы</span>
      <span class="cnt">${draft.items.filter(n => n.kind === 'group').length}</span>
    </button>`;
    const walk = (node, lvl) => {
      node.items.filter(n => n.kind === 'group').forEach(g => {
        const kids = g.items.some(n => n.kind === 'group');
        const open = treeOpen.has(g.id);
        html += `<button class="tr ${cur === g.id ? 'on' : ''}" data-gid="${g.id}" draggable="true"
            style="padding-left:${10 + lvl * 18}px; --c:${g.color}">
          <span class="grip"><svg><use href="#i-grip"/></svg></span>
          <span class="chv${kids ? (open ? ' open' : '') : ' leaf'}"><svg><use href="#i-chev"/></svg></span>
          ${lvl === 1 ? '<span class="fi"><svg><use href="#i-folder"/></svg></span>' : '<span class="cd"></span>'}
          <span class="nm">${g.name}</span>
          <span class="cnt">${countAll(g)}</span>
        </button>`;
        if (open) walk(g, lvl + 1);
      });
    };
    walk({ items: draft.items }, 1);
    document.getElementById('hkTree').innerHTML = html;
  }

  /* путь и лента групп — те же, что у кассира: внутри группы чипы групп первого уровня,
     глубже — строка пути под ними */
  function renderEditCrumbs() {
    const el = document.getElementById('hkCrumbs');
    const ribbon = renderRibbon(draft.items.filter(n => n.kind === 'group').sort(byName), document.getElementById('hkRibbon'), editPath);
    if (!editPath.length || (ribbon && editPath.length === 1)) el.innerHTML = '';
    else {
      let html = ribbon ? '' : `<button class="up" id="hkCrumbUp" title="На уровень выше"><svg><use href="#i-back"/></svg></button>`;
      html += `<button class="cr" data-i="-1">Все группы</button>`;
      editPath.forEach((id, i) => {
        const g = findNode(draft, id); if (!g) return;
        html += `<span class="sl">›</span><button class="cr ${i === editPath.length - 1 ? 'last' : ''}" data-i="${i}">${g.name}</button>`;
      });
      el.innerHTML = html;
    }

    const deep = editPath.length >= MAX_DEPTH;
    const b = document.getElementById('hkAddGroup');
    b.disabled = deep;
    b.title = deep ? `Глубже ${MAX_DEPTH} уровней кассиру неудобно — добавьте сюда товары` : '';
    /* на первом уровне создаётся группа, внутри группы — подгруппа */
    document.getElementById('hkAddGroupL').textContent = editPath.length ? 'Добавить подгруппу' : 'Добавить группу';
  }

  function renderEditGrid() {
    const cur = nodeByPath(draft, editPath);
    const menu = `<span class="em" data-menu><svg style="width:17px;height:17px"><use href="#i-dots"/></svg></span>`;
    let html = cur.items.map(n => {
      if (n.kind === 'group') return tileGroup(n, { edit: true, extra: menu });
      const p = prod(n.pid); if (!p) return '';
      return tileProduct(p, { edit: true, nid: n.id, extra: menu });
    }).join('');

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
  let pickKey = 'all';          // выбранный узел левого столбца
  const pickOpen = new Set();   // раскрытые узлы (группы с подгруппами)

  /* В каталоге пока нет вложенных групп, поэтому верхний уровень собран из разделов меню —
     так же, как стартовая витрина. Группы вне разделов остаются на верхнем уровне. */
  const PICK_SECTIONS = [
    ['Обеды', ['combo', 'soup', 'hot', 'garnir']],
    ['Салаты и закуски', ['salat', 'zakuska']],
    ['Выпечка', ['vypechka', 'konditer', 'svezh']],
    ['Буфет и хлеб', ['bufet', 'hleb']],
  ];
  function pickTree() {
    const cnt = {}, subs = {};
    PRODUCTS.forEach(p => {
      cnt[p.cat] = (cnt[p.cat] || 0) + 1;
      if (p.sub) { const m = subs[p.cat] = subs[p.cat] || {}; m[p.sub] = (m[p.sub] || 0) + 1; }
    });
    const catNode = c => ({
      key: 'c:' + c.id, label: c.name, count: cnt[c.id] || 0, test: p => p.cat === c.id,
      kids: Object.keys(subs[c.id] || {}).map(sn => ({
        key: 'u:' + c.id + '|' + sn, label: sn, count: subs[c.id][sn],
        test: p => p.cat === c.id && p.sub === sn, kids: [],
      })),
    });
    const top = [{ key: 'all', label: 'Все', count: PRODUCTS.length, test: () => true, kids: [] }];
    const done = new Set();
    CATEGORIES.forEach(c => {
      const sec = PICK_SECTIONS.find(x => x[1].includes(c.id));
      if (!sec) { top.push(catNode(c)); return; }
      if (done.has(sec[0])) return;
      done.add(sec[0]);
      const cats = CATEGORIES.filter(x => sec[1].includes(x.id));
      top.push({
        key: 's:' + sec[0], label: sec[0], count: cats.reduce((n, x) => n + (cnt[x.id] || 0), 0),
        test: p => sec[1].includes(p.cat), kids: cats.map(catNode),
      });
    });
    return top;
  }
  function pickFind(nodes, key) {
    for (const n of nodes) {
      if (n.key === key) return n;
      const r = pickFind(n.kids, key); if (r) return r;
    }
    return null;
  }

  function openPicker() {
    pickSel = new Set(); pickKey = 'all'; pickOpen.clear();
    const cur = nodeByPath(draft, editPath);
    document.getElementById('pickDest').textContent = 'В группу: ' +
      (editPath.length ? editPath.map(id => findNode(draft, id).name).join(' › ') : 'Все группы (первый экран)');
    document.getElementById('pickInput').value = '';
    renderPicker();
    open('modalPick');
  }
  function pickerResults() {
    const q = document.getElementById('pickInput').value.trim().toLowerCase();
    return PRODUCTS.filter(p =>
      (pickFind(pickTree(), pickKey) || { test: () => true }).test(p) &&
      (!q || p.name.toLowerCase().includes(q))
    );
  }
  /* левый столбец: дерево групп; нажатие на группу выбирает её и раскрывает/сворачивает подгруппы */
  function renderPickSide() {
    const esc = t => String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const row = (n, lvl) => {
      const open = pickOpen.has(n.key);
      return `<button class="pt l${lvl}${pickKey === n.key ? ' on' : ''}" data-key="${esc(n.key)}">
        <span class="chv${n.kids.length ? (open ? ' open' : '') : ' leaf'}"><svg><use href="#i-chev"/></svg></span>
        <span class="l">${n.label}</span><span class="n">${n.count}</span></button>` +
        (open ? n.kids.map(k => row(k, lvl + 1)).join('') : '');
    };
    document.getElementById('pickTabs').innerHTML = pickTree().map(n => row(n, 0)).join('');
  }
  function renderPicker() {
    renderPickSide();
    const cur = nodeByPath(draft, editPath);
    const here = new Set(cur.items.filter(n => n.kind === 'item').map(n => n.pid));
    const list = pickerResults();
    document.getElementById('pickList').innerHTML = list.length ? list.map(p => {
      const added = here.has(p.id);
      return `<button class="pk ${pickSel.has(p.id) ? 'on' : ''} ${added ? 'dis' : ''}" data-p="${p.id}" ${added ? 'disabled' : ''}>
        <span class="cb"><svg><use href="#i-check"/></svg></span>
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
    dragScroll(document.getElementById('ribbon'));
    dragScroll(document.getElementById('hkRibbon'));
    document.getElementById('crumbs').addEventListener('click', onCrumbClick);
    document.getElementById('ribbon').addEventListener('click', e => {
      if (S.view !== 'hk') return;
      const b = e.target.closest('.rb'); if (!b) return;
      /* стрелки «выше» нет: нажатие на уже открытую группу возвращает на первый экран */
      path = b.classList.contains('on') ? [] : [b.dataset.gid];
      renderCashier();
      document.getElementById('grid').scrollTop = 0;
    });

    /* режим на витрине кассира */
    document.getElementById('btnMode').addEventListener('click', e => { e.stopPropagation(); toggleModeMenu(); });
    document.getElementById('menuMode').addEventListener('click', e => {
      const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m);
    });
    document.addEventListener('click', e => { if (!e.target.closest('#menuMode')) hideModeMenu(); });

    /* режимы в редакторе */
    document.getElementById('hkMode').addEventListener('click', openModes);
    document.getElementById('modeList').addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      modeAction(b.dataset.a, b.closest('[data-id]').dataset.id);
    });
    document.getElementById('modeNew').addEventListener('click', () => { if (!needSaved()) openModeName({}); });
    document.getElementById('modeNameOk').addEventListener('click', modeNameOk);
    document.getElementById('modeNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') modeNameOk(); });

    /* редактор: верхняя панель */
    document.getElementById('hkSave').addEventListener('click', save);
    document.getElementById('hkUndo').addEventListener('click', undo);
    document.getElementById('hkExit').addEventListener('click', () => closeEditor());
    document.getElementById('hkAddGroup').addEventListener('click', () => openGroupModal(null));
    document.getElementById('hkAddItems').addEventListener('click', openPicker);
    document.getElementById('hkFromCat').addEventListener('click', openFromCat);

    /* дерево */
    const tree = document.getElementById('hkTree');
    tree.addEventListener('click', e => {
      const r = e.target.closest('[data-gid]'); if (!r) return;
      const id = r.dataset.gid;
      editPath = id === 'root' ? [] : (pathTo(draft, id) || []).concat(id);
      /* нажатие на группу с подгруппами раскрывает их, повторное — сворачивает */
      const g = id === 'root' ? null : findNode(draft, id);
      if (g && g.items.some(n => n.kind === 'group')) treeOpen.has(id) ? treeOpen.delete(id) : treeOpen.add(id);
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
    document.getElementById('hkRibbon').addEventListener('click', e => {
      const b = e.target.closest('.rb'); if (!b) return;
      editPath = b.classList.contains('on') ? [] : [b.dataset.gid];
      renderEditor();
    });
    document.getElementById('hkCrumbs').addEventListener('click', e => {
      if (e.target.closest('#hkCrumbUp')) { editPath = editPath.slice(0, -1); renderEditor(); return; }
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
      const b = e.target.closest('[data-key]'); if (!b) return;
      const key = b.dataset.key;
      const n = pickFind(pickTree(), key);
      pickKey = key;
      if (n && n.kids.length) pickOpen.has(key) ? pickOpen.delete(key) : pickOpen.add(key);
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
    renderModeChip, resetMode,
    openEditor,
    exit: () => closeEditor(),
    isEditing: () => !document.getElementById('hkEditor').classList.contains('hidden'),
    hasPath: () => path.length > 0,
  };
})();
