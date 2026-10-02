const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const localDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

function noteText(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 6000) throw new Error('Escreva uma anotação de até 6.000 caracteres.');
  return value.trim();
}

function explicitDate(content, year) {
  const br = content.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  const candidate = br ? `${br[3] || year}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}` : content;
  return { date: validDate(candidate) ? candidate : '', inferredYear: !!(br && !br[3]) };
}

export function noteForm(note = {}) {
  return {
    title: 'Anotação rápida',
    html: `<label class="field" for="nf-text"><span>O que você quer anotar?</span><textarea id="nf-text" name="text" rows="8" required maxlength="6000" autofocus placeholder="Escreva do seu jeito…">${esc(note.text)}</textarea></label><p class="help">Salve agora. Depois você pode organizar ou compartilhar.</p>`,
    build(form) { return { text: noteText(form.get('text')) }; },
  };
}

export function notesView(state = {}, { search = '' } = {}) {
  const query = norm(search);
  const notes = (Array.isArray(state.notes) ? state.notes : []).filter(note => note && typeof note.text === 'string' && (!query || norm(note.text).includes(query))).slice().sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  const labels = { shipment: 'Envio criado', debt: 'Dívida criada', movement: 'Movimentação criada', product: 'Produto criado' };
  const cards = notes.map(note => {
    const firstLine = note.text.trim().split(/\r?\n/)[0] || 'Anotação';
    const title = [...firstLine].length > 90 ? `${[...firstLine].slice(0, 90).join('')}…` : firstLine;
    const date = new Date(note.updatedAt || note.createdAt);
    const stamp = Number.isFinite(date.getTime()) ? date.toLocaleDateString('pt-BR') : 'Sem data';
    const linked = labels[note.convertedTo?.type];
    return `<article class="note-card debt-card"><details class="note-content"><summary class="shipment-summary debt-top"><span><strong>${esc(title)}</strong><span class="meta shipment-route">${esc(stamp)}${linked ? ` · ${linked}` : ''}</span></span><span class="shipment-chevron" aria-hidden="true">⌄</span></summary><p class="notes note-text">${esc(note.text).replace(/\r?\n/g, '<br>')}</p><div class="card-actions"><button type="button" class="secondary" data-action="note-share" data-id="${esc(note.id)}">Compartilhar</button><button type="button" class="ghost" data-action="note-copy" data-id="${esc(note.id)}">Copiar texto</button></div></details><div class="card-actions"><button type="button" class="${linked ? 'secondary' : 'primary'}" data-action="${linked ? 'note-open' : 'note-convert'}" data-id="${esc(note.id)}">${linked ? 'Abrir registro' : 'Organizar / enviar'}</button>${linked ? '' : `<button type="button" class="ghost" data-action="note-edit" data-id="${esc(note.id)}" aria-label="Editar anotação" title="Editar anotação">✎</button>`}</div></article>`;
  }).join('');
  return `<section class="notes-module" aria-label="Anotações rápidas"><div class="debt-list notes-list">${cards || `<div class="empty">${query ? 'Nenhuma anotação corresponde à busca.' : 'Escreva agora, organize depois. Use “Anotar” para começar.'}</div>`}</div></section>`;
}

export function noteToShipment(note, today = localDate()) {
  if (!validDate(today)) throw new Error('Informe uma data de referência válida.');
  const text = noteText(note?.text);
  const createdDate = typeof note.createdAt === 'string' ? note.createdAt.slice(0, 10) : '';
  const year = (validDate(note.date) ? note.date : validDate(createdDate) ? createdDate : today).slice(0, 4);
  const warnings = [], values = { transport: [], client: [], date: [] }, items = [];
  let unrecognized = 0, inferredYear = false;
  // ponytail: only explicit labels and quantity-first lines; ambiguous prose stays in the saved note for review.
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const label = line.match(/^(transporte|cliente|data|mercadorias?)\s*:\s*(.*)$/i);
    const content = label ? label[2].trim() : line.replace(/^[-•]\s+/, '');
    if (label && /^(transporte|cliente)$/i.test(label[1])) {
      values[norm(label[1]) === 'transporte' ? 'transport' : 'client'].push(content);
      continue;
    }
    if (label && norm(label[1]) === 'data') {
      const parsed = explicitDate(content, year);
      values.date.push(parsed.date);
      inferredYear ||= parsed.inferredYear;
      continue;
    }
    if (label && !content) continue;
    const item = content.match(/^(\d+)\s+(.+)$/);
    if (item && Number.isSafeInteger(Number(item[1])) && Number(item[1]) > 0 && Number(item[1]) <= 1000000 && item[2].trim().length <= 120 && /[\p{L}]/u.test(item[2]) && !/^(?:(?:real|reais|dolar|dolares|brl|usd)(?:\s|$)|r\$|us\$)/.test(norm(item[2]))) items.push({ name: item[2].trim(), quantity: Number(item[1]) });
    else unrecognized++;
  }
  const input = { transport: '', client: '', date: '', items, notes: text.length <= 1000 ? text : '' };
  for (const [key, label] of [['transport', 'transporte'], ['client', 'cliente'], ['date', 'data']]) {
    const candidates = [...new Set(values[key])];
    if (candidates.length === 1 && candidates[0] && (key === 'date' || candidates[0].length <= 120)) input[key] = candidates[0];
    else warnings.push(values[key].length ? `Confira ${label}: há informação incompleta ou ambígua na anotação.` : `Preencha ${label} do envio.`);
  }
  if (inferredYear && input.date) warnings.push(`A data não tinha ano; usamos ${year}. Confira antes de salvar.`);
  if (!items.length) warnings.push('Inclua as mercadorias e quantidades do envio.');
  if (items.length > 50) warnings.push('Este envio aceita até 50 mercadorias; divida a anotação em mais de um envio.');
  if (unrecognized) warnings.push(`${unrecognized} ${unrecognized === 1 ? 'linha ficou' : 'linhas ficaram'} sem classificação. O texto original foi preservado na anotação.`);
  if (text.length > 1000) warnings.push('O texto original continua salvo na anotação. Resuma as observações do envio em até 1.000 caracteres.');
  return { input, warnings };
}

