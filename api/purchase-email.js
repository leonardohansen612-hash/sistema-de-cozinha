const RESEND_URL = 'https://api.resend.com/emails';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const fmt = n => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function table(title, items) {
  if (!items?.length) return `<h2 style="font-size:18px;margin:24px 0 8px">${esc(title)}</h2><p>Nenhum item necessário.</p>`;
  return `<h2 style="font-size:18px;margin:24px 0 8px">${esc(title)} · ${items.length} itens</h2>
  <table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
    <thead><tr style="background:#f1efe9"><th style="text-align:left;padding:8px;border:1px solid #ddd">Produto</th><th style="text-align:right;padding:8px;border:1px solid #ddd">Atual</th><th style="text-align:right;padding:8px;border:1px solid #ddd">Mínimo</th><th style="text-align:right;padding:8px;border:1px solid #ddd">Alvo</th><th style="text-align:right;padding:8px;border:1px solid #ddd">Repor</th></tr></thead>
    <tbody>${items.map(i=>`<tr><td style="padding:8px;border:1px solid #ddd"><strong>${esc(i.name)}</strong></td><td style="text-align:right;padding:8px;border:1px solid #ddd">${fmt(i.current)} ${esc(i.unit)}</td><td style="text-align:right;padding:8px;border:1px solid #ddd">${fmt(i.minimum)} ${esc(i.unit)}</td><td style="text-align:right;padding:8px;border:1px solid #ddd">${fmt(i.target)} ${esc(i.unit)}</td><td style="text-align:right;padding:8px;border:1px solid #ddd"><strong>${fmt(i.needed)} ${esc(i.unit)}</strong></td></tr>`).join('')}</tbody>
  </table>`;
}

export default async function purchaseEmailHandler(req, res) {
  try {
    if (req.method && req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

    const apiKey = process.env.RESEND_API_KEY;
    const to = process.env.PURCHASE_EMAIL;
    const from = process.env.FROM_EMAIL || 'Tex Estoque <onboarding@resend.dev>';
    if (!apiKey || !to) return res.status(503).json({ error: 'E-mail não configurado. Defina RESEND_API_KEY e PURCHASE_EMAIL no Render.' });

    const { date, purchase = [], production = [], automatic = false } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Data inválida.' });
    if (!Array.isArray(purchase) || !Array.isArray(production)) return res.status(400).json({ error: 'Lista inválida.' });

    const brDate = date.split('-').reverse().join('/');
    const total = purchase.length + production.length;
    const html = `<div style="max-width:760px;margin:auto;font-family:Arial,sans-serif;color:#1c1c1b">
      <h1 style="font-size:24px;margin-bottom:5px">Tex Estoque · Fechamento ${esc(brDate)}</h1>
      <p style="color:#666;margin-top:0">${automatic ? 'Gerado automaticamente após a baixa das vendas da Saipos.' : 'Lista gerada manualmente pelo painel de estoque.'}</p>
      <div style="padding:12px 14px;background:#f5f2ea;border-radius:8px"><strong>${total}</strong> itens precisam de reposição para retornar ao estoque alvo.</div>
      ${table('Lista de compras', purchase)}
      ${table('Lista de produção', production)}
      <p style="font-size:11px;color:#777;margin-top:28px">Estoque mínimo: referência semanal definida no Tex Estoque. Quantidade “Repor” leva o saldo até o estoque alvo.</p>
    </div>`;

    const rr = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `tex-estoque-${date}-${automatic ? 'fechamento' : 'manual'}`
      },
      body: JSON.stringify({ from, to: [to], subject: `Tex Estoque · Lista de reposição · ${brDate}`, html })
    });
    const text = await rr.text();
    let data = {}; try { data = JSON.parse(text); } catch {}
    if (!rr.ok) return res.status(502).json({ error: data.message || `Resend respondeu HTTP ${rr.status}.`, detail: text.slice(0, 500) });
    return res.status(200).json({ ok: true, to, id: data.id || null, purchaseCount: purchase.length, productionCount: production.length });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Erro interno ao enviar e-mail.' });
  }
}
