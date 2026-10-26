import { getExpressProducts, parseExpressPrice } from './express.mjs';
import { formatMoney } from './money.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
const defaultTitle = 'Ar-condicionados · Puff';

export function priceTableProducts(legacy, state) {
  const groups = new Map();
  const availableLegacy={...legacy,itens:(Array.isArray(legacy?.itens)?legacy.itens:[]).filter(item=>item&&normalized(item.situacao)==='disponivel')};
  for (const product of getExpressProducts(availableLegacy, state)) {
    const key = encodeURIComponent(JSON.stringify([normalized(product.name),product.priceCents,product.currency]));
    if (!groups.has(key)) groups.set(key,{key,name:product.name.trim().replace(/\s+/g,' '),priceCents:product.priceCents,currency:product.currency,sourceKeys:[]});
    groups.get(key).sourceKeys.push(product.key);
  }
  return [...groups.values()];
}

export function priceTableForm(products, draft = {}) {
  const current = new Set(products.map(product=>product.key));
  const missing = Object.keys(draft).filter(field=>field.startsWith('selected:')&&draft[field]&&!current.has(field.slice(9)))
    .map(field=>({key:field.slice(9),name:draft[`name:${field.slice(9)}`]||'Produto indisponível',missing:true}));
  const rows = [...products,...missing].map((product,index)=>{
    const selected=Boolean(draft[`selected:${product.key}`]);
    const price=draft[`price:${product.key}`]??(product.priceCents?(product.priceCents/100).toFixed(2).replace('.',','):'');
    const currency=draft[`currency:${product.key}`]??product.currency??'';
    return `<div class="price-table-row${product.missing?' price-table-unavailable':''}">
      <label class="price-table-select" for="pt-select-${index}"><input type="checkbox" id="pt-select-${index}" name="selected:${esc(product.key)}" value="1"${selected?' checked':''}> Incluir na tabela</label>
      <label class="price-table-model" for="pt-name-${index}">Modelo<input id="pt-name-${index}" name="name:${esc(product.key)}" value="${esc(product.name)}" readonly></label>
      <label for="pt-price-${index}">Preço por aparelho<input id="pt-price-${index}" name="price:${esc(product.key)}" inputmode="decimal" maxlength="24" placeholder="Ex.: 1.500,00" value="${esc(price)}"></label>
      <label for="pt-currency-${index}">Moeda<select id="pt-currency-${index}" name="currency:${esc(product.key)}"><option value="">Escolha</option><option value="BRL"${currency==='BRL'?' selected':''}>R$ · Real</option><option value="USD"${currency==='USD'?' selected':''}>US$ · Dólar</option></select></label>
      ${product.missing?'<p class="help price-table-warning">Este modelo não está mais disponível com os dados anteriores. Desmarque esta linha e escolha um aparelho da lista atual.</p>':''}
    </div>`;
  }).join('');
  return `<section class="price-table-panel" aria-label="Tabela de ar-condicionados para clientes">
    <p class="help">Marque os modelos e informe o preço de cada um. A tabela mostra apenas modelos, preços e suas condições. Não registra venda nem altera o estoque.</p>
    <button type="button" id="price-table-reload" class="secondary">Atualizar aparelhos</button>
    <form id="price-table-form">
      <label for="price-table-title">Título da tabela<input id="price-table-title" name="title" maxlength="120" value="${esc(draft.title??defaultTitle)}" required></label>
      <div class="price-table-products">${rows||'<p class="empty">Nenhum ar-condicionado disponível. Atualize os aparelhos ou confira o estoque.</p>'}</div>
      <label for="price-table-conditions">Condições para o cliente <span class="meta">· opcional</span><textarea id="price-table-conditions" name="conditions" rows="3" maxlength="600" placeholder="Forma de pagamento, entrega ou prazo que deseja informar.">${esc(draft.conditions||'')}</textarea></label>
      <button type="submit" id="price-table-generate" class="primary">Gerar tabela</button>
    </form>
    <iframe id="price-table-preview" title="Prévia da tabela para clientes" sandbox="allow-same-origin allow-modals" hidden></iframe>
    <label for="price-table-message">Texto para enviar<textarea id="price-table-message" rows="8" readonly placeholder="A tabela aparece aqui depois de gerar."></textarea></label>
    <div class="price-table-actions card-actions"><button type="button" id="price-table-copy" class="secondary" disabled>Copiar tabela</button><button type="button" id="price-table-share" class="primary" disabled>Compartilhar texto</button><button type="button" id="price-table-print" class="secondary" disabled>Imprimir / PDF</button></div>
    <p id="price-table-status" class="help" role="status" aria-live="polite"></p>
  </section>`;
}

