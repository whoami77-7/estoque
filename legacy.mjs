const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const money = value => Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Valor inválido';
const dateBR = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : String(value || '—');
const matches = (query, ...values) => !query || normalized(values.join(' ')).includes(normalized(query));
const sold = item => normalized(item.situacao) === 'vendido';
const received = item => normalized(item.pagamento) === 'recebido';
const empty = message => `<div class="empty">${esc(message)}</div>`;
const button = (action, row, label, className = 'secondary') => `<button type="button" class="${className}" data-action="${action}" data-id="${esc(row)}">${label}</button>`;
const amount = (label, value) => `<div><span class="meta">${label}</span><strong>${money(value)}</strong></div>`;
const pencil = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z"/></svg>';
const CATEGORIES = ['Peptídeos', 'Ar-condicionados', 'Mercadorias'];
function categoryFor(item) {
  return { peptideos: 'Peptídeos', 'ar-condicionados': 'Ar-condicionados', mercadorias: 'Mercadorias' }[classifyCategory(item)];
}

function itemByRow(data, row) {
  const number = Number(row);
  if (!Number.isSafeInteger(number) || number < 2) throw new Error('Aparelho inválido. Atualize o painel.');
  const item = data.itens?.find(value => Number(value.row) === number);
  if (!item) throw new Error('Aparelho não encontrado. Atualize o painel antes de continuar.');
  return item;
}

function itemCard(item) {
  const isSold = sold(item), isPaid = received(item);
  const safePhoto = typeof item.photo === 'string' && item.photo.length <= 1024 * 1024 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.photo);
  const photo = safePhoto
    ? `<img class="product-image" src="${esc(item.photo)}" alt="${esc(item.modelo)}">`
    : '<div class="product-image placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="11" rx="2"/><path d="M5 12h14M7 19v2m5-2v2m5-2v2"/></svg></div>';
  return `<article class="product-card stock-principal">
    <div class="product-top">${photo}<div><span class="stock-badge principal">Estoque principal</span><h2 class="product-title">${esc(item.modelo || 'Sem modelo')}</h2><span class="badge ${isSold ? 'good' : normalized(item.situacao) === 'pendente' ? 'warning' : ''}">${esc(item.situacao || 'Sem situação')}</span></div><button type="button" class="ghost edit-product" data-action="legacy-edit" data-id="${esc(item.row)}" aria-label="Editar ${esc(item.modelo || 'aparelho')}">${pencil}</button></div>
    <div class="client-location"><span class="context-chip"><span class="context-label">Cliente</span><strong>${esc(item.cliente || 'Sem cliente')}</strong></span><span class="context-chip"><span class="context-label">Local</span><strong>${esc(item.local || 'Sem local')}</strong></span></div>
    <div class="card-values">${amount('Compra', item.compra)}${amount(isSold ? 'Venda' : 'Venda pretendida', item.venda)}${amount('Lucro', item.lucro)}</div>
    <p class="meta">Entrada: ${esc(dateBR(item.dataPasse))}${item.dataVenda ? ` · Venda: ${esc(dateBR(item.dataVenda))}` : ''}</p>
    ${isSold ? `<p><span class="badge ${isPaid ? 'good' : 'warning'}">${isPaid ? 'Recebido' : 'A receber'}</span></p>` : ''}
    <p class="notes">${esc(item.notes || 'Use o lápis para adicionar uma foto ou observação.')}</p>
    <div class="card-actions">${isSold ? button('legacy-paid', item.row, isPaid ? 'Marcar a receber' : 'Marcar recebido', 'primary') : button('legacy-sell', item.row, 'Vender', 'primary')}${button('legacy-local', item.row, 'Local')}${button('legacy-delete', item.row, 'Arquivar', 'ghost')}</div>
  </article>`;
}

export function legacyCards(data, { view = 'estoque', search = '', location = '' } = {}) {
  const items = (data.itens || []).filter(item => {
    const inView = view === 'vendas' ? sold(item) : view === 'receber' ? sold(item) && !received(item) : !sold(item);
    return inView && (!location || item.local === location) && matches(search, item.modelo, item.cliente, item.local, item.notes);
  });
  if (view === 'vendas') items.sort((a, b) => String(b.dataVenda || '').localeCompare(String(a.dataVenda || '')));
  return items.length ? `<div class="product-grid">${items.map(itemCard).join('')}</div>` : empty(view === 'receber' ? 'Nenhum aparelho com pagamento pendente.' : 'Nenhum aparelho encontrado.');
}

