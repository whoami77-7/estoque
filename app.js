import { LOCATIONS, validateState, balance, debtBalance } from './model.mjs';
import { legacyCards, legacyView, legacyForm, legacyPaymentAction, legacyDeleteAction, legacyExpenseDeleteAction, legacyRestoreAction } from './legacy.mjs';
import { classifyCategory, decisionView } from './analytics.mjs';
import { setupFeedback, unlockSound, reward, setAlissonBalance } from './feedback.mjs';
import { currencyOf, formatMoney, convertCents } from './money.mjs';
import { moneyHTML, moneyTotals, currencyForm, readCurrencyForm, deliveryAddressField, deliveryAddressHTML } from './currency-ui.mjs';
import { shipmentView, shipmentForm, shipmentItemFields } from './shipments.mjs';
import { notesView, noteForm, shipmentNoteForm, noteToShipment, noteToDebt } from './notes.mjs';
import { setupResilience } from './resilience.mjs';
import { getExpressProducts, expressProductOptions, expressModelOptions, expressModelDetails, expressExactModel, expressForm, readExpressForm, buildExpressMessage } from './express.mjs';
import { priceTableProducts, priceTableForm, readPriceTable, buildPriceTableText, buildPriceTableHTML } from './price-table.mjs';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = formatMoney;
const dateBR = date => date ? date.split('-').reverse().join('/') : '—';
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const API = 'https://script.google.com/macros/s/AKfycbzAb-D01oLo_xwI_V20ViUFmcmW05I3zTOdBAc8-P05KLJNuAqHBheNmTcPvpfAIIP0/exec';
const KEY = 'painel-puff:cache:v2';
const PENDING_KEY = 'painel-puff:pending:v2';
const NOTE_DRAFT_KEY = 'painel-puff:note-drafts:v1';
const EXPRESS_DRAFT_KEY = 'painel-puff:express-draft:v1';
const PRICE_TABLE_DRAFT_KEY = 'painel-puff:price-table-draft:v1';
let priceTableDraft={};
try{const draft=JSON.parse(storageRead(PRICE_TABLE_DRAFT_KEY));if(draft&&typeof draft==='object'&&!Array.isArray(draft))priceTableDraft=Object.fromEntries(Object.entries(draft).slice(0,1000).filter(([key,value])=>key.length<1500&&typeof value==='string'&&value.length<=1000));}catch{}
function storageRead(key) { try{return localStorage.getItem(key);}catch{return null;} }
let expressDraft={};
try{const draft=JSON.parse(storageRead(EXPRESS_DRAFT_KEY));for(const key of ['productKey','price','currency','customer','specifications','conditions','catalogModelId','catalogProductName'])if(typeof draft?.[key]==='string'&&draft[key].length<=600)expressDraft[key]=draft[key];}catch{}
let token = storageRead('chave') || '', state = {version:1,products:[],movements:[],debts:[]}, legacy = {itens:[],gastos:[],clientes:[],locais:[]};
let invalid = true, writable = false, modulesReady = false, stored = 0, loading = false, saving = false, stoppedWaiting = false, refreshPromise, resilience, view = 'estoque', search = '', locationFilter = '', stockFilter = '', categoryFilter = '', dialogAction, dialogVersion, dialogInstance = 0, pendingOperation, pendingUnreadable = false, syncMessage = '';
let lastSyncAt=0, lastResumeAt=0, refreshAfterClose=false, externalRevision=0, combinedReadSupported=true, awaitingSavedSnapshot=false;
function readPending(){
  let raw;try{raw=localStorage.getItem(PENDING_KEY);}catch{pendingUnreadable=true;return;}
  pendingUnreadable=false;pendingOperation=null;
  if(!raw)return;
  try{const entry=JSON.parse(raw);if(!entry||typeof entry.id!=='string'||typeof entry.action!=='string'||!entry.payload||typeof entry.payload!=='object')throw Error();pendingOperation=entry;}
  catch{pendingUnreadable=true;}
}
readPending();
let modulesLoaded=false;
let decisionCurrency=storageRead('puff:decision-currency')==='USD'?'USD':'BRL';
let shipmentMonth=today().slice(0,7);
let shipmentStatus='';
let notesMonth=today().slice(0,7);
try{const cache=JSON.parse(storageRead(KEY));if(cache&&cache.legacy&&Array.isArray(cache.legacy.itens)){validateState(cache.state);state=cache.state;legacy=cache.legacy;legacy.currencyReference=state.settings||{};modulesLoaded=true;invalid=false;$('#last-sync').textContent='Cópia de '+new Date(cache.syncedAt).toLocaleString('pt-BR');}}catch{}
const locations = () => [...new Set([...LOCATIONS,...(legacy.locais || []),...state.movements.flatMap(m=>[m.location,m.toLocation])].filter(Boolean))];
const status = text => { $('#connection-status').textContent = text; };
function showSyncProblem(message=syncMessage){
  syncMessage=message;$('#sync-blocker').hidden=!message;$('#sync-message').textContent=message;
  $('#sync-recover').disabled=saving||loading;$('#reconcile').disabled=saving||loading;
}
function pendingMessage(){
  if(pendingUnreadable)return 'Há uma pendência local que não foi possível ler. Baixe o backup para conferência; os registros foram preservados.';
  if(!pendingOperation)return '';
  const name=({puffPagamento:'Um pagamento',puffPagamentoEdit:'Uma correção de pagamento',puffMovimento:pendingOperation.payload?.input?.type==='saida'?'Uma saída de estoque':'Uma movimentação',vender:'Uma venda',campo:'Uma atualização',puffNota:'Uma anotação'})[pendingOperation.action]||'Um lançamento';
  return `${name} deste aparelho aguarda confirmação. Conferir e recuperar consulta ou conclui a mesma tentativa, sem criar outro lançamento.`;
}
const activeRequests=new Set();

