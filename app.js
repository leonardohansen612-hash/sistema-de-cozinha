
const DATA = window.TEX_DATA;
const $ = s => document.querySelector(s);
const fmtQty = (v,u) => `${Number(v||0).toLocaleString('pt-BR',{maximumFractionDigits:2})} ${u}`;
const nowISO = () => new Date().toISOString();
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const normalize = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/\s+/g,' ');

let state = {
  inventory: [],
  movements: [],
  syncs: [],
  settings: { initialized:false },
  view:'dashboard',
  search:'',
  filter:'Todos'
};

let cloud = null;

function seedLocal() {
  const saved = localStorage.getItem('texEstoqueV1');
  if(saved){
    try { state = {...state,...JSON.parse(saved)}; } catch(e){}
  }
  if(!state.inventory?.length){
    state.inventory = DATA.inventory.map(x=>({...x,current:0,target:x.target||Math.ceil(x.minimum*1.5)}));
  }
  saveLocal();
}
function saveLocal(){ localStorage.setItem('texEstoqueV1',JSON.stringify({
  inventory:state.inventory,movements:state.movements.slice(0,1000),syncs:state.syncs.slice(0,100),settings:state.settings
})); }

async function initCloud(){
  const cfg=window.FIREBASE_CONFIG;
  if(!cfg || !cfg.projectId){ $('#storageMode').textContent='Modo local'; return; }
  try{
    const [{initializeApp},{getFirestore,collection,doc,getDocs,setDoc,addDoc,onSnapshot,writeBatch,serverTimestamp}] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
    ]);
    const app=initializeApp(cfg), db=getFirestore(app);
    cloud={db,collection,doc,getDocs,setDoc,addDoc,onSnapshot,writeBatch,serverTimestamp};
    const snap=await getDocs(collection(db,'inventory'));
    if(snap.empty){
      const batch=writeBatch(db);
      state.inventory.forEach(i=>batch.set(doc(db,'inventory',i.code),i));
      await batch.commit();
    }
    onSnapshot(collection(db,'inventory'), s=>{
      state.inventory=s.docs.map(d=>d.data()).sort((a,b)=>a.code.localeCompare(b.code)); saveLocal(); render();
    });
    onSnapshot(collection(db,'movements'), s=>{
      state.movements=s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,1000); saveLocal(); render();
    });
    $('#storageMode').textContent='Firebase conectado';
  }catch(err){
    console.error(err); $('#storageMode').textContent='Firebase indisponível · local';
    toast('Firebase não conectou. O sistema continua em modo local.');
  }
}
async function saveItem(item){
  const ix=state.inventory.findIndex(x=>x.code===item.code);
  if(ix>=0) state.inventory[ix]=item; else state.inventory.push(item);
  saveLocal();
  if(cloud) await cloud.setDoc(cloud.doc(cloud.db,'inventory',item.code),item,{merge:true});
}
async function addMovement(m){
  const movement={id:uid(),createdAt:nowISO(),...m};
  state.movements.unshift(movement); saveLocal();
  if(cloud) await cloud.addDoc(cloud.collection(cloud.db,'movements'),movement);
  return movement;
}

