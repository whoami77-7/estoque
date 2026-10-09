import { shipmentTracking } from './model.mjs';
import { deliveryAddressField, deliveryAddressHTML } from './currency-ui.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const localDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const dateBR = value => value.split('-').reverse().join('/');
const count = value => value.toLocaleString('pt-BR');

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

function text(value, label, max, required = true) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`${label}: ${required ? 'preencha com' : 'use'} até ${max} caracteres.`);
  return value.trim();
}

export function shipmentItemFields(item = {}, index = 0) {
  const number = Number.isSafeInteger(index) && index >= 0 ? index + 1 : 1;
  return `<div class="shipment-line"><label class="field"><span>Mercadoria</span><input name="shipmentItem" value="${esc(item.name)}" required maxlength="120" placeholder="Nome da mercadoria"></label><label class="field"><span>Quantidade</span><input name="shipmentQuantity" type="number" value="${esc(item.quantity ?? 1)}" required min="1" max="1000000" step="1" inputmode="numeric"></label><button type="button" class="ghost danger shipment-remove" data-action="shipment-remove-item" aria-label="Remover mercadoria ${number}" title="Remover mercadoria">×</button></div>`;
}

export function shipmentForm(shipment, today = localDate()) {
  if (!validDate(today)) throw new Error('Informe uma data de referência válida.');
  const record = shipment || {};
  const items = Array.isArray(record.items) && record.items.length ? record.items : [{}];
  const extras = `<details class="card-details"${record.expectedDate || record.trackingCode || record.trackingUrl || record.status === 'delivered' ? ' open' : ''}><summary>Previsão e rastreio · opcional</summary><label class="field" for="sf-expected"><span>Previsão de chegada</span><input id="sf-expected" name="expectedDate" type="date" value="${esc(record.expectedDate)}"></label><label class="field" for="sf-tracking-code"><span>Código de rastreio</span><input id="sf-tracking-code" name="trackingCode" maxlength="120" value="${esc(record.trackingCode)}" placeholder="Código ou número da remessa"></label><label class="field" for="sf-tracking-url"><span>Link de rastreio</span><input id="sf-tracking-url" name="trackingUrl" type="url" maxlength="1000" value="${esc(record.trackingUrl)}" placeholder="https://..."></label>${record.status === 'delivered' ? `<label class="field" for="sf-delivered"><span>Data da entrega · opcional</span><input id="sf-delivered" name="deliveredDate" type="date" value="${esc(record.deliveredDate)}" max="${today}"></label>` : ''}<p class="help">O aviso de atraso usa a previsão informada. O rastreio abre o site da transportadora; não atualiza a entrega sozinho.</p></details>`;
  return {
    title: shipment ? 'Editar envio' : 'Novo envio',
    html: `<div class="form-grid"><label class="field" for="sf-date"><span>Data do envio</span><input id="sf-date" name="date" type="date" required value="${esc(record.date || today)}"></label><label class="field" for="sf-transport"><span>Transporte</span><input id="sf-transport" name="transport" value="${esc(record.transport)}" required maxlength="120" placeholder="Transportadora ou responsável"></label></div><label class="field" for="sf-client"><span>Cliente</span><input id="sf-client" name="client" value="${esc(record.client)}" required maxlength="120" placeholder="Quem vai receber"></label>${deliveryAddressField(record.deliveryAddress)}<h3>Mercadorias do envio</h3><div id="shipment-items" class="shipment-lines">${items.map(shipmentItemFields).join('')}</div><button type="button" class="secondary" data-action="shipment-add-item">+ Adicionar mercadoria</button><label class="field" for="sf-notes"><span>Observações <small>opcional</small></span><textarea id="sf-notes" name="notes" rows="2" maxlength="1000" placeholder="Algum detalhe deste envio…">${esc(record.notes)}</textarea></label>${extras}<p class="help">Controle de envios; movimentações do estoque são registradas em Estoque.</p>`,
    build(form) {
      const names = form.getAll('shipmentItem'), quantities = form.getAll('shipmentQuantity');
      if (!names.length || names.length > 50 || quantities.length !== names.length) throw new Error('Inclua de 1 a 50 mercadorias, cada uma com sua quantidade.');
      const items = names.map((name, index) => {
        const raw = quantities[index];
        if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) throw new Error(`Mercadoria ${index + 1}: informe uma quantidade inteira.`);
        const quantity = Number(raw);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) throw new Error(`Mercadoria ${index + 1}: informe de 1 a 1.000.000 unidades.`);
        return { name: text(name, `Mercadoria ${index + 1}`, 120), quantity };
      });
      const date = form.get('date');
      if (!validDate(date)) throw new Error('Informe uma data de envio válida.');
      const tracking=shipmentTracking({date,expectedDate:form.get('expectedDate')||'',trackingCode:form.get('trackingCode'),trackingUrl:form.get('trackingUrl')});
      const arrival=record.status==='delivered'?{deliveredDate:String(form.get('deliveredDate')||'')}:{};
      if(arrival.deliveredDate&&(!validDate(arrival.deliveredDate)||arrival.deliveredDate<date||arrival.deliveredDate>today))throw new Error('A data da entrega deve ficar entre o envio e hoje.');
      return { transport: text(form.get('transport'), 'Transporte', 120), client: text(form.get('client'), 'Cliente', 120), deliveryAddress: text(form.has('deliveryAddress') ? form.get('deliveryAddress') : record.deliveryAddress, 'Endereço de entrega', 500, false), date, items, ...tracking, ...arrival, notes: text(form.get('notes'), 'Observações', 1000, false) };
    },
  };
}

