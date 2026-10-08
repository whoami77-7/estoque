import { classifyCategory } from './analytics.mjs';
import { currencyForm, readCurrencyForm, moneyHTML, moneyTotals } from './currency-ui.mjs';
import { currencyOf, convertCents, formatMoney } from './money.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const dateBR = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : String(value || '—');
const matches = (query, ...values) => !query || normalized(values.join(' ')).includes(normalized(query));
const sold = item => normalized(item.situacao) === 'vendido';
const received = item => normalized(item.pagamento) === 'recebido';
const empty = message => `<div class="empty">${esc(message)}</div>`;
const button = (action, row, label, className = 'secondary') => `<button type="button" class="${className}" data-action="${action}" data-id="${esc(row)}">${label}</button>`;
const amount = (label, value, record, reference, field = 'currency') => `<div><span class="meta">${label}</span><strong>${value == null ? 'Valor inválido' : moneyHTML(value, record, reference, field)}</strong></div>`;
const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/></svg>';
const CATEGORIES = ['Peptídeos', 'Ar-condicionados', 'Mercadorias'];
function categoryFor(item) {
  return { peptideos: 'Peptídeos', 'ar-condicionados': 'Ar-condicionados', mercadorias: 'Mercadorias' }[classifyCategory(item)];
}

function numericCents(value) {
  if (value === '' || value == null || !['number', 'string'].includes(typeof value)) return null;
  const number = Number(value), result = Math.round(number * 100);
  return Number.isFinite(number) && Number.isSafeInteger(result) && Math.abs(number * 100 - result) < .00001 ? result : null;
}

function profitCents(item) {
  const purchase = numericCents(item.compra), sale = numericCents(item.venda);
  if (purchase == null || purchase <= 0 || sale == null || sale < 0) return null;
  const cost = convertCents(purchase, currencyOf(item, 'costCurrency'), currencyOf(item), item.costFxRate);
  return cost == null || !Number.isSafeInteger(sale - cost) ? null : sale - cost;
}

function itemByRow(data, row) {
  const number = Number(row);
  if (!Number.isSafeInteger(number) || number < 2) throw new Error('Aparelho inválido. Atualize o painel.');
  const item = data.itens?.find(value => Number(value.row) === number);
  if (!item) throw new Error('Aparelho não encontrado. Atualize o painel antes de continuar.');
  return item;
}

function itemCard(item, reference) {
  const isSold = sold(item), isPaid = received(item);
  const profit = profitCents(item);
  const safePhoto = typeof item.photo === 'string' && item.photo.length <= 1024 * 1024 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.photo);
  const photo = safePhoto
    ? `<img class="product-image" src="${esc(item.photo)}" alt="${esc(item.modelo)}">`
    : '<div class="product-image placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="11" rx="2"/><path d="M5 12h14M7 19v2m5-2v2m5-2v2"/></svg></div>';
  return `<article class="product-card stock-principal">
    <div class="product-top">${photo}<div><span class="stock-badge principal">Estoque principal</span><h2 class="product-title">${esc(item.modelo || 'Sem modelo')}</h2><span class="badge ${isSold ? 'good' : normalized(item.situacao) === 'pendente' ? 'warning' : ''}">${esc(item.situacao || 'Sem situação')}</span></div><button type="button" class="ghost edit-product" data-action="legacy-edit" data-id="${esc(item.row)}" aria-label="Editar ${esc(item.modelo || 'aparelho')}">${pencil}</button></div>
    <div class="client-location"><span class="context-chip"><span class="context-label">Cliente</span><strong>${esc(item.cliente || 'Sem cliente')}</strong></span><span class="context-chip"><span class="context-label">Local</span><strong>${esc(item.local || 'Sem local')}</strong></span></div>
    <div class="card-values">${amount(isSold ? 'Venda' : 'Venda pretendida', numericCents(item.venda), item, reference)}${isSold ? `<span class="badge ${isPaid ? 'good' : 'warning'}">${isPaid ? 'Recebido' : 'A receber'}</span>` : ''}</div>
    <div class="card-actions">${isSold ? button('legacy-paid', item.row, isPaid ? 'Marcar a receber' : 'Marcar recebido', 'primary') : button('legacy-sell', item.row, 'Vender', 'primary')}${!isSold ? button('legacy-delete', item.row, '🗑 Excluir', 'ghost danger') : ''}</div>
    <details class="card-details"><summary>Detalhes e custos</summary>
      <div class="card-values">${amount('Compra', numericCents(item.compra), item, reference, 'costCurrency')}<div><span class="meta">Diferença na moeda da venda</span><strong>${profit == null ? 'Não apurado' : esc(formatMoney(profit, currencyOf(item)))}</strong><small class="help">${profit == null ? 'Confirme moedas, custo e câmbio da compra.' : 'A análise considera as taxas de cada lançamento.'}</small></div></div>
      <p class="meta">Entrada: ${esc(dateBR(item.dataPasse))}${item.dataVenda ? ` · Venda: ${esc(dateBR(item.dataVenda))}` : ''}</p>
      ${item.notes ? `<p class="notes">${esc(item.notes)}</p>` : ''}
      <div class="card-actions">${button('legacy-local', item.row, 'Local')}${isSold ? button('legacy-delete', item.row, 'Arquivar', 'ghost') : ''}</div>
    </details>
  </article>`;
}

