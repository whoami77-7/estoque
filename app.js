import { LOCATIONS, validateState, balance, debtBalance } from './model.mjs';
import { legacyCards, legacyView, legacyForm, legacyPaymentAction, legacyDeleteAction, legacyExpenseDeleteAction } from './legacy.mjs';
import { classifyCategory, decisionView } from './analytics.mjs';
import { setupFeedback, unlockSound, reward, setAlissonBalance } from './feedback.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => (cents / 100).toLocaleString('pt-BR', {style:'currency', currency:'BRL'});
const dateBR = date => date ? date.split('-').reverse().join('/') : '—';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const API = 'https://script.google.com/macros/s/AKfycbzAb-D01oLo_xwI_V20ViUFmcmW05I3zTOdBAc8-P05KLJNuAqHBheNmTcPvpfAIIP0/exec';
const KEY = 'painel-puff:cache:v2';
const PENDING_KEY = 'painel-puff:pending:v2';
let token = localStorage.getItem('chave') || '', state = {version:1,products:[],movements:[],debts:[]}, legacy = {itens:[],gastos:[],clientes:[],locais:[]};
let invalid = true, writable = false, modulesReady = false, stored = 0, loading = false, view = 'estoque', search = '', locationFilter = '', stockFilter = '', categoryFilter = '', dialogAction, dialogVersion, pendingOperation;
try{pendingOperation=JSON.parse(localStorage.getItem(PENDING_KEY));}catch{}
let modulesLoaded=false;
try{const cache=JSON.parse(localStorage.getItem(KEY));if(cache){validateState(cache.state);state=cache.state;modulesLoaded=true;}}catch{}
const locations = () => [...new Set([...LOCATIONS,...(legacy.locais || []),...state.movements.flatMap(m=>[m.location,m.toLocation])].filter(Boolean))];
const status = text => { $('#connection-status').textContent = text; };

async function api(acao,payload={}) {
  let response;
  try { response = await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({acao,token,...payload}),signal:AbortSignal.timeout(45000)}); }
  catch { throw new Error('A conexão não confirmou a operação. Atualize antes de repetir.'); }
  if(!response.ok) throw new Error(`Servidor indisponível (${response.status}). Atualize antes de repetir.`);
  let result; try { result = await response.json(); } catch { throw new Error('Resposta inesperada. Atualize antes de repetir.'); }
  if(!result.ok) throw new Error(result.erro || result.error || 'Não foi possível concluir a operação.');
  return result.dados ?? result;
}
async function load() {
  if(loading)return;
  if(!token){auth();return;}
  loading=true; writable=false; status('Atualizando dados…');
  try {
    const fresh = await api('dados');
    let extra;
    try { extra = await api('puffDados'); validateState(extra); modulesReady=true;modulesLoaded=true; }
    catch(error) { modulesReady=false; extra=state; toast('Estoque carregado. Módulos novos aguardam conexão: '+error.message); }
    legacy=fresh; state=extra; invalid=false; writable=modulesReady; stored++;
    const syncedAt=new Date().toISOString();
    if(modulesReady)try { localStorage.setItem(KEY,JSON.stringify({legacy,state,syncedAt})); } catch { toast('Dados carregados. O navegador está sem espaço para uma cópia offline.'); }
    status(modulesReady?'✓ Dados atualizados na planilha':'Estoque conectado · módulos novos indisponíveis');
    $('#last-sync').textContent='Atualizado em '+new Date(syncedAt).toLocaleString('pt-BR');
    if(JSON.parse(localStorage.getItem('fila') || '[]').length){writable=false;status('Há alterações pendentes na versão anterior. Abra “Versão anterior” para sincronizá-las antes de continuar.');}
    if(pendingOperation){writable=false;status('Há uma operação sem confirmação. Use “Conferir operação” antes de novos lançamentos.');}
    render();
  } catch(error) {
    writable=false;
    if(invalid){try {const cached=JSON.parse(localStorage.getItem(KEY));if(cached){validateState(cached.state);legacy=cached.legacy;state=cached.state;invalid=false;$('#last-sync').textContent='Cópia de '+new Date(cached.syncedAt).toLocaleString('pt-BR');}}catch{}}
    status('Sem sincronização · somente leitura');toast(error.message);render();
  } finally {loading=false;}
}
function auth() {
  openDialog('Chave de acesso',field('Sua chave','key','password',token,'required autocomplete="off"')+'<p class="help">A chave fica neste navegador e é usada somente para acessar sua planilha.</p>','Conectar',async data=>{
    const next=String(data.get('key') || '').trim();if(!next)throw new Error('Informe a chave.');
    token=next;await api('dados');localStorage.setItem('chave',next);await load();
  });
}
async function save(action,payload={},celebration='') {
  if(!writable)throw new Error('Atualize o painel e aguarde a conexão antes de salvar.');
  if(stored!==dialogVersion)throw new Error('Os dados mudaram. Feche e abra o formulário novamente.');
  const signature=JSON.stringify({action,payload});
  if(pendingOperation&&pendingOperation.signature!==signature)throw new Error('Confira a operação pendente antes de fazer outro lançamento.');
  if(!pendingOperation)pendingOperation={signature,id:crypto.randomUUID(),action,payload};
  localStorage.setItem(PENDING_KEY,JSON.stringify(pendingOperation));
  payload={...payload,operationId:pendingOperation.id};
  // The server rejects stale row snapshots before any original-sheet mutation.
  try{await api(action,payload);}
  catch(error){
    try{const known=await api('puffOperacao',{operationId:pendingOperation.id});if(known.status==='complete'){clearPending();}else if(known.status==='none'){clearPending();throw error;}else{throw error;}}
    catch(reconciliation){if(pendingOperation){writable=false;status('Operação sem confirmação. Clique em Conferir operação.');$('#reconcile').hidden=false;}throw reconciliation;}
  }
  clearPending();
  if(celebration)reward(celebration,action==='puffPagamento'?0:Number(payload.input?.quantity || 1));
  toast('Salvo na planilha.');await load();
}
function clearPending(){pendingOperation=null;localStorage.removeItem(PENDING_KEY);$('#reconcile').hidden=true;}
async function reconcile(){
  if(!pendingOperation)return;
  $('#reconcile').disabled=true;
  try{
    const known=await api('puffOperacao',{operationId:pendingOperation.id});
    if(known.status==='complete'){clearPending();toast('A operação foi salva. Dados recuperados.');}
    else if(known.status==='none'){clearPending();toast('Nada foi gravado. Você pode lançar novamente.');}
    else if(known.status==='pending'){await api(pendingOperation.action,{...pendingOperation.payload,operationId:pendingOperation.id});clearPending();toast('Operação recuperada e confirmada.');}
    else{throw new Error('A operação antiga pode ter sido gravada parcialmente. Confira o registro na planilha antes de liberar novos lançamentos.');}
    if($('#editor').open)$('#editor').close();await load();
  }catch(error){toast(error.message);}finally{$('#reconcile').disabled=false;}
}
async function readPhoto(file,current='') {
  if(!file?.size)return current;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    for(const edge of [512,384,256]){
      const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      for(const quality of [.8,.6,.4]){const result=canvas.toDataURL('image/jpeg',quality);if(result.length<=40000)return result;}
    }
  } finally {bitmap.close();}
  throw new Error('A foto ainda está grande. Recorte a imagem e tente novamente.');
}