async function api(acao,payload={}) {
  const controller=new AbortController(),limit=['dados','puffDados','puffPainel','puffOperacao'].includes(acao)?20000:25000;
  const request={controller,deadline:Date.now()+limit};activeRequests.add(request);
  const timer=setTimeout(()=>controller.abort(),limit);
  try{
    const response=await fetch(API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({acao,token,...payload}),signal:controller.signal});
    if(!response.ok)throw new Error(`Servidor indisponível (${response.status}).`);
    const result=await response.json();
    if(!result||typeof result.ok!=='boolean')throw new Error('Resposta inesperada do servidor.');
    if(!result.ok){const error=new Error(result.erro||result.error||'Não foi possível concluir a operação.');error.serverRejected=true;throw error;}
    return result.dados??result;
  }catch(error){if(error.serverRejected)throw error;throw new Error(['dados','puffDados','puffPainel','puffOperacao'].includes(acao)?'A conexão não respondeu para atualizar os dados. A última cópia continua disponível.':'A conexão não confirmou a operação. Use Recuperar painel; não repita o lançamento.');}
  finally{clearTimeout(timer);activeRequests.delete(request);}
}
async function readSnapshot(){
  if(combinedReadSupported){
    try{return await api('puffPainel');}
    catch(error){if(!error.serverRejected||!/^acao desconhecida:\s*puffPainel$/i.test(error.message))throw error;combinedReadSupported=false;}
  }
  // Compatibility with the previous server only; a slow connection never doubles its requests.
  return {legacy:await api('dados'),modules:await api('puffDados')};
}
async function load(prefetched) {
  if(loading||saving)return;
  if(!token){auth();return;}
  readPending();
  if(pendingOperation||pendingUnreadable)syncMessage=pendingMessage();
  const revision=externalRevision,instanceAtStart=dialogInstance;refreshAfterClose=false;
  loading=true; writable=false; status(awaitingSavedSnapshot?'Salvo ✓ Atualizando a lista…':'Atualizando dados…');showSyncProblem();render();
  try {
    // Apenas consulta automática: uma tentativa incerta só é reenviada por ação do usuário.
    if(pendingOperation)try{const known=await api('puffOperacao',{operationId:pendingOperation.id});if(known.status==='complete'){clearPending();toast('O lançamento anterior já foi salvo. Acesso recuperado.');}}catch{}
    const snapshot=prefetched||await readSnapshot(),fresh=snapshot.legacy,extra=snapshot.modules;
    if(!fresh||!Array.isArray(fresh.itens))throw new Error('A resposta do estoque está incompleta. A última cópia foi preservada.');
    validateState(extra);
    if(revision!==externalRevision)throw new Error('Outro acesso está atualizando o painel. Aguarde a confirmação antes de continuar.');
    if($('#editor').open&&dialogInstance!==instanceAtStart){refreshAfterClose=true;return;}
    modulesReady=true;modulesLoaded=true;awaitingSavedSnapshot=false;
    legacy=fresh; state=extra; legacy.currencyReference=state.settings||{}; invalid=false; writable=modulesReady; stored++;
    lastSyncAt=Date.now();const syncedAt=new Date(lastSyncAt).toISOString();
    if(modulesReady)try { localStorage.setItem(KEY,JSON.stringify({legacy,state,syncedAt})); } catch { toast('Dados carregados. O navegador está sem espaço para uma cópia offline.'); }
    status(modulesReady?'✓ Dados atualizados na planilha':'Estoque conectado · módulos novos indisponíveis');
    $('#last-sync').textContent='Atualizado em '+new Date(syncedAt).toLocaleString('pt-BR');
    syncMessage=modulesReady?'':'Não foi possível atualizar todos os dados. Use Recuperar painel antes de registrar pagamentos ou saídas.';
    let oldQueue=false;try{const queue=JSON.parse(storageRead('fila')||'[]');oldQueue=!Array.isArray(queue)||queue.length>0;}catch{oldQueue=true;}
    if(oldQueue){writable=false;syncMessage='Há lançamentos da versão antiga guardados neste aparelho. Baixe o backup para conferência antes de liberar novos registros.';status(syncMessage);}
    if(pendingOperation||pendingUnreadable){writable=false;syncMessage=pendingMessage();status('Lançamento pendente · use Conferir e recuperar.');}
    if(state.pendingLegacy){writable=false;status(pendingOperation?'Há uma operação pendente. Use “Conferir operação” antes de novos lançamentos.':'Há uma operação pendente em outro acesso. Confira o lançamento original antes de continuar.');}
    if(state.pendingLegacy&&!pendingOperation)syncMessage='Há uma operação pendente em outro acesso. Confira o lançamento original antes de continuar.';
    render();
    if(modulesReady)resilience?.ready();
  } catch(error) {
    writable=false;modulesReady=false;
    if(invalid){try {const cached=JSON.parse(localStorage.getItem(KEY));if(cached){validateState(cached.state);legacy=cached.legacy;state=cached.state;invalid=false;$('#last-sync').textContent='Cópia de '+new Date(cached.syncedAt).toLocaleString('pt-BR');}}catch{}}
    syncMessage=pendingMessage()||(awaitingSavedSnapshot?'O lançamento foi salvo, mas a lista ainda não atualizou. Use Conferir e recuperar; não registre novamente.':'Sem conexão confirmada. Seus dados estão preservados; use Recuperar painel para voltar a registrar.');
    status('Sem sincronização · somente leitura');toast(error.message);render();
  } finally {loading=false;showSyncProblem();if(awaitingSavedSnapshot)render();if(refreshAfterClose&&!saving&&!$('#editor').open&&!pendingOperation&&!pendingUnreadable){refreshAfterClose=false;refreshPromise=load();}}
}
function auth() {
  openDialog('Chave de acesso',field('Sua chave','key','password',token,'required autocomplete="off"')+'<p class="help">A chave fica neste navegador e é usada somente para acessar sua planilha.</p>','Conectar',async data=>{
    const next=String(data.get('key') || '').trim();if(!next)throw new Error('Informe a chave.');
    const previous=token;token=next;let snapshot;
    try{snapshot=await readSnapshot();validateState(snapshot.modules);if(!Array.isArray(snapshot.legacy?.itens))throw new Error('Resposta incompleta do painel.');localStorage.setItem('chave',next);}catch(error){token=previous;throw error;}
    await load(snapshot);
  });
}
async function save(action,payload={},celebration='') {
  if(!writable||saving||pendingUnreadable)throw new Error('Atualize o painel e aguarde a conexão antes de salvar.');
  if(stored!==dialogVersion)throw new Error('Os dados mudaram. Feche e abra o formulário novamente.');
  const signature=JSON.stringify({action,payload});
  if(pendingOperation&&pendingOperation.signature!==signature)throw new Error('Confira a operação pendente antes de fazer outro lançamento.');
  if(!pendingOperation){
    const entry={signature,id:crypto.randomUUID(),action,payload},serialized=JSON.stringify(entry);
    try{localStorage.setItem(PENDING_KEY,serialized);}catch{
      // O cache é reconstruível; chave, rascunhos e lançamentos pendentes nunca são descartados.
      try{localStorage.removeItem(KEY);localStorage.setItem(PENDING_KEY,serialized);}catch{throw new Error('Sem espaço para guardar a confirmação com segurança. Nada foi enviado. Libere espaço no aparelho e tente novamente.');}
    }
    pendingOperation=entry;
  }
  payload={...payload,operationId:pendingOperation.id};
  saving=true;stoppedWaiting=false;writable=false;status('Salvando na planilha…');showSyncProblem('Salvando com segurança… Aguarde a confirmação. Você pode sair desta janela; a tentativa ficará guardada.');
  let confirmed=false;
  // The server rejects stale row snapshots before any original-sheet mutation.
  try{
    try{await api(action,payload);confirmed=true;}
    catch(error){
      if(stoppedWaiting)throw new Error('A espera foi interrompida. O lançamento pode ter sido salvo; use Recuperar painel antes de continuar.');
      const known=await api('puffOperacao',{operationId:pendingOperation.id});
      if(known.status==='complete')confirmed=true;
      else{if(known.status==='none'&&error.serverRejected){clearPending();writable=true;}throw error;}
    }
    clearPending();
  }finally{
    saving=false;
    if(!confirmed||pendingOperation){syncMessage=pendingMessage();status(syncMessage?'Lançamento pendente · use Conferir e recuperar.':'Operação não salva. Revise os dados e tente novamente.');$('#reconcile').hidden=!pendingOperation;showSyncProblem();render();}
  }
  if(celebration)reward(celebration,action==='puffPagamento'?0:Number(payload.input?.quantity || 1));
  awaitingSavedSnapshot=true;toast('Salvo na planilha. Atualizando a lista…');refreshPromise=load();
}
function clearPending(){
  const current=JSON.parse(localStorage.getItem(PENDING_KEY)||'null');
  if(current&&current.id!==pendingOperation?.id){readPending();throw new Error('Outra aba guardou uma tentativa. Recupere a conexão para conferir.');}
  localStorage.removeItem(PENDING_KEY);pendingOperation=null;pendingUnreadable=false;$('#reconcile').hidden=true;
}
async function reconcile(){
  if(saving||loading)return;
  if(!pendingOperation){await load();return;}
  saving=true;stoppedWaiting=false;writable=false;showSyncProblem('Conferindo o lançamento guardado neste aparelho…');
  try{
    const known=await api('puffOperacao',{operationId:pendingOperation.id});
    if(known.status==='complete'){clearPending();toast('A operação foi salva. Dados recuperados.');}
    else if(['none','pending'].includes(known.status)){
      // Mesmo ID inclusive em "none": a requisição original pode ainda estar chegando ao servidor.
      try{await api(pendingOperation.action,{...pendingOperation.payload,operationId:pendingOperation.id});}
      catch(error){if(error.serverRejected){const checked=await api('puffOperacao',{operationId:pendingOperation.id});if(checked.status==='complete'){clearPending();toast('A operação já estava salva.');}else if(checked.status==='none'){clearPending();throw error;}else throw error;}else throw error;}
      if(pendingOperation)clearPending();toast('Operação recuperada e confirmada.');
    }
    else{throw new Error('A operação antiga pode ter sido gravada parcialmente. Confira o registro na planilha antes de liberar novos lançamentos.');}
    if($('#editor').open)$('#editor').close();
  }catch(error){toast(error.message);syncMessage=pendingMessage()||error.message;}
  finally{saving=false;showSyncProblem();}
  await load();
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
  express:['Venda Express','Monte a oferta e leve a mensagem pronta para o cliente.',''],
  tabela:['Tabela para clientes','Só ar-condicionados. Escolha os modelos e os preços que quer oferecer.',''],
  mercadorias:['Mercadorias','Cada produto, seu saldo e tudo o que aconteceu.','+ Novo produto'],
  devedores:['Devedores','Anote o combinado. Registre cada pagamento.','+ Nova dívida'],
  estoque:['Estoque','Todos os produtos, cada estoque com a sua cor.','+ Novo produto'],
  vendas:['Vendas','Histórico de vendas, clientes e recebimentos.',''],
  receber:['A receber','Acompanhe o dinheiro que ainda precisa entrar.',''],
  gastos:['Gastos','Custos registrados, sem perder os detalhes.','+ Novo gasto'],
  clientes:['Clientes','Quem compra com você, em um só lugar.',''],
  locais:['Locais','Confira onde estão os seus produtos.','+ Novo local'],
  decisao:['Tomada de decisão','Números que ajudam a escolher o próximo passo.',''],
  envios:['Envios','O que saiu, com quem foi e para quem. Cada mês fica guardado.',''],
  anotacoes:['Anotações','Seu caderno por mês. Salve e continue quando quiser.','+ Anotação livre'],
  arquivados:['Lixeira do estoque','Excluiu por engano? Restaure o item aqui.','']
};
const helpTopics = {
  tabela:['Sua tabela de ar-condicionados','Marque os aparelhos e confira o preço e a moeda de cada um. Modelos iguais com o mesmo preço aparecem uma vez.\nGere a tabela para revisar, copiar no WhatsApp ou imprimir / salvar em PDF. No iPhone, a opção de PDF fica no compartilhamento da prévia de impressão.\nCustos, lucro, quantidade e dados de clientes não entram na tabela. Os preços ajustados aqui valem só para a oferta; o cadastro do estoque continua igual.'],
  express:['Sua oferta em poucos toques','Escolha o ar. Se o cadastro tiver o código exato, a ficha é preenchida; nos demais, escolha o modelo da Rio Paraná conferindo a etiqueta. Versões 110 V, 220 V, Inverter e convencional têm características diferentes.\nSem ficha confirmada, entram só os dados escritos no cadastro. Acrescente detalhes confirmados, informe o preço em reais ou dólares e gere a mensagem.\nO rascunho fica neste aparelho. A oferta não baixa o estoque: confirme a venda no Estoque quando fechar com o cliente.'],
  estoque: ['Encontre seus produtos', 'Todos reúne aparelhos e mercadorias. Estoque principal mostra os aparelhos; Mercadorias mostra produtos por quantidade.\nDepósito SP mostra o que tem saldo nesse local. Se algo sumir da lista, use Limpar filtros. Excluir guarda o item na Lixeira do estoque, sem registrar venda.'],
  mercadorias: ['Mercadorias por quantidade', 'Cadastre o produto uma vez. Use Entrada para somar unidades e Saída para registrar a venda e baixar o saldo.\nO lápis altera nome, foto, preço e observações. O histórico mostra as movimentações e permite transferir entre locais.'],
  devedores: ['Receba aos poucos', 'Registre o valor original. A cada recebimento, use Registrar pagamento parcial e informe o valor pago e a data.\nExemplo: devia 3.000, pagou 500, faltam 2.500. O card fica vermelho enquanto houver saldo e verde quando estiver quitado. Use Editar dívida ou Histórico / pagamentos para corrigir.'],
  receber: ['O que falta entrar', 'Aqui ficam os valores pendentes dos aparelhos vendidos. Use o botão de recebimento quando o aparelho for pago.\nDívidas avulsas e pagamentos parciais ficam em Devedores. Reais e dólares têm totais separados.'],
  vendas: ['Vendas e saídas', 'Consulte os aparelhos vendidos e as saídas de mercadorias, com cliente, data e valor. Use a busca ou a categoria para encontrar um lançamento.'],
  gastos: ['Registre os custos', 'Anote a descrição, o valor, a moeda e a data do gasto. Moeda / câmbio confirma a moeda do valor existente. Excluir gasto remove o registro; baixe um backup se quiser guardar uma cópia.'],
  clientes: ['Consulte por cliente', 'Encontre o cliente pela busca e confira os registros associados a ele. Para corrigir uma venda ou dívida, abra a área correspondente no painel.'],
  locais: ['Onde está cada produto', 'Os locais organizam os saldos. Cadastre um local antes de usá-lo em uma entrada ou transferência.\nNo estoque, escolha o local para conferir apenas as unidades que estão lá.'],
  decisao: ['Números para comparar', 'O ranking usa o estoque, as vendas e os custos registrados. Escolha a moeda e a categoria para comparar.\nAs projeções são estimativas do ritmo anterior, não vendas garantidas. Dados sem moeda ou custo podem limitar a análise.'],
  envios: ['Envios por mês', 'Registre transporte, cliente, mercadorias, quantidades e data. Marcar entregue deixa o card verde. Abra o card para editar, ver rastreio ou excluir.\nPrevisão e rastreio são opcionais no formulário. O prazo vencido usa a previsão informada; o link abre o site da transportadora. Excluir guarda o envio na lixeira do mês para restaurar depois.\nSalvar um envio organiza a lista. Para baixar quantidades, registre também a Saída no estoque.'],
  anotacoes: ['Escreva agora, organize depois', 'Anotação livre: escreva do seu jeito. Anotar envio: use os campos prontos.\nSalve e use Continuar anotação para completar. Em Organizar / enviar, escolha Envios, Financeiro ou Estoque e revise antes de confirmar.\nTroque o mês para consultar as anteriores.'],
  arquivados: ['Lixeira do estoque', 'Consulte aparelhos e mercadorias excluídos e restaure quando precisar. As anotações excluídas ficam na Lixeira de Anotações; as dívidas excluídas ficam em Devedores.'],
  produto: ['Cadastro da mercadoria', 'Preencha nome, preço por unidade e moeda. Foto, custo e observações ajudam a identificar o produto.\nDepois de cadastrar, use Entrada para informar a quantidade e o local. Alterar o cadastro não altera o saldo.'],
  divida: ['Valor original da dívida', 'Informe o total combinado, antes dos pagamentos. O painel desconta os pagamentos registrados para calcular quanto falta.\nPara registrar dinheiro que entrou agora, use Pagamento parcial no card. Não diminua o valor original manualmente.'],
  pagamento: ['Quanto ele pagou agora?', 'Informe somente o valor recebido neste pagamento e a data. O painel desconta esse valor da dívida e mostra o novo saldo.\nSe recebeu em outra moeda, informe a taxa combinada em Câmbio: quantos reais vale US$ 1.'],
  'pagamento-antigo': ['Corrigir um abatimento antigo', 'Corrija o valor abatido, a data ou a observação. O saldo será recalculado. A moeda recebida e o câmbio não foram informados nesse registro antigo.'],
  entrada: ['Somar ao estoque', 'Informe a quantidade que chegou, o local e a data. Ao salvar, essas unidades são somadas ao saldo do produto naquele local.'],
  saida: ['Dar saída no estoque', 'Informe quantidade, local, cliente e preço por unidade. Ao salvar, o saldo desse local diminui.\nSe ficou para pagar depois, marque Anotar esta venda em Devedores. O painel cria a dívida com o total da saída.'],
  transferencia: ['Mudar de local', 'Escolha a quantidade, o local de origem e o destino. O saldo sai de um local e entra no outro; o total do produto permanece igual.'],
  cambio: ['Reais e dólares', 'Escolha a moeda em que o valor foi combinado. Câmbio é opcional para mostrar equivalências e necessário ao receber em outra moeda.\nA cotação é manual: US$ 1 = quantos reais? Alterar a referência não reescreve pagamentos antigos.'],
  nota: ['Sua anotação fica em aberto', 'Escreva e toque em Salvar anotação para guardar no painel. Depois, use Continuar anotação para acrescentar informações.\nA data define o mês. Sem conexão, o rascunho fica só neste aparelho até você conseguir salvar.'],
  'nota-envio': ['Preencha e continue depois', 'Informe transporte, cliente, data e mercadorias. Use + Adicionar mercadoria para incluir mais itens.\nSalvar anotação mantém o texto em aberto no caderno. Para criar um envio, use Organizar / enviar depois.'],
};