export function shipmentView(state = {}, { month = localDate().slice(0, 7), search = '', status = '', today = localDate() } = {}) {
  if (!validDate(today)) throw new Error('Informe uma data de referência válida.');
  if (!['', 'pending', 'delivered', 'late'].includes(status)) throw new Error('Selecione uma situação válida para consultar os envios.');
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw new Error('Selecione um mês válido para consultar os envios.');
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  const monthName = label[0].toUpperCase() + label.slice(1);
  const monthShipments = (Array.isArray(state?.shipments) ? state.shipments : []).filter(shipment => shipment && validDate(shipment.date) && shipment.date.slice(0, 7) === month);
  const shipments=monthShipments.filter(shipment=>!shipment.deletedAt);
  const late=shipment=>shipment.status!=='delivered'&&validDate(shipment.expectedDate)&&shipment.expectedDate<today;
  const quantity = shipment => (Array.isArray(shipment.items) ? shipment.items : []).reduce((total, item) => total + (Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0), 0);
  const totalUnits = shipments.reduce((total, shipment) => total + quantity(shipment), 0);
  const clients = new Set(shipments.map(shipment => norm(shipment.client)).filter(Boolean));
  const delivered = shipments.filter(shipment => shipment.status === 'delivered').length;
  const query = norm(search);
  const matching=shipment=>!query||norm([shipment.transport,shipment.client,shipment.deliveryAddress,shipment.trackingCode,shipment.notes,shipment.date,dateBR(shipment.date),...(shipment.items||[]).map(item=>item.name)].join(' ')).includes(query);
  const visible = shipments.filter(shipment => (status === 'late' ? late(shipment) : status === 'delivered' ? shipment.status === 'delivered' : status === 'pending' ? shipment.status !== 'delivered' : true) && matching(shipment)).sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const cards = visible.map(shipment => {
    const arrived = shipment.status === 'delivered';
    const statusLabel = arrived ? '✓ Entregue' : late(shipment) ? '⚠ Prazo de chegada vencido' : shipment.status === 'pending' ? 'Aguardando entrega' : 'Aguardando confirmação';
    return `<article class="shipment-card debt-card shipment-${arrived ? 'delivered' : 'pending'}"><details class="shipment-record"><summary class="shipment-summary debt-top"><span><strong class="shipment-transport">${esc(shipment.transport || 'Sem transporte')}</strong><span class="meta shipment-route">Para: ${esc(shipment.client || 'Sem cliente')} · ${esc(dateBR(shipment.date))}</span></span><span class="shipment-summary-end"><span class="badge">${count(quantity(shipment))} un.</span><span class="shipment-chevron" aria-hidden="true">⌄</span></span></summary><div class="shipment-details">${deliveryAddressHTML(shipment.deliveryAddress)}<ul class="payments shipment-item-list">${(Array.isArray(shipment.items) ? shipment.items : []).map(item => `<li class="payment-row"><span>${esc(item.name)}</span><strong>${esc(item.quantity)} un.</strong></li>`).join('')}</ul>${shipment.notes ? `<p class="notes">${esc(shipment.notes)}</p>` : ''}${shipment.trackingCode ? `<p class="help">Rastreio: <strong>${esc(shipment.trackingCode)}</strong></p>` : ''}${shipment.trackingUrl ? `<p><a class="tracking-link" href="${esc(shipmentTracking(shipment).trackingUrl)}" target="_blank" rel="noopener noreferrer">↗ Abrir rastreio</a></p>` : ''}<div class="card-actions"><button type="button" class="secondary" data-action="shipment-edit" data-id="${esc(shipment.id)}">✎ Editar envio</button><button type="button" class="ghost danger" data-action="shipment-delete" data-id="${esc(shipment.id)}">🗑 Excluir envio</button></div></div></details><div class="shipment-delivery"><span class="shipment-status">${statusLabel}${!arrived && validDate(shipment.expectedDate) ? `<small>Previsão: ${esc(dateBR(shipment.expectedDate))}</small>` : ''}${arrived && validDate(shipment.deliveredDate) ? `<small>Em ${esc(dateBR(shipment.deliveredDate))}</small>` : ''}</span><button type="button" class="secondary" data-action="shipment-delivery" data-id="${esc(shipment.id)}">${arrived ? 'Desfazer entrega' : '✓ Marcar entregue'}</button></div></article>`;
  }).join('');
  const statusFilter = `<label class="shipment-status-filter" for="shipment-status"><span>Situação</span><select id="shipment-status"><option value=""${!status ? ' selected' : ''}>Todos (${count(shipments.length)})</option><option value="pending"${status === 'pending' ? ' selected' : ''}>A confirmar / a caminho (${count(shipments.length - delivered)})</option><option value="delivered"${status === 'delivered' ? ' selected' : ''}>Entregues (${count(delivered)})</option><option value="late"${status === 'late' ? ' selected' : ''}>Prazo vencido (${count(shipments.filter(late).length)})</option></select></label>`;
  const excluded=monthShipments.filter(s=>s.deletedAt&&matching(s));
  const trash=`<details class="notes-trash"><summary>🗑 Envios excluídos · ${excluded.length}</summary><p class="help">Lixeira deste mês. Restaurar devolve o envio à lista com seus dados e situação.</p>${excluded.map(s=>`<article class="payment-row"><div><strong class="shipment-transport">${esc(s.transport || 'Sem transporte')}</strong><p class="meta">Para: ${esc(s.client || 'Sem cliente')} · ${dateBR(s.date)} · ${count(quantity(s))} un.</p></div><button type="button" class="secondary" data-action="shipment-restore" data-id="${esc(s.id)}">↩ Restaurar envio</button></article>`).join('')||'<p class="help">Nenhum envio excluído para esta busca.</p>'}</details>`;
  return `<section class="shipment-module" aria-label="Envios de ${esc(monthName)}"><div class="summary-strip"><div class="stat"><span>Envios no mês</span><strong>${count(shipments.length)}</strong></div><div class="stat"><span>Unidades enviadas</span><strong>${count(totalUnits)}</strong></div><div class="stat"><span>Clientes no mês</span><strong>${count(clients.size)}</strong></div></div><div class="toolbar shipment-toolbar"><h2>${esc(monthName)}</h2><button type="button" class="primary" data-action="shipment-new">+ Novo envio</button></div>${statusFilter}<div class="debt-list shipment-list">${cards || `<div class="empty">${query || status ? 'Nenhum envio corresponde aos filtros neste mês.' : 'Nenhum envio neste mês. Use “Novo envio” para anotar o primeiro.'}</div>`}</div>${trash}<p class="help shipment-help">Marcar como entregue apenas confirma a chegada; não altera o estoque nem gera uma venda.</p></section>`;
}