function toast(text) {
  $('#toast').textContent = text; $('#toast').classList.add('on');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('on'), 4200);
}
function cents(value) {
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error('Use um valor positivo com até duas casas decimais.');
  const [whole, fraction = ''] = text.replace(',','.').split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(result)) throw new Error('Valor muito alto.');
  return result;
}
const matches = (...values) => !search || normalize(values.join(' ')).includes(normalize(search));
const image = p => p.photo ? `<img class="product-image" src="${esc(p.photo)}" alt="${esc(p.name)}">` : `<div class="product-image placeholder" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5"/></svg></div>`;
const action = (name, id, label, cls = 'secondary') => `<button class="${cls}" data-action="${name}" data-id="${esc(id)}">${label}</button>`;
const stat = (label, value, cls = '') => `<div class="stat ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
const empty = text => `<div class="empty">${text}</div>`;
const locationOptions = value => locations().map(l => `<option ${l === value ? 'selected' : ''}>${esc(l)}</option>`).join('');
const stockName = p => p.stock === 'principal' ? 'Estoque principal' : 'Mercadorias';
const headings = {
  mercadorias:['Mercadorias','Cada produto, seu saldo e tudo o que aconteceu.','+ Novo produto'],
  devedores:['Devedores','Anote o combinado. Registre cada pagamento.','+ Nova dívida'],
  estoque:['Estoque','Todos os produtos, cada estoque com a sua cor.','+ Novo produto'],
  vendas:['Vendas','Histórico de vendas, clientes e recebimentos.',''],
  receber:['A receber','Acompanhe o dinheiro que ainda precisa entrar.',''],
  gastos:['Gastos','Custos registrados, sem perder os detalhes.','+ Novo gasto'],
  clientes:['Clientes','Quem compra com você, em um só lugar.',''],
  locais:['Locais','Confira onde estão os seus produtos.','+ Novo local'],
  decisao:['Tomada de decisão','Números que ajudam a escolher o próximo passo.','']
};

function render() {
  if (invalid) { $('#content').innerHTML = empty('Conecte com sua chave para carregar os dados do painel.'); $('#new-entry').disabled = true; return; }
  const [title,description,button] = headings[view];
  $('#page-title').textContent = title; $('#page-description').textContent = description;
  $('#new-entry').textContent = button; $('#new-entry').hidden = !button; $('#new-entry').disabled = !writable;
  $('#reconcile').hidden=!pendingOperation;
  $('#search').closest('label').hidden = view === 'decisao';
  $('#location-filter').closest('label').hidden = !['estoque','mercadorias'].includes(view);
  $('#stock-filter').closest('label').hidden = view !== 'estoque';
  $('#category-filter').closest('label').hidden = !['estoque','mercadorias','vendas','receber','decisao'].includes(view);
  $('#location-filter').innerHTML='<option value="">Todos os locais</option>'+locationOptions(locationFilter);$('#location-filter').value=locationFilter;
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.toggle('active',b.dataset.view === view); b.setAttribute('aria-current',b.dataset.view === view ? 'page' : 'false'); });
  if (view === 'mercadorias' || view === 'estoque') renderProducts();
  else if (view === 'devedores') {if(modulesLoaded)renderDebts();else{$('#summary').innerHTML='';$('#content').innerHTML=empty('A caderneta ainda não foi carregada. Atualize a conexão para consultar o saldo.');}}
  else if (view === 'decisao') {
    $('#summary').innerHTML='';$('#content').innerHTML=modulesLoaded?decisionView(legacy,state,{today:today(),category:categoryFilter}):empty('Atualize a conexão para carregar todos os módulos antes de analisar o painel.');
    const disclosure=$('#decision-details');if(disclosure){disclosure.open=localStorage.getItem('puff:decision-collapsed')!=='true';disclosure.addEventListener('toggle',()=>localStorage.setItem('puff:decision-collapsed',String(!disclosure.open)));}
  }
  else {
    $('#summary').innerHTML = '';
    $('#content').innerHTML = legacyView(filteredLegacy(),view,search)+extraView();
  }
  if(!writable)document.querySelectorAll('[data-action]').forEach(b=>{if(!['details-product','details-debt'].includes(b.dataset.action))b.disabled=true;});
  setAlissonBalance(state.commission?.balanceCents || 0);
}

function filteredLegacy(){return {...legacy,itens:legacy.itens.filter(p=>!categoryFilter||classifyCategory(p)===categoryFilter)};}
function extraView(){
  const products=state.products.filter(p=>!categoryFilter||classifyCategory(p)===categoryFilter), ids=new Set(products.map(p=>p.id));
  if(view==='vendas'){
    const sales=state.movements.filter(m=>m.type==='saida'&&ids.has(m.productId)&&matches(m.client,m.notes,state.products.find(p=>p.id===m.productId)?.name)).slice().reverse();
    return sales.length?`<h2 class="section-title">Saídas de mercadorias</h2><div class="debt-list">${sales.map(m=>`<article class="debt-card"><h3>${esc(state.products.find(p=>p.id===m.productId)?.name)}</h3><div class="client-location"><span class="context-chip">Cliente <strong>${esc(m.client)}</strong></span><span class="context-chip">Local <strong>${esc(m.location)}</strong></span></div><p>${m.quantity} un. · ${money(m.quantity*m.unitPriceCents)} · ${dateBR(m.date)}</p></article>`).join('')}</div>`:'';
  }
  if(view==='receber')return `<div class="module-note"><strong>Caderneta de devedores: ${money(state.debts.reduce((sum,d)=>sum+debtBalance(d),0))}</strong><p>Pagamentos parciais e dívidas avulsas ficam na aba Devedores.</p><button type="button" data-action="open-debts" class="secondary">Ver devedores</button></div>`;
  if(view==='clientes'){
    const clients=[...new Set(state.movements.filter(m=>m.type==='saida').map(m=>m.client))].filter(name=>matches(name));
    return clients.length?`<h2 class="section-title">Clientes das mercadorias</h2><div class="product-grid">${clients.map(name=>{const movements=state.movements.filter(m=>m.type==='saida'&&m.client===name);return `<article class="product-card stock-mercadorias"><h3>${esc(name)}</h3><strong>${money(movements.reduce((n,m)=>n+m.quantity*m.unitPriceCents,0))}</strong><p>${movements.reduce((n,m)=>n+m.quantity,0)} unidades · ${esc([...new Set(movements.map(m=>m.location))].join(', '))}</p></article>`;}).join('')}</div>`:'';
  }
  if(view==='locais')return `<h2 class="section-title">Mercadorias por local</h2><div class="product-grid">${locations().map(loc=>`<article class="product-card stock-mercadorias"><h3>${esc(loc)}</h3><strong>${state.products.reduce((n,p)=>n+balance(state,p.id,loc),0)} unidades</strong></article>`).join('')}</div>`;
  return '';
}

function renderProducts() {
  const products = state.products.filter(p => {
    const selectedStock = view === 'mercadorias' ? 'mercadorias' : stockFilter;
    const clients = state.movements.filter(m=>m.productId===p.id).map(m=>m.client).join(' ');
    return (!selectedStock || (p.stock || 'mercadorias') === selectedStock) && (!categoryFilter||classifyCategory(p)===categoryFilter) && matches(p.name,p.category,p.notes,clients) && (!locationFilter||balance(state,p.id,locationFilter)>0);
  }).sort((a,b)=>Number(b.stock==='principal')-Number(a.stock==='principal'));
  const loc = locationFilter || undefined;
  const mainItems=view==='estoque'&&stockFilter!=='mercadorias'?filteredLegacy().itens.filter(p=>normalize(p.situacao)!=='vendido'&&(!locationFilter||p.local===locationFilter)&&matches(p.modelo,p.cliente,p.notes,p.local)):[];
  const quantity = products.reduce((n,p) => n + balance(state,p.id,loc),mainItems.length);
  const low = products.filter(p => balance(state,p.id,loc) <= p.minStock).length;
  $('#summary').innerHTML = `<div class="summary-strip">${stat('Produtos / aparelhos',products.length+mainItems.length)}${stat(locationFilter ? `Unidades · ${esc(locationFilter)}` : 'Unidades em estoque',quantity)}${stat('Estoque baixo',low,low ? 'warning' : '')}</div>`;
  $('#content').innerHTML = products.length ? `<div class="product-grid">${products.map(p => {
    const qty = balance(state,p.id,loc), isLow = qty <= p.minStock;
    const lastSale = state.movements.filter(m=>m.productId===p.id&&m.type==='saida').at(-1);
    const places = locations().filter(l=>balance(state,p.id,l)>0).map(l=>`${l}: ${balance(state,p.id,l)}`).join(' · ');
    return `<article class="product-card stock-${esc(p.stock || 'mercadorias')}"><div class="product-top">${image(p)}<div><div class="meta stock-badge">${stockName(p)}</div><h2 class="product-title">${esc(p.name)}</h2><span class="badge ${isLow?'low':'good'}">${qty === 0 ? 'Sem estoque' : isLow ? 'Estoque baixo' : 'Disponível'}</span></div><button type="button" class="ghost edit-product" data-action="edit-product" data-id="${esc(p.id)}" aria-label="Editar ${esc(p.name)}" title="Editar produto"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/></svg></button></div>
      <div class="card-values"><div><span class="meta">${locationFilter ? 'Neste local' : 'Disponível'}</span><strong class="stock-number">${qty}<small> un.</small></strong></div><div><span class="meta">Preço por unidade</span><strong>${money(p.priceCents)}</strong></div></div>
      <div class="client-location"><div class="context-chip"><span class="context-label">Local · unidades</span><strong>${esc(places || 'Sem saldo nos locais')}</strong></div><div class="context-chip"><span class="context-label">Último cliente</span><strong>${esc(lastSale?.client || 'Ainda sem saída')}</strong></div></div>
      <p class="notes">${esc(p.notes || 'Adicione uma observação para encontrar os detalhes depois.')}</p>
      <div class="card-actions">${action('entrada',p.id,'↓ Entrada')}${action('saida',p.id,'↑ Saída','primary')}${action('details-product',p.id,'Histórico','ghost')}</div></article>`;
  }).join('')}</div>` : empty('Nenhum produto encontrado. Tente outro termo ou cadastre uma mercadoria.');
  if(mainItems.length)$('#content').innerHTML=legacyCards({...legacy,itens:mainItems})+(products.length?`<h2 class="section-title">Catálogo de mercadorias</h2>`+$('#content').innerHTML:'');
}

function renderDebts() {
  const debts = state.debts.filter(d => matches(d.name,d.description,d.notes));
  const received = debts.reduce((n,d)=>n+d.totalCents-debtBalance(d),0);
  const outstanding = debts.reduce((n,d)=>n+debtBalance(d),0);
  $('#summary').innerHTML = `<div class="summary-strip">${stat('Saldo a receber',money(outstanding))}${stat('Já recebido',money(received),'success')}${stat('Anotações em aberto',debts.filter(d=>debtBalance(d)>0).length)}</div>`;
  $('#content').innerHTML = debts.length ? `<div class="debt-list">${debts.map(d=>{
    const remaining = debtBalance(d), paid = d.totalCents-remaining;
    const late = remaining > 0 && d.dueDate && d.dueDate < today();
    return `<article class="debt-card"><div class="debt-top"><div><div class="debt-person"><span class="avatar" aria-hidden="true">${esc(d.name.slice(0,1))}</span><div><h2>${esc(d.name)}</h2><p class="meta">${esc(d.description)}</p></div></div></div><span class="badge ${remaining===0?'good':late?'low':''}">${remaining===0?'Quitado':late?'Vencido':paid?'Pagamento parcial':'Em aberto'}</span></div>
      <div class="debt-amount"><span class="meta">Falta receber</span><strong>${money(remaining)}</strong></div>
      <div class="debt-progress" role="progressbar" aria-label="Valor recebido" aria-valuemin="0" aria-valuemax="${d.totalCents}" aria-valuenow="${paid}" aria-valuetext="${esc(money(paid))} de ${esc(money(d.totalCents))}"><span style="width:${paid/d.totalCents*100}%"></span></div>
      <div class="payment-row"><span class="meta">Recebido <b>${money(paid)}</b></span><span class="meta">Total ${money(d.totalCents)}</span></div>
      <p class="notes">${d.payments.length ? `Último pagamento: ${money(d.payments[d.payments.length-1].amountCents)} em ${dateBR(d.payments[d.payments.length-1].date)}` : `Anotado em ${dateBR(d.date)}`}${d.dueDate ? ` · Vence ${dateBR(d.dueDate)}` : ''}</p>
      <div class="card-actions">${remaining ? action('payment',d.id,'+ Registrar pagamento','primary') : '<span class="paid-label">✓ Tudo recebido</span>'}${action('details-debt',d.id,'Ver histórico','secondary')}</div></article>`;
  }).join('')}</div>` : empty('Nenhuma dívida encontrada. Anote o nome, o motivo e o valor para começar.');
}

function field(label,name,type='text',value='',extra='') {
  return `<label class="field" for="f-${name}"><span>${label}</span><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function notes(value = '') { return `<label class="field" for="f-notes"><span>Observações <small>opcional</small></span><textarea id="f-notes" name="notes" rows="3" maxlength="1000" placeholder="Um detalhe para lembrar depois…">${esc(value)}</textarea></label>`; }
