'use strict';
/* ASOFT Управление: интерфейс. Без сборки, как и касса. Данные и правила наследования меню: js/store.js */

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rub = n => (Math.abs(n) >= 1000 ? Math.round(n) : Math.round(n * 100) / 100).toLocaleString('ru-RU') + ' ₽';
const nm = n => Math.round(n).toLocaleString('ru-RU');
const ico = (n, c = '') => `<svg class="i ${c}"><use href="#i-${n}"/></svg>`;
const dmy = s => s.split('-').reverse().join('.');
const stamp = t => { const d = new Date(t); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const ago = m => m < 1 ? 'сейчас' : m < 60 ? m + ' мин' : m < 1440 ? Math.round(m / 60) + ' ч' : Math.round(m / 1440) + ' дн';
const ST = { online: ['', 'на связи'], late: ['w', 'давно'], offline: ['b', 'нет связи'] };

/* ---------- состояние ---------- */
const UI_KEY = 'asoft-mgr-ui';
load();
const S = Object.assign({ org: D.orgs[0].id, page: 'overview', node: null, period: 'today', uTab: 'users', folded: {}, orgOpen: false },
  (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (_) { return {}; } })());
S.orgOpen = false;
function saveUI() { try { localStorage.setItem(UI_KEY, JSON.stringify({ org: S.org, page: S.page, node: S.node, period: S.period, uTab: S.uTab, folded: S.folded })); } catch (_) {} }
function fixState() {
  if (!orgById(S.org)) S.org = D.orgs[0].id;
  if (S.node && (!nodeById(S.node) || nodeById(S.node).org !== S.org)) S.node = null;
}
const scope = () => S.node || S.org;
const myOrg = () => orgById(S.org);

const PAGES = [['overview', 'Обзор', 'home'], ['structure', 'Структура', 'tree'], ['menu', 'Меню', 'menu'], ['users', 'Пользователи', 'users'], ['kassas', 'Кассы', 'reg'], ['reports', 'Отчёты', 'rep'], ['journal', 'Журнал', 'log']];

/* ---------- каркас ---------- */
function render() {
  fixState();
  const page = PAGES.find(p => p.id === S.page) || PAGES.find(p => p[0] === S.page) || PAGES[0];
  $('#app').innerHTML = `<div class="app">${sidebar()}<div class="main"><div class="top"><strong style="font-size:18px">${page[1]}</strong><span class="grow"></span><span class="chip">${ico('info', 'x')} Тестовая версия · данные демонстрационные</span><span class="muted">${esc(ME)}</span></div><div class="content">${pageHtml()}</div></div></div>`;
  saveUI();
}

function sidebar() {
  const light = document.documentElement.dataset.theme === 'light';
  return `<aside class="side">
    <div class="brand"><img src="img/asoft-emblem.png" alt=""><span>ASOFT <em>Управление</em></span></div>
    <div class="orgsw">
      <button class="orgbtn" data-act="orgmenu" aria-haspopup="true" aria-expanded="${S.orgOpen}">${ico('home')}<span class="t"><small>Организация</small><b>${esc(myOrg().name)}</b></span>${ico('chev')}</button>
      ${S.orgOpen ? `<div class="orgmenu">${D.orgs.map(o => `<button data-act="org" data-id="${o.id}" class="${o.id === S.org ? 'on' : ''}">${o.id === S.org ? ico('check') : '<span style="width:20px"></span>'}${esc(o.name)}</button>`).join('')}<hr><button data-act="neworg">${ico('plus')}Добавить организацию</button></div>` : ''}
    </div>
    ${PAGES.map(([id, label, ic]) => `<button class="nav ${S.page === id ? 'on' : ''}" data-act="nav" data-id="${id}" title="${label}">${ico(ic)}<span class="lbl-t">${label}</span></button>`).join('')}
    <div class="grow"></div>
    <div class="side-foot">
      <button class="nav small" data-act="theme" title="Тема">${ico(light ? 'moon' : 'sun')}<span class="lbl-t">${light ? 'Тёмная тема' : 'Светлая тема'}</span></button>
      <button class="nav small" data-act="reset" title="Сбросить демо-данные">${ico('undo')}<span class="lbl-t">Сбросить демо-данные</span></button>
    </div>
  </aside>`;
}

function pageHtml() {
  switch (S.page) {
    case 'structure': return pStructure();
    case 'menu': return pMenu();
    case 'users': return pUsers();
    case 'kassas': return pKassas();
    case 'reports': return pReports();
    case 'journal': return pJournal();
    default: return pOverview();
  }
}

function head(title, actions = '', sc = scope()) {
  const p = pathNames(sc);
  return `<div class="ph"><div><h1>${esc(title)}</h1><div class="crumb">${p.map((n, i) => i === p.length - 1 ? `<b>${esc(n)}</b>` : esc(n)).join(' › ')}</div></div><div class="acts">${actions}</div></div>`;
}
const withTree = inner => `<div class="split">${treePanel()}<div class="pane">${inner}</div></div>`;