export function legacyCards(data, { view = 'estoque', search = '', location = '' } = {}) {
  const items = (data.itens || []).filter(item => {
    const inView = view === 'vendas' ? sold(item) : view === 'receber' ? sold(item) && !received(item) : !sold(item);
    return inView && (!location || item.local === location) && matches(search, item.modelo, item.cliente, item.local, item.notes);
  });
  if (view === 'vendas') items.sort((a, b) => String(b.dataVenda || '').localeCompare(String(a.dataVenda || '')));
  return items.length ? `<div class="product-grid">${items.map(item => itemCard(item, data.currencyReference || {})).join('')}</div>` : empty(view === 'receber' ? 'Nenhum aparelho com pagamento pendente.' : 'Nenhum aparelho encontrado.');
}

export function legacyView(data, view, search = '') {
  if (['estoque', 'vendas', 'receber'].includes(view)) return legacyCards(data, { view, search });
  if (view === 'arquivados') {
    const items = (data.excluidos || []).filter(item => matches(search, item.modelo, item.cliente, item.local, item.notes)).slice().sort((a, b) => String(b.excluidoEm || '').localeCompare(String(a.excluidoEm || '')) || Number(b.rowHist) - Number(a.rowHist));
    return items.length ? `<div class="debt-list">${items.map(item => `<details class="card-details debt-card"><summary><strong>${esc(item.modelo || 'Sem modelo')}</strong> <span class="meta">· Excluído em ${esc(dateBR(item.excluidoEm))}</span></summary><div class="client-location"><span class="context-chip"><span class="context-label">Cliente</span><strong>${esc(item.cliente || 'Sem cliente')}</strong></span><span class="context-chip"><span class="context-label">Local</span><strong>${esc(item.local || 'Sem local')}</strong></span></div><div class="card-values">${amount('Compra', numericCents(item.compra), item, data.currencyReference || {}, 'costCurrency')}${amount(sold(item) ? 'Venda' : 'Venda pretendida', numericCents(item.venda), item, data.currencyReference || {})}</div><p class="meta">Situação: ${esc(item.situacao || 'Não informada')} · Entrada: ${esc(dateBR(item.dataPasse))}${item.dataVenda ? ` · Venda: ${esc(dateBR(item.dataVenda))}` : ''}</p>${item.notes ? `<p class="notes">${esc(item.notes)}</p>` : ''}<div class="card-actions">${button('legacy-restore', item.rowHist, 'Restaurar item', 'secondary')}</div></details>`).join('')}</div>` : empty('Nenhum aparelho na lixeira.');
  }
  if (view === 'gastos') {
    const expenses = (data.gastos || []).filter(item => matches(search, item.descricao, item.aparelho));
    return expenses.length ? `<div class="debt-list">${expenses.map(item => `<article class="debt-card"><div class="debt-top"><div><h2>${esc(item.descricao || 'Gasto')}</h2><p class="meta">${esc(dateBR(item.data))}${item.aparelho ? ` · ${esc(item.aparelho)}` : ''}</p></div><strong>${numericCents(item.valor) == null ? 'Valor inválido' : moneyHTML(numericCents(item.valor), item, data.currencyReference || {})}</strong></div><div class="card-actions">${button('legacy-expense-edit', item.row, 'Moeda / câmbio')}${button('legacy-expense-delete', item.row, 'Excluir gasto', 'ghost')}</div></article>`).join('')}</div>` : empty('Nenhum gasto encontrado.');
  }
  if (view === 'clientes') {
    const clients = new Map();
    for (const item of data.itens || []) {
      if (!sold(item) || !item.cliente || !matches(search, item.cliente)) continue;
      if (!clients.has(item.cliente)) clients.set(item.cliente, []);
      clients.get(item.cliente).push(item);
    }
    const cards = [...clients].map(([name, items]) => {
      const profits = items.map(item => ({ ...item, profit: profitCents(item) })).filter(item => item.profit != null);
      return `<article class="product-card stock-principal"><h2 class="product-title">${esc(name)}</h2><p class="meta">${items.length} aparelho(s) com venda detalhada</p><div class="card-values"><div><span class="meta">Valor vendido</span>${moneyTotals(items, item => numericCents(item.venda) ?? 0, item => numericCents(item.venda) == null ? null : currencyOf(item))}</div><div><span class="meta">Lucro bruto</span>${profits.length ? moneyTotals(profits, item => item.profit) : '<strong>Não apurado</strong>'}${profits.length < items.length ? `<small class="help">${items.length - profits.length} lucro(s) não apurados</small>` : ''}</div></div></article>`;
    });
    for (const item of data.clientes || []) {
      if (clients.has(item.nome) || !matches(search, item.nome)) continue;
      cards.push(`<article class="product-card stock-principal"><h2 class="product-title">${esc(item.nome || 'Sem nome')}</h2><p class="meta">${esc(item.qtd)} aparelho(s) no resumo anterior</p><p class="help">Valores indisponíveis por moeda: não há vendas detalhadas para confirmar este resumo.</p></article>`);
    }
    return cards.length ? `<div class="product-grid">${cards.join('')}</div>` : empty('Nenhum cliente encontrado.');
  }
  if (view === 'locais') {
    const places = (data.resumoLocais || []).filter(item => item.nome && matches(search, item.nome));
    return places.length ? `<div class="product-grid">${places.map(item => `<article class="product-card stock-principal"><h2 class="product-title">${esc(item.nome)}</h2><div class="client-location"><span class="context-chip"><span class="context-label">Disponíveis</span><strong>${esc(item.disponivel)}</strong></span><span class="context-chip"><span class="context-label">Pendentes</span><strong>${esc(item.pendente)}</strong></span><span class="context-chip"><span class="context-label">Vendidos</span><strong>${esc(item.vendido)}</strong></span></div></article>`).join('')}</div>` : empty('Nenhum local encontrado.');
  }
  throw new Error('Seção do painel não encontrada.');
}