function openDialog(title, fields, saveLabel, save) {
  $('#dialog-title').textContent = title; $('#dialog-fields').innerHTML = fields;
  $('#form-error').textContent = ''; $('#save-dialog').textContent = saveLabel || 'Salvar';
  $('#save-dialog').hidden = !save; $('#cancel-dialog').textContent = save ? 'Cancelar' : 'Fechar';
  dialogAction = save; dialogVersion = stored; $('#editor').showModal();
}
function closeDialog() { if (!$('#save-dialog').disabled) $('#editor').close(); }

function productForm(id) {
  const product = state.products.find(p=>p.id===id);
  openDialog(product ? 'Editar produto' : 'Nova mercadoria',
    field('Nome do produto','name','text',product?.name || '','required maxlength="120" placeholder="Ex.: Kit de acessórios"')+
    '<p class="help">Mercadorias · controle por quantidade. Também aparece na aba Estoque.</p>'+
    `<div class="form-grid"><label class="field" for="f-category"><span>Categoria</span><select id="f-category" name="category">${['Mercadorias','Peptídeos','Ar-condicionados'].map(c=>`<option ${classifyCategory({category:c})===classifyCategory(product||{})?'selected':''}>${c}</option>`).join('')}</select></label>${field('Preço por unidade (R$)','price','text',((product?.priceCents || 0)/100).toFixed(2),'required inputmode="decimal"')}</div>`+
    field('Custo atual por unidade (R$) · opcional','cost','text',product?.costCents==null?'':(product.costCents/100).toFixed(2),'inputmode="decimal" placeholder="Preencha para estimar a reposição"')+
    field('Avisar quando chegar a (unidades)','minStock','number',product?.minStock ?? 5,'required min="0" max="1000000" step="1"')+
    `<label class="field" for="f-photo"><span>Foto do produto <small>opcional</small></span><input id="f-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small class="help">JPG, PNG ou WebP até 5 MB. Redimensionamos automaticamente.</small></label>${product?.photo?'<label class="check-field"><input name="removePhoto" type="checkbox"> Remover foto atual</label>':''}`+
    notes(product?.notes), 'Salvar produto', async data => {
      let photo = product?.photo || '';
      if (data.get('removePhoto')) photo = '';
      photo=await readPhoto(data.get('photo'),photo);
      const input={name:data.get('name'),stock:'mercadorias',category:data.get('category'),priceCents:cents(data.get('price')),costCents:String(data.get('cost')).trim()?cents(data.get('cost')):null,minStock:Number(data.get('minStock')),notes:data.get('notes'),photo};
      await save('puffProduto',{input,...(product?{productId:product.id,expected:product}:{})});
      toast(product?'Produto atualizado.':'Produto cadastrado. Registre a primeira entrada.');
    });
}