function text(value,label,max,required=false) {
  if(value==null)value='';
  if(typeof value!=='string'||value.trim().length>max||required&&!value.trim())throw new Error(`${label}: ${required?'preencha com':'use'} até ${max} caracteres.`);
  return value.trim();
}

function tableData(input) {
  if(!Array.isArray(input?.items)||!input.items.length)throw new Error('Marque pelo menos um ar-condicionado para gerar a tabela.');
  return {
    title:text(input.title,'Título',120,true),conditions:text(input.conditions,'Condições',600),
    items:input.items.map(item=>{
      if(!['BRL','USD'].includes(item.currency))throw new Error('Escolha real ou dólar para cada modelo selecionado.');
      if(!Number.isSafeInteger(item.priceCents)||item.priceCents<=0)throw new Error('Informe um preço maior que zero para cada modelo selecionado.');
      return {name:text(item.name,'Modelo',200,true).replace(/\s+/g,' '),priceCents:item.priceCents,currency:item.currency};
    }),
  };
}

export function readPriceTable(products, form) {
  const selected=[...form.keys()].filter(key=>key.startsWith('selected:'));
  if(new Set(selected).size!==selected.length)throw new Error('A seleção contém um modelo repetido. Atualize os aparelhos.');
  const items=selected.map(field=>{
    const key=field.slice(9),product=products.find(item=>item.key===key);
    if(!product)throw new Error('Um modelo selecionado não está mais disponível com os dados anteriores. Atualize os aparelhos e revise a seleção.');
    if(normalized(form.get(`name:${key}`))!==normalized(product.name))throw new Error('O nome de um modelo mudou. Atualize os aparelhos e selecione novamente.');
    return {name:product.name,priceCents:parseExpressPrice(form.get(`price:${key}`)),currency:form.get(`currency:${key}`)};
  });
  return tableData({title:form.get('title'),conditions:form.get('conditions'),items});
}

export function buildPriceTableText(input) {
  const data=tableData(input);
  return [data.title,data.items.map(item=>`• ${item.name} — ${formatMoney(item.priceCents,item.currency)}`).join('\n'),data.conditions,'Valores por aparelho. Consulte a disponibilidade antes de fechar.'].filter(Boolean).join('\n\n');
}

export function buildPriceTableHTML(input,dateLabel='') {
  const data=tableData(input),date=text(dateLabel,'Data da tabela',80);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(data.title)}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#fff;color:#172534;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5}main{max-width:880px;margin:0 auto;padding:40px 28px}h1{font-size:29px;line-height:1.2;margin:0 0 8px}.date{margin:0;color:#60717e;font-size:12px}header{padding-bottom:24px;border-bottom:3px solid #167c8d}table{width:100%;border-collapse:collapse;margin:20px 0;table-layout:fixed}th{text-align:left;color:#60717e;font-size:12px;font-weight:700;padding:10px 12px;border-bottom:1px solid #bdcbd1}td{padding:15px 12px;border-bottom:1px solid #dfe7eb;vertical-align:top;overflow-wrap:anywhere}th:last-child,td:last-child{text-align:right;width:32%}td:last-child{font-weight:700;color:#124d5b}tbody tr:nth-child(even){background:#f5f9fa}.conditions{margin-top:24px;padding:18px;background:#f5f9fa}.conditions h2{margin:0 0 6px;font-size:13px}.conditions p{margin:0;white-space:pre-line;overflow-wrap:anywhere}footer{margin-top:28px;font-size:11px;color:#60717e}@media(max-width:480px){main{padding:24px 16px}h1{font-size:24px}td,th{padding:12px 6px}th:last-child,td:last-child{width:38%}}@media print{@page{size:A4;margin:15mm}main{max-width:none;padding:0}thead{display:table-header-group}tr,.conditions{break-inside:avoid}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}h1{font-size:25px}}
  </style></head><body><main><header><h1>${esc(data.title)}</h1>${date?`<p class="date">Atualizada em ${esc(date)}</p>`:''}</header><table><thead><tr><th scope="col">Modelo</th><th scope="col">Preço por aparelho</th></tr></thead><tbody>${data.items.map(item=>`<tr><td>${esc(item.name)}</td><td>${esc(formatMoney(item.priceCents,item.currency))}</td></tr>`).join('')}</tbody></table>${data.conditions?`<section class="conditions"><h2>Condições</h2><p>${esc(data.conditions)}</p></section>`:''}<footer>Valores por aparelho. Consulte a disponibilidade antes de fechar.</footer></main></body></html>`;
}