function render() {
  $('#page-help').dataset.help=view;
  $('#page-help').setAttribute('aria-label',`Ajuda sobre ${headings[view][0]}`);
  if (invalid && view !== 'anotacoes') { $('#content').innerHTML = empty(!token?'Conecte com sua chave para carregar os dados do painel.':loading?'Carregando os dados do painel…':'Não foi possível carregar os dados. Use Recuperar painel para tentar novamente.'); $('#new-entry').disabled = true; return; }
  const [title,description,button] = headings[view];
  $('#page-title').textContent = view==='estoque'?(locationFilter==='Depósito SP'?'Depósito SP':stockFilter==='principal'?'Estoque principal':title):title; $('#page-description').textContent = description;
  $('#new-entry').textContent = button; $('#new-entry').hidden = !button; $('#new-entry').disabled = !writable && view !== 'anotacoes';
  $('#summary').hidden=['express','tabela'].includes(view);$('.filter-bar').hidden=['express','tabela'].includes(view);
  $('#reconcile').hidden=!pendingOperation;
  const reference=state.settings||{};
  $('#exchange-rate').textContent=reference.fxRate?`R$ ⇄ US$ · ${String(reference.fxRate).replace('.',',')}`:'R$ ⇄ US$ · Câmbio';
  $('#exchange-rate').disabled=!writable;
  $('#exchange-note').textContent=reference.fxRate?`Câmbio informado: US$ 1 = R$ ${String(reference.fxRate).replace('.',',')} · ${dateBR(reference.fxDate)}`:'Valores em R$ e US$. Equivalências aparecem ao informar um câmbio.';
  $('#exchange-note').hidden=['envios','anotacoes','express','tabela'].includes(view);
  const section=['estoque','mercadorias'].includes(view)?'estoque':['devedores','receber','vendas','gastos'].includes(view)?'financeiro':['express','tabela'].includes(view)?'express':['envios','anotacoes'].includes(view)?view:'';
  document.querySelectorAll('[data-section]').forEach(b=>{b.classList.toggle('active',b.dataset.section===section);b.setAttribute('aria-current',b.dataset.section===section?'page':'false');});
  const sectionViews=section==='estoque'?[['estoque','Todos','',''],['estoque','Estoque principal','principal',''],['mercadorias','Mercadorias','mercadorias',''],['estoque','Depósito SP','','Depósito SP']]:section==='financeiro'?[['devedores','Devedores'],['receber','A receber'],['vendas','Vendas'],['gastos','Gastos']]:section==='express'?[['express','Oferta individual'],['tabela','Tabela para clientes']]:[];
  $('#section-tabs').innerHTML=sectionViews.map(([name,label,stock,local])=>`<button type="button" data-view="${name}"${stock!==undefined?` data-stock="${stock}" data-location="${local}"`:''}>${label}</button>`).join('');
  $('#section-tabs').classList.toggle('stock-tabs',section==='estoque');
  $('#section-tabs').hidden=!sectionViews.length;
  $('#shipment-month').closest('label').hidden=view!=='envios';$('#shipment-month').value=shipmentMonth;
  $('#stock-trash').hidden=!['estoque','mercadorias'].includes(view);
  $('#search').placeholder=view==='anotacoes'?'Buscar nas anotações':view==='envios'?'Buscar cliente, transporte ou mercadoria':'Buscar produto, cliente ou observação';
  $('#search').setAttribute('aria-label',$('#search').placeholder);
  $('#search').closest('label').hidden = ['decisao','express','tabela'].includes(view);
  $('#location-filter').closest('label').hidden = !['estoque','mercadorias'].includes(view);
  $('#category-filter').closest('label').hidden = !['estoque','mercadorias','vendas','receber','decisao'].includes(view);
  $('#filter-options').hidden=!['estoque','mercadorias','vendas','receber','decisao'].includes(view);
  const categoryLabel={'peptideos':'Peptídeos','ar-condicionados':'Ar-condicionados',mercadorias:'Mercadorias'}[categoryFilter];
  $('#filter-options-title').textContent=categoryLabel?`Categoria: ${categoryLabel}`:'Categoria';
  const activeFilters=section==='estoque'?[view==='mercadorias'||stockFilter==='mercadorias'?'Mercadorias':stockFilter==='principal'?'Estoque principal':'',locationFilter,categoryLabel,search?`Busca: ${search}`:''].filter(Boolean):['vendas','receber','decisao'].includes(view)?[categoryLabel].filter(Boolean):[];
  $('#active-filters').hidden=!activeFilters.length;
  $('#active-filters').innerHTML=activeFilters.map(label=>`<span class="chip">${esc(label)}</span>`).join('')+(activeFilters.length?'<button type="button" class="ghost" data-action="clear-filters">Limpar filtros</button>':'');
  $('#location-filter').innerHTML='<option value="">Todos os locais</option>'+locationOptions(locationFilter);$('#location-filter').value=locationFilter;
  document.querySelectorAll('[data-view]').forEach(b => { const active=b.dataset.view===view&&(b.dataset.stock===undefined||b.dataset.stock===stockFilter&&b.dataset.location===locationFilter);b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false'); });
  if(awaitingSavedSnapshot&&loading&&!['anotacoes','express','tabela'].includes(view)){$('#summary').innerHTML='';$('#content').innerHTML=empty('Salvo na planilha ✓ Atualizando os valores da lista…');return;}
  if(view==='express')renderExpress();
  else if(view==='tabela')renderPriceTable();
  else if (view === 'mercadorias' || view === 'estoque') renderProducts();
  else if(view==='envios'){$('#summary').innerHTML='';$('#content').innerHTML=modulesLoaded?shipmentView(state,{month:shipmentMonth,search,status:shipmentStatus}):empty('Atualize a conexão para consultar os envios.');}
  else if(view==='arquivados')renderTrash();
  else if(view==='anotacoes'){$('#summary').innerHTML='';$('#content').innerHTML=modulesLoaded?notesView(state,{search,month:notesMonth}):empty('Conecte para carregar suas anotações.');}
  else if (view === 'devedores') {if(modulesLoaded)renderDebts();else{$('#summary').innerHTML='';$('#content').innerHTML=empty('A caderneta ainda não foi carregada. Atualize a conexão para consultar o saldo.');}}
  else if (view === 'decisao') {
    $('#summary').innerHTML='';$('#content').innerHTML=modulesLoaded?decisionView(legacy,state,{today:today(),category:categoryFilter,currency:decisionCurrency,reference}):empty('Atualize a conexão para carregar todos os módulos antes de analisar o painel.');
    const currencySelect=$('#decision-currency');if(currencySelect)currencySelect.addEventListener('change',()=>{decisionCurrency=currencySelect.value;try{localStorage.setItem('puff:decision-currency',decisionCurrency);}catch{}render();});
    const disclosure=$('#decision-details');if(disclosure){disclosure.open=storageRead('puff:decision-collapsed')!=='true';disclosure.addEventListener('toggle',()=>{try{localStorage.setItem('puff:decision-collapsed',String(!disclosure.open));}catch{}});}
  }
  else {
    $('#summary').innerHTML = '';
    $('#content').innerHTML = legacyView(filteredLegacy(),view,search)+extraView();
  }
  if(!writable)document.querySelectorAll('[data-action]').forEach(b=>{if(!['details-product','details-debt','note-copy','note-share','note-open','note-new','note-edit','note-template','filter-location','clear-filters'].includes(b.dataset.action))b.disabled=true;});
  setAlissonBalance(state.commission?.balanceCents || 0);
}

function updateExpressModel(products,reset=false){
  const product=products.find(p=>p.key===$('#express-product').value),select=$('#express-model'),stockName=$('#express-model-product');
  const modelId=reset?expressExactModel(product):select.value;
  if(reset)stockName.value=product?.name||'';
  select.innerHTML=expressModelOptions(product,modelId);
  const details=expressModelDetails(product,modelId,stockName.value);
  select.disabled=!product||!details.hasModels&&!modelId;
  $('#express-model-hint').textContent=details.hint;
  $('#express-model-specs').textContent=details.text;$('#express-model-specs').hidden=!details.text;
  $('#express-model-source').hidden=!details.sourceUrl;
  if(details.sourceUrl)$('#express-model-source').href=details.sourceUrl;
}
function renderExpress(){
  $('#summary').innerHTML='';
  const products=getExpressProducts(legacy,state);
  // Keep the mounted form and focus when a background read completes.
  if($('#express-form')){
    const select=$('#express-product');select.innerHTML=expressProductOptions(products,select.value);
    $('#express-empty').hidden=products.length>0;updateExpressModel(products);return;
  }
  $('#content').innerHTML=expressForm(products,expressDraft);
  const form=$('#express-form'),message=$('#express-message'),copy=$('#express-copy'),share=$('#express-share'),feedback=$('#express-status');
  const invalidate=()=>{message.value='';copy.disabled=true;share.disabled=true;feedback.textContent='';};
  const remember=()=>{expressDraft=Object.fromEntries(new FormData(form));invalidate();try{localStorage.setItem(EXPRESS_DRAFT_KEY,JSON.stringify(expressDraft));}catch{feedback.textContent='Rascunho mantido nesta tela. Não foi possível guardá-lo no aparelho.';}};
  form.addEventListener('input',remember);
  $('#express-product').addEventListener('change',()=>{
    const product=getExpressProducts(legacy,state).find(p=>p.key===$('#express-product').value);
    $('#express-price').value=product?.priceCents?(product.priceCents/100).toFixed(2).replace('.',','):'';
    $('#express-currency').value=product?.currency||'';
    $('#express-specifications').value='';updateExpressModel(getExpressProducts(legacy,state),true);remember();
  });
  $('#express-model').addEventListener('change',()=>{
    const products=getExpressProducts(legacy,state),product=products.find(p=>p.key===$('#express-product').value);
    $('#express-model-product').value=product?.name||'';updateExpressModel(products);remember();
  });
  form.addEventListener('change',remember);
  const generate=()=>{
    try{message.value=buildExpressMessage(readExpressForm(getExpressProducts(legacy,state),new FormData(form)));copy.disabled=false;share.disabled=false;feedback.textContent='Confira a mensagem. Depois, copie ou compartilhe.';return message.value;}
    catch(error){invalidate();feedback.textContent=error.message;return '';}
  };
  form.addEventListener('submit',e=>{e.preventDefault();generate();});
  const send=async shareOnly=>{
    const text=generate();if(!text)return;
    try{
      if(shareOnly&&navigator.share){await navigator.share({title:'Oferta · Puff',text});return;}
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);feedback.textContent='Mensagem copiada. Cole na conversa com o cliente.';return;}
    }catch(error){if(error.name==='AbortError')return;}
    message.focus();message.select();message.setSelectionRange(0,text.length);feedback.textContent='Texto selecionado. Toque e segure para copiar e cole na conversa.';
  };
  copy.addEventListener('click',()=>send(false));share.addEventListener('click',()=>send(true));
}

function renderPriceTable(){
  $('#summary').innerHTML='';
  if($('#price-table-form'))return; // Preserve focus and draft while the stock refreshes.
  $('#content').innerHTML=priceTableForm(priceTableProducts(legacy,state),priceTableDraft);
  const form=$('#price-table-form'),message=$('#price-table-message'),preview=$('#price-table-preview'),feedback=$('#price-table-status');
  const copy=$('#price-table-copy'),share=$('#price-table-share'),print=$('#price-table-print');
  let previewReady=false;
  const invalidate=()=>{message.value='';preview.hidden=true;copy.disabled=true;share.disabled=true;print.disabled=true;preview.onload=null;feedback.textContent='';};
  const remember=()=>{priceTableDraft=Object.fromEntries(new FormData(form));invalidate();try{localStorage.setItem(PRICE_TABLE_DRAFT_KEY,JSON.stringify(priceTableDraft));}catch{feedback.textContent='Rascunho mantido nesta tela. Não foi possível guardá-lo no aparelho.';}};
  form.addEventListener('input',remember);form.addEventListener('change',remember);
  $('#price-table-reload').addEventListener('click',()=>{remember();$('#content').innerHTML='';renderPriceTable();});
  const generate=(printing=false)=>{
    try{
      const data=readPriceTable(priceTableProducts(legacy,state),new FormData(form));
      const html=buildPriceTableHTML(data,dateBR(today()));
      message.value=buildPriceTableText(data);copy.disabled=false;share.disabled=false;preview.hidden=false;
      feedback.textContent='Tabela pronta. Confira os modelos, preços e condições antes de enviar.';
      const printNow=()=>{try{preview.contentWindow.focus();preview.contentWindow.print();}catch{feedback.textContent='Não foi possível abrir a impressão. Use Copiar tabela ou Compartilhar texto.';}};
      if(preview.srcdoc!==html||!previewReady){previewReady=false;print.disabled=true;preview.onload=()=>{previewReady=true;print.disabled=false;if(printing)printNow();};preview.srcdoc=html;}
      else {print.disabled=false;if(printing)printNow();}
      return message.value;
    }catch(error){invalidate();feedback.textContent=error.message;return '';}
  };
  form.addEventListener('submit',event=>{event.preventDefault();generate();});
  const send=async sharing=>{
    const text=generate();if(!text)return;
    try{
      if(sharing&&navigator.share){await navigator.share({title:'Tabela de ar-condicionados · Puff',text});return;}
      if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);feedback.textContent='Tabela copiada. Cole na conversa com o cliente.';return;}
    }catch(error){if(error.name==='AbortError')return;}
    message.focus();message.select();message.setSelectionRange(0,text.length);feedback.textContent='Texto selecionado. Toque e segure para copiar.';
  };
  copy.addEventListener('click',()=>send(false));share.addEventListener('click',()=>send(true));print.addEventListener('click',()=>generate(true));
}