function debtForm() {
  openDialog('Nova anotação de dívida',field('Quem deve?','name','text','','required maxlength="120" placeholder="Nome da pessoa"')+
    field('Sobre o que deve?','description','text','','required maxlength="200" placeholder="Ex.: iPhone, serviço, empréstimo…"')+
    field('Quantidade de itens neste combinado','units','number',1,'required min="1" max="1000000" step="1"')+
    `<div class="form-grid">${field('Valor total (R$)','total','text','','required inputmode="decimal" placeholder="2.000,00 → digite 2000,00"')}${field('Data da anotação','date','date',today(),'required')}</div>`+
    field('Vencimento (opcional)','dueDate','date')+notes(), 'Salvar dívida', async data=>{
      await save('puffDivida',{input:{name:data.get('name'),description:data.get('description'),units:Number(data.get('units')),totalCents:cents(data.get('total')),date:data.get('date'),dueDate:data.get('dueDate'),notes:data.get('notes')}});toast('Dívida anotada.');
    });
}
function paymentForm(id) {
  const debt = state.debts.find(d=>d.id===id); if (!debt) return;
  openDialog(`Pagamento de ${debt.name}`,`<p class="dialog-summary">${esc(debt.description)}<br>Saldo atual <strong>${money(debtBalance(debt))}</strong></p>`+
    `<div class="form-grid">${field('Valor recebido (R$)','amount','text','','required inputmode="decimal" placeholder="Ex.: 500,00"')}${field('Data do pagamento','date','date',today(),`required min="${esc(debt.date)}"`)}</div>`+notes(), 'Registrar pagamento',async data=>{
      await save('puffPagamento',{debtId:id,input:{amountCents:cents(data.get('amount')),date:data.get('date'),note:data.get('notes')}},'Pagamento recebido');toast('Pagamento registrado e saldo atualizado.');
    });
}

