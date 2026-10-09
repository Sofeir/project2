/* =============================================================================
   ВИРТУАЛЬНАЯ КЛАВИАТУРА
   -----------------------------------------------------------------------------
   Единый компонент на всё приложение: любое текстовое поле получает клавиатуру
   автоматически, без отдельного кода на каждом экране.

   Ключевое решение — клавиатура не всплывает поверх интерфейса, а занимает
   в нём место, и делает это по-разному в зависимости от контекста:

   • поле внутри рабочего экрана  → клавиатура встраивается в ту колонку,
     которой принадлежит поле (витрина сжимается, чек и итог остаются целыми);
   • поле внутри диалога          → клавиатура прижимается к низу экрана,
     а диалог поднимается над ней и ужимается по высоте.

   Раскладка выбирается по полю: числовое поле получает цифровой блок,
   текстовое — полную русскую раскладку с переключением на латиницу.
   ============================================================================= */

const VK = (() => {

  /* --------------------------------- раскладки ---------------------------- */
  const B = k => ({ fn: k });                       // служебная клавиша

  const LAYOUTS = {
    ru: {
      cols: 12,
      rows: [
        ['/','1','2','3','4','5','6','7','8','9','0','-'],
        ['й','ц','у','к','е','н','г','ш','щ','з','х','ъ'],
        ['ф','ы','в','а','п','р','о','л','д','ж','э','ё'],
        [B('shift'),'я','ч','с','м','и','т','ь','б','ю',B('back')],
      ],
    },
    en: {
      cols: 12,
      rows: [
        ['/','1','2','3','4','5','6','7','8','9','0','-'],
        ['q','w','e','r','t','y','u','i','o','p'],
        ['a','s','d','f','g','h','j','k','l'],
        [B('shift'),'z','x','c','v','b','n','m',B('back')],
      ],
    },
    num: {
      cols: 3,
      rows: [
        ['1','2','3'],
        ['4','5','6'],
        ['7','8','9'],
        [B('clear'),'0',B('back')],
      ],
    },
  };

  const FN_LABEL = {
    shift: 'Aa', back: '⌫', clear: 'Очистить', space: 'Пробел', done: 'Готово', lang: 'ENG',
  };

  /* ---------------------------------- состояние --------------------------- */
  let el = null;            // корневой узел клавиатуры
  let target = null;        // поле, в которое печатаем
  let lang = 'ru';
  let shift = 0;            // 0 — нет, 1 — на один символ, 2 — фиксация
  let mode = 'fixed';       // fixed | inline

  const isNum = i => i.dataset.vk === 'num' || i.getAttribute('inputmode') === 'numeric';
  const layoutOf = i => isNum(i) ? 'num' : lang;
  const isOpen = () => !!target;

  /* ------------------------------- построение ----------------------------- */
  function build() {
    el = document.createElement('div');
    el.id = 'vk';
    el.className = 'vk';
    /* нажатие по клавиатуре не должно уводить фокус из поля */
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (b) press(b.dataset.k);
    });
  }

  function keyHTML(k, wide) {
    if (typeof k === 'string') {
      const ch = shift && /[а-яёa-z]/.test(k) ? k.toUpperCase() : k;
      return `<button class="vk-key" data-k="${k}">${ch}</button>`;
    }
    const f = k.fn;
    const cls = ['vk-key', 'fn', f === 'shift' && shift ? 'on' : '', f === 'back' ? 'bk' : '', wide || 'w15'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-k="${f}">${FN_LABEL[f]}</button>`;
  }

  function render() {
    const name = layoutOf(target);
    const L = LAYOUTS[name];
    el.dataset.lay = name;
    el.style.setProperty('--vk-cols', L.cols);

    /* Поле может попросить символ, которого нет в раскладке: например, номеру
       документа-основания нужна дробь. Такие клавиши встают в ряд цифр —
       он короче остальных, и место там есть. */
    const extra = (target.dataset.vkExtra || '').split('').filter(Boolean)
      .filter(ch => name === 'num' || !L.rows.some(r => r.includes(ch)));   // «/» уже есть в раскладке
    const num = name === 'num';
    /* У цифрового блока все ряды ровно по три клавиши: дополнительный символ
       (запятая) встаёт слева от нуля, а «Очистить» переезжает к «Готово». */
    const numExtra = num && extra.length > 0;
    const src = numExtra
      ? L.rows.slice(0, 3).concat([[extra[0], '0', B('back')]])
      : L.rows.map((r, i) => (i === 0 && extra.length ? r.concat(extra) : r));
    const rows = src
      .map(r => `<div class="vk-row">${r.map(k => keyHTML(k, num ? 'w1' : '')).join('')}</div>`).join('');

    const bottom = num
      ? `<div class="vk-row vk-bottom">
           ${numExtra ? '<button class="vk-key fn" data-k="clear">Очистить</button>' : ''}
           <button class="vk-key done" data-k="done">Готово</button>
         </div>`
      : `<div class="vk-row vk-bottom">
           <button class="vk-key fn" data-k="lang">${lang === 'ru' ? 'ENG' : 'РУС'}</button>
           <button class="vk-key pt" data-k=".">.</button>
           <button class="vk-key pt" data-k=",">,</button>
           <button class="vk-key space" data-k="space">Пробел</button>
           <button class="vk-key fn" data-k="clear">Очистить</button>
           <button class="vk-key done" data-k="done">Готово</button>
         </div>`;

    el.innerHTML = `<div class="vk-inner">${rows}${bottom}</div>`;
  }

  /* --------------------------------- ввод --------------------------------- */
  function fire() { target.dispatchEvent(new Event('input', { bubbles: true })); }

  function insert(txt) {
    const max = target.maxLength;
    if (max > 0 && target.value.length + txt.length > max) return;
    const s = target.selectionStart ?? target.value.length;
    const e = target.selectionEnd ?? s;
    target.value = target.value.slice(0, s) + txt + target.value.slice(e);
    const p = s + txt.length;
    try { target.setSelectionRange(p, p); } catch (_) {}
    fire();
  }

  function backspace() {
    const s = target.selectionStart ?? target.value.length;
    const e = target.selectionEnd ?? s;
    if (s === e) {
      if (!s) return;
      target.value = target.value.slice(0, s - 1) + target.value.slice(s);
      try { target.setSelectionRange(s - 1, s - 1); } catch (_) {}
    } else {
      target.value = target.value.slice(0, s) + target.value.slice(e);
      try { target.setSelectionRange(s, s); } catch (_) {}
    }
    fire();
  }

  function press(k) {
    if (!target) return;
    if (!target.isConnected || !target.offsetParent) { close(); return; }

    if (k === 'back')  return backspace();
    if (k === 'space') return insert(' ');
    if (k === 'clear') { target.value = ''; fire(); return; }
    if (k === 'lang')  { lang = lang === 'ru' ? 'en' : 'ru'; shift = 0; render(); return; }
    if (k === 'shift') { shift = shift === 1 ? 2 : shift === 2 ? 0 : 1; render(); return; }
    if (k === 'done')  { done(); return; }

    insert(shift && /[а-яёa-z]/.test(k) ? k.toUpperCase() : k);
    if (shift === 1) { shift = 0; render(); }
  }

  /* «Готово» закрывает ввод. Для полей формы дополнительно подтверждает
     значение — там Enter означает «сохранить», а в поиске это привело бы
     к неожиданному действию, поэтому включается только по атрибуту. */
  function done() {
    const t = target;
    const submit = t.dataset.vkEnter === 'submit';
    close();
    if (submit) t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  /* ------------------------------ открыть/закрыть -------------------------- */
  function open(input) {
    if (!el) build();
    if (target === input && el.isConnected) return;

    target = input;
    shift = 0;

    const veil = input.closest('.veil');
    mode = veil ? 'fixed' : 'inline';
    el.dataset.mode = mode;

    render();

    const host = mode === 'inline'
      ? (input.closest('[data-vk-host]') || document.body)
      : document.body;
    host.appendChild(el);

    document.body.classList.add('vk-open');
    document.body.classList.toggle('vk-fixed', mode === 'fixed');

    requestAnimationFrame(measure);
  }

  function close() {
    if (!target) return;
    const was = target;
    target = null;
    if (el && el.isConnected) el.remove();
    document.body.classList.remove('vk-open', 'vk-fixed');
    document.body.style.removeProperty('--vk-h');
    const cat = document.querySelector('[data-vk-host]');
    if (cat) cat.style.removeProperty('--sr-max');
    /* поле, которому клавиатура больше не нужна, узнаёт об этом (например, поиск очищается) */
    document.dispatchEvent(new CustomEvent('vk:close', { detail: { target: was } }));
  }

  /* фактическая высота — в переменную: по ней сдвигаются диалоги и уведомления */
  function measure() {
    if (!isOpen() || !el.isConnected) return;
    const h = Math.round(el.getBoundingClientRect().height);
    document.body.style.setProperty('--vk-h', h + 'px');

    /* выпадающий список результатов не должен уезжать под клавиатуру */
    const host = document.querySelector('[data-vk-host]');
    if (host && mode === 'inline' && target) {
      const space = el.getBoundingClientRect().top - target.getBoundingClientRect().bottom - 24;
      host.style.setProperty('--sr-max', Math.max(150, Math.round(space)) + 'px');
    }

    /* диалог ужался над клавиатурой — поле, в которое печатают, должно остаться видно */
    if (mode === 'fixed' && target) setTimeout(() => target && target.scrollIntoView({ block: 'nearest' }), 80);
  }

  /* ------------------------------- подключение ---------------------------- */
  const editable = i =>
    i && i.tagName === 'INPUT' && i.type === 'text' && i.dataset.vk !== 'off' && !i.disabled;

  document.addEventListener('focusin', e => { if (editable(e.target)) open(e.target); });

  /* касание по полю: открывает клавиатуру, а если она уже открыта для
     другого поля — переносит ввод на новое (open сам отсеет повтор) */
  document.addEventListener('click', e => {
    const i = e.target.closest('input');
    if (editable(i)) open(i);
  });

  /* касание мимо поля, списка результатов и самой клавиатуры — закрываем */
  document.addEventListener('mousedown', e => {
    if (!isOpen()) return;
    if (e.target.closest('#vk, .search-field, .pick-search, .field, .cl, .search-res')) return;
    close();
  });

  window.addEventListener('resize', measure);

  return {
    open, close, isOpen,
    /* вызывается при закрытии диалога: клавиатура не должна пережить своё поле */
    closeIfInside(node) { if (target && node && node.contains(target)) close(); },
  };
})();