function statusOf(i){
  const cur=Number(i.current||0), min=Number(i.minimum||0);
  if(cur<=0) return {key:'bad',label:'ZERADO'};
  if(cur<min) return {key:'bad',label:'CRÍTICO'};
  if(cur<min*1.25) return {key:'warn',label:'BAIXO'};
  return {key:'ok',label:'OK'};
}
function needQty(i){ return Math.max(0,Number(i.target||i.minimum*1.5)-Number(i.current||0)); }
function replenishmentLists(){
  const needs=state.inventory.filter(i=>i.status!=='Inativo'&&Number(i.current||0)<Number(i.minimum||0)).sort((a,b)=>needQty(b)-needQty(a));
  return {
    production: needs.filter(i=>i.supplyType==='Produção'),
    purchase: needs.filter(i=>i.supplyType!=='Produção')
  };
}
function printInventory(){
  const items=state.inventory.filter(i=>i.status!=='Inativo').sort((a,b)=>(a.category||'').localeCompare(b.category||'','pt-BR')||a.name.localeCompare(b.name,'pt-BR'));
  const old=document.getElementById('printSheet'); if(old) old.remove();
  const sheet=document.createElement('section'); sheet.id='printSheet';
  const grouped={}; items.forEach(i=>{const k=i.category||'Outros';(grouped[k]??=[]).push(i)});
  sheet.innerHTML=`<div class="print-head"><div><h1>Tex Estoque · Contagem física</h1><p>Cozinha de montagem</p></div><div><strong>Data:</strong> ${new Date().toLocaleDateString('pt-BR')}<br><strong>Responsável:</strong> ____________________</div></div>
    ${Object.entries(grouped).map(([cat,arr])=>`<h2>${cat}</h2><table><thead><tr><th>Produto</th><th>Un.</th><th>Sistema</th><th>Contagem física</th><th>Diferença</th><th>Observação</th></tr></thead><tbody>${arr.map(i=>`<tr><td>${i.name}</td><td>${i.unit}</td><td>${Number(i.current||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}</td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>`).join('')}
    <div class="print-foot">Assinatura: _________________________________________________</div>`;
  document.body.appendChild(sheet);
  window.print();
  setTimeout(()=>sheet.remove(),500);
}
async function sendReplenishmentEmail(date, automatic=false){
  const lists=replenishmentLists();
  const payload={
    date,
    automatic,
    purchase:lists.purchase.map(i=>({code:i.code,name:i.name,unit:i.unit,current:Number(i.current||0),minimum:Number(i.minimum||0),target:Number(i.target||0),needed:needQty(i)})),
    production:lists.production.map(i=>({code:i.code,name:i.name,unit:i.unit,current:Number(i.current||0),minimum:Number(i.minimum||0),target:Number(i.target||0),needed:needQty(i)}))
  };
  const r=await fetch('/api/purchase-email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||'Não foi possível enviar o e-mail.');
  return data;
}
function percent(i){ const t=Number(i.target||i.minimum*1.5)||1; return Math.max(0,Math.min(100,(Number(i.current||0)/t)*100)); }
function stats(){
  const active=state.inventory.filter(i=>i.status!=='Inativo');
  const critical=active.filter(i=>statusOf(i).key==='bad').length;
  const low=active.filter(i=>statusOf(i).key==='warn').length;
  const ok=active.filter(i=>statusOf(i).key==='ok').length;
  const replen=active.filter(i=>Number(i.current||0)<Number(i.minimum||0)).length;
  return {active,critical,low,ok,replen};
}
function render(){
  const map={
    dashboard:['Dashboard','Visão geral do estoque da cozinha'],
    estoque:['Estoque','Saldo atual, mínimo semanal e estoque alvo'],
    entrada:['Entrada / Ajuste','Lance produção, compra, perda ou inventário'],
    reposicao:['Reposição','O que precisa ser produzido ou comprado'],
    movimentos:['Movimentações','Histórico de entradas, saídas, perdas e ajustes'],
    saipos:['Saipos','Baixa automática a partir das vendas'],
    config:['Configuração','Parâmetros dos itens e integração']
  };
  $('#viewTitle').textContent=map[state.view][0]; $('#viewSubtitle').textContent=map[state.view][1];
  document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  if(state.view==='dashboard') renderDashboard();
  if(state.view==='estoque') renderStock();
  if(state.view==='entrada') renderEntry();
  if(state.view==='reposicao') renderReplenishment();
  if(state.view==='movimentos') renderMovements();
  if(state.view==='saipos') renderSaipos();
  if(state.view==='config') renderConfig();
}
function renderDashboard(){
  const s=stats();
  const crit=s.active.filter(i=>statusOf(i).key!=='ok').sort((a,b)=>(Number(a.current||0)/Math.max(1,a.minimum))-(Number(b.current||0)/Math.max(1,b.minimum))).slice(0,8);
  const recent=state.movements.slice(0,7);
  $('#content').innerHTML=`
    <div class="grid">
      <div class="card kpi"><span>Itens ativos</span><strong>${s.active.length}</strong><small>Cadastro da planilha</small></div>
      <div class="card kpi"><span>Críticos</span><strong>${s.critical}</strong><small>Abaixo do mínimo semanal</small></div>
      <div class="card kpi"><span>Baixos</span><strong>${s.low}</strong><small>Até 25% acima do mínimo</small></div>
      <div class="card kpi"><span>Reposição</span><strong>${s.replen}</strong><small>Produção ou compra necessária</small></div>
    </div>
    <div class="two">
      <div class="card"><div class="section-title"><h2>Prioridade de reposição</h2><button class="secondary" data-go="reposicao">Ver lista</button></div>
        ${crit.length?crit.map(i=>{const st=statusOf(i);return `<div class="stock-row"><div class="row-head"><div><strong>${i.name}</strong><div class="muted">${fmtQty(i.current,i.unit)} de alvo ${fmtQty(i.target,i.unit)}</div></div><span class="pill ${st.key}">${st.label}</span></div><div class="progress"><i style="width:${percent(i)}%"></i></div></div>`}).join(''):'<div class="empty">Nenhum item em alerta.</div>'}
      </div>
      <div class="card"><div class="section-title"><h2>Últimas movimentações</h2><button class="secondary" data-go="movimentos">Histórico</button></div>
        ${recent.length?recent.map(m=>`<div class="stock-row split"><div><strong>${m.itemName}</strong><div class="muted">${new Date(m.createdAt).toLocaleString('pt-BR')} · ${m.type}</div></div><strong>${m.delta>0?'+':''}${fmtQty(m.delta,m.unit)}</strong></div>`).join(''):'<div class="empty">Ainda não há movimentações.</div>'}
      </div>
    </div>`;
  bindGo();
}
function renderStock(){
  let arr=state.inventory.filter(i=>i.status!=='Inativo');
  if(state.search) arr=arr.filter(i=>normalize(i.name).includes(normalize(state.search))||normalize(i.code).includes(normalize(state.search)));
  if(state.filter!=='Todos') arr=arr.filter(i=>statusOf(i).label===state.filter);
  $('#content').innerHTML=`
    <div class="toolbar"><input id="stockSearch" placeholder="Buscar produto..." value="${state.search}"><select id="stockFilter"><option>Todos</option><option>ZERADO</option><option>CRÍTICO</option><option>BAIXO</option><option>OK</option></select><button id="printStock" class="secondary">🖨 Imprimir estoque</button></div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Produto</th><th>Tipo</th><th class="num">Atual</th><th class="num">Mínimo semanal</th><th class="num">Alvo</th><th>Status</th><th></th></tr></thead><tbody>
    ${arr.map(i=>{const st=statusOf(i);return `<tr><td><span class="code">${i.code}</span></td><td><strong>${i.name}</strong><div class="muted">${i.category}</div></td><td><span class="tag">${i.supplyType||'Compra'}</span></td><td class="num">${fmtQty(i.current,i.unit)}</td><td class="num">${fmtQty(i.minimum,i.unit)}</td><td class="num">${fmtQty(i.target,i.unit)}</td><td><span class="pill ${st.key}">${st.label}</span></td><td><button class="secondary mini-entry" data-code="${i.code}">Lançar</button></td></tr>`}).join('')}
    </tbody></table></div>`;
  $('#stockFilter').value=state.filter;
  $('#stockSearch').addEventListener('input',e=>{state.search=e.target.value;renderStock()});
  $('#stockFilter').addEventListener('change',e=>{state.filter=e.target.value;renderStock()});
  $('#printStock').addEventListener('click',printInventory);
  document.querySelectorAll('.mini-entry').forEach(b=>b.addEventListener('click',()=>openEntryModal(b.dataset.code)));
}
function entryForm(code=''){
  return `<form id="entryForm"><div class="form-grid">
    <div class="field full"><label>Produto</label><select id="entryItem" required>${state.inventory.filter(i=>i.status!=='Inativo').map(i=>`<option value="${i.code}" ${i.code===code?'selected':''}>${i.name} · ${i.code}</option>`).join('')}</select></div>
    <div class="field"><label>Tipo</label><select id="entryType"><option>ENTRADA</option><option>PERDA</option><option>AJUSTE</option></select></div>
    <div class="field"><label>Quantidade</label><input id="entryQty" type="number" step="0.01" min="0" required placeholder="0"></div>
    <div class="field full"><label>Observação</label><input id="entryNote" placeholder="Ex.: produção da manhã, compra fornecedor, quebra..."></div>
  </div><div class="callout" id="entryCurrent"></div><div class="actions"><button class="primary" type="submit">Confirmar lançamento</button></div></form>`;
}
function renderEntry(){
  $('#content').innerHTML=`<div class="card" style="max-width:760px"><div class="section-title"><h2>Novo lançamento</h2></div>${entryForm()}</div>`;
  bindEntryForm();
}
function bindEntryForm(modal=false){
  const select=$('#entryItem'), box=$('#entryCurrent');
  const refresh=()=>{const i=state.inventory.find(x=>x.code===select.value); if(i) box.textContent=`Saldo atual: ${fmtQty(i.current,i.unit)} · mínimo semanal: ${fmtQty(i.minimum,i.unit)}`};
  refresh(); select.addEventListener('change',refresh);
  $('#entryForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const i=state.inventory.find(x=>x.code===select.value); const type=$('#entryType').value; const qty=Number($('#entryQty').value);
    if(!i||!Number.isFinite(qty)||qty<0) return;
    const before=Number(i.current||0);
    let after=before, delta=0;
    if(type==='ENTRADA'){delta=qty;after=before+qty}
    if(type==='PERDA'){delta=-qty;after=Math.max(0,before-qty)}
    if(type==='AJUSTE'){after=qty;delta=after-before}
    const updated={...i,current:after,updatedAt:nowISO()};
    await saveItem(updated); await addMovement({type,itemCode:i.code,itemName:i.name,unit:i.unit,qty,before,after,delta,note:$('#entryNote').value||''});
    toast('Estoque atualizado.');
    if(modal) closeModal(); else renderEntry();
  });
}
function renderReplenishment(){
  const lists=replenishmentLists(), prod=lists.production, buy=lists.purchase;
  const section=(title,arr)=>`<div class="card"><div class="section-title"><h2>${title}</h2><span class="pill ${arr.length?'bad':'ok'}">${arr.length} itens</span></div><div class="big-list">${arr.length?arr.map(i=>`<div class="need"><div><strong>${i.name}</strong><div class="muted">${fmtQty(i.current,i.unit)} em estoque</div></div><div><span class="muted">Mínimo</span><br><strong>${fmtQty(i.minimum,i.unit)}</strong></div><div><span class="muted">Alvo</span><br><strong>${fmtQty(i.target,i.unit)}</strong></div><div><span class="muted">Repor</span><br><strong>${fmtQty(needQty(i),i.unit)}</strong></div></div>`).join(''):'<div class="empty">Nada para repor.</div>'}</div></div>`;
  $('#content').innerHTML=`<div class="toolbar"><button id="emailList" class="secondary">✉ Enviar lista por e-mail agora</button><span class="muted">No fechamento Saipos, o envio é automático se o e-mail estiver configurado no Render.</span></div><div class="two">${section('Lista de produção',prod)}${section('Lista de compras',buy)}</div>`;
  $('#emailList').addEventListener('click',async()=>{
    const b=$('#emailList'); b.disabled=true; b.textContent='Enviando…';
    try{await sendReplenishmentEmail(new Date().toISOString().slice(0,10),false);toast('Lista enviada por e-mail.');}
    catch(err){toast(err.message);}
    finally{b.disabled=false;b.textContent='✉ Enviar lista por e-mail agora';}
  });
}
function renderMovements(){
  $('#content').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th class="num">Movimento</th><th class="num">Antes</th><th class="num">Depois</th><th>Obs.</th></tr></thead><tbody>
  ${state.movements.length?state.movements.map(m=>`<tr><td>${new Date(m.createdAt).toLocaleString('pt-BR')}</td><td>${m.itemName}</td><td><span class="tag">${m.type}</span></td><td class="num">${m.delta>0?'+':''}${fmtQty(m.delta,m.unit)}</td><td class="num">${fmtQty(m.before,m.unit)}</td><td class="num">${fmtQty(m.after,m.unit)}</td><td>${m.note||''}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhuma movimentação ainda.</td></tr>'}
  </tbody></table></div>`;
}
function renderSaipos(){
  const mapped=Object.keys(DATA.saiposAliases).length, recipes=Object.keys(DATA.recipes).length;
  const incomplete=Object.entries(DATA.recipes).filter(([k,v])=>v.incomplete?.length);
  $('#content').innerHTML=`<div class="two">
    <div class="card"><div class="section-title"><h2>Sincronizar vendas</h2><span class="pill warn">V1</span></div>
      <div class="field"><label>Data da operação</label><input id="syncDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="callout">O sistema busca os itens vendidos na Saipos, converte pelas fichas técnicas e grava uma movimentação <strong>SAÍDA SAIPOS</strong> por ingrediente. A mesma data não deve ser sincronizada duas vezes.</div>
      <div class="actions"><button id="syncBtn" class="primary">Sincronizar Saipos</button><button id="dryBtn" class="secondary">Apenas conferir</button></div>
      <div id="syncResult"></div>
    </div>
    <div class="card"><div class="section-title"><h2>Mapeamento</h2></div>
      <div class="stock-row split"><span>Itens Saipos mapeados</span><strong>${mapped}</strong></div>
      <div class="stock-row split"><span>Fichas técnicas carregadas</span><strong>${recipes}</strong></div>
      <div class="stock-row split"><span>Fichas com gramagem incompleta</span><strong>${incomplete.length}</strong></div>
      <div class="callout warn">Ingredientes sem quantidade na planilha não são baixados automaticamente. Eles aparecem como aviso para você completar depois.</div>
    </div></div>`;
  $('#syncBtn').addEventListener('click',()=>runSync(false));
  $('#dryBtn').addEventListener('click',()=>runSync(true));
}
async function runSync(dryRun){
  const date=$('#syncDate').value, box=$('#syncResult');
  if(!date) return;
  if(!dryRun && state.syncs.some(s=>s.date===date&&s.applied)){box.innerHTML='<div class="callout warn">Essa data já foi aplicada. Use “Apenas conferir” se quiser revisar.</div>';return;}
  box.innerHTML='<div class="callout">Consultando a Saipos…</div>';
  try{
    const r=await fetch(`/api/saipos?date=${encodeURIComponent(date)}`);
    const payload=await r.json();
    if(!r.ok) throw new Error(payload.error||'Falha na API');
    const sales=payload.items||[];
    const usage=new Map(), warnings=[], unmapped=[];
    for(const sale of sales){
      const alias=DATA.saiposAliases[sale.name]||DATA.saiposAliases[Object.keys(DATA.saiposAliases).find(k=>normalize(k)===normalize(sale.name))];
      if(!alias){unmapped.push(`${sale.name} (${sale.quantity})`);continue;}
      const rec=DATA.recipes[alias];
      if(!rec){unmapped.push(`${sale.name} → ${alias}`);continue;}
      if(rec.incomplete?.length) warnings.push(`${alias}: faltam quantidades de ${rec.incomplete.join(', ')}`);
      rec.ingredients.forEach(x=>usage.set(x.ingredient,(usage.get(x.ingredient)||0)+(Number(x.qty)*Number(sale.quantity||0))));
    }
    const lines=[...usage.entries()].map(([name,qty])=>({name,qty,item:state.inventory.find(i=>normalize(i.name)===normalize(name))})).filter(x=>x.item);
    box.innerHTML=`<div class="callout"><strong>${sales.length}</strong> itens de venda recebidos · <strong>${lines.length}</strong> insumos com baixa calculada.</div>
      ${unmapped.length?`<div class="callout warn"><strong>Não mapeados:</strong> ${unmapped.slice(0,12).join('; ')}</div>`:''}
      ${warnings.length?`<div class="callout warn"><strong>Fichas incompletas:</strong> ${[...new Set(warnings)].slice(0,8).join('; ')}</div>`:''}
      <div class="table-wrap"><table><thead><tr><th>Ingrediente</th><th class="num">Baixa calculada</th></tr></thead><tbody>${lines.map(x=>`<tr><td>${x.name}</td><td class="num">${fmtQty(x.qty,x.item.unit)}</td></tr>`).join('')}</tbody></table></div>`;
    if(!dryRun){
      for(const x of lines){
        const i=x.item,before=Number(i.current||0),after=Math.max(0,before-x.qty),delta=after-before;
        await saveItem({...i,current:after,updatedAt:nowISO()});
        await addMovement({type:'SAÍDA SAIPOS',itemCode:i.code,itemName:i.name,unit:i.unit,qty:x.qty,before,after,delta,note:`Vendas Saipos ${date}`});
      }
      state.syncs.unshift({date,applied:true,createdAt:nowISO(),salesCount:sales.length}); saveLocal();
      toast('Baixa da Saipos aplicada.');
      try{
        const emailResult=await sendReplenishmentEmail(date,true);
        box.insertAdjacentHTML('beforeend',`<div class="callout"><strong>Fechamento concluído:</strong> lista de compras/produção enviada automaticamente para ${emailResult.to||'o e-mail configurado'}.</div>`);
      }catch(emailErr){
        box.insertAdjacentHTML('beforeend',`<div class="callout warn"><strong>Estoque baixado normalmente.</strong> O e-mail automático não foi enviado: ${emailErr.message}</div>`);
      }
    }
  }catch(err){ box.innerHTML=`<div class="callout warn"><strong>Não foi possível sincronizar:</strong> ${err.message}. Confira o token SAIPOS_API_TOKEN no Render.</div>`; }
}
function renderConfig(){
  $('#content').innerHTML=`<div class="two">
    <div class="card"><div class="section-title"><h2>Cadastro de itens</h2></div>
      <div class="callout">O mínimo atual representa aproximadamente <strong>1 semana de consumo médio + 30% de segurança</strong>. O estoque alvo da V1 foi inicializado em 150% do mínimo e pode ser alterado.</div>
      <div class="toolbar"><select id="cfgItem">${state.inventory.map(i=>`<option value="${i.code}">${i.name}</option>`).join('')}</select></div>
      <form id="cfgForm"><div class="form-grid">
        <div class="field"><label>Estoque mínimo</label><input id="cfgMin" type="number" step="0.01"></div>
        <div class="field"><label>Estoque alvo</label><input id="cfgTarget" type="number" step="0.01"></div>
        <div class="field"><label>Tipo de reposição</label><select id="cfgType"><option>Produção</option><option>Compra</option></select></div>
        <div class="field"><label>Status</label><select id="cfgStatus"><option>Ativo</option><option>Inativo</option></select></div>
      </div><div class="actions"><button class="primary">Salvar item</button></div></form>
    </div>
    <div class="card"><div class="section-title"><h2>Infraestrutura</h2></div>
      <div class="stock-row"><strong>Firebase</strong><div class="muted">Cole seu firebaseConfig em <span class="code">firebase-config.js</span>. Sem isso, a V1 funciona apenas neste navegador.</div></div>
      <div class="stock-row"><strong>Saipos</strong><div class="muted">No Render, crie a variável <span class="code">SAIPOS_API_TOKEN</span>. Opcional: <span class="code">SAIPOS_AUTH_MODE</span> = raw ou bearer.</div></div>
      <div class="stock-row"><strong>E-mail de fechamento</strong><div class="muted">Configure no Render <span class="code">RESEND_API_KEY</span>, <span class="code">PURCHASE_EMAIL</span> e opcionalmente <span class="code">FROM_EMAIL</span>. Após uma sincronização Saipos aplicada, a lista é enviada automaticamente.</div></div>
      <div class="stock-row"><strong>Fechamento automático</strong><div class="muted">Nesta V1.1 o e-mail é automático após a sincronização real do dia. O agendamento 100% sem intervenção pode ser ativado depois com um Cron Job no Render.</div></div>
    </div></div>`;
  const sel=$('#cfgItem');
  const load=()=>{const i=state.inventory.find(x=>x.code===sel.value);$('#cfgMin').value=i.minimum;$('#cfgTarget').value=i.target;$('#cfgType').value=i.supplyType||'Compra';$('#cfgStatus').value=i.status||'Ativo'};
  load(); sel.addEventListener('change',load);
  $('#cfgForm').addEventListener('submit',async e=>{e.preventDefault();const i=state.inventory.find(x=>x.code===sel.value);await saveItem({...i,minimum:Number($('#cfgMin').value),target:Number($('#cfgTarget').value),supplyType:$('#cfgType').value,status:$('#cfgStatus').value});toast('Configuração salva.');renderConfig()});
}
function openEntryModal(code=''){ $('#modalContent').innerHTML=`<h2>Lançar estoque</h2>${entryForm(code)}`;$('#modal').classList.remove('hidden');$('#modal').setAttribute('aria-hidden','false');bindEntryForm(true)}
function closeModal(){ $('#modal').classList.add('hidden');$('#modal').setAttribute('aria-hidden','true') }
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}
function bindGo(){document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.go;render()}))}
document.querySelectorAll('.nav').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render()}));
$('#quickEntry').addEventListener('click',()=>openEntryModal());
$('#closeModal').addEventListener('click',closeModal);$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});
seedLocal(); render(); initCloud();
