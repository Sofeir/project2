/* =============================================================================
   КЛИЕНТ API
   Единственное место, где интерфейс общается с сервером. Все операции,
   меняющие смену, возвращают её полный снимок — интерфейсу не нужно
   догадываться, что изменилось, он просто применяет ответ.
   ============================================================================= */

const API = (() => {

  async function req(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) {
      throw new Error('Нет связи с сервером кассы');
    }

    let data = null;
    try { data = await res.json(); } catch (_) { /* пустой ответ */ }

    if (!res.ok) throw new Error(data?.error || `Сервер ответил ${res.status}`);
    return data;
  }

  return {
    catalog:     ()   => req('GET',    '/api/catalog'),
    state:       ()   => req('GET',    '/api/state'),

    sale:        p    => req('POST',   '/api/checks', { kind: 'sale', ...p }),
    refund:      no   => req('POST',   '/api/checks', { kind: 'return', sourceNumber: no }),

    cash:        p    => req('POST',   '/api/cash', p),

    park:        p    => req('POST',   '/api/parked', p),
    unpark:      id   => req('DELETE', `/api/parked/${id}`),

    closeShift:  cash => req('POST',   '/api/shift/close', { countedCash: cash }),

    hotkeys:     ()    => req('GET',   '/api/hotkeys'),
    saveHotkeys: items => req('PUT',   '/api/hotkeys', { items }),
  };
})();