function treePanel() {
  const sel = scope();
  const rows = (pid, d) => children(pid).map(n => {
    const kids = children(n.id).length, shut = S.folded[n.id];
    const right = n.type === 'kassa' ? `<span class="dot ${ST[statusOf(n)][0]}" title="${ST[statusOf(n)][1]}"></span>` : `<span class="cnt">${kassasUnder(n.id).length}</span>`;
    return `<div class="tn d${d} ${sel === n.id ? 'on' : ''}" data-act="pick" data-id="${n.id}">
      <button class="fold ${kids ? '' : 'none'} ${shut ? 'shut' : ''}" data-act="fold" data-id="${n.id}" aria-label="Свернуть или развернуть">${ico('chev')}</button>
      ${ico({ unit: 'pin', hall: 'shop', kassa: 'reg' }[n.type])}<span class="nm">${esc(n.name)}</span>${right}</div>` + (kids && !shut ? rows(n.id, d + 1) : '');
  }).join('');
  return `<div class="treep"><h4>Где работаем</h4>
    <div class="tn root ${sel === S.org ? 'on' : ''}" data-act="pick" data-id="${S.org}">${ico('home')}<span class="nm">${esc(myOrg().name)}</span><span class="cnt">${kassasUnder(S.org).length}</span></div>
    ${rows(S.org, 1)}</div>`;
}

