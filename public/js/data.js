/* =============================================================================
   СПРАВОЧНИКИ КАССЫ
   Номенклатура живёт в хранилище браузера (js/api.js), а этот файл только
   держит её в памяти страницы и заполняется при загрузке ответом API.catalog(). Имена переменных сохранены — остальной код
   продолжает работать с ними как прежде.
   ============================================================================= */

let CATEGORIES = [];
let PRODUCTS   = [];
let DISCOUNTS  = [{ id: 'none', name: 'Без скидки', percent: 0 }];

/* PIN и рабочее место остаются на стороне терминала: это настройка кассы,
   а не данные номенклатуры. Номер кассы уточняется из открытой смены. */
const CASHIER = { pin: '1234', register: 13, name: 'Смирнова Е. В.' };
const SHIFT   = { number: 0, openedAt: '--:--', openingCash: 0 };

function applyCatalog(data) {
  CATEGORIES = data.categories;
  PRODUCTS = data.products.map(p => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    unit: p.unit,
    cat: p.cat,
    hit: !!p.hit,
    weight: !!p.weight,
  }));
  /* «Без скидки» — это отсутствие записи в хранилище, в списке она нужна как способ снять скидку */
  DISCOUNTS = [{ id: 'none', name: 'Без скидки', percent: 0 }].concat(
    data.discounts.map(d => ({ id: d.id, name: d.name, percent: Number(d.percent) }))
  );
}