function filteredLegacy(){return ['estoque','mercadorias','vendas','receber'].includes(view)?{...legacy,itens:legacy.itens.filter(p=>!categoryFilter||classifyCategory(p)===categoryFilter)}:legacy;}
function extraView(){
  const products=state.products.filter(p=>!categoryFilter||classifyCategory(p)===categoryFilter), ids=new Set(products.map(p=>p.id));
  if(view==='vendas'){
    const sales=state.movements.filter(m=>m.type==='saida'&&ids.has(m.productId)&&matches(m.client,m.deliveryAddress,m.notes,state.products.find(p=>p.id===m.productId)?.name)).slice().reverse();
    return sales.length?`<h2 class="section-title">Saídas de mercadorias</h2><div class="debt-list">${sales.map(m=>`<article class="debt-card"><h3>${esc(state.products.find(p=>p.id===m.productId)?.name)}</h3><div class="client-location"><span class="context-chip">Cliente <strong>${esc(m.client)}</strong></span><span class="context-chip">Local <strong>${esc(m.location)}</strong></span></div><p>${m.quantity} un. · ${moneyHTML(m.quantity*m.unitPriceCents,m,state.settings)} · ${dateBR(m.date)}</p>${deliveryAddressHTML(m.deliveryAddress)}<div class="card-actions">${action('movement-address',m.id,'✎ Endereço de entrega','secondary')}${!currencyOf(m)?action('movement-currency',m.id,'Confirmar moeda','secondary'):''}</div></article>`).join('')}</div>`:'';
  }
  if(view==='receber')return `<div class="module-note"><strong>Caderneta de devedores</strong>${moneyTotals(state.debts.filter(d=>!d.deletedAt),debtBalance)}<p>Pagamentos parciais e dívidas avulsas ficam na aba Devedores. Os totais de reais e dólares são separados.</p><button type="button" data-action="open-debts" class="secondary">Ver devedores</button></div>`;
  if(view==='clientes'){
    const clients=[...new Set(state.movements.filter(m=>m.type==='saida').map(m=>m.client))].filter(name=>matches(name));
    return clients.length?`<h2 class="section-title">Clientes das mercadorias</h2><div class="product-grid">${clients.map(name=>{const movements=state.movements.filter(m=>m.type==='saida'&&m.client===name);return `<article class="product-card stock-mercadorias"><h3>${esc(name)}</h3><strong>${moneyTotals(movements,m=>m.quantity*m.unitPriceCents)}</strong><p>${movements.reduce((n,m)=>n+m.quantity,0)} unidades · ${esc([...new Set(movements.map(m=>m.location))].join(', '))}</p></article>`;}).join('')}</div>`:'';
  }
  if(view==='locais')return `<h2 class="section-title">Mercadorias por local</h2><div class="product-grid">${locations().filter(loc=>matches(loc)).map(loc=>`<article class="product-card stock-mercadorias"><h3>${esc(loc)}</h3><strong>${state.products.filter(p=>!p.deletedAt).reduce((n,p)=>n+balance(state,p.id,loc),0)} unidades</strong><div class="card-actions"><button type="button" class="secondary" data-action="filter-location" data-location="${esc(loc)}">Ver produtos deste local</button></div></article>`).join('')}</div>`;
  return '';
}

function renderProducts() {
  const selectedStock = view === 'mercadorias' ? 'mercadorias' : stockFilter;
  const products = state.products.filter(p => {
    if(p.deletedAt)return false;
    const clients = state.movements.filter(m=>m.productId===p.id).map(m=>m.client).join(' ');
    return (!selectedStock || (p.stock || 'mercadorias') === selectedStock) && (!categoryFilter||classifyCategory(p)===categoryFilter) && matches(p.name,p.category,p.notes,clients) && (!locationFilter||balance(state,p.id,locationFilter)>0);
  }).sort((a,b)=>Number(b.stock==='principal')-Number(a.stock==='principal'));
  const loc = locationFilter || undefined;
  const mainItems=view==='estoque'&&stockFilter!=='mercadorias'?filteredLegacy().itens.filter(p=>normalize(p.situacao)!=='vendido'&&(!locationFilter||p.local===locationFilter)&&matches(p.modelo,p.cliente,p.notes,p.local)):[];
  const quantity = products.reduce((n,p) => n + balance(state,p.id,loc),mainItems.length);
  $('#summary').innerHTML = `<div class="summary-strip">${stat('Aparelhos',mainItems.length)}${stat('Produtos no catálogo',products.length)}${stat(locationFilter ? `Unidades · ${esc(locationFilter)}` : 'Unidades em estoque',quantity)}</div>`;
  const noCatalog=selectedStock!=='principal'&&!state.products.some(p=>!p.deletedAt);
  const catalogEmpty=modulesLoaded?`<div class="empty stock-empty"><strong>Catálogo de mercadorias vazio</strong><p>Cadastre o produto e depois use Entrada para informar a quantidade e o local, como Depósito SP.</p><div class="card-actions"><button type="button" class="primary" data-action="new-catalog">+ Cadastrar mercadoria</button>${state.shipments?.length?'<button type="button" class="secondary" data-view="envios">Conferir listas em Envios</button>':''}</div><p class="help">Envios guarda suas listas; não altera o saldo do estoque.</p></div>`:empty('Atualize a conexão para consultar o catálogo de mercadorias.');
  $('#content').innerHTML = products.length ? `<div class="product-grid">${products.map(p => {
    const qty = balance(state,p.id,loc), isLow = qty <= p.minStock;
    const lastSale = state.movements.filter(m=>m.productId===p.id&&m.type==='saida').at(-1);
    const places = locations().filter(l=>balance(state,p.id,l)>0).map(l=>`${l}: ${balance(state,p.id,l)}`).join(' · ');
    return `<article class="product-card stock-${esc(p.stock || 'mercadorias')}"><div class="product-top">${image(p)}<div><div class="meta stock-badge">${stockName(p)}</div><h2 class="product-title">${esc(p.name)}</h2><span class="badge ${isLow?'low':'good'}">${qty === 0 ? 'Sem estoque' : isLow ? 'Estoque baixo' : 'Disponível'}</span></div><button type="button" class="ghost edit-product" data-action="edit-product" data-id="${esc(p.id)}" aria-label="Editar ${esc(p.name)}" title="Editar produto"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z"/></svg></button></div>
      <div class="card-values"><div><span class="meta">${locationFilter ? 'Neste local' : 'Disponível'}</span><strong class="stock-number">${qty}<small> un.</small></strong></div><div><span class="meta">Preço por unidade</span><strong>${moneyHTML(p.priceCents,p,state.settings)}</strong></div></div>
      <div class="client-location"><div class="context-chip"><span class="context-label">Local · unidades</span><strong>${esc(places || 'Sem saldo nos locais')}</strong></div><div class="context-chip"><span class="context-label">Último cliente</span><strong>${esc(lastSale?.client || 'Ainda sem saída')}</strong></div></div>
      <details class="card-details"><summary>Detalhes e custos</summary>${p.costCents!=null?`<div class="card-values"><div><span class="meta">Custo por unidade</span><strong>${moneyHTML(p.costCents,p,state.settings,'costCurrency')}</strong></div></div>`:''}<p class="notes">${esc(p.notes)}</p><div class="card-actions">${action('details-product',p.id,'Histórico','ghost')}</div></details>
      <div class="card-actions">${action('entrada',p.id,'↓ Entrada')}${action('saida',p.id,'↑ Saída','primary')}${action('product-delete',p.id,'🗑 Excluir','ghost danger')}</div></article>`;
  }).join('')}</div>` : noCatalog?catalogEmpty:`<div class="empty stock-empty"><strong>${locationFilter?`Nenhum produto com saldo em ${esc(locationFilter)}.`:'Nenhum produto encontrado.'}</strong><p>Confira o local, a categoria e a busca. Para adicionar quantidades, abra a mercadoria e use Entrada.</p><button type="button" class="secondary" data-view="estoque" data-stock="" data-location="">Mostrar todos os produtos</button></div>`;
  if(mainItems.length)$('#content').innerHTML=legacyCards({...legacy,itens:mainItems})+(products.length?`<h2 class="section-title">Catálogo de mercadorias</h2>`+$('#content').innerHTML:noCatalog?catalogEmpty:'');
}

function renderTrash() {
  const products=state.products.filter(p=>p.deletedAt&&matches(p.name,p.category,p.notes));
  $('#summary').innerHTML='';
  $('#content').innerHTML=`<h2 class="section-title">Aparelhos</h2>${legacyView(legacy,'arquivados',search)}<h2 class="section-title">Mercadorias e peptídeos</h2>${products.length?`<div class="product-grid">${products.map(p=>`<article class="product-card stock-mercadorias"><div class="product-top">${image(p)}<div><h3 class="product-title">${esc(p.name)}</h3><span class="meta">Excluído em ${esc(new Date(p.deletedAt).toLocaleDateString('pt-BR'))}</span></div></div><p class="help">${balance(state,p.id)} un. guardadas com o histórico. Restaurar devolve o produto ao estoque.</p><div class="card-actions">${action('product-restore',p.id,'↩ Restaurar produto')}</div></article>`).join('')}</div>`:empty('Nenhuma mercadoria na lixeira.')}<p class="help">Anotações e dívidas têm suas próprias lixeiras.</p><div class="card-actions"><button type="button" class="secondary" data-view="anotacoes">Anotações</button><button type="button" class="secondary" data-view="devedores">Devedores</button></div>`;
}

function productTrash(id,restore=false) {
  const product=state.products.find(p=>p.id===id);if(!product)return;
  if(Boolean(product.deletedAt)!==restore)throw new Error('Este produto mudou. Atualize o painel.');
  openDialog(restore?'Restaurar produto?':'Excluir produto?',`<p class="dialog-summary"><strong>${esc(product.name)}</strong> · ${balance(state,id)} un.</p><p>${restore?'O produto e suas quantidades voltam ao estoque.':'O produto sai do estoque ativo e fica na Lixeira. Você pode restaurá-lo depois.'}</p><p class="help">O histórico permanece guardado. Esta ação não registra venda, recebimento ou cafezinho.</p>`,restore?'Restaurar produto':'Mover para lixeira',async()=>{
    await save(restore?'puffProdutoRestaurar':'puffProdutoExcluir',{productId:id,expected:product,input:{}});
    toast(restore?'Produto restaurado.':'Produto guardado na Lixeira do estoque.');
  });
}

function shipmentDelivery(id) {
  const shipment=(state.shipments||[]).find(s=>s.id===id);if(!shipment)return;
  if(shipment.deletedAt)throw new Error('Restaure o envio antes de marcar a entrega.');
  const delivered=shipment.status==='delivered';
  openDialog(delivered?'Desfazer entrega?':'Marcar como entregue',`<p class="dialog-summary"><strong>${esc(shipment.client)}</strong><br>${esc(shipment.transport)} · enviado em ${dateBR(shipment.date)}</p>${delivered?'<p>O envio volta a Aguardando entrega.</p>':field('Data da entrega · opcional','deliveredDate','date','',`min="${esc(shipment.date)}" max="${today()}"`)}<p class="help">Confirma apenas a chegada. O estoque, as vendas e o cafezinho permanecem iguais.</p>`,delivered?'Voltar para aguardando':'Confirmar entrega',async data=>{
    const deliveredDate=delivered?'':String(data.get('deliveredDate')||'');
    if(deliveredDate&&deliveredDate>today())throw new Error('A entrega confirmada não pode ter uma data futura.');
    await save('puffEnvio',{shipmentId:id,expected:shipment,input:{status:delivered?'pending':'delivered',deliveredDate}});
    toast(delivered?'Envio voltou para aguardando.':'Entrega confirmada.');
  },'envios');
}

function shipmentTrash(id,restore=false) {
  const shipment=(state.shipments||[]).find(s=>s.id===id);if(!shipment)return;
  if(Boolean(shipment.deletedAt)!==restore)throw new Error('Este envio mudou. Atualize o painel.');
  openDialog(restore?'Restaurar envio?':'Excluir envio?',`<p class="dialog-summary"><strong>${esc(shipment.client)}</strong><br>${esc(shipment.transport)} · ${dateBR(shipment.date)}</p><p>${restore?'O envio volta à lista com as mercadorias e a situação que tinha.':'O envio fica na lixeira deste mês. Você pode restaurá-lo depois.'}</p><p class="help">Estoque, vendas, anotações e cafezinho permanecem iguais.</p>`,restore?'Restaurar envio':'Mover para lixeira',async()=>{
    await save(restore?'puffEnvioRestaurar':'puffEnvioExcluir',{shipmentId:id,expected:shipment,input:{}});
    toast(restore?'Envio restaurado.':'Envio guardado em Envios excluídos.');
  },'envios');
}