/* ---------- Обзор ---------- */
function pOverview() {
  const sc = scope(), s = salesFor(sc, 'today'), ks = kassasUnder(sc);
  const on = ks.filter(k => statusOf(k) === 'online').length, quiet = ks.filter(k => statusOf(k) !== 'online').length;
  const fnWarn = ks.map(k => ({ k, days: Math.ceil((Date.parse(k.eq.kkt.fnTill) - Date.now()) / 864e5) })).filter(x => x.days <= 30).sort((a, b) => a.days - b.days);
  const max = Math.max(1, ...s.rows.map(r => r.sum));
  const list = [...ks].sort((a, b) => a.last - b.last);
  return withTree(`${head('Обзор')}
    ${fnWarn.length ? `<div class="note w">${ico('warn')}<span><b>Срок ФН заканчивается:</b> ${fnWarn.slice(0, 3).map(x => `${esc(x.k.name)} (${esc(nameOf(x.k.parent))}, ${esc(nameOf(nodeById(x.k.parent).parent))}) — ${dmy(x.k.eq.kkt.fnTill)}, ${x.days < 0 ? 'уже истёк' : 'осталось ' + x.days + ' дн'}`).join('; ')}${fnWarn.length > 3 ? ` и ещё ${fnWarn.length - 3}` : ''}.</span></div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="l">Выручка сегодня</div><div class="v m">${rub(s.tot.sum)}</div><div class="d">по ${s.kassas} кассам</div></div>
      <div class="kpi"><div class="l">Чеков</div><div class="v">${nm(s.tot.checks)}</div><div class="d">с начала дня</div></div>
      <div class="kpi"><div class="l">Средний чек</div><div class="v">${rub(s.avg)}</div><div class="d">наличные, карта, СБП</div></div>
      <div class="kpi"><div class="l">Кассы на связи</div><div class="v">${on} из ${ks.length}</div><div class="d">${quiet ? quiet + ' давно не выходили' : 'все на связи'}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Выручка: ${esc(s.levelLabel.toLowerCase())}</h3><div class="bars">${s.rows.map(r => `<div class="bar"><span class="nm">${esc(r.name)}</span><span class="t"><i style="width:${r.sum / max * 100}%"></i></span><span class="vl num">${rub(r.sum)}</span></div>`).join('') || '<div class="empty">Нет данных</div>'}</div></div>
      <div class="card flush"><h3 style="padding:10px 14px 0">Кассы</h3>${list.length ? `<table><tr><th>Касса</th><th>Где</th><th>Продажа</th></tr>${list.slice(0, 8).map(k => `<tr><td>${esc(k.name)}</td><td class="muted">${esc(nameOf(k.parent))}, ${esc(nameOf(nodeById(k.parent).parent))}</td><td><span class="dot ${ST[statusOf(k)][0]}"></span> ${ago(k.last)}</td></tr>`).join('')}</table>${list.length > 8 ? `<div class="muted" style="padding:8px 14px">и ещё ${list.length - 8}, полный список на странице «Кассы»</div>` : ''}` : '<div class="empty">Касс нет</div>'}</div>
    </div>`);
}

/* ---------- Структура ---------- */
const CHILD_OF = { org: ['unit', 'Подразделение'], unit: ['hall', 'Столовая'], hall: ['kassa', 'Касса'] };
function pStructure() {
  const id = scope(), t = typeOf(id), n = nodeById(id), kids = children(id), ch = CHILD_OF[t];
  const acts = `${ch ? `<button class="btn p" data-act="add" data-id="${id}">${ico('plus')}${ch[1]}</button>` : ''}<button class="btn" data-act="rename" data-id="${id}">${ico('pencil')}Переименовать</button>${t !== 'org' ? `<button class="btn bad" data-act="del" data-id="${id}">${ico('trash')}Удалить</button>` : ''}`;
  let body = '';
  if (t === 'kassa') {
    const st = statusOf(n);
    body = `<div class="card"><h3>Касса</h3><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><span class="tag ${ST[st][0]}">${ST[st][1]}</span><span class="muted">последняя продажа ${ago(n.last)} назад</span><span style="flex:1"></span><button class="btn" data-act="kassa-open" data-id="${id}">${ico('chip')}Настроить оборудование</button></div></div>`;
  } else {
    body = `<div class="card flush">${kids.length ? `<table><tr><th>${t === 'org' ? 'Подразделение' : t === 'unit' ? 'Столовая' : 'Касса'}</th><th class="r">Касс</th><th class="acts"></th></tr>${kids.map(k => `<tr class="click" data-act="pick" data-id="${k.id}"><td>${esc(k.name)}</td><td class="r num">${kassasUnder(k.id).length}</td><td class="acts">${ico('chev', 'chev-r')}</td></tr>`).join('')}</table>` : `<div class="empty">Здесь пока пусто. Добавьте: ${ch ? ch[1].toLowerCase() : ''}.</div>`}</div>`;
  }
  return withTree(`${head(t === 'org' ? 'Структура организации' : n.name, acts)}
    <div class="note">${ico('info')}<span><b>Меню задаётся на организацию, подразделение или столовую, но не на одну кассу.</b> Нужно отдельное меню для одной кассы (буфет, раздача) — заведите для неё отдельную столовую.</span></div>
    ${body}`);
}

/* ---------- Меню ---------- */
function pMenu() {
  const sc = hallOf(scope());
  const rows = effectiveMenu(sc), t = typeOf(sc), chain_ = chain(sc).map(nameOf).join(' → ');
  let sect = '';
  const body = rows.map(r => {
    const it = r.item, own = r.from === sc, ov = overAt(sc, it.id);
    let h = '';
    if (it.section !== sect) { sect = it.section; h = `<tr><td colspan="5" style="background:var(--card);font-weight:700;color:var(--tx-2);font-size:13px">${esc(sect)}</td></tr>`; }
    const src = own ? '<span class="tag n">здесь</span>' : `<span class="muted">${esc(nameOf(r.from))}</span>`;
    const tags = (r.priceFrom !== r.from ? ` <span class="tag w">цена: ${r.priceFrom === sc ? 'своя' : esc(nameOf(r.priceFrom))}</span>` : '') + (r.hidden ? ` <span class="tag b">скрыта${r.hiddenFrom === sc ? '' : ': ' + esc(nameOf(r.hiddenFrom))}</span>` : '');
    return h + `<tr class="${r.hidden ? 'dim' : ''}"><td>${esc(it.name)}</td><td class="r num"><b>${rub(r.price)}</b></td><td>${src}${tags}</td>
      <td class="acts"><button class="ibtn" data-act="item-edit" data-id="${it.id}" title="Изменить">${ico('pencil')}</button>${r.hidden ? `<button class="ibtn" data-act="item-show" data-id="${it.id}" title="Показывать на кассах">${ico('eye')}</button>` : `<button class="ibtn" data-act="item-hide" data-id="${it.id}" title="Скрыть на кассах">${ico('eyeoff')}</button>`}${ov ? `<button class="ibtn" data-act="item-reset" data-id="${it.id}" title="Вернуть как выше">${ico('undo')}</button>` : ''}${own ? `<button class="ibtn bad" data-act="item-del" data-id="${it.id}" title="Удалить позицию">${ico('trash')}</button>` : ''}</td></tr>`;
  }).join('');
  const kassas = kassasUnder(sc).length;
  return withTree(`${head('Меню', `<button class="btn p" data-act="item-add">${ico('plus')}Позиция</button>`, sc)}
    <div class="note">${ico('info')}<span>Правка здесь действует на <b>${kassas} ${kassas === 1 ? 'кассу' : 'кассы'}</b> (${esc(nameOf(sc))}) и сама доходит до касс. Меню наследуется сверху вниз: <b>${esc(chain_)}</b>. Позицию или цену, заданную выше, здесь можно переопределить, и это коснётся только этого уровня.${t === 'org' ? ' Сейчас выбрана вся организация: новые позиции появятся во всех столовых.' : ''}</span></div>
    <div class="card flush">${rows.length ? `<table><tr><th>Позиция</th><th class="r">Цена</th><th>Откуда</th><th class="acts"></th></tr>${body}</table>` : '<div class="empty">Позиций нет. Добавьте первую.</div>'}</div>`);
}

function itemForm(row, isNew) {
  const own = isNew || row.from === scopeForMenu();
  const it = row ? row.item : { name: '', section: SECTIONS[0], price: '' };
  return `${own ? `<div class="field"><label for="f-name">Название</label><input class="input" id="f-name" name="name" required value="${esc(it.name)}"></div>
    <div class="field"><label for="f-sec">Раздел</label><select class="input" id="f-sec" name="section">${SECTIONS.map(s => `<option ${s === it.section ? 'selected' : ''}>${s}</option>`).join('')}</select></div>` : `<div class="note" style="margin-bottom:14px">${ico('info')}<span>Позиция «${esc(it.name)}» пришла сверху (${esc(nameOf(row.from))}). Здесь можно поменять только цену, и только для «${esc(nameOf(scopeForMenu()))}».</span></div>`}
    <div class="field"><label for="f-price">Цена, ₽</label><input class="input" id="f-price" name="price" inputmode="decimal" required value="${isNew ? '' : row.price}"></div>`;
}
const scopeForMenu = () => hallOf(scope());

/* ---------- Пользователи и профили ---------- */
function pUsers() {
  const sc = hallOf(scope());
  const tabs = `<div class="seg"><button class="${S.uTab === 'users' ? 'on' : ''}" data-act="utab" data-id="users">Пользователи</button><button class="${S.uTab === 'profiles' ? 'on' : ''}" data-act="utab" data-id="profiles">Профили прав</button></div>`;
  if (S.uTab === 'profiles') {
    const ps = D.profiles.filter(p => p.org === S.org);
    return withTree(`${head('Пользователи', `<button class="btn p" data-act="prof-add">${ico('plus')}Профиль</button>`, sc)}${tabs}
      <div class="note">${ico('info')}<span>Профиль — набор прав. Пользователю назначается готовый профиль, права по одному не настраиваются.</span></div>
      <div class="profs">${ps.map(p => `<div class="prof"><h4>${esc(p.name)}</h4><div class="muted">${p.rights.length} из ${RIGHTS.length} прав · ${D.users.filter(u => u.profile === p.id).length} польз.</div>
        <div class="rights">${RIGHTS.filter(r => p.rights.includes(r[0])).map(r => `<span class="tag n">${r[1]}</span>`).join('')}</div>
        <div style="display:flex;gap:6px;margin-top:auto"><button class="btn sm" data-act="prof-edit" data-id="${p.id}">${ico('pencil')}Изменить</button><button class="btn sm bad" data-act="prof-del" data-id="${p.id}">${ico('trash')}</button></div></div>`).join('')}</div>`);
  }
  const us = D.users.filter(u => u.org === S.org && (sc === S.org || u.access.some(a => related(a, sc))));
  return withTree(`${head('Пользователи', `<button class="btn p" data-act="user-add">${ico('plus')}Пользователь</button>`, sc)}${tabs}
    <div class="card flush">${us.length ? `<table><tr><th>Пользователь</th><th>Профиль</th><th>Допуск</th><th>PIN</th><th class="acts"></th></tr>${us.map(u => {
      const p = D.profiles.find(p => p.id === u.profile);
      return `<tr><td><b>${esc(u.name)}</b></td><td>${p ? `<span class="tag i">${esc(p.name)}</span>` : '—'}</td><td class="muted">${u.access.length ? esc(u.access.map(nameOf).join(', ')) : 'нет допуска'}</td><td class="muted">••••</td>
        <td class="acts"><button class="ibtn" data-act="user-edit" data-id="${u.id}" title="Изменить">${ico('pencil')}</button><button class="ibtn bad" data-act="user-del" data-id="${u.id}" title="Удалить">${ico('trash')}</button></td></tr>`;
    }).join('')}</table>` : '<div class="empty">В этой части структуры пользователей нет.</div>'}</div>`);
}

function userForm(u) {
  const ps = D.profiles.filter(p => p.org === S.org);
  const units = children(S.org).filter(n => n.type === 'unit');
  const chk = (n, ind) => `<label class="chk ${ind ? 'ind1' : ''}"><input type="checkbox" name="acc" value="${n.id}" ${u.access.includes(n.id) ? 'checked' : ''}>${ico(n.type === 'unit' ? 'pin' : 'shop')}<span>${esc(n.name)}</span></label>`;
  return `<div class="field"><label for="f-name">Имя</label><input class="input" id="f-name" name="name" required value="${esc(u.name)}"></div>
    <div class="row2"><div class="field"><label for="f-pin">PIN-код (4 цифры)</label><input class="input num" id="f-pin" name="pin" inputmode="numeric" maxlength="4" required value="${esc(u.pin)}"></div>
    <div class="field"><label for="f-prof">Профиль прав</label><select class="input" id="f-prof" name="profile">${ps.map(p => `<option value="${p.id}" ${p.id === u.profile ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
    <div class="field"><span class="lbl">Допуск: где может работать</span><div class="checks">${units.map(un => chk(un, false) + children(un.id).filter(h => h.type === 'hall').map(h => chk(h, true)).join('')).join('') || '<div class="muted" style="padding:8px">Сначала создайте подразделения и столовые.</div>'}</div><span class="hint">Допуск на подразделение — на все его столовые.</span></div>`;
}

/* ---------- Кассы и оборудование ---------- */
function pKassas() {
  const sc = scope(), ks = kassasUnder(sc);
  return withTree(`${head('Кассы', '', sc)}
    <div class="note">${ico('info')}<span>Настройки оборудования меняются удалённо: касса применит их сама при ближайшей связи с сервером. Выберите кассу.</span></div>
    <div class="card flush">${ks.length ? `<table><tr><th>Касса</th><th>Где</th><th>Связь</th><th>ККТ · ФН до</th><th>Эквайринг</th><th>СБП</th></tr>${ks.map(k => {
      const st = statusOf(k), days = Math.ceil((Date.parse(k.eq.kkt.fnTill) - Date.now()) / 864e5);
      return `<tr class="click" data-act="kassa-open" data-id="${k.id}"><td><b>${esc(k.name)}</b></td><td class="muted">${esc(nameOf(k.parent))}, ${esc(nameOf(nodeById(k.parent).parent))}</td>
        <td><span class="tag ${ST[st][0]}">${ST[st][1]}</span> <span class="muted">${ago(k.last)}</span></td>
        <td>${esc(k.eq.kkt.model)} · <span class="${days <= 30 ? 'tag w' : ''}">${dmy(k.eq.kkt.fnTill)}</span></td><td>${esc(k.eq.acq.model)}</td><td>${k.eq.sbp ? '<span class="tag">включена</span>' : '<span class="tag n">выключена</span>'}</td></tr>`;
    }).join('')}</table>` : '<div class="empty">Касс нет.</div>'}</div>`);
}

function kassaForm(k) {
  const e = k.eq, sel = (name, opts, v) => `<select class="input" name="${name}">${opts.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  const sw = (name, on, label) => `<label class="chk"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  return `<div class="sec">Контрольно-кассовая техника</div>
    <div class="row2"><div class="field"><label>Модель</label>${sel('kkt_model', KKT_MODELS, e.kkt.model)}</div><div class="field"><label>Подключение</label>${sel('kkt_conn', CONNS, e.kkt.conn)}</div></div>
    <div class="row2"><div class="field"><label>Номер ФН</label><input class="input num" name="kkt_fn" value="${esc(e.kkt.fn)}"></div><div class="field"><label>ФН действует до</label><input class="input" type="date" name="kkt_till" value="${esc(e.kkt.fnTill)}"></div></div>
    <div class="field"><label>IP-адрес (если подключение по сети)</label><input class="input num" name="kkt_ip" placeholder="192.168.0.50" value="${esc(e.kkt.ip)}"></div>
    <div class="sec">Эквайринг</div>
    <div class="row2"><div class="field"><label>Терминал</label>${sel('acq_model', ACQ_MODELS, e.acq.model)}</div><div class="field"><label>Подключение</label>${sel('acq_conn', CONNS, e.acq.conn)}</div></div>
    <div class="sec">Печать и периферия</div>
    <div class="row2"><div class="field"><label>Принтер чеков</label><input class="input" name="prn_model" value="${esc(e.printer.model)}"></div><div class="field"><label>Подключение</label>${sel('prn_conn', CONNS, e.printer.conn)}</div></div>
    ${sw('scale_on', e.scale.on, 'Весы подключены')}
    <div class="row2" style="margin-top:6px"><div class="field"><label>Модель весов</label><input class="input" name="scale_model" value="${esc(e.scale.model)}"></div><div class="field"><label>Подключение</label>${sel('scale_conn', CONNS, e.scale.conn)}</div></div>
    ${sw('disp_on', e.display.on, 'Дисплей покупателя')}
    <div class="sec">Оплата</div>
    ${sw('sbp', e.sbp, 'Оплата по СБП')}`;
}

/* ---------- Отчёты ---------- */
const PERIODS = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['week', '7 дней'], ['month', '30 дней']];
function pReports() {
  const sc = scope(), s = salesFor(sc, S.period), max = Math.max(1, ...s.rows.map(r => r.sum));
  const pay = [['Карта', s.tot.card, '--m-card'], ['СБП', s.tot.qr, '--m-qr'], ['Наличные', s.tot.cash, '--m-cash']];
  return withTree(`${head('Отчёты', `<button class="btn" data-act="export">${ico('down')}Скачать CSV</button>`, sc)}
    <div><div class="seg">${PERIODS.map(([id, l]) => `<button class="${S.period === id ? 'on' : ''}" data-act="period" data-id="${id}">${l}</button>`).join('')}</div></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Выручка</div><div class="v m">${rub(s.tot.sum)}</div></div>
      <div class="kpi"><div class="l">Чеков</div><div class="v">${nm(s.tot.checks)}</div></div>
      <div class="kpi"><div class="l">Средний чек</div><div class="v">${rub(s.avg)}</div></div>
      <div class="kpi"><div class="l">Касс в отчёте</div><div class="v">${s.kassas}</div></div>
    </div>
    <div class="card flush"><h3 style="padding:10px 14px 0">${esc(s.levelLabel)}</h3>${s.rows.length ? `<table><tr><th>${s.levelLabel === 'Дни' ? 'День' : 'Название'}</th><th></th><th class="r">Чеков</th><th class="r">Средний чек</th><th class="r">Выручка</th></tr>${s.rows.map(r => `<tr><td>${esc(r.name)}</td><td style="width:26%"><div class="bar" style="grid-template-columns:1fr"><span class="t"><i style="width:${r.sum / max * 100}%"></i></span></div></td><td class="r num">${nm(r.checks)}</td><td class="r num">${rub(r.avg)}</td><td class="r num"><b>${rub(r.sum)}</b></td></tr>`).join('')}</table>` : '<div class="empty">Нет данных</div>'}</div>
    <div class="grid2">
      <div class="card"><h3>Способы оплаты</h3><div class="bars">${pay.map(([l, v, c]) => `<div class="bar"><span>${l}</span><span class="t"><i style="width:${v / Math.max(1, s.tot.sum) * 100}%;background:var(${c})"></i></span><span class="vl num">${nm(v / Math.max(1, s.tot.sum) * 100)}%</span></div>`).join('')}</div></div>
      <div class="card flush"><h3 style="padding:10px 14px 0">Популярные позиции</h3><table><tr><th>Позиция</th><th class="r">Шт.</th><th class="r">Сумма</th></tr>${s.top.map(t => `<tr><td>${esc(t.name)}</td><td class="r num">${nm(t.qty)}</td><td class="r num">${rub(t.sum)}</td></tr>`).join('')}</table></div>
    </div>`);
}

/* ---------- Журнал ---------- */
function pJournal() {
  const sc = scope();
  const rows = D.log.filter(e => e.org === S.org && (sc === S.org || related(e.scope, sc)));
  return withTree(`${head('Журнал изменений', '', sc)}
    <div class="card flush">${rows.length ? `<table><tr><th>Когда</th><th>Кто</th><th>Что</th><th>Где</th></tr>${rows.map(e => `<tr><td class="num muted" style="white-space:nowrap">${stamp(e.t)}</td><td>${esc(e.who)}</td><td>${esc(e.act)}</td><td class="muted">${esc(chain(e.scope).length ? chain(e.scope).slice(1).map(nameOf).join(' › ') || 'вся организация' : '—')}</td></tr>`).join('')}</table>` : '<div class="empty">Записей нет.</div>'}</div>`);
}

/* ---------- окна ---------- */
let mSave = null;
function openModal({ title, body, save, label = 'Сохранить', sheet = false, danger = false }) {
  mSave = save;
  $('#modal').innerHTML = `<div class="veil ${sheet ? 'sheet' : ''}"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="mh"><h2>${esc(title)}</h2><button class="ibtn" data-act="mclose" aria-label="Закрыть">${ico('close')}</button></div>
    <form class="mb" id="mform" autocomplete="off" novalidate>${body}</form>
    <div class="mf"><button class="btn" data-act="mclose" type="button">Отмена</button>${save ? `<button class="btn ${danger ? 'bad' : 'p'}" data-act="msave" type="button">${label}</button>` : ''}</div></div></div>`;
  const f = $('#mform input:not([type=checkbox]),#mform select'); if (f) f.focus();
}
function closeModal() { $('#modal').innerHTML = ''; mSave = null; }
function submitModal() {
  if (!mSave) return;
  if (mSave(new FormData($('#mform'))) !== false) { closeModal(); save(); render(); }
}
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2400); }
const num = v => parseFloat(String(v).replace(',', '.'));