function readText(form, name, label, required = false, max = 120) {
  const value = form.get(name);
  if (value !== null && typeof value !== 'string') throw new Error(`${label}: texto inválido.`);
  const text = (value || '').trim();
  if ((required && !text) || text.length > max) throw new Error(`${label}: ${required ? 'preencha com' : 'use'} até ${max} caracteres.`);
  return text;
}

function amountValue(form, name, label, allowZero = true, optional = false) {
  let value = readText(form, name, label, !optional, 32);
  if (!value && optional) return 0;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) value = value.replaceAll('.', '').replace(',', '.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(value)) value = value.replace(',', '.');
  else throw new Error(`${label}: digite apenas o número, com até duas casas decimais.`);
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || (!allowZero && cents === 0)) throw new Error(`${label}: informe um valor ${allowZero ? 'válido' : 'maior que zero'}.`);
  return cents / 100;
}

function readDate(form, name, label) {
  const value = readText(form, name, label, true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`${label}: informe uma data válida.`);
  return value;
}

const field = (label, name, value = '', extra = '', type = 'text') => `<label class="field" for="lf-${name}"><span>${label}</span><input id="lf-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const moneyValue = value => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0).toFixed(2).replace('.', ',') : '';
const priceField = (label, name, value = '', required = true) => field(label, name, value, `${required ? 'required' : ''} inputmode="decimal" placeholder="0,00"`);
const grid = content => `<div class="form-grid">${content}</div>`;
const dateField = (label, name, value, extra = '') => field(label, name, value, `required ${extra}`, 'date');

function localField(data, value = '') {
  const locals = [...new Set([...(data.locais || []), value].filter(Boolean))];
  return field('Local', 'local', value, 'maxlength="120" list="lf-locais" placeholder="Escolha ou digite um novo local"') + `<datalist id="lf-locais">${locals.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>`;
}

function expenseByRow(data, row) {
  const number = Number(row);
  const item = Number.isSafeInteger(number) && number >= 2 ? data.gastos?.find(value => Number(value.row) === number) : null;
  if (!item) throw new Error('Gasto não encontrado. Atualize o painel.');
  return item;
}

export function legacyForm(data, kind, row, today) {
  const item = ['edit', 'sell', 'local'].includes(kind) ? structuredClone(itemByRow(data, row)) : null;
  const itemRow = item ? Number(item.row) : null;
  const reference = data.currencyReference || {};
  const defaults = { currency: 'BRL', costCurrency: 'BRL' };
  if (kind === 'edit') {
    return {
      title: 'Editar aparelho', submitLabel: 'Salvar alterações',
      html: field('Modelo', 'modelo', item.modelo, 'required maxlength="120"') + `<label class="field" for="lf-category"><span>Categoria</span><select id="lf-category" name="category" required>${CATEGORIES.map(category => `<option ${category === categoryFor(item) ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></label>` + grid(field('Cliente', 'cliente', item.cliente, 'maxlength="120"') + localField(data, item.local)) + currencyForm(item, { cost: true, reference }) + grid(priceField('Valor de compra', 'compra', moneyValue(item.compra)) + priceField('Valor de venda', 'venda', moneyValue(item.venda))) +
        '<label class="field" for="lf-photo"><span>Foto do aparelho <small>opcional</small></span><input id="lf-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small class="help">JPG, PNG ou WebP de até 5 MB. A foto será redimensionada automaticamente.</small></label>' + (item.photo ? '<label class="check-field"><input name="removePhoto" type="checkbox"> Remover foto atual</label>' : '') +
        `<label class="field" for="lf-notes"><span>Observações</span><textarea id="lf-notes" name="notes" rows="3" maxlength="1000">${esc(item.notes)}</textarea></label><p class="help">Situação, datas e recebimento ficam preservados nesta edição.</p>`,
      build(form) {
        const file = form.get('photo');
        if (file?.size && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) throw new Error('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
        const category = form.has('category') ? readText(form, 'category', 'Categoria', true, 30) : categoryFor(item);
        if (!CATEGORIES.includes(category)) throw new Error('Selecione uma categoria válida.');
        return { action: 'puffLegacyEdit', payload: { row: itemRow, expected: structuredClone(item), input: {
          category, ...readCurrencyForm(form, { cost: true }),
          modelo: readText(form, 'modelo', 'Modelo', true), cliente: readText(form, 'cliente', 'Cliente'), local: readText(form, 'local', 'Local'),
          compra: amountValue(form, 'compra', 'Compra'), venda: amountValue(form, 'venda', 'Venda'), notes: readText(form, 'notes', 'Observações', false, 1000), photo: form.get('removePhoto') ? '' : (item.photo || ''),
        } } };
      },
    };
  }
  if (kind === 'new') {
    return {
      title: 'Novo aparelho', submitLabel: 'Adicionar ao estoque',
      html: field('Modelo', 'modelo', '', 'required maxlength="120" placeholder="Ex.: Ar-condicionado 12 mil"') + grid(field('Quantidade', 'qtd', 1, 'required min="1" max="1000" step="1"', 'number') + dateField('Data de entrada', 'dataPasse', today)) + localField(data) + currencyForm(defaults, { cost: true, reference }) + grid(priceField('Compra por aparelho', 'compra', '0,00') + priceField('Venda pretendida por aparelho', 'venda', '0,00')),
      build(form) {
        const qtd = Number(readText(form, 'qtd', 'Quantidade', true, 10));
        if (!Number.isSafeInteger(qtd) || qtd < 1 || qtd > 1000) throw new Error('Quantidade: informe um inteiro entre 1 e 1000.');
        return { action: 'novo', payload: { ...readCurrencyForm(form, { cost: true }), modelo: readText(form, 'modelo', 'Modelo', true), qtd, compra: amountValue(form, 'compra', 'Compra'), venda: amountValue(form, 'venda', 'Venda pretendida'), local: readText(form, 'local', 'Local'), dataPasse: readDate(form, 'dataPasse', 'Data de entrada') } };
      },
    };
  }
  if (kind === 'sell') {
    if (sold(item)) throw new Error('Este aparelho já foi vendido. Atualize o painel.');
    const clients = [...new Set((data.clientes || []).map(client => client.nome).filter(Boolean))];
    return {
      title: 'Registrar venda', submitLabel: 'Confirmar venda',
      html: `<p class="dialog-summary"><strong>${esc(item.modelo)}</strong><br>${esc(item.local || 'Sem local')}</p>` + field('Cliente', 'cliente', item.cliente, 'required maxlength="120" list="lf-clientes"') + `<datalist id="lf-clientes">${clients.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>` + currencyForm(item, { reference }) + grid(priceField('Valor da venda', 'valorVenda', moneyValue(item.venda)) + dateField('Data da venda', 'dataVenda', today, item.dataPasse ? `min="${esc(item.dataPasse)}"` : '')) + '<label class="check-field"><input type="checkbox" name="pagamento"> Já recebi o pagamento</label>' + grid(field('Gasto desta venda (opcional)', 'gastoDesc', '', 'maxlength="120" placeholder="Ex.: frete"') + priceField('Valor do gasto · mesma moeda da venda', 'gastoValor', '', false)) + '<p class="help">Se o gasto estiver em outra moeda, registre-o separadamente em Gastos. A moeda e o câmbio da compra ficam preservados.</p>',
      build(form) {
        const dataVenda = readDate(form, 'dataVenda', 'Data da venda');
        if (item.dataPasse && dataVenda < item.dataPasse) throw new Error('A venda não pode ser anterior à entrada do aparelho.');
        return { action: 'vender', payload: { ...readCurrencyForm(form), row: itemRow, expected: structuredClone(item), cliente: readText(form, 'cliente', 'Cliente', true), valorVenda: amountValue(form, 'valorVenda', 'Valor da venda', false), dataVenda, pagamento: Boolean(form.get('pagamento')), gastoValor: amountValue(form, 'gastoValor', 'Gasto', true, true), gastoDesc: readText(form, 'gastoDesc', 'Descrição do gasto') } };
      },
    };
  }
  if (kind === 'local') {
    return { title: 'Alterar local', submitLabel: 'Salvar local', html: `<p class="dialog-summary">${esc(item.modelo)}</p>` + localField(data, item.local), build: form => ({ action: 'campo', payload: { row: itemRow, expected: structuredClone(item), campo: 'local', valor: readText(form, 'local', 'Local', true) } }) };
  }
  if (kind === 'expense') {
    return {
      title: 'Novo gasto', submitLabel: 'Registrar gasto',
      html: field('O que foi?', 'descricao', '', 'required maxlength="200" placeholder="Ex.: frete, suporte, manutenção"') + currencyForm(defaults, { reference }) + grid(priceField('Valor', 'valor') + dateField('Data', 'data', today)) + field('Aparelho (opcional)', 'aparelho', '', 'maxlength="120" placeholder="Deixe em branco para um gasto geral"'),
      build: form => ({ action: 'gasto', payload: { ...readCurrencyForm(form), descricao: readText(form, 'descricao', 'Descrição', true, 200), valor: amountValue(form, 'valor', 'Valor do gasto', false), data: readDate(form, 'data', 'Data do gasto'), aparelho: readText(form, 'aparelho', 'Aparelho') } }),
    };
  }
  if (kind === 'expense-edit') {
    const expense = structuredClone(expenseByRow(data, row));
    return {
      title: 'Confirmar moeda do gasto', submitLabel: 'Salvar moeda e câmbio',
      html: `<p class="dialog-summary"><strong>${esc(expense.descricao || 'Gasto')}</strong><br>Valor registrado: ${esc(moneyValue(expense.valor))}<br>${esc(dateBR(expense.data))}</p>` + currencyForm(expense, { reference }) + '<p class="help">O número, a descrição e a data do gasto ficam preservados. Esta ação confirma apenas a moeda e o câmbio.</p>',
      build: form => ({ action: 'puffExpenseEdit', payload: { row: Number(expense.row), expected: structuredClone(expense), input: readCurrencyForm(form) } }),
    };
  }
  throw new Error('Formulário não encontrado.');
}

export function legacyPaymentAction(data, row) {
  const item = itemByRow(data, row);
  if (!sold(item)) throw new Error('O recebimento só pode ser alterado em aparelhos vendidos.');
  return { action: 'campo', payload: { row: Number(item.row), expected: structuredClone(item), campo: 'pagamento', valor: !received(item) } };
}

export function legacyDeleteAction(data, row) {
  const item = itemByRow(data, row);
  return { action: 'excluir', payload: { row: Number(item.row), expected: structuredClone(item) } };
}

export function legacyExpenseDeleteAction(data, row) {
  const item = expenseByRow(data, row);
  return { action: 'gastoExcluir', payload: { row: Number(item.row), expected: structuredClone(item) } };
}

export function legacyRestoreAction(data, rowHist) {
  const row = Number(rowHist);
  const item = Number.isSafeInteger(row) && row >= 2 ? data.excluidos?.find(record => Number(record.rowHist) === row) : null;
  if (!item) throw new Error('Item arquivado não encontrado. Atualize o painel.');
  return { action: 'restaurar', payload: { rowHist: row, expected: structuredClone(item) } };
}
