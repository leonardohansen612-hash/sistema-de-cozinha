const BASE = 'https://data.saipos.io/v1';

function authHeaders(token, mode = 'raw') {
  return {
    Authorization: mode === 'bearer' ? `Bearer ${token}` : token,
    Accept: 'application/json'
  };
}

function collectSaleItems(obj, out = []) {
  if (Array.isArray(obj)) {
    obj.forEach(x => collectSaleItems(x, out));
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;

  // Formato oficial do endpoint /sales_items:
  // cada venda possui um array "items"; cada item usa desc_sale_item + quantity.
  if (Array.isArray(obj.items)) {
    for (const item of obj.items) {
      if (!item || typeof item !== 'object') continue;

      // Item removido/deletado não deve baixar estoque.
      const deleted = item.deleted === true ||
                      item.deleted === 1 ||
                      String(item.deleted || '').toUpperCase() === 'Y';

      const name =
        item.desc_sale_item ||
        item.desc_store_item ||
        item.item_name ||
        item.name ||
        item.description ||
        item.product_name;

      const qty = item.quantity ?? item.qty ?? item.amount ?? item.item_quantity;

      if (!deleted && name && Number.isFinite(Number(qty)) && Number(qty) > 0) {
        out.push({
          name: String(name).trim(),
          quantity: Number(qty),
          id_sale_item: item.id_sale_item ?? null,
          id_store_item: item.id_store_item ?? null
        });
      }
    }
  }

  // Procura outros envelopes da resposta, mas evita reprocessar "items".
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'items') continue;
    if (value && typeof value === 'object') collectSaleItems(value, out);
  }

  return out;
}

export default async function handler(req, res) {
  try {
    const token = process.env.SAIPOS_API_TOKEN;
    if (!token) {
      return res.status(500).json({
        error: 'SAIPOS_API_TOKEN não configurado no Render.'
      });
    }

    const date = req.query.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return res.status(400).json({ error: 'Data inválida. Use YYYY-MM-DD.' });
    }

    const mode = process.env.SAIPOS_AUTH_MODE || 'raw';

    // A documentação oficial exige estes parâmetros.
    // Usamos shift_date porque representa o turno operacional da Saipos.
    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;

    const params = new URLSearchParams({
      p_date_column_filter: 'shift_date',
      p_filter_date_start: start,
      p_filter_date_end: end,
      p_limit: '1000',
      p_offset: '0'
    });

    const url = `${BASE}/sales_items?${params.toString()}`;

    let r = await fetch(url, { headers: authHeaders(token, mode) });

    // Mantém o fallback que já usamos caso o token espere Bearer.
    if (r.status === 401 && mode === 'raw') {
      r = await fetch(url, { headers: authHeaders(token, 'bearer') });
    }

    const text = await r.text();

    if (!r.ok) {
      return res.status(r.status).json({
        error: `Saipos respondeu HTTP ${r.status}.`,
        detail: text.slice(0, 1000)
      });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: 'A Saipos respondeu, mas o retorno não veio em JSON.',
        detail: text.slice(0, 1000)
      });
    }

    const raw = collectSaleItems(json, []);

    if (!raw.length) {
      return res.status(200).json({
        date,
        items: [],
        totalItems: 0,
        message: 'Consulta realizada com sucesso, mas nenhum item vendido foi encontrado para este turno.',
        source: '/sales_items',
        debugTopLevelKeys: json && typeof json === 'object' ? Object.keys(json).slice(0, 20) : []
      });
    }

    // Agrupa itens iguais para o front receber "produto + quantidade vendida".
    const grouped = new Map();
    for (const x of raw) {
      const current = grouped.get(x.name) || 0;
      grouped.set(x.name, current + x.quantity);
    }

    const items = [...grouped.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    return res.status(200).json({
      date,
      items,
      totalItems: raw.reduce((sum, x) => sum + x.quantity, 0),
      uniqueItems: items.length,
      source: '/sales_items',
      filter: 'shift_date'
    });

  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Erro interno ao consultar a Saipos.'
    });
  }
}