function renderDebts() {
  const debts = state.debts.filter(d => !d.deletedAt && matches(d.name,d.description,d.notes)).sort((a,b)=>Number(debtBalance(a)===0)-Number(debtBalance(b)===0));
  const openCount = debts.filter(d=>debtBalance(d)>0).length;
  $('#summary').innerHTML = `<div class="summary-strip">${stat('Saldo a receber',moneyTotals(debts,debtBalance))}${stat('Abatido das dívidas',moneyTotals(debts,d=>d.totalCents-debtBalance(d)),'success')}${stat('Dívidas em aberto',openCount)}</div>`;
  $('#content').innerHTML = debts.length ? `<div class="debt-list">${debts.map((d,index)=>{
    const remaining = debtBalance(d), paid = d.totalCents-remaining, payments = d.payments.filter(p=>!p.deletedAt);
    const late = remaining > 0 && d.dueDate && d.dueDate < today();
    const hue=remaining?0:150;
    const heading = index===0 || index===openCount ? `<h2 class="section-title">${remaining?'Em aberto':'Quitados'} · ${remaining?openCount:debts.length-openCount}</h2>` : '';
    return `${heading}<article class="debt-card debt-progress-color ${remaining?'debt-open':'debt-settled'}" style="--debt-hue:${Math.round(hue)}"><div class="debt-top"><div><div class="debt-person"><span class="avatar" aria-hidden="true">${esc(d.name.slice(0,1))}</span><div><h2>${esc(d.name)}</h2><p class="meta">${esc(d.description)}</p></div></div></div><span class="badge ${remaining===0?'good':'danger'}">${remaining===0?'Quitado':late?'Vencido':paid?'Pagamento parcial':'Em aberto'}</span></div>
      <div class="debt-amount"><span class="meta">Falta receber</span><strong>${moneyHTML(remaining,d,state.settings)}</strong></div>
      <div class="debt-progress" role="progressbar" aria-label="Valor recebido" aria-valuemin="0" aria-valuemax="${d.totalCents}" aria-valuenow="${paid}" aria-valuetext="${esc(money(paid,d.currency))} de ${esc(money(d.totalCents,d.currency))}"><span style="width:${paid/d.totalCents*100}%"></span></div>
      <div class="payment-row"><span class="meta">Abatido <b>${money(paid,d.currency)}</b></span><span class="meta">Total ${money(d.totalCents,d.currency)}</span></div>
      <p class="notes">${payments.length ? `Último abatimento: ${money(payments.at(-1).amountCents,d.currency)} em ${dateBR(payments.at(-1).date)}` : `Anotado em ${dateBR(d.date)}`}${d.dueDate ? ` · Vence ${dateBR(d.dueDate)}` : ''}</p>
      <div class="card-actions">${action('debt-edit',d.id,'✎ Editar dívida','secondary')}${remaining ? action('payment',d.id,'+ Registrar pagamento parcial','primary') : '<span class="paid-label">✓ Tudo recebido</span>'}${action('details-debt',d.id,'Histórico / pagamentos','secondary')}${action('debt-delete',d.id,'🗑 Excluir','ghost')}</div></article>`;
  }).join('')}</div>` : empty('Nenhuma dívida encontrada. Anote o nome, o motivo e o valor para começar.');
  const deleted=state.debts.filter(d=>d.deletedAt&&matches(d.name,d.description,d.notes));
  $('#content').innerHTML+=`<details class="notes-trash"><summary>🗑 Dívidas excluídas · ${deleted.length}</summary><p class="help">Fora dos totais. Restaure para voltar a acompanhar a dívida e seus pagamentos.</p><div class="debt-list">${deleted.map(d=>`<article class="debt-card"><h2>${esc(d.name)}</h2><p>${esc(d.description)}</p><p>Saldo: ${money(debtBalance(d),d.currency)}</p><div class="card-actions">${action('debt-restore',d.id,'↩ Restaurar dívida')}${action('details-debt',d.id,'Ver histórico','ghost')}</div></article>`).join('')||'<p class="help">Nenhuma dívida excluída para esta busca.</p>'}</div></details>`;
}

function field(label,name,type='text',value='',extra='') {
  return `<label class="field" for="f-${name}"><span>${label}</span><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
}
function notes(value = '') { return `<label class="field" for="f-notes"><span>Observações <small>opcional</small></span><textarea id="f-notes" name="notes" rows="3" maxlength="1000" placeholder="Um detalhe para lembrar depois…">${esc(value)}</textarea></label>`; }
function openDialog(title, fields, saveLabel, save, helpTopic = '') {
  dialogInstance++;
  $('#dialog-fields').oninput=null;$('#dialog-fields').onchange=null;
  $('#dialog-title').textContent = title; $('#dialog-fields').innerHTML = fields;
  $('#dialog-help').hidden=!helpTopic; $('#dialog-help').dataset.help=helpTopic;
  $('#form-error').textContent = ''; $('#save-dialog').textContent = saveLabel || 'Salvar';
  $('#save-dialog').disabled=saving;
  $('#save-dialog').hidden = !save; $('#cancel-dialog').textContent = save ? 'Cancelar' : 'Fechar';
  dialogAction = save; dialogVersion = stored; $('#editor').showModal();
}
function closeDialog() {
  if(saving){stoppedWaiting=true;for(const request of activeRequests)request.controller.abort();toast('A tentativa ficou guardada. Use Recuperar painel antes de registrar novamente.');}
  else if($('#save-dialog').disabled)return;
  $('#editor').close();
  if(refreshAfterClose&&!saving&&!loading){refreshAfterClose=false;refreshPromise=load();}
}

function productForm(id, sourceNote) {
  const product = state.products.find(p=>p.id===id);
  if(product?.deletedAt)throw new Error('Restaure o produto pela Lixeira antes de editar.');
  openDialog(product ? 'Editar produto' : 'Nova mercadoria',
    field('Nome do produto','name','text',product?.name || '','required maxlength="120" placeholder="Ex.: Kit de acessórios"')+
    '<p class="help">Mercadorias · controle por quantidade. Também aparece na aba Estoque.</p>'+
    `<label class="field" for="f-category"><span>Categoria</span><select id="f-category" name="category">${['Mercadorias','Peptídeos','Ar-condicionados'].map(c=>`<option ${classifyCategory({category:c})===classifyCategory(product||{})?'selected':''}>${c}</option>`).join('')}</select></label>`+
    currencyForm(product||{currency:'BRL',costCurrency:'BRL',...state.settings,costFxRate:state.settings?.fxRate,costFxDate:state.settings?.fxDate},{cost:true,reference:state.settings})+
    `<div class="form-grid">${field('Preço de venda por unidade','price','text',((product?.priceCents || 0)/100).toFixed(2),'required inputmode="decimal"')}${field('Custo por unidade · opcional','cost','text',product?.costCents==null?'':(product.costCents/100).toFixed(2),'inputmode="decimal" placeholder="Na moeda da compra"')}</div>`+
    field('Avisar quando chegar a (unidades)','minStock','number',product?.minStock ?? 5,'required min="0" max="1000000" step="1"')+
    `<label class="field" for="f-photo"><span>Foto do produto <small>opcional</small></span><input id="f-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small class="help">JPG, PNG ou WebP até 5 MB. Redimensionamos automaticamente.</small></label>${product?.photo?'<label class="check-field"><input name="removePhoto" type="checkbox"> Remover foto atual</label>':''}`+
    notes(product?.notes), 'Salvar produto', async data => {
      let photo = product?.photo || '';
      if (data.get('removePhoto')) photo = '';
      photo=await readPhoto(data.get('photo'),photo);
      const input={name:data.get('name'),stock:'mercadorias',category:data.get('category'),priceCents:cents(data.get('price')),costCents:String(data.get('cost')).trim()?cents(data.get('cost')):null,...readCurrencyForm(data,{cost:true}),minStock:Number(data.get('minStock')),notes:data.get('notes'),photo};
      await save('puffProduto',{input,...noteSource(sourceNote),...(product?{productId:product.id,expected:product}:{})});
      if(!product){view='mercadorias';stockFilter='mercadorias';locationFilter='';categoryFilter='';search='';$('#search').value='';$('#category-filter').value='';render();}
      toast(product?'Produto atualizado.':'Produto cadastrado. Use Entrada para informar quantidade e local.');
    }, 'produto');
  if(sourceNote){const draft=noteToShipment(sourceNote,today()).input;if(draft.items.length===1)$('#f-name').value=draft.items[0].name;$('#f-notes').value=draft.notes;$('#mf-currency').value='';$('#mf-costCurrency').value='';attachNote(sourceNote,'Confira nome, moeda e preço. O produto será cadastrado; a quantidade entra depois em Entrada.');}
}

function debtForm(sourceNote,id) {
  const debt=id?state.debts.find(d=>d.id===id):null;
  if(id&&!debt)return;
  if(debt?.deletedAt)throw new Error('Restaure a dívida antes de editar.');
  const paid=debt?debt.totalCents-debtBalance(debt):0;
  openDialog(debt?'Editar dívida':'Nova anotação de dívida',field('Quem deve?','name','text',debt?.name||'','required maxlength="120" placeholder="Nome da pessoa"')+
    field('Sobre o que deve?','description','text',debt?.description||'','required maxlength="1000" placeholder="Ex.: iPhone, serviço, empréstimo…"')+
    field('Quantidade de itens neste combinado','units','number',debt?.units||1,'required min="1" max="1000000" step="1"')+
    currencyForm(debt||{currency:'BRL',...state.settings},{reference:state.settings})+
    (debt?.payments.length?'<p class="help">Há pagamentos no histórico: uma moeda já confirmada fica preservada. Corrija os pagamentos pelo histórico.</p>':'')+
    `<div class="form-grid">${field('Valor original da dívida','total','text',debt?(debt.totalCents/100).toFixed(2):'','required inputmode="decimal" placeholder="Ex.: 2000,00"')}${field('Data da anotação','date','date',debt?.date||today(),'required')}</div>`+
    (debt?`<p class="help">Já abatido: ${money(paid,debt.currency)}. O saldo será recalculado a partir do valor original e dos pagamentos.</p>`:'')+
    field('Vencimento (opcional)','dueDate','date',debt?.dueDate||'')+notes(debt?.notes), 'Salvar dívida', async data=>{
      const input={name:data.get('name'),description:data.get('description'),units:Number(data.get('units')),totalCents:cents(data.get('total')),...readCurrencyForm(data),date:data.get('date'),dueDate:data.get('dueDate'),notes:data.get('notes')};
      if(input.totalCents<paid)throw new Error('O valor original não pode ser menor que o total já abatido. Confira os pagamentos no histórico.');
      await save(debt?'puffDividaEdit':'puffDivida',{...(debt?{debtId:debt.id,expected:debt}:noteSource(sourceNote)),input});toast(debt?'Dívida atualizada.':'Dívida anotada.');
    }, 'divida');
  if(sourceNote){const draft=noteToDebt(sourceNote,today());for(const name of ['name','description','total','date','notes'])$('#f-'+name).value=draft.input[name]||'';$('#f-units').value=draft.input.units||1;$('#mf-currency').value=draft.input.currency||'';attachNote(sourceNote,'Confira pessoa, valor e moeda antes de registrar o valor a receber.',draft.warnings);}
}
function paymentForm(id,paymentId) {
  const debt = state.debts.find(d=>d.id===id); if (!debt) return;
  if(debt.deletedAt)throw new Error('Restaure a dívida antes de alterar pagamentos.');
  const payment=paymentId?debt.payments.find(p=>p.id===paymentId):null;
  if(paymentId&&!payment)return;
  if(payment?.deletedAt)throw new Error('Restaure o pagamento antes de editar.');
  if(payment&&payment.receivedCents===undefined){
    openDialog(`Editar pagamento · ${debt.name}`,`<p class="help">Este registro antigo informa apenas o abatimento. A moeda recebida e o câmbio continuam sem identificação.</p>`+field(`Abatimento registrado · ${currencyOf(debt)||'moeda a confirmar'}`,'amount','text',(payment.amountCents/100).toFixed(2),'required inputmode="decimal"')+field('Data do pagamento','date','date',payment.date,`required min="${esc(debt.date)}"`)+notes(payment.note),'Salvar pagamento',async data=>{
      await save('puffPagamentoEdit',{debtId:id,paymentId,expected:debt,input:{amountCents:cents(data.get('amount')),date:data.get('date'),note:data.get('notes')}});toast('Pagamento corrigido e saldo recalculado.');
    }, 'pagamento-antigo');return;
  }
  if(!currencyOf(debt)){debtCurrencyForm(id);return;}
  const remaining = debtBalance(debt)+(payment?.amountCents||0);
  openDialog(`${payment?'Editar pagamento':'Pagamento'} · ${debt.name}`,`<p class="dialog-summary">${esc(debt.description)}<br>${payment?'Saldo sem este pagamento':'Saldo atual'} <strong>${money(remaining,debt.currency)}</strong></p><p class="help">${payment?'Corrija o valor recebido ou a data. O saldo será recalculado.':'Receba uma parte ou o total.'} Para receber em outra moeda, informe o câmbio deste pagamento.</p>`+
    currencyForm(payment||{currency:debt.currency,...state.settings},{reference:state.settings})+
    `<div class="form-grid">${field(payment?'Valor recebido neste pagamento':'Valor recebido agora','amount','text',payment?(payment.receivedCents/100).toFixed(2):'','required inputmode="decimal" placeholder="Ex.: 500,00" aria-describedby="payment-remaining"')}${field('Data do pagamento','date','date',payment?.date||today(),`required min="${esc(debt.date)}"`)}</div><p id="payment-remaining" class="payment-preview" role="status"></p>`+notes(payment?.note), payment?'Salvar pagamento':'Registrar pagamento',async data=>{
      const currency=readCurrencyForm(data),receivedCents=cents(data.get('amount'));
      const applied=convertCents(receivedCents,currency.currency,debt.currency,currency.fxRate);
      if(applied==null)throw new Error('Informe o câmbio para receber em outra moeda.');
      if(applied<=0||applied>remaining)throw new Error(`O abatimento precisa ser maior que zero e até ${money(remaining,debt.currency)}.`);
      await save(payment?'puffPagamentoEdit':'puffPagamento',{debtId:id,expected:debt,...(payment?{paymentId}:{}),input:{receivedCents,...currency,date:data.get('date'),note:data.get('notes')}},payment?'':'Pagamento recebido');toast('Pagamento registrado e saldo atualizado.');
    }, 'pagamento');
  const preview = $('#payment-remaining');
  const updateRemaining = () => {
    preview.classList.remove('success');
    try {
      const input=readCurrencyForm({get:name=>$('#mf-'+name).value});
      const amount = convertCents(cents($('#f-amount').value),input.currency,debt.currency,input.fxRate);
      if(amount==null){preview.textContent='Informe o câmbio para receber em outra moeda.';return;}
      if(!amount)throw new Error();
      if(amount>remaining){preview.textContent=`O pagamento não pode ultrapassar o saldo de ${money(remaining,debt.currency)}.`;return;}
      const conversion=input.currency!==debt.currency?`Abatimento: ${money(amount,debt.currency)} (US$ 1 = R$ ${String(input.fxRate).replace('.',',')}). `:'';
      preview.textContent=conversion+(amount===remaining?'✓ Este pagamento quita a dívida.':`Após este pagamento, falta receber ${money(remaining-amount,debt.currency)}.`);
      preview.classList.toggle('success',amount===remaining);
    } catch { preview.textContent='Digite o valor recebido para conferir quanto ainda falta.'; }
  };
  $('#f-amount').addEventListener('input',updateRemaining);
  ['currency','fxRate','fxDate'].forEach(name=>$('#mf-'+name).addEventListener('input',updateRemaining));updateRemaining();
}

