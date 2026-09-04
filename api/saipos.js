
const BASE='https://data.saipos.io/v1';
function authHeaders(token,mode='raw'){return {Authorization:mode==='bearer'?`Bearer ${token}`:token,Accept:'application/json'};}
function flattenCandidates(obj,out=[]){
  if(Array.isArray(obj)){obj.forEach(x=>flattenCandidates(x,out));return out}
  if(!obj||typeof obj!=='object')return out;
  const name=obj.item_name||obj.name||obj.description||obj.product_name||obj.sale_item_name||obj.item_description;
  const qty=obj.quantity??obj.qty??obj.amount??obj.item_quantity;
  if(name && Number.isFinite(Number(qty))) out.push({name:String(name).trim(),quantity:Number(qty)});
  Object.values(obj).forEach(v=>{if(v&&typeof v==='object')flattenCandidates(v,out)});
  return out;
}
export default async function handler(req,res){
  try{
    const token=process.env.SAIPOS_API_TOKEN;
    if(!token) return res.status(500).json({error:'SAIPOS_API_TOKEN não configurado'});
    const date=req.query.date;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')) return res.status(400).json({error:'Data inválida'});
    const mode=process.env.SAIPOS_AUTH_MODE||'raw';
    const attempts=[
      `/sales_items?shift_date=${encodeURIComponent(date)}`,
      `/sales_items?initial_date=${encodeURIComponent(date)}&final_date=${encodeURIComponent(date)}`,
      `/sales_items?start_date=${encodeURIComponent(date)}&end_date=${encodeURIComponent(date)}`
    ];
    let last='';
    for(const path of attempts){
      let r=await fetch(BASE+path,{headers:authHeaders(token,mode)});
      if(r.status===401&&mode==='raw') r=await fetch(BASE+path,{headers:authHeaders(token,'bearer')});
      const text=await r.text(); last=text;
      if(!r.ok) continue;
      let json; try{json=JSON.parse(text)}catch{continue}
      const raw=flattenCandidates(json,[]);
      if(!raw.length) continue;
      const grouped=new Map();
      raw.forEach(x=>grouped.set(x.name,(grouped.get(x.name)||0)+x.quantity));
      return res.status(200).json({date,items:[...grouped.entries()].map(([name,quantity])=>({name,quantity})),source:path});
    }
    return res.status(502).json({error:'A Saipos respondeu, mas a V1 não reconheceu itens no formato retornado.',detail:last.slice(0,500)});
  }catch(err){return res.status(500).json({error:err.message||'Erro interno'});}
}