function askName(title, value, done) {
  openModal({ title, body: `<div class="field"><label for="f-name">Название</label><input class="input" id="f-name" name="name" required value="${esc(value)}"></div>`, save: fd => { const v = String(fd.get('name')).trim(); if (!v) { toast('Введите название'); return false; } return done(v); } });
}

/* ---------- действия ---------- */
const A = {
  nav(el) { S.page = el.dataset.id; if (['menu', 'users'].includes(S.page) && S.node && typeOf(S.node) === 'kassa') S.node = hallOf(S.node); S.orgOpen = false; render(); },
  pick(el) { const id = el.dataset.id; S.node = id === S.org ? null : id; if (['menu', 'users'].includes(S.page) && S.node && typeOf(S.node) === 'kassa') S.node = hallOf(S.node); render(); },
  fold(el) { S.folded[el.dataset.id] = !S.folded[el.dataset.id]; render(); },
  orgmenu() { S.orgOpen = !S.orgOpen; render(); },
  org(el) { S.org = el.dataset.id; S.node = null; S.orgOpen = false; render(); },
  neworg() {
    S.orgOpen = false; render();
    askName('Новая организация', '', v => { const id = uid('o'); D.orgs.push({ id, name: v }); D.profiles.push({ id: uid('p'), org: id, name: 'Кассир', rights: ['sale', 'shift'] }); S.org = id; S.node = null; logAct('Создана организация «' + v + '»', id, id); });
  },
  theme() { const l = document.documentElement.dataset.theme === 'light'; if (l) delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = 'light'; try { localStorage.setItem('asoft-mgr-theme', l ? 'dark' : 'light'); } catch (_) {} render(); },
  reset() { openModal({ title: 'Сбросить демо-данные?', body: '<p class="muted">Все ваши правки в этой тестовой версии пропадут, вернётся исходный набор.</p>', label: 'Сбросить', danger: true, save: () => { resetData(); S.org = D.orgs[0].id; S.node = null; } }); },
  period(el) { S.period = el.dataset.id; render(); },
  utab(el) { S.uTab = el.dataset.id; render(); },

  /* структура */
  add(el) {
    const pid = el.dataset.id, [type, label] = CHILD_OF[typeOf(pid)];
    const auto = type === 'kassa' ? 'Касса №' + (D.nodes.filter(n => n.type === 'kassa' && n.org === S.org).reduce((m, k) => Math.max(m, parseInt(k.name.replace(/\D/g, '')) || 0), 0) + 1) : '';
    askName('Новое: ' + label.toLowerCase(), auto, v => {
      const n = { id: uid('n'), org: S.org, parent: pid, type, name: v };
      if (type === 'kassa') Object.assign(n, { last: 9999, eq: { kkt: { model: KKT_MODELS[0], fn: '', fnTill: ymd(new Date(Date.now() + 365 * 864e5)), conn: 'USB', ip: '' }, acq: { model: ACQ_MODELS[0], conn: 'LAN' }, printer: { model: 'Чековый принтер 80 мм', conn: 'USB' }, scale: { on: false, model: '', conn: 'COM' }, display: { on: false, conn: 'USB' }, sbp: true } });
      D.nodes.push(n); S.node = n.id; logAct(`Создан${type === 'kassa' ? 'а' : ''} ${label.toLowerCase()} «${v}»`, n.id, S.org);
    });
  },
  rename(el) {
    const id = el.dataset.id, o = orgById(id) || nodeById(id);
    askName('Переименовать', o.name, v => { logAct(`«${o.name}» переименовано в «${v}»`, id, S.org); o.name = v; });
  },
  del(el) {
    const id = el.dataset.id, n = nodeById(id), ids = subtreeIds(id), ks = kassasUnder(id).length;
    openModal({
      title: 'Удалить «' + n.name + '»?', label: 'Удалить', danger: true,
      body: `<p class="muted">${ks ? `Вместе с ним удалятся вложенные элементы, касс: ${ks}. ` : ''}Меню, заданное на этом уровне, тоже удалится. Действие нельзя отменить.</p>`,
      save: () => {
        const parent = n.parent; logAct(`Удалено «${n.name}»`, parent, S.org);
        const itemIds = D.items.filter(i => ids.includes(i.scope)).map(i => i.id);
        D.nodes = D.nodes.filter(x => !ids.includes(x.id));
        D.items = D.items.filter(i => !ids.includes(i.scope));
        D.over = D.over.filter(o => !ids.includes(o.scope) && !itemIds.includes(o.item));
        D.users.forEach(u => { u.access = u.access.filter(a => !ids.includes(a)); });
        S.node = parent === S.org ? null : parent;
      },
    });
  },

  /* меню */
  'item-add'() {
    const sc = scopeForMenu();
    openModal({ title: 'Новая позиция', body: itemForm(null, true), save: fd => {
      const name = String(fd.get('name')).trim(), price = num(fd.get('price'));
      if (!name || !(price >= 0)) { toast('Введите название и цену'); return false; }
      D.items.push({ id: uid('i'), scope: sc, name, section: fd.get('section'), price });
      logAct(`Добавлена позиция «${name}» (${rub(price)})`, sc, S.org);
    } });
  },
  'item-edit'(el) {
    const sc = scopeForMenu(), id = el.dataset.id, row = effectiveMenu(sc).find(r => r.item.id === id), it = row.item, own = row.from === sc;
    openModal({ title: 'Позиция «' + it.name + '»', body: itemForm(row, false), save: fd => {
      const price = num(fd.get('price'));
      if (!(price >= 0)) { toast('Введите цену'); return false; }
      if (own) {
        const name = String(fd.get('name')).trim(); if (!name) { toast('Введите название'); return false; }
        it.name = name; it.section = fd.get('section'); it.price = price;
      } else {
        const base = effectiveMenu(sc, sc).find(r => r.item.id === id).price;
        setOver(sc, id, { price: price === base ? undefined : price });
      }
      logAct(`Цена «${it.name}» → ${rub(price)}`, sc, S.org);
    } });
  },
  'item-hide'(el) { const sc = scopeForMenu(), id = el.dataset.id, it = D.items.find(i => i.id === id); setOver(sc, id, { hidden: true }); logAct(`Позиция «${it.name}» скрыта`, sc, S.org); save(); render(); },
  'item-show'(el) { const sc = scopeForMenu(), id = el.dataset.id, it = D.items.find(i => i.id === id), r = effectiveMenu(sc).find(r => r.item.id === id); setOver(sc, id, { hidden: r.hiddenFrom === sc ? undefined : false }); logAct(`Позиция «${it.name}» снова на кассах`, sc, S.org); save(); render(); },
  'item-reset'(el) { const sc = scopeForMenu(), id = el.dataset.id, it = D.items.find(i => i.id === id); D.over = D.over.filter(o => !(o.scope === sc && o.item === id)); logAct(`«${it.name}»: правки уровня «${nameOf(sc)}» сброшены`, sc, S.org); save(); render(); },
  'item-del'(el) {
    const sc = scopeForMenu(), id = el.dataset.id, it = D.items.find(i => i.id === id);
    openModal({ title: 'Удалить «' + it.name + '»?', label: 'Удалить', danger: true, body: '<p class="muted">Позиция пропадёт на всех кассах ниже по структуре.</p>', save: () => { D.items = D.items.filter(i => i.id !== id); D.over = D.over.filter(o => o.item !== id); logAct(`Удалена позиция «${it.name}»`, sc, S.org); } });
  },

  /* пользователи */
  'user-add'() {
    const sc = hallOf(scope()), t = typeOf(sc), u = { name: '', pin: '', profile: (D.profiles.find(p => p.org === S.org) || {}).id, access: ['unit', 'hall'].includes(t) ? [sc] : [] };
    openModal({ title: 'Новый пользователь', body: userForm(u), save: fd => saveUser(fd, null) });
  },
  'user-edit'(el) { const u = D.users.find(u => u.id === el.dataset.id); openModal({ title: u.name, body: userForm(u), save: fd => saveUser(fd, u) }); },
  'user-del'(el) { const u = D.users.find(u => u.id === el.dataset.id); openModal({ title: 'Удалить «' + u.name + '»?', label: 'Удалить', danger: true, body: '<p class="muted">Он больше не сможет войти ни на одну кассу.</p>', save: () => { D.users = D.users.filter(x => x !== u); logAct(`Удалён пользователь «${u.name}»`, S.org, S.org); } }); },
  'prof-add'() { openModal({ title: 'Новый профиль', body: profForm({ name: '', rights: ['sale'] }), save: fd => saveProf(fd, null) }); },
  'prof-edit'(el) { const p = D.profiles.find(p => p.id === el.dataset.id); openModal({ title: 'Профиль «' + p.name + '»', body: profForm(p), save: fd => saveProf(fd, p) }); },
  'prof-del'(el) {
    const p = D.profiles.find(p => p.id === el.dataset.id), used = D.users.filter(u => u.profile === p.id).length;
    if (used) { toast(`Профиль назначен ${used} польз., сначала смените им профиль`); return; }
    openModal({ title: 'Удалить профиль «' + p.name + '»?', label: 'Удалить', danger: true, body: '<p class="muted">Профиль никому не назначен.</p>', save: () => { D.profiles = D.profiles.filter(x => x !== p); logAct(`Удалён профиль «${p.name}»`, S.org, S.org); } });
  },

  /* кассы */
  'kassa-open'(el) {
    const k = nodeById(el.dataset.id);
    openModal({ title: k.name + ' · ' + nameOf(k.parent), sheet: true, body: kassaForm(k), save: fd => {
      const g = n => String(fd.get(n) ?? '').trim(), e = k.eq;
      Object.assign(e.kkt, { model: g('kkt_model'), conn: g('kkt_conn'), fn: g('kkt_fn'), fnTill: g('kkt_till') || e.kkt.fnTill, ip: g('kkt_ip') });
      Object.assign(e.acq, { model: g('acq_model'), conn: g('acq_conn') });
      Object.assign(e.printer, { model: g('prn_model'), conn: g('prn_conn') });
      Object.assign(e.scale, { on: fd.has('scale_on'), model: g('scale_model'), conn: g('scale_conn') });
      e.display.on = fd.has('disp_on'); e.sbp = fd.has('sbp');
      logAct(`${k.name}: изменены настройки оборудования`, k.id, S.org);
      toast('Сохранено. Касса применит настройки при ближайшей связи');
    } });
  },

  export() {
    const sc = scope(), s = salesFor(sc, S.period), p = PERIODS.find(x => x[0] === S.period)[1];
    const lines = [[s.levelLabel === 'Дни' ? 'День' : 'Название', 'Чеков', 'Средний чек', 'Выручка'], ...s.rows.map(r => [r.name, r.checks, Math.round(r.avg), Math.round(r.sum)]), ['Итого', s.tot.checks, Math.round(s.avg), Math.round(s.tot.sum)]];
    const csv = '﻿' + lines.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = `otchet-${nameOf(sc)}-${p}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Отчёт скачан');
  },

  mclose() { closeModal(); },
  msave() { submitModal(); },
};

function saveUser(fd, u) {
  const name = String(fd.get('name')).trim(), pin = String(fd.get('pin')).trim(), access = fd.getAll('acc');
  if (!name) { toast('Введите имя'); return false; }
  if (!/^\d{4}$/.test(pin)) { toast('PIN — ровно 4 цифры'); return false; }
  if (!access.length) { toast('Выберите, где пользователь может работать'); return false; }
  if (D.users.some(x => x !== u && x.org === S.org && x.pin === pin)) { toast('Такой PIN уже занят'); return false; }
  if (u) { Object.assign(u, { name, pin, profile: fd.get('profile'), access }); logAct(`Изменён пользователь «${name}»`, access[0], S.org); }
  else { D.users.push({ id: uid('us'), org: S.org, name, pin, profile: fd.get('profile'), access }); logAct(`Добавлен пользователь «${name}»`, access[0], S.org); }
}
function profForm(p) {
  return `<div class="field"><label for="f-name">Название профиля</label><input class="input" id="f-name" name="name" required value="${esc(p.name)}"></div>
    <div class="field"><span class="lbl">Права</span><div class="checks">${RIGHTS.map(([k, l]) => `<label class="chk"><input type="checkbox" name="r" value="${k}" ${p.rights.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>`;
}
function saveProf(fd, p) {
  const name = String(fd.get('name')).trim(), rights = fd.getAll('r');
  if (!name) { toast('Введите название'); return false; }
  if (p) { p.name = name; p.rights = rights; logAct(`Изменён профиль «${name}»`, S.org, S.org); }
  else { D.profiles.push({ id: uid('p'), org: S.org, name, rights }); logAct(`Создан профиль «${name}»`, S.org, S.org); }
}

/* ---------- события ---------- */
document.addEventListener('click', e => {
  if (e.target.classList.contains('veil')) { closeModal(); return; }
  if (S.orgOpen && !e.target.closest('.orgsw')) { S.orgOpen = false; render(); }
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act]) A[el.dataset.act](el);
});
document.addEventListener('submit', e => { if (e.target.id === 'mform') { e.preventDefault(); submitModal(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#modal').firstChild) closeModal(); else if (S.orgOpen) { S.orgOpen = false; render(); } }
  if (e.key === 'Enter' && $('#mform') && e.target.matches('#mform input:not([type=checkbox])')) { e.preventDefault(); submitModal(); }
});

render();