function movementForm(id,type,sourceNote) {
  const p=state.products.find(p=>p.id===id); if(!p)return;
  if(p.deletedAt)throw new Error('Restaure o produto pela Lixeira antes de movimentar.');
  const titles={entrada:'Registrar entrada',saida:'Registrar saída',transferencia:'Transferir entre locais'};
  const source=locationFilter || (type!=='entrada'&&locations().find(local=>balance(state,id,local)>0)) || 'Depósito SP';
  openDialog(titles[type],`<p class="dialog-summary"><strong>${esc(p.name)}</strong><br><span id="stock-at-location">${balance(state,id,source)} un. em ${esc(source)}</span></p>`+
    `<div class="form-grid">${field('Quantidade','quantity','number',1,'required min="1" max="1000000" step="1"')}<label class="field" for="f-location"><span>${type==='transferencia'?'Local de origem':'Local'}</span><select name="location" id="f-location">${locationOptions(source)}</select></label></div>`+
    (type==='transferencia'?`<label class="field" for="f-toLocation"><span>Local de destino</span><select id="f-toLocation" name="toLocation">${locationOptions(source==='Loja'?'Depósito SP':'Loja')}</select></label>`:'')+
    (type==='saida'?currencyForm({currency:p.currency,...state.settings},{reference:state.settings})+`<div class="form-grid">${field('Cliente','client','text','','required maxlength="120" placeholder="Nome de quem recebeu"')}${field('Valor por unidade','unitPrice','text',(p.priceCents/100).toFixed(2),'required inputmode="decimal"')}</div>${deliveryAddressField()}<p class="movement-total" id="movement-total"></p><label class="check-field"><input type="checkbox" name="createDebt"> Anotar esta venda em Devedores</label><p class="help">Marque quando o pagamento ficar para depois. A moeda e o valor desta saída entram na caderneta.</p>`:'')+
    field('Data','date','date',today(),'required')+notes(),'Salvar movimentação',async data=>{
      const quantity=Number(data.get('quantity')),unitPriceCents=type==='saida'?cents(data.get('unitPrice')):p.priceCents;
      const currency=type==='saida'?readCurrencyForm(data):{currency:p.currency,fxRate:p.fxRate,fxDate:p.fxDate};
      await save('puffMovimento',{productId:id,...noteSource(sourceNote),input:{type,quantity,location:data.get('location'),toLocation:data.get('toLocation')||'',client:data.get('client')||'',deliveryAddress:data.get('deliveryAddress')||'',unitPriceCents,...currency,date:data.get('date'),notes:data.get('notes')},createDebt:type==='saida'&&Boolean(data.get('createDebt'))},type==='saida'?`${quantity} ${quantity===1?'unidade registrada':'unidades registradas'}`:'');toast('Movimentação registrada.');
    }, type);
  if(sourceNote){const draft=noteToShipment(sourceNote,today()).input;$('#f-quantity').value=draft.items.length===1?draft.items[0].quantity:'';$('#f-date').value=draft.date||today();$('#f-notes').value=draft.notes;if(type==='saida')$('#f-client').value=draft.client;attachNote(sourceNote,'Confira produto, quantidade e local. Ao confirmar, esta operação altera o estoque.');}
  $('#f-location').addEventListener('change',()=>{$('#stock-at-location').textContent=`${balance(state,id,$('#f-location').value)} un. em ${$('#f-location').value}`;});
  if(type==='saida'){
    const updateTotal=()=>{try{$('#movement-total').textContent='Total da saída: '+money(Number($('#f-quantity').value)*cents($('#f-unitPrice').value),$('#mf-currency').value);}catch{$('#movement-total').textContent='Informe quantidade e valor por unidade.';}};
    $('#f-quantity').addEventListener('input',updateTotal);$('#f-unitPrice').addEventListener('input',updateTotal);$('#mf-currency').addEventListener('change',updateTotal);updateTotal();
  }
}

function exchangeForm() {
  const reference=state.settings||{};
  openDialog('Câmbio de referência',`<p class="help">Informe a cotação que você usa hoje. Ela mostra equivalências nos cards e pode ser copiada para um novo lançamento. Pagamentos antigos conservam suas taxas.</p><div class="form-grid">${field('US$ 1 vale quantos reais?','rate','text',reference.fxRate??'','inputmode="decimal" placeholder="Ex.: 5,25"')}${field('Data da cotação','rateDate','date',reference.fxDate||today())}</div><p class="help">Cotação informada manualmente. Deixe o valor vazio para retirar a referência.</p>`,'Salvar câmbio',async data=>{
    const input=readCurrencyForm({get:name=>name==='currency'?'BRL':name==='fxRate'?data.get('rate'):data.get('rateDate')});
    await save('puffCambio',{input:{fxRate:input.fxRate,fxDate:input.fxDate}});toast('Câmbio de referência atualizado.');
  }, 'cambio');
}
function debtCurrencyForm(id) {
  const debt=state.debts.find(d=>d.id===id);if(!debt)return;
  if(debt.deletedAt)throw new Error('Restaure a dívida antes de editar.');
  openDialog(`Moeda · ${debt.name}`,`<p class="dialog-summary">Valor original: <strong>${money(debt.totalCents,debt.currency)}</strong><br>Falta receber: <strong>${money(debtBalance(debt),debt.currency)}</strong></p>`+currencyForm(debt,{reference:state.settings})+'<p class="help">Confirma a moeda dos números existentes, sem converter os valores. Depois de receber pagamentos, uma moeda já confirmada fica preservada.</p>','Salvar moeda e câmbio',async data=>{
    await save('puffDividaEdit',{debtId:id,expected:debt,input:readCurrencyForm(data)});toast('Moeda da dívida atualizada.');
  });
}
function movementCurrencyForm(id) {
  const movement=state.movements.find(m=>m.id===id);if(!movement)return;
  openDialog('Confirmar moeda da saída',`<p class="dialog-summary">${esc(movement.client)} · ${dateBR(movement.date)}<br>${movement.quantity} unidades · ${money(movement.quantity*movement.unitPriceCents,movement.currency)}</p>`+currencyForm(movement,{reference:state.settings})+'<p class="help">O número registrado permanece igual; esta ação identifica a moeda do lançamento antigo.</p>','Confirmar moeda',async data=>save('puffMovimentoEdit',{movementId:id,expected:movement,input:readCurrencyForm(data)}));
}
function movementAddressForm(id) {
  const movement=state.movements.find(m=>m.id===id&&m.type==='saida');if(!movement)return;
  openDialog('Endereço de entrega',`<p class="dialog-summary">${esc(movement.client)} · ${dateBR(movement.date)}</p>`+deliveryAddressField(movement.deliveryAddress),'Salvar endereço',async data=>{
    await save('puffMovimentoEdit',{movementId:id,expected:movement,input:{deliveryAddress:data.get('deliveryAddress')}});toast('Endereço atualizado.');
  });
}
function productDetails(id) {
  const p=state.products.find(p=>p.id===id);if(!p)return;
  if(p.deletedAt){view='arquivados';$('#editor').close();render();toast('Produto na Lixeira. Restaure para continuar.');return;}
  const movements=state.movements.filter(m=>m.productId===id).slice().reverse();
  openDialog(p.name,`<div class="chips">${locations().map(l=>`<span class="chip">${esc(l)} <b>${balance(state,id,l)} un.</b></span>`).join('')}</div><p class="notes">${esc(p.notes)}</p><div class="card-actions">${action('transferencia',id,'⇄ Transferir entre locais')}</div><h3>Histórico de movimentações</h3><div class="timeline">${movements.map(m=>`<div class="movement"><span class="movement-icon">${m.type==='entrada'?'↓':m.type==='saida'?'↑':'⇄'}</span><div class="movement-main"><strong>${m.type==='entrada'?'Entrada':m.type==='saida'?'Saída':'Transferência'} · ${m.quantity} un.</strong><div class="meta">${esc(m.location)}${m.toLocation?' → '+esc(m.toLocation):''}${m.client?' · '+esc(m.client):''}</div><div class="meta">${dateBR(m.date)}${m.type==='saida'?' · '+moneyHTML(m.quantity*m.unitPriceCents,m,state.settings):''}</div>${m.type==='saida'?deliveryAddressHTML(m.deliveryAddress)+action('movement-address',m.id,'✎ Endereço de entrega'):''}${m.type==='saida'&&!currencyOf(m)?action('movement-currency',m.id,'Confirmar moeda'):''}${m.notes?`<p class="notes">${esc(m.notes)}</p>`:''}</div></div>`).join('') || empty('Nenhuma movimentação. Registre a primeira entrada.')}</div>`,null,null);
}
function debtDetails(id) {
  const d=state.debts.find(d=>d.id===id);if(!d)return;
  const payments=deleted=>d.payments.filter(p=>Boolean(p.deletedAt)===deleted).slice().reverse().map(p=>`<div class="payment-row"><div><strong>${dateBR(p.date)}</strong>${p.note?`<p class="meta">${esc(p.note)}</p>`:''}<p class="meta">${p.receivedCents!=null?`Recebido: ${money(p.receivedCents,p.currency)}${p.fxRate?` · US$ 1 = R$ ${esc(p.fxRate)} · ${dateBR(p.fxDate)}`:''}`:'Registro anterior à identificação da moeda recebida.'}</p><strong class="${deleted?'meta':'success'}">${deleted?'Abatimento excluído':'Abatido'} ${money(p.amountCents,d.currency)}</strong>${!d.deletedAt?`<div class="card-actions">${deleted?`<button type="button" class="secondary" data-action="payment-restore" data-id="${esc(id)}" data-payment-id="${esc(p.id)}">↩ Restaurar pagamento</button>`:`<button type="button" class="secondary" data-action="payment-edit" data-id="${esc(id)}" data-payment-id="${esc(p.id)}">✎ Editar pagamento</button><button type="button" class="ghost" data-action="payment-delete" data-id="${esc(id)}" data-payment-id="${esc(p.id)}">🗑 Excluir pagamento</button>`}</div>`:''}</div></div>`).join('');
  openDialog(`Histórico · ${d.name}`,`${d.deletedAt?'<p class="help">Dívida excluída, fora dos totais. Restaure para fazer alterações.</p>':''}<p class="dialog-summary">${esc(d.description)}<br>Valor original <strong>${money(d.totalCents,d.currency)}</strong><br>Falta receber <strong>${money(debtBalance(d),d.currency)}</strong></p>${d.notes?`<p class="notes">${esc(d.notes)}</p>`:''}<h3>Pagamentos registrados</h3><div class="payments">${payments(false)||empty('Nenhum pagamento ativo. Registre os recebimentos para abater o saldo.')}</div><details class="notes-trash"><summary>Pagamentos excluídos · ${d.payments.filter(p=>p.deletedAt).length}</summary><div class="payments">${payments(true)||'<p class="help">Nenhum pagamento excluído.</p>'}</div></details><p class="help">Dívida anotada em ${dateBR(d.date)}${d.dueDate?` · vencimento ${dateBR(d.dueDate)}`:''}.</p>`,null,null);
}

