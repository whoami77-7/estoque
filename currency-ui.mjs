import { currencyOf, formatMoney, convertCents } from './money.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localDate=()=>new Date().toLocaleDateString('en-CA');
const rateValue=value=>value==null?'':String(value).replace('.',',');

export function moneyHTML(cents, record={}, reference={}, field='currency') {
  if(cents==null)return '<span class="money-unconfirmed">Não apurado</span>';
  const currency=currencyOf(record,field), cost=field==='costCurrency';
  const saved=record[cost?'costFxRate':'fxRate']!=null;
  const rate=saved?record[cost?'costFxRate':'fxRate']:reference.fxRate;
  const date=saved?record[cost?'costFxDate':'fxDate']:reference.fxDate;
  const other=currency==='USD'?'BRL':'USD';
  const equivalent=convertCents(cents,currency,other,rate);
  return `<span class="money-stack ${currency?'':'money-unconfirmed'}"><span>${esc(formatMoney(cents,currency))}</span>${equivalent==null?'':`<small title="${saved?'Câmbio salvo':'Referência do painel'}: 1 US$ = R$ ${esc(rateValue(rate))}${date?' · '+esc(date):''}">≈ ${esc(formatMoney(equivalent,other))}</small>`}</span>`;
}

export function moneyTotals(records,getAmount,getCurrency=record=>record.currency) {
  const totals={BRL:0,USD:0}; let unknown=0;
  for(const record of records){
    const amount=getAmount(record); if(amount==null)continue;
    const currency=currencyOf({currency:getCurrency(record)});
    if(!currency){unknown++;continue;}
    totals[currency]+=amount;
    if(!Number.isSafeInteger(totals[currency]))throw new Error('Total monetário acima do limite permitido.');
  }
  return `<span class="money-stack"><span>${esc(formatMoney(totals.BRL,'BRL'))}</span><span>${esc(formatMoney(totals.USD,'USD'))}</span>${unknown?`<small class="money-unconfirmed">${unknown} ${unknown===1?'registro sem moeda confirmada':'registros sem moeda confirmada'}</small>`:''}</span>`;
}

function select(name,label,value) {
  return `<label class="field" for="mf-${name}"><span>${label}</span><select id="mf-${name}" name="${name}" required><option value="" ${!value?'selected':''}>Confirmar moeda</option><option value="BRL" ${value==='BRL'?'selected':''}>R$ · Real</option><option value="USD" ${value==='USD'?'selected':''}>US$ · Dólar</option></select></label>`;
}
function rateFields(record,cost=false) {
  const rate=cost?'costFxRate':'fxRate', date=cost?'costFxDate':'fxDate';
  return `<div class="form-grid"><label class="field" for="mf-${rate}"><span>${cost?'Câmbio da compra':'Câmbio do lançamento'} <small>opcional</small></span><input id="mf-${rate}" name="${rate}" value="${esc(rateValue(record[rate]))}" inputmode="decimal" placeholder="1 US$ = quantos R$?" autocomplete="off"></label><label class="field" for="mf-${date}"><span>Data desse câmbio</span><input id="mf-${date}" name="${date}" type="date" value="${esc(record[date]||localDate())}"></label></div>`;
}
export function currencyForm(record={}, {cost=false,reference={}}={}) {
  return `<div class="currency-fields"><div class="form-grid">${select('currency',cost?'Moeda da venda / preço':'Moeda do valor',currencyOf(record))}${cost?select('costCurrency','Moeda da compra / custo',currencyOf(record,'costCurrency')):''}</div><details class="currency-rates"><summary>Câmbio e valor equivalente <span>opcional</span></summary><p class="help">Use a taxa combinada: US$ 1 em reais. Ela fica salva neste lançamento.</p>${rateFields(record)}${cost?rateFields(record,true):''}${reference.fxRate?`<p class="help">Referência: US$ 1 = R$ ${esc(rateValue(reference.fxRate))} · ${esc(reference.fxDate||'')}</p><button type="button" class="secondary" data-action="use-fx">Usar câmbio de referência</button>`:''}</details></div>`;
}

export function readCurrencyForm(form,{cost=false}={}) {
  const result={};
  for(const name of cost?['currency','costCurrency']:['currency']){
    const value=form.get(name);
    if(!['BRL','USD'].includes(value))throw new Error('Confirme a moeda dos valores: real ou dólar.');
    result[name]=value;
  }
  for(const prefix of cost?['','cost']:['']){
    const rate=prefix?'costFxRate':'fxRate', date=prefix?'costFxDate':'fxDate';
    const raw=String(form.get(rate)||'').trim();
    if(!raw){result[rate]=null;result[date]='';continue;}
    if(!/^\d+(?:[.,]\d{1,6})?$/.test(raw))throw new Error('Câmbio: use um número positivo com até seis casas decimais.');
    const value=Number(raw.replace(',','.'));
    if(!Number.isFinite(value)||value<=0||value>1000000)throw new Error('Informe um câmbio maior que zero e de até 1.000.000.');
    const day=String(form.get(date)||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day))||new Date(day).toISOString().slice(0,10)!==day)throw new Error('Informe a data do câmbio utilizado.');
    result[rate]=value;result[date]=day;
  }
  return result;
}