export function noteToDebt(note, today = localDate()) {
  if (!validDate(today)) throw new Error('Informe uma data de referência válida.');
  const text = noteText(note?.text);
  const createdDate = typeof note.createdAt === 'string' ? note.createdAt.slice(0, 10) : '';
  const year = (validDate(note.date) ? note.date : validDate(createdDate) ? createdDate : today).slice(0, 4);
  const values = { name: [], description: [], total: [], date: [], units: [] }, warnings = [];
  const fields = { devedor: 'name', cliente: 'name', nome: 'name', produto: 'description', sobre: 'description', motivo: 'description', valor: 'total', total: 'total', data: 'date', quantidade: 'units' };
  let unrecognized = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const match = raw.trim().match(/^([^:]+):\s*(.*)$/);
    const field = match && fields[norm(match[1])];
    if (field) values[field].push(match[2].trim());
    else unrecognized++;
  }
  const input = { name: '', description: '', total: '', currency: '', date: '', notes: text.length <= 1000 ? text : '' };
  const single = key => { const unique = [...new Set(values[key])]; return unique.length === 1 ? unique[0] : ''; };
  for (const [key, label, max] of [['name', 'quem deve', 120], ['description', 'o motivo da dívida', 200]]) {
    const value = single(key);
    if (value && value.length <= max) input[key] = value;
    else warnings.push(`Preencha ${label}; a anotação não informa um único texto válido.`);
  }
  const date = explicitDate(single('date'), year);
  input.date = date.date;
  if (!date.date) warnings.push('Preencha a data da dívida.');
  else if (date.inferredYear) warnings.push(`A data não tinha ano; usamos ${year}. Confira antes de salvar.`);
  let amount = single('total');
  const currencyBefore = amount.match(/^(US\$|R\$|USD|BRL)\s*(.+)$/i);
  const currencyAfter = amount.match(/^(.+?)\s*(US\$|R\$|USD|BRL)$/i);
  const currency = currencyBefore?.[1] || currencyAfter?.[2];
  if (currency) {
    input.currency = /^(US\$|USD)$/i.test(currency) ? 'USD' : 'BRL';
    amount = (currencyBefore?.[2] || currencyAfter[1]).trim();
  }
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(amount)) amount = amount.replace(/\./g, '').replace(',', '.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(amount)) amount = amount.replace(',', '.');
  else amount = '';
  if (amount) {
    const [whole, fraction = ''] = amount.split('.');
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
    if (cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER)) input.total = `${BigInt(whole)}.${fraction.padEnd(2, '0')}`;
  }
  if (!input.total) warnings.push('Confira o valor total; use, por exemplo, “Valor: R$ 2.000,00”.');
  if (!input.currency) warnings.push('Escolha a moeda da dívida; ela não foi identificada.');
  const units = single('units');
  if (units && /^\d+$/.test(units) && Number(units) > 0 && Number(units) <= 1000000) input.units = Number(units);
  else if (values.units.length) warnings.push('Confira a quantidade de itens; informe um número inteiro de 1 a 1.000.000.');
  if (unrecognized) warnings.push(`${unrecognized} ${unrecognized === 1 ? 'linha ficou' : 'linhas ficaram'} sem classificação. O texto original foi preservado na anotação.`);
  if (text.length > 1000) warnings.push('O texto original continua salvo na anotação. Resuma as observações da dívida em até 1.000 caracteres.');
  return { input, warnings };
}