function movementForm(id,type) {
  const p=state.products.find(p=>p.id===id); if(!p)return;
  const titles={entrada:'Registrar entrada',saida:'Registrar saída',transferencia:'Transferir entre locais'};
  const source=locationFilter || 'Depósito SP';
  openDialog(titles[type],`<p class="dialog-summary"><strong>${esc(p.name)}</strong><br><span id="stock-at-location">${balance(state,id,source)} un. em ${esc(source)}</span></p>`+
    `<div class="form-grid">${field('Quantidade','quantity','number',1,'required min="1" max="1000000" step="1"')}<label class="field" for="f-location"><span>${type==='transferencia'?'Local de origem':'Local'}</span><select name="location" id="f-location">${locationOptions(source)}</select></label></div>`+
    (type==='transferencia'?`<label class="field" for="f-toLocation"><span>Local de destino</span><select id="f-toLocation" name="toLocation">${locationOptions(source==='Loja'?'Depósito SP':'Loja')}</select></label>`:'')+
    (type==='saida'?`<div class="form-grid">${field('Cliente','client','text','','required maxlength="120" placeholder="Nome de quem recebeu"')}${field('Valor por unidade (R$)','unitPrice','text',(p.priceCents/100).toFixed(2),'required inputmode="decimal"')}</div><p class="movement-total" id="movement-total"></p><label class="check-field"><input type="checkbox" name="createDebt"> Anotar esta venda em Devedores</label><p class="help">Marque quando o pagamento ficar para depois. O valor total entra na caderneta.</p>`:'')+
    field('Data','date','date',today(),'required')+notes(),'Salvar movimentação',async data=>{
      const quantity=Number(data.get('quantity')),unitPriceCents=type==='saida'?cents(data.get('unitPrice')):p.priceCents;
      await save('puffMovimento',{productId:id,input:{type,quantity,location:data.get('location'),toLocation:data.get('toLocation')||'',client:data.get('client')||'',unitPriceCents,date:data.get('date'),notes:data.get('notes')},createDebt:type==='saida'&&Boolean(data.get('createDebt'))},type==='saida'?`${quantity} ${quantity===1?'unidade registrada':'unidades registradas'}`:'');toast('Movimentação registrada.');
    });
  $('#f-location').addEventListener('change',()=>{$('#stock-at-location').textContent=`${balance(state,id,$('#f-location').value)} un. em ${$('#f-location').value}`;});
  if(type==='saida'){
    const updateTotal=()=>{try{$('#movement-total').textContent='Total da saída: '+money(Number($('#f-quantity').value)*cents($('#f-unitPrice').value));}catch{$('#movement-total').textContent='Informe quantidade e valor por unidade.';}};
    $('#f-quantity').addEventListener('input',updateTotal);$('#f-unitPrice').addEventListener('input',updateTotal);updateTotal();
  }
}