function debtTrash(id,restore=false,paymentId) {
  const debt=state.debts.find(d=>d.id===id);if(!debt)return;
  const payment=paymentId?debt.payments.find(p=>p.id===paymentId):null;
  if(paymentId&&!payment)return;
  if(payment&&debt.deletedAt)throw new Error('Restaure a dívida antes de alterar pagamentos.');
  const target=payment||debt;
  if(Boolean(target.deletedAt)!==restore)throw new Error('Este registro mudou. Atualize o painel.');
  const kind=payment?'pagamento':'dívida', verb=restore?'Restaurar':'Excluir';
  const explanation=payment?(restore?'O pagamento volta a abater a dívida, se ainda houver saldo suficiente.':'O abatimento será desfeito e o saldo a receber aumentará. Você pode restaurar este pagamento no histórico.'):(restore?'A dívida e seus pagamentos ativos voltam aos totais da caderneta.':'A dívida e seus pagamentos saem dos totais da caderneta. Você pode restaurá-la em Dívidas excluídas. Vendas, estoque e envios permanecem como estão.');
  openDialog(`${verb} ${kind}?`,`<p class="dialog-summary">${esc(debt.name)} · ${money(payment?.amountCents??debt.totalCents,debt.currency)}</p><p>${explanation}</p>`,`${verb} ${kind}`,async()=>{
    await save(`puff${payment?'Pagamento':'Divida'}${restore?'Restaurar':'Excluir'}`,{debtId:id,expected:debt,...(payment?{paymentId}:{}),input:{}});
    view='devedores';search='';$('#search').value='';render();toast(restore?'Registro restaurado.':'Registro excluído. Você pode restaurá-lo pelo histórico.');
  });
}