export function legacyView(data, view, search = '') {
  if (['estoque', 'vendas', 'receber'].includes(view)) return legacyCards(data, { view, search });
  if (view === 'gastos') {
    const expenses = (data.gastos || []).filter(item => matches(search, item.descricao, item.aparelho));
    return expenses.length ? `<div class="debt-list">${expenses.map(item => `<article class="debt-card"><div class="debt-top"><div><h2>${esc(item.descricao || 'Gasto')}</h2><p class="meta">${esc(dateBR(item.data))}${item.aparelho ? ` · ${esc(item.aparelho)}` : ''}</p></div><strong>${money(item.valor)}</strong></div><div class="card-actions">${button('legacy-expense-delete', item.row, 'Excluir gasto', 'ghost')}</div></article>`).join('')}</div>` : empty('Nenhum gasto encontrado.');
  }
  if (view === 'clientes') {
    const clients = (data.clientes || []).filter(item => matches(search, item.nome));
    return clients.length ? `<div class="product-grid">${clients.map(item => `<article class="product-card stock-principal"><h2 class="product-title">${esc(item.nome || 'Sem nome')}</h2><p class="meta">${esc(item.qtd)} aparelho(s)</p><div class="card-values">${amount('Valor vendido', item.valor)}${amount('Lucro', item.lucro)}</div></article>`).join('')}</div>` : empty('Nenhum cliente encontrado.');
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

function reais(form, name, label, allowZero = true, optional = false) {
  let value = readText(form, name, label, !optional, 32).replace(/^R\$\s*/, '');
  if (!value && optional) return 0;
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) value = value.replaceAll('.', '').replace(',', '.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(value)) value = value.replace(',', '.');
  else throw new Error(`${label}: use um valor em reais com até duas casas decimais.`);
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

export function legacyForm(data, kind, row, today) {
  const item = ['edit', 'sell', 'local'].includes(kind) ? structuredClone(itemByRow(data, row)) : null;
  const itemRow = item ? Number(item.row) : null;
  if (kind === 'edit') {
    return {
      title: 'Editar aparelho', submitLabel: 'Salvar alterações',
      html: field('Modelo', 'modelo', item.modelo, 'required maxlength="120"') + `<label class="field" for="lf-category"><span>Categoria</span><select id="lf-category" name="category" required>${CATEGORIES.map(category => `<option ${category === categoryFor(item) ? 'selected' : ''}>${esc(category)}</option>`).join('')}</select></label>` + grid(field('Cliente', 'cliente', item.cliente, 'maxlength="120"') + localField(data, item.local)) + grid(priceField('Valor de compra (R$)', 'compra', moneyValue(item.compra)) + priceField('Valor de venda (R$)', 'venda', moneyValue(item.venda))) +
        '<label class="field" for="lf-photo"><span>Foto do aparelho <small>opcional</small></span><input id="lf-photo" name="photo" type="file" accept="image/png,image/jpeg,image/webp"><small class="help">JPG, PNG ou WebP de até 5 MB. A foto será redimensionada automaticamente.</small></label>' + (item.photo ? '<label class="check-field"><input name="removePhoto" type="checkbox"> Remover foto atual</label>' : '') +
        `<label class="field" for="lf-notes"><span>Observações</span><textarea id="lf-notes" name="notes" rows="3" maxlength="1000">${esc(item.notes)}</textarea></label><p class="help">Situação, datas e recebimento ficam preservados nesta edição.</p>`,
      build(form) {
        const file = form.get('photo');
        if (file?.size && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) throw new Error('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
        const category = form.has('category') ? readText(form, 'category', 'Categoria', true, 30) : categoryFor(item);
        if (!CATEGORIES.includes(category)) throw new Error('Selecione uma categoria válida.');
        return { action: 'puffLegacyEdit', payload: { row: itemRow, expected: structuredClone(item), input: {
          category,
          modelo: readText(form, 'modelo', 'Modelo', true), cliente: readText(form, 'cliente', 'Cliente'), local: readText(form, 'local', 'Local'),
          compra: reais(form, 'compra', 'Compra'), venda: reais(form, 'venda', 'Venda'), notes: readText(form, 'notes', 'Observações', false, 1000), photo: form.get('removePhoto') ? '' : (item.photo || ''),
        } } };
      },
    };
  }
  if (kind === 'new') {
    return {
      title: 'Novo aparelho', submitLabel: 'Adicionar ao estoque',
      html: field('Modelo', 'modelo', '', 'required maxlength="120" placeholder="Ex.: Ar-condicionado 12 mil"') + grid(field('Quantidade', 'qtd', 1, 'required min="1" max="1000" step="1"', 'number') + dateField('Data de entrada', 'dataPasse', today)) + localField(data) + grid(priceField('Compra por aparelho (R$)', 'compra', '0,00') + priceField('Venda pretendida por aparelho (R$)', 'venda', '0,00')),
      build(form) {
        const qtd = Number(readText(form, 'qtd', 'Quantidade', true, 10));
        if (!Number.isSafeInteger(qtd) || qtd < 1 || qtd > 1000) throw new Error('Quantidade: informe um inteiro entre 1 e 1000.');
        return { action: 'novo', payload: { modelo: readText(form, 'modelo', 'Modelo', true), qtd, compra: reais(form, 'compra', 'Compra'), venda: reais(form, 'venda', 'Venda pretendida'), local: readText(form, 'local', 'Local'), dataPasse: readDate(form, 'dataPasse', 'Data de entrada') } };
      },
    };
  }
  if (kind === 'sell') {
    if (sold(item)) throw new Error('Este aparelho já foi vendido. Atualize o painel.');
    const clients = [...new Set((data.clientes || []).map(client => client.nome).filter(Boolean))];
    return {
      title: 'Registrar venda', submitLabel: 'Confirmar venda',
      html: `<p class="dialog-summary"><strong>${esc(item.modelo)}</strong><br>${esc(item.local || 'Sem local')}</p>` + field('Cliente', 'cliente', item.cliente, 'required maxlength="120" list="lf-clientes"') + `<datalist id="lf-clientes">${clients.map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>` + grid(priceField('Valor da venda (R$)', 'valorVenda', moneyValue(item.venda)) + dateField('Data da venda', 'dataVenda', today, item.dataPasse ? `min="${esc(item.dataPasse)}"` : '')) + '<label class="check-field"><input type="checkbox" name="pagamento"> Já recebi o pagamento</label>' + grid(field('Gasto desta venda (opcional)', 'gastoDesc', '', 'maxlength="120" placeholder="Ex.: frete"') + priceField('Valor do gasto (R$)', 'gastoValor', '', false)),
      build(form) {
        const dataVenda = readDate(form, 'dataVenda', 'Data da venda');
        if (item.dataPasse && dataVenda < item.dataPasse) throw new Error('A venda não pode ser anterior à entrada do aparelho.');
        return { action: 'vender', payload: { row: itemRow, expected: structuredClone(item), cliente: readText(form, 'cliente', 'Cliente', true), valorVenda: reais(form, 'valorVenda', 'Valor da venda', false), dataVenda, pagamento: Boolean(form.get('pagamento')), gastoValor: reais(form, 'gastoValor', 'Gasto', true, true), gastoDesc: readText(form, 'gastoDesc', 'Descrição do gasto') } };
      },
    };
  }
  if (kind === 'local') {
    return { title: 'Alterar local', submitLabel: 'Salvar local', html: `<p class="dialog-summary">${esc(item.modelo)}</p>` + localField(data, item.local), build: form => ({ action: 'campo', payload: { row: itemRow, expected: structuredClone(item), campo: 'local', valor: readText(form, 'local', 'Local', true) } }) };
  }
  if (kind === 'expense') {
    return {
      title: 'Novo gasto', submitLabel: 'Registrar gasto',
      html: field('O que foi?', 'descricao', '', 'required maxlength="200" placeholder="Ex.: frete, suporte, manutenção"') + grid(priceField('Valor (R$)', 'valor') + dateField('Data', 'data', today)) + field('Aparelho (opcional)', 'aparelho', '', 'maxlength="120" placeholder="Deixe em branco para um gasto geral"'),
      build: form => ({ action: 'gasto', payload: { descricao: readText(form, 'descricao', 'Descrição', true, 200), valor: reais(form, 'valor', 'Valor do gasto', false), data: readDate(form, 'data', 'Data do gasto'), aparelho: readText(form, 'aparelho', 'Aparelho') } }),
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
  const number = Number(row);
  const item = Number.isSafeInteger(number) && number >= 2 ? data.gastos?.find(value => Number(value.row) === number) : null;
  if (!item) throw new Error('Gasto não encontrado. Atualize o painel.');
  return { action: 'gastoExcluir', payload: { row: number, expected: structuredClone(item) } };
}
import { classifyCategory } from './analytics.mjs';