function productDetails(id) {
  const p=state.products.find(p=>p.id===id);if(!p)return;
  const movements=state.movements.filter(m=>m.productId===id).slice().reverse();
  openDialog(p.name,`<div class="chips">${locations().map(l=>`<span class="chip">${esc(l)} <b>${balance(state,id,l)} un.</b></span>`).join('')}</div><p class="notes">${esc(p.notes)}</p><div class="card-actions">${action('transferencia',id,'⇄ Transferir entre locais')}</div><h3>Histórico de movimentações</h3><div class="timeline">${movements.map(m=>`<div class="movement"><span class="movement-icon">${m.type==='entrada'?'↓':m.type==='saida'?'↑':'⇄'}</span><div class="movement-main"><strong>${m.type==='entrada'?'Entrada':m.type==='saida'?'Saída':'Transferência'} · ${m.quantity} un.</strong><div class="meta">${esc(m.location)}${m.toLocation?' → '+esc(m.toLocation):''}${m.client?' · '+esc(m.client):''}</div><div class="meta">${dateBR(m.date)}${m.type==='saida'?' · '+money(m.quantity*m.unitPriceCents):''}</div>${m.notes?`<p class="notes">${esc(m.notes)}</p>`:''}</div></div>`).join('') || empty('Nenhuma movimentação. Registre a primeira entrada.')}</div>`,null,null);
}
function debtDetails(id) {
  const d=state.debts.find(d=>d.id===id);if(!d)return;
  openDialog(`Histórico · ${d.name}`,`<p class="dialog-summary">${esc(d.description)}<br>Valor original <strong>${money(d.totalCents)}</strong><br>Falta receber <strong>${money(debtBalance(d))}</strong></p>${d.notes?`<p class="notes">${esc(d.notes)}</p>`:''}<h3>Pagamentos registrados</h3><div class="payments">${d.payments.slice().reverse().map(p=>`<div class="payment-row"><div><strong>${dateBR(p.date)}</strong>${p.note?`<p class="meta">${esc(p.note)}</p>`:''}</div><strong class="success">${money(p.amountCents)}</strong></div>`).join('') || empty('Ainda não houve pagamento. Cada recebimento ficará registrado aqui com a data.')}</div><p class="help">Dívida anotada em ${dateBR(d.date)}${d.dueDate?` · vencimento ${dateBR(d.dueDate)}`:''}.</p>`,null,null);
}