function noteSource(note) { return note ? {sourceNoteId:note.id,expectedNote:note} : {}; }
function attachNote(note, message, warnings=[]) {
  $('#dialog-fields').insertAdjacentHTML('afterbegin',`<p class="help note-review">${esc(message)}</p><details class="note-source"><summary>Ver anotação original</summary><p class="note-text">${esc(note.text)}</p></details>${warnings.length?`<p class="help">${warnings.map(esc).join(' ')}</p>`:''}`);
}
function noteEditor(id, template=false) {
  const note=(state.notes||[]).find(n=>n.id===id);
  if(note?.deletedAt)throw new Error('Restaure a anotação pela lixeira antes de editar.');
  if(note?.convertedTo){openNoteTarget(note);return;}
  let drafts={};try{drafts=JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY))||{};}catch{}
  const defaultDate=notesMonth&&notesMonth!==today().slice(0,7)?`${notesMonth}-01`:today();
  const draftKey=id||(template?`envio:${notesMonth||today().slice(0,7)}`:'new');
  const draft=typeof drafts[draftKey]==='string'?{text:drafts[draftKey]}:drafts[draftKey]||{};
  const form=template?shipmentNoteForm(draft,defaultDate):noteForm({...note,...draft},defaultDate);
  openDialog(form.title,form.html,'Salvar anotação',async data=>{
    const input=form.build(data);
    await save('puffNota',{input,...(note?{noteId:note.id,expected:note}:{})});
    try{const current=JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY))||{};delete current[draftKey];localStorage.setItem(NOTE_DRAFT_KEY,JSON.stringify(current));}catch{}
    view='anotacoes';notesMonth=input.date.slice(0,7);search='';$('#search').value='';render();toast('Anotação salva e em aberto. Use Continuar anotação para completar.');
  }, template?'nota-envio':'nota');
  const rememberDraft=()=>{try{
    const data=new FormData($('#editor-form')),current=JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY))||{};
    current[draftKey]=template?{date:data.get('date'),transport:data.get('transport'),client:data.get('client'),notes:data.get('notes'),items:data.getAll('shipmentItem').map((name,i)=>({name,quantity:data.getAll('shipmentQuantity')[i]}))}:{text:data.get('text'),date:data.get('date')};
    localStorage.setItem(NOTE_DRAFT_KEY,JSON.stringify(current));
  }catch{toast('Sem espaço para guardar o rascunho. Salve a anotação antes de sair.');}};
  $('#dialog-fields').oninput=rememberDraft;$('#dialog-fields').onchange=rememberDraft;
  if(!writable)$('#form-error').textContent='Sem conexão para salvar na planilha. O rascunho fica neste aparelho enquanto você escreve.';
  $(template?'#sf-transport':'#nf-text').focus();
}
function noteDestination(id) {
  const note=(state.notes||[]).find(n=>n.id===id);if(!note)return;
  if(note.deletedAt)throw new Error('Restaure a anotação pela lixeira antes de organizar.');
  if(note.convertedTo){openNoteTarget(note);return;}
  openDialog('Para onde vai esta anotação?',`<p class="help">Escolha o destino. Você revisa os campos antes de confirmar.</p><div class="note-destinations"><button type="button" data-action="note-to-shipment" data-id="${esc(id)}"><span aria-hidden="true">🚚</span><span><strong>Envios</strong><small>Transporte, cliente e mercadorias por mês</small></span><span aria-hidden="true">→</span></button><button type="button" data-action="note-to-debt" data-id="${esc(id)}"><span aria-hidden="true">💰</span><span><strong>Financeiro</strong><small>Registrar uma dívida / valor a receber</small></span><span aria-hidden="true">→</span></button><button type="button" data-action="note-to-stock" data-id="${esc(id)}"><span aria-hidden="true">📦</span><span><strong>Estoque</strong><small>Cadastrar mercadoria ou registrar entrada e saída</small></span><span aria-hidden="true">→</span></button></div><div class="card-actions"><button type="button" class="secondary" data-action="note-share" data-id="${esc(id)}">Compartilhar texto</button><button type="button" class="ghost" data-action="note-copy" data-id="${esc(id)}">Copiar</button></div>`,null,null);
}
function noteTrash(id,restore=false) {
  const note=(state.notes||[]).find(n=>n.id===id);if(!note)return;
  if(Boolean(note.deletedAt)!==restore)throw new Error('Esta anotação mudou. Atualize o painel.');
  openDialog(restore?'Restaurar anotação':'Excluir anotação?',`<p>${restore?'A anotação volta para sua lista.':'A anotação vai para a lixeira. Você pode restaurá-la depois.'}</p>${note.convertedTo?'<p class="help">O registro que ela gerou continua no painel, sem alterações.</p>':''}<p class="notes note-text">${esc(note.text)}</p>`,restore?'Restaurar anotação':'Excluir anotação',async()=>{
    await save(restore?'puffNotaRestaurar':'puffNotaExcluir',{noteId:id,expected:note,input:{}});
    if(!restore)try{const drafts=JSON.parse(localStorage.getItem(NOTE_DRAFT_KEY))||{};delete drafts[id];localStorage.setItem(NOTE_DRAFT_KEY,JSON.stringify(drafts));}catch{}
    view='anotacoes';notesMonth=note.date.slice(0,7);search='';$('#search').value='';render();toast(restore?'Anotação restaurada.':'Anotação movida para a lixeira.');
  });
}
function noteStockDestination(note) {
  const draft=noteToShipment(note,today());
  const products=state.products.filter(p=>!p.deletedAt);
  openDialog('Anotação → Estoque',`<p class="help">Mercadorias por quantidade. Escolha o que deseja registrar.</p><button type="button" class="secondary" data-action="note-to-product" data-id="${esc(note.id)}">+ Cadastrar novo produto</button>${products.length?`<hr><label class="field" for="note-product"><span>Produto já cadastrado</span><select id="note-product"><option value="">Escolha o produto</option>${products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><div class="card-actions"><button type="button" class="secondary" data-action="note-to-entry" data-id="${esc(note.id)}">↓ Entrada</button><button type="button" class="primary" data-action="note-to-exit" data-id="${esc(note.id)}">↑ Saída / venda</button></div>`:'<p class="help">Cadastre a mercadoria para começar a controlar sua quantidade.</p>'}`,null,null);
  attachNote(note,draft.input.items.length>1?'Esta anotação tem vários itens. Para movimentar o estoque, separe uma anotação por produto. Envios aceita a lista completa.':'Você confere a quantidade e o local na próxima etapa.');
  if(draft.input.items.length>1)document.querySelectorAll('[data-action="note-to-entry"],[data-action="note-to-exit"]').forEach(b=>b.disabled=true);
  const matching=products.filter(p=>draft.input.items.length===1&&normalize(p.name)===normalize(draft.input.items[0].name));
  if(matching.length===1)$('#note-product').value=matching[0].id;
}
function openNoteTarget(note) {
  const target=note.convertedTo;if(!target)return;
  if(target.type==='shipment'){const shipment=(state.shipments||[]).find(s=>s.id===target.id);if(shipment){view='envios';shipmentMonth=shipment.date.slice(0,7);search='';$('#search').value='';$('#editor').close();render();shipmentEditor(shipment.id);}}
  else if(target.type==='debt'){view='devedores';render();debtDetails(target.id);}
  else if(target.type==='product')productDetails(target.id);
  else if(target.type==='movement'){const movement=state.movements.find(m=>m.id===target.id);if(movement)productDetails(movement.productId);}
}
async function shareNote(id,copyOnly=false) {
  const note=(state.notes||[]).find(n=>n.id===id);if(!note)return;
  try {
    if(!copyOnly&&navigator.share){await navigator.share({title:'Anotação · Puff',text:note.text});return;}
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(note.text);toast('Texto copiado. Cole onde quiser enviar.');return;}
  } catch(error){if(error.name==='AbortError')return;}
  openDialog('Copiar anotação',`<p class="help">Selecione e copie o texto para enviar pelo aplicativo que preferir.</p><textarea id="note-copy-text" aria-label="Texto para copiar" readonly rows="10">${esc(note.text)}</textarea>`,null,null);$('#note-copy-text').select();
}
function shipmentEditor(id, sourceNote) {
  const shipment=(state.shipments||[]).find(s=>s.id===id);
  if(shipment?.deletedAt){view='envios';shipmentMonth=shipment.date.slice(0,7);shipmentStatus='';search='';$('#search').value='';$('#editor').close();render();toast('Envio na lixeira. Abra Envios excluídos para restaurar.');return;}
  const draft=sourceNote?noteToShipment(sourceNote,today()):null;
  const form=shipmentForm(draft?.input||shipment,today());
  openDialog(sourceNote?'Anotação → Envio':form.title,form.html,'Salvar envio',async data=>{
    const input=form.build(data);
    await save('puffEnvio',{input,...noteSource(sourceNote),...(shipment?{shipmentId:shipment.id,expected:shipment}:{})});
    if(sourceNote)view='envios';shipmentMonth=input.date.slice(0,7);render();toast('Envio registrado no mês correspondente.');
  }, 'envios');
  if(sourceNote){$('#sf-date').value=draft.input.date;attachNote(sourceNote,'Confira o transporte, o cliente, a data e as quantidades.',draft.warnings);}
}
$('#search').addEventListener('input',e=>{search=e.target.value;render();});
$('#shipment-month').addEventListener('change',e=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value)){shipmentMonth=e.target.value;render();}});
document.addEventListener('change',e=>{if(e.target.id==='shipment-status'){shipmentStatus=e.target.value;render();}if(e.target.id==='notes-month'){notesMonth=e.target.value;render();}});
$('#exchange-rate').addEventListener('click',exchangeForm);
$('#location-filter').addEventListener('change',e=>{locationFilter=e.target.value;render();});
$('#category-filter').addEventListener('change',e=>{categoryFilter=e.target.value;render();});
function originalForm(kind,id){
  const form=legacyForm(legacy,kind,id,today());
  openDialog(form.title,form.html,form.submitLabel,async data=>{
    const request=form.build(data);
    if(kind==='edit')request.payload.input.photo=await readPhoto(data.get('photo'),request.payload.input.photo);
    await save(request.action,request.payload,kind==='sell'?'Venda registrada':'');
  }, kind.includes('expense')?'gastos':kind==='local'?'locais':kind==='sell'?'vendas':'estoque');
}
$('#new-entry').addEventListener('click',()=>{
  if(view==='anotacoes')noteEditor();
  else if(view==='devedores')debtForm();
  else if(view==='gastos')originalForm('expense');
  else if(view==='locais')openDialog('Novo local',field('Nome do local','nome','text','','required maxlength="120"'),'Salvar local',async data=>save('local',{nome:data.get('nome')}));
  else if(view==='estoque'&&stockFilter!=='mercadorias')openDialog('Adicionar ao estoque','<p>Escolha como controlar o produto.</p><div class="card-actions"><button type="button" class="primary" data-action="new-legacy">Aparelho individual</button><button type="button" class="secondary" data-action="new-catalog">Mercadoria por quantidade</button></div>',null,null);
  else productForm();
});
document.addEventListener('click',e=>{
  const help=e.target.closest('[data-help]');
  if(help){const topic=helpTopics[help.dataset.help];if(topic){$('#help-title').textContent=topic[0];$('#help-text').textContent=topic[1];$('#context-help').showModal();}return;}
  const nav=e.target.closest('[data-view],[data-section]');
  if(nav){view=nav.dataset.view||({financeiro:'devedores',estoque:'estoque',express:'express',envios:'envios',anotacoes:'anotacoes'}[nav.dataset.section]);if(['estoque','mercadorias'].includes(view)){stockFilter=nav.dataset.stock||(view==='mercadorias'?'mercadorias':'');locationFilter=nav.dataset.location||'';categoryFilter='';$('#category-filter').value='';}if(view==='envios'){shipmentMonth=today().slice(0,7);shipmentStatus='';}if(view==='anotacoes')notesMonth=today().slice(0,7);search='';$('#search').value='';$('#more-sections').open=false;render();return;}
  const b=e.target.closest('[data-action]');if(!b||invalid)return;
  const {action:a,id,location}=b.dataset;
  try {
  if(a==='note-new'||a==='note-edit'){noteEditor(id);return;}
  if(a==='note-template'){noteEditor(undefined,true);return;}
  if(a==='note-convert'){noteDestination(id);return;}
  if(a==='note-delete'||a==='note-restore'){noteTrash(id,a==='note-restore');return;}
  if(a==='note-share'||a==='note-copy'){shareNote(id,a==='note-copy').catch(error=>toast(error.message));return;}
  if(a==='note-open'||a.startsWith('note-to-')){
    const note=(state.notes||[]).find(n=>n.id===id);if(!note)return;
    if(a==='note-open'){openNoteTarget(note);return;}
    if(note.deletedAt)throw new Error('Restaure a anotação pela lixeira antes de organizar.');
    if(!writable)throw new Error('Atualize a conexão antes de organizar a anotação.');
    if(note.convertedTo){openNoteTarget(note);return;}
    if(a==='note-to-shipment')shipmentEditor(undefined,note);
    else if(a==='note-to-debt')debtForm(note);
    else if(a==='note-to-stock')noteStockDestination(note);
    else if(a==='note-to-product')productForm(undefined,note);
    else if(a==='note-to-entry'||a==='note-to-exit'){const productId=$('#note-product').value;if(!productId)throw new Error('Escolha o produto para continuar.');movementForm(productId,a==='note-to-entry'?'entrada':'saida',note);}
    return;
  }
  if(a==='clear-filters'){stockFilter='';locationFilter='';categoryFilter='';search='';if(view==='mercadorias')view='estoque';$('#search').value='';$('#category-filter').value='';render();return;}
  if(a==='use-fx'){
    for(const prefix of ['','cost']){const rate=$('#mf-'+(prefix?'costFxRate':'fxRate')),date=$('#mf-'+(prefix?'costFxDate':'fxDate'));if(rate&&date){rate.value=state.settings?.fxRate??'';date.value=state.settings?.fxDate||today();rate.dispatchEvent(new Event('input',{bubbles:true}));}}return;
  }
  if(a==='shipment-delivery'){shipmentDelivery(id);return;}
  if(a==='shipment-delete'||a==='shipment-restore'){shipmentTrash(id,a==='shipment-restore');return;}
  if(a==='product-delete'||a==='product-restore'){productTrash(id,a==='product-restore');return;}
  if(a==='shipment-new'||a==='shipment-edit'){shipmentEditor(id);return;}
  if(a==='shipment-add-item'){const count=$('#shipment-items').querySelectorAll('.shipment-line').length;if(count>=50)throw new Error('Um envio aceita até 50 mercadorias.');$('#shipment-items').insertAdjacentHTML('beforeend',shipmentItemFields({},count));$('#dialog-fields').dispatchEvent(new Event('input'));return;}
  if(a==='shipment-remove-item'){if($('#shipment-items').querySelectorAll('.shipment-line').length<=1)throw new Error('Mantenha pelo menos uma mercadoria no envio.');b.closest('.shipment-line').remove();$('#dialog-fields').dispatchEvent(new Event('input'));return;}
  if(a==='open-debts'){view='devedores';render();return;}
  if(a==='new-legacy'){$('#editor').close();originalForm('new');return;}
  if(a==='new-catalog'){$('#editor').close();productForm();return;}
  if(a.startsWith('legacy-')){
    const kind=a.slice(7);
    if(['edit','sell','local','expense-edit'].includes(kind)){originalForm(kind,Number(id));return;}
    const request=kind==='paid'?legacyPaymentAction(legacy,id):kind==='delete'?legacyDeleteAction(legacy,id):kind==='restore'?legacyRestoreAction(legacy,id):legacyExpenseDeleteAction(legacy,id);
    const title=kind==='paid'?(request.payload.valor?'Registrar recebimento':'Voltar para a receber'):kind==='delete'?'Excluir aparelho?':kind==='restore'?'Restaurar aparelho':'Excluir gasto';
    openDialog(title,kind==='delete'?'<p>O aparelho ficará na Lixeira do estoque e poderá ser restaurado. Esta ação não registra uma venda nem acrescenta cafezinho.</p>':kind==='restore'?'<p>O aparelho voltará ao estoque, com os dados que tinha ao ser arquivado.</p>':kind==='expense-delete'?'<p>Este gasto será excluído da planilha. Exporte um backup se quiser guardar uma cópia.</p>':'<p>Confirme a atualização do pagamento deste aparelho.</p>','Confirmar',async()=>save(request.action,request.payload,kind==='paid'&&request.payload.valor?'Pagamento recebido':''));return;
  }
  if(a==='filter-location'){view='estoque';stockFilter='';categoryFilter='';search='';locationFilter=location;$('#search').value='';$('#category-filter').value='';$('#location-filter').value=location;render();return;}
  if(['entrada','saida','transferencia'].includes(a)){$('#editor').close();movementForm(id,a);}
  else if(a==='edit-product')productForm(id);
  else if(a==='details-product')productDetails(id);
  else if(a==='debt-edit')debtForm(undefined,id);
  else if(a==='debt-delete'||a==='debt-restore')debtTrash(id,a==='debt-restore');
  else if(a==='payment-edit')paymentForm(id,b.dataset.paymentId);
  else if(a==='payment-delete'||a==='payment-restore')debtTrash(id,a==='payment-restore',b.dataset.paymentId);
  else if(a==='payment')paymentForm(id);
  else if(a==='details-debt')debtDetails(id);
  else if(a==='debt-currency')debtCurrencyForm(id);
  else if(a==='movement-currency')movementCurrencyForm(id);
  else if(a==='movement-address')movementAddressForm(id);
  } catch(error){toast(error.message);}
});
$('#close-dialog').addEventListener('click',closeDialog);$('#cancel-dialog').addEventListener('click',closeDialog);
$('#editor').addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
$('#editor-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!dialogAction||$('#save-dialog').disabled)return;
  unlockSound();
  const instance=dialogInstance,label=$('#save-dialog').textContent;
  $('#form-error').textContent='';$('#save-dialog').disabled=true;
  $('#save-dialog').textContent='Salvando…';$('#cancel-dialog').textContent='Sair e conferir depois';
  try{if(stored!==dialogVersion)throw new Error('Os dados mudaram. Feche e reabra o formulário.');await dialogAction(new FormData(e.target));if(instance===dialogInstance)$('#editor').close();}catch(error){if(instance===dialogInstance)$('#form-error').textContent=error.message;}
  finally{if(instance===dialogInstance){$('#save-dialog').disabled=false;$('#save-dialog').textContent=label;$('#cancel-dialog').textContent='Cancelar';}}
});
function exportBackup(){
  const data=JSON.stringify({format:'painel-puff-backup-v2',exportedAt:new Date().toISOString(),synced:writable,legacy,modules:state,local:{pendingOperation,storedPending:storageRead(PENDING_KEY),legacyQueue:storageRead('fila'),noteDrafts:storageRead(NOTE_DRAFT_KEY),expressDraft:storageRead(EXPRESS_DRAFT_KEY),priceTableDraft:storageRead(PRICE_TABLE_DRAFT_KEY)}},null,2);
  const url=URL.createObjectURL(new Blob([data ?? ''],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`painel-puff-backup-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Backup preparado para download.');
}
$('#export-backup').addEventListener('click',exportBackup);$('#sync-export').addEventListener('click',exportBackup);
$('#sync-recover').addEventListener('click',()=>{if($('#editor').open&&!pendingOperation){toast('Feche o formulário antes de recuperar a conexão.');return;}return pendingOperation?reconcile():load();});
$('#refresh').addEventListener('click',()=>{if($('#editor').open){toast('Feche o formulário antes de atualizar.');return;}load();});
$('#reconcile').addEventListener('click',reconcile);
$('#change-key').addEventListener('click',auth);
$('#alisson-balance').addEventListener('click',()=>{
  const commission=state.commission || {balanceCents:0,entries:[]};
  const usd=value=>money(value,'USD');
  openDialog('Uma nobre causa: o café do Alisson ☕',`<p>📦 Você cuida do estoque. ☕ O Alisson cuida do café que mantém as ideias funcionando.</p><p class="dialog-summary">💰 Fundo do cafezinho <strong>${usd(commission.balanceCents)}</strong></p><p>❄️ Cada ar-condicionado vendido rende <strong>US$ 0,50 pro cafezinho</strong>. Clima fresco, café quentinho! ☕😄</p><p class="help">Somente unidades de ar-condicionado vendidas. Dívidas, recebimentos e outras mercadorias não entram. Contador informativo, sem transferência automática.</p>${commission.entries.length?`<h3>🤝 Quem abasteceu a cafeteira</h3><div class="payments">${commission.entries.slice(-10).reverse().map(entry=>`<div class="payment-row"><div><strong>${esc(entry.reason || 'Unidades registradas')}</strong><p class="meta">${esc(entry.units)} un. · ${esc(new Date(entry.createdAt).toLocaleDateString('pt-BR'))}</p></div><strong>${usd(entry.amountCents)}</strong></div>`).join('')}</div>`:'<p class="help">🚀 A cafeteira está pronta. O primeiro lançamento inaugura o fundo.</p>'}`,null,null);
});
window.addEventListener('storage',e=>{
  // A cached read in another tab is not a business change and must never lock this tab.
  if(![PENDING_KEY,'fila'].includes(e.key))return;
  externalRevision++;stored++;writable=false;
  if(e.key===PENDING_KEY&&!saving)readPending();
  syncMessage=pendingMessage()||'Outro acesso alterou os dados. Feche o formulário para atualizar a lista.';
  status(syncMessage);showSyncProblem();render();refreshAfterClose=true;
  if(!saving&&!loading&&!$('#editor').open&&!pendingOperation&&!pendingUnreadable){refreshAfterClose=false;refreshPromise=load();}
});
function resumeConnection(){
  if(document.hidden)return;
  for(const request of activeRequests)if(Date.now()>=request.deadline)request.controller.abort();
  if(saving||loading||$('#editor').open)return;
  const now=Date.now();
  if(writable&&now-lastSyncAt<60000||now-lastResumeAt<15000)return;
  lastResumeAt=now;refreshAfterClose=false;refreshPromise=load();
}
window.addEventListener('pageshow',resumeConnection);window.addEventListener('online',resumeConnection);
document.addEventListener('visibilitychange',resumeConnection);
resilience=setupResilience({busy:()=>saving||loading,openForm:()=>$('#editor').open,recover:()=>pendingOperation?reconcile():load()});
setupFeedback();render();load();