document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.view;search='';$('#search').value='';render();}));
$('#search').addEventListener('input',e=>{search=e.target.value;render();});
$('#location-filter').addEventListener('change',e=>{locationFilter=e.target.value;render();});
$('#stock-filter').addEventListener('change',e=>{stockFilter=e.target.value;render();});
$('#category-filter').addEventListener('change',e=>{categoryFilter=e.target.value;render();});
function originalForm(kind,id){
  const form=legacyForm(legacy,kind,id,today());
  openDialog(form.title,form.html,form.submitLabel,async data=>{
    const request=form.build(data);
    if(kind==='edit')request.payload.input.photo=await readPhoto(data.get('photo'),request.payload.input.photo);
    await save(request.action,request.payload,kind==='sell'?'Venda registrada':'');
  });
}
$('#new-entry').addEventListener('click',()=>{
  if(view==='devedores')debtForm();
  else if(view==='gastos')originalForm('expense');
  else if(view==='locais')openDialog('Novo local',field('Nome do local','nome','text','','required maxlength="120"'),'Salvar local',async data=>save('local',{nome:data.get('nome')}));
  else if(view==='estoque'&&stockFilter!=='mercadorias')openDialog('Adicionar ao estoque','<p>Escolha como controlar o produto.</p><div class="card-actions"><button type="button" class="primary" data-action="new-legacy">Aparelho individual</button><button type="button" class="secondary" data-action="new-catalog">Mercadoria por quantidade</button></div>',null,null);
  else productForm();
});
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b||invalid)return;
  const {action:a,id,location}=b.dataset;
  try {
  if(a==='open-debts'){view='devedores';render();return;}
  if(a==='new-legacy'){$('#editor').close();originalForm('new');return;}
  if(a==='new-catalog'){$('#editor').close();productForm();return;}
  if(a.startsWith('legacy-')){
    const kind=a.slice(7);
    if(['edit','sell','local'].includes(kind)){originalForm(kind,Number(id));return;}
    const request=kind==='paid'?legacyPaymentAction(legacy,id):kind==='delete'?legacyDeleteAction(legacy,id):legacyExpenseDeleteAction(legacy,id);
    const title=kind==='paid'?(request.payload.valor?'Registrar recebimento':'Voltar para a receber'):kind==='delete'?'Arquivar aparelho':'Excluir gasto';
    openDialog(title,kind==='delete'?'<p>O aparelho ficará nos arquivados da versão anterior e poderá ser restaurado.</p>':kind==='expense-delete'?'<p>Este gasto será excluído da planilha. Exporte um backup se quiser guardar uma cópia.</p>':'<p>Confirme a atualização do pagamento deste aparelho.</p>','Confirmar',async()=>save(request.action,request.payload,kind==='paid'&&request.payload.valor?'Pagamento recebido':''));return;
  }
  if(a==='filter-location'){locationFilter=location;$('#location-filter').value=location;render();return;}
  if(['entrada','saida','transferencia'].includes(a)){$('#editor').close();movementForm(id,a);}
  else if(a==='edit-product')productForm(id);
  else if(a==='details-product')productDetails(id);
  else if(a==='payment')paymentForm(id);
  else if(a==='details-debt')debtDetails(id);
  } catch(error){toast(error.message);}
});
$('#close-dialog').addEventListener('click',closeDialog);$('#cancel-dialog').addEventListener('click',closeDialog);
$('#editor').addEventListener('cancel',e=>{if($('#save-dialog').disabled)e.preventDefault();});
$('#editor-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!dialogAction||$('#save-dialog').disabled)return;
  unlockSound();
  $('#form-error').textContent='';$('#save-dialog').disabled=true;
  try{if(stored!==dialogVersion)throw new Error('Os dados mudaram. Feche e reabra o formulário.');await dialogAction(new FormData(e.target));$('#editor').close();}catch(error){$('#form-error').textContent=error.message;}
  finally{$('#save-dialog').disabled=false;}
});
$('#export-backup').addEventListener('click',()=>{
  if(invalid){toast('Conecte para carregar os dados antes de exportar.');return;}
  const data=JSON.stringify({format:'painel-puff-backup-v2',exportedAt:new Date().toISOString(),synced:writable,legacy,modules:state},null,2);
  const url=URL.createObjectURL(new Blob([data ?? ''],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`painel-puff-backup-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Backup preparado para download.');
});
$('#refresh').addEventListener('click',()=>{if($('#editor').open){toast('Feche o formulário antes de atualizar.');return;}load();});
$('#reconcile').addEventListener('click',reconcile);
$('#change-key').addEventListener('click',auth);
$('#alisson-balance').addEventListener('click',()=>{
  const commission=state.commission || {balanceCents:0,entries:[]};
  const usd=value=>(value/100).toLocaleString('pt-BR',{style:'currency',currency:'USD'});
  openDialog('Uma nobre causa: o café do Alisson ☕',`<p>📦 Você cuida do estoque. ☕ O Alisson cuida do café que mantém as ideias funcionando.</p><p class="dialog-summary">💰 Fundo do cafezinho <strong>${usd(commission.balanceCents)}</strong></p><p>💸 Cada unidade rende <strong>US$ 0,50 pro cafezinho</strong>. Pagou depois? Sem bis: essa unidade já ajudou! 😄</p><p class="help">Uma vez por unidade vendida ou recebida. Dívidas avulsas contam no primeiro pagamento, pela quantidade anotada. Contador informativo, sem transferência automática; começa nesta versão.</p>${commission.entries.length?`<h3>🤝 Quem abasteceu a cafeteira</h3><div class="payments">${commission.entries.slice(-10).reverse().map(entry=>`<div class="payment-row"><div><strong>${esc(entry.reason || 'Unidades registradas')}</strong><p class="meta">${esc(entry.units)} un. · ${esc(new Date(entry.createdAt).toLocaleDateString('pt-BR'))}</p></div><strong>${usd(entry.amountCents)}</strong></div>`).join('')}</div>`:'<p class="help">🚀 A cafeteira está pronta. O primeiro lançamento inaugura o fundo.</p>'}`,null,null);
});
window.addEventListener('storage',e=>{if(e.key===KEY){writable=false;stored++;status('Outra aba atualizou o painel. Clique em Atualizar.');render();}});
setupFeedback();render();load();
if('serviceWorker' in navigator && location.hostname!=='localhost' && location.hostname!=='127.0.0.1')navigator.serviceWorker.register('sw.js').catch(()=>{});
