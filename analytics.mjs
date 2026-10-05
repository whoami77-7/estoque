import { currencyOf, formatMoney, convertCents } from './money.mjs';
import { classifyCategory } from './model.mjs';
export { classifyCategory };

const DAY = 86400000;
const categories = { peptideos: 'Peptídeos', 'ar-condicionados': 'Ar-condicionados', mercadorias: 'Mercadorias' };
const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const array = value => Array.isArray(value) ? value : [];

function date(value) {
  if (typeof value !== 'string') return null;
  let iso = value.trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(iso);
  if (br) iso = `${br[3]}-${br[2]}-${br[1]}`;
  else if (/^\d{4}-\d{2}-\d{2}T/.test(iso) && Number.isFinite(Date.parse(iso))) iso = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const stamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === iso ? iso : null;
}

function legacyCents(value) {
  if (value === '' || value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string') {
    value = value.trim().replace(/^(?:US\$|R\$|\$)\s*/, '');
    if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) value = value.replaceAll('.', '').replace(',', '.');
    else if (/^-?\d+(?:[.,]\d{1,2})?$/.test(value)) value = value.replace(',', '.');
    else return null;
  }
  if (typeof value !== 'number') value = Number(value);
  const cents = Math.round(value * 100);
  return Number.isFinite(value) && Number.isSafeInteger(cents) && Math.abs(value * 100 - cents) < .00001 ? cents : null;
}
const cents = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const daysSince = (today, first) => Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY);

export function analyze(legacyData = {}, state = {}, options = {}) {
  state ||= {};
  const today = date(options.today);
  if (!today) throw new Error('Informe a data de referência no formato AAAA-MM-DD.');
  const category = options.category || '';
  if (category && !Object.hasOwn(categories, category)) throw new Error('Categoria de análise inválida.');
  const currency = options.currency || 'BRL';
  if (!['BRL', 'USD'].includes(currency)) throw new Error('Moeda de análise inválida.');
  const legacy = legacyData?.dados || legacyData || {};
  const groups = new Map();
  const warnings = { undatedSales: 0, futureRecords: 0, invalidMovements: 0, unknownRevenueSales: 0, duplicateRecords: 0, negativeStockProducts: 0, unknownCurrencyValues: 0, missingExchangeRateValues: 0 };
  const totals = { unitsSold: 0, revenueCents: 0, revenueKnownUnits: 0, revenueUnknownUnits: 0, profitKnownCents: 0, profitKnownUnits: 0, profitUnknownUnits: 0, stockUnits: 0, stockCostKnownCents: 0, stockCostKnownUnits: 0, stockCostUnknownUnits: 0, legacyOutstandingCents: 0, legacyOutstandingUnknownRecords: 0, legacyReceivedMarkedCents: 0, newOutstandingCents: 0, newOutstandingUnknownDebts: 0, newPayments30Cents: 0, newPayments30UnknownRecords: 0 };
  // Cotações de referência atuais nunca reescrevem os valores históricos.
  const amountInCurrency = (amount, record, field = 'currency') => {
    if (amount == null) return null;
    if (!Number.isSafeInteger(amount)) throw new Error('O total excede o limite seguro de centavos. Revise os valores cadastrados.');
    const from = currencyOf(record, field);
    if (!from) { warnings.unknownCurrencyValues++; return null; }
    const converted = convertCents(amount, from, currency, record[field === 'costCurrency' ? 'costFxRate' : 'fxRate']);
    if (converted == null) warnings.missingExchangeRateValues++;
    return converted;
  };
  const sales = [];
  const group = (key, item, source) => {
    if (!groups.has(key)) groups.set(key, { key, name: item.name || item.modelo || 'Sem nome', category: classifyCategory(item), source, stockUnits: 0, stockCostKnownCents: 0, stockCostKnownUnits: 0, dates: [], sales: [], stockDates: [], minStock: Number.isSafeInteger(item.minStock) && item.minStock > 0 ? item.minStock : 0 });
    return groups.get(key);
  };
  const admitSale = (product, sale) => {
    if (sale.date && sale.date > today) { warnings.futureRecords++; return; }
    if (!sale.date) warnings.undatedSales++;
    if (sale.revenueCents == null) { warnings.unknownRevenueSales++; totals.revenueUnknownUnits += sale.units; }
    else { totals.revenueCents += sale.revenueCents; totals.revenueKnownUnits += sale.units; }
    totals.unitsSold += sale.units;
    if (sale.profitCents == null) totals.profitUnknownUnits += sale.units;
    else { totals.profitKnownCents += sale.profitCents; totals.profitKnownUnits += sale.units; }
    product.sales.push(sale); sales.push(sale);
    if (sale.date) product.dates.push(sale.date);
  };
  const seenRows = new Set();
  for (const [index, item] of array(legacy.itens).entries()) {
    if (!item || typeof item !== 'object' || (category && classifyCategory(item) !== category)) continue;
    const identity = item.row == null ? `index:${index}` : `row:${item.row}`;
    if (seenRows.has(identity)) { warnings.duplicateRecords++; continue; }
    seenRows.add(identity);
    const product = group(`legacy:${classifyCategory(item)}:${norm(item.modelo)}`, item, 'principal');
    const entry = date(item.dataPasse), sold = norm(item.situacao) === 'vendido';
    const purchase = legacyCents(item.compra), salePrice = legacyCents(item.venda);
    // Zero é o padrão do banco para compra ausente, portanto não prova custo zero.
    const knownCost = purchase != null && purchase > 0;
    if (entry && entry <= today) product.dates.push(entry);
    if (sold) {
      const soldAt = date(item.dataVenda);
      if (soldAt && soldAt > today) { warnings.futureRecords++; continue; }
      const revenue = amountInCurrency(salePrice != null && salePrice >= 0 ? salePrice : null, item);
      const cost = knownCost ? amountInCurrency(purchase, item, 'costCurrency') : null;
      admitSale(product, { date: soldAt, units: 1, revenueCents: revenue, profitCents: cost != null && revenue != null ? revenue - cost : null });
      if (norm(item.pagamento) === 'recebido') totals.legacyReceivedMarkedCents += revenue ?? 0;
      else {
        totals.legacyOutstandingCents += revenue ?? 0;
        if (revenue == null) totals.legacyOutstandingUnknownRecords++;
      }
    } else if (entry && entry > today) warnings.futureRecords++;
    else {
      product.stockUnits++;
      if (entry) product.stockDates.push(entry);
      const cost = knownCost ? amountInCurrency(purchase, item, 'costCurrency') : null;
      if (cost != null) { product.stockCostKnownCents += cost; product.stockCostKnownUnits++; }
    }
  }

  const products = new Map();
  for (const item of array(state.products)) {
    if (!item || typeof item.id !== 'string' || (category && classifyCategory(item) !== category)) continue;
    if (products.has(item.id)) { warnings.duplicateRecords++; continue; }
    const product = group(`product:${item.id}`, item, 'mercadorias');
    product.currentCostCents = cents(item.costCents);
    product.costCurrency = currencyOf(item, 'costCurrency');
    product.costFxRate = item.costFxRate;
    products.set(item.id, product);
  }
  const seenMovements = new Set();
  for (const [index, movement] of array(state.movements).entries()) {
    if (!movement || !products.has(movement.productId)) continue;
    const identity = movement.id || `index:${index}`;
    if (seenMovements.has(identity)) { warnings.duplicateRecords++; continue; }
    seenMovements.add(identity);
    const product = products.get(movement.productId), day = date(movement.date);
    if (!day || !Number.isSafeInteger(movement.quantity) || movement.quantity <= 0 || !['entrada', 'saida', 'transferencia'].includes(movement.type)) { warnings.invalidMovements++; continue; }
    if (day > today) { warnings.futureRecords++; continue; }
    product.dates.push(day);
    if (movement.type === 'entrada') { product.stockUnits += movement.quantity; product.stockDates.push(day); }
    if (movement.type === 'saida') {
      product.stockUnits -= movement.quantity;
      const price = cents(movement.unitPriceCents);
      const revenue = amountInCurrency(price != null && Number.isSafeInteger(price * movement.quantity) ? price * movement.quantity : null, movement);
      // Entrada.unitPriceCents é preço de venda sugerido no app atual, nunca custo de compra.
      admitSale(product, { date: day, units: movement.quantity, revenueCents: revenue, profitCents: null });
    }
  }
  // Pagamentos são caixa, não uma segunda venda. A categoria não é conhecida nas dívidas avulsas.
  for (const debt of array(state.debts)) {
    if (debt?.deletedAt) continue;
    const origin = date(debt?.date), total = cents(debt?.totalCents);
    if (total == null || !origin || origin > today) continue;
    let paid = 0;
    const seen = new Set();
    for (const [index, payment] of array(debt.payments).entries()) {
      if (payment?.deletedAt) continue;
      const identity = payment?.id || `index:${index}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const day = date(payment?.date), value = cents(payment?.amountCents);
      if (!day || day > today || day < origin || value == null) continue;
      paid += value;
      if (daysSince(today, day) < 30) {
        const receivedAmount = cents(payment.receivedCents);
        // Histórico antigo só informa o abatimento; não prova a moeda recebida nem o câmbio.
        const received = receivedAmount == null ? amountInCurrency(value, {}) : amountInCurrency(receivedAmount, payment);
        totals.newPayments30Cents += received ?? 0;
        if (received == null) totals.newPayments30UnknownRecords++;
      }
    }
    const balance = Math.max(0, total - paid);
    if (balance) {
      const outstanding = amountInCurrency(balance, debt);
      totals.newOutstandingCents += outstanding ?? 0;
      if (outstanding == null) totals.newOutstandingUnknownDebts++;
    }
  }

  const summarize = events => events.reduce((result, sale) => {
    result.units += sale.units; result.saleRecords++;
    result.revenueCents += sale.revenueCents ?? 0;
    if (sale.revenueCents == null) result.revenueUnknownUnits += sale.units;
    else result.revenueKnownUnits += sale.units;
    if (sale.profitCents != null) { result.profitKnownCents += sale.profitCents; result.profitKnownUnits += sale.units; }
    else result.profitUnknownUnits += sale.units;
    return result;
  }, { units: 0, saleRecords: 0, revenueCents: 0, revenueKnownUnits: 0, revenueUnknownUnits: 0, profitKnownCents: 0, profitKnownUnits: 0, profitUnknownUnits: 0 });
  const within = (sale, days) => sale.date && daysSince(today, sale.date) >= 0 && daysSince(today, sale.date) < days;
  const windows = { days30: summarize(sales.filter(sale => within(sale, 30))), days90: summarize(sales.filter(sale => within(sale, 90))) };
  const results = [...groups.values()].map(product => {
    if (product.stockUnits < 0) warnings.negativeStockProducts++;
    const first = product.dates.length ? product.dates.reduce((a, b) => a < b ? a : b) : null;
    const historyDays = first ? Math.min(90, daysSince(today, first) + 1) : 0;
    const lastSale = product.sales.filter(sale => sale.date).map(sale => sale.date).sort().at(-1) || null;
    const recent = product.sales.filter(sale => within(sale, 90));
    const recentTotals = summarize(recent), last30 = summarize(product.sales.filter(sale => within(sale, 30)));
    const available = Math.max(0, product.stockUnits);
    if (product.source === 'mercadorias' && product.currentCostCents != null && available) {
      const cost = amountInCurrency(available * product.currentCostCents, product, 'costCurrency');
      if (cost != null) { product.stockCostKnownCents = cost; product.stockCostKnownUnits = available; }
    }
    const oldestStockDate = product.stockDates.length ? product.stockDates.reduce((a, b) => a < b ? a : b) : null;
    const stockAgeDays = product.source === 'principal' && oldestStockDate ? daysSince(today, oldestStockDate) : null;
    const eligible = historyDays >= 14 && recent.length >= 3 && product.stockUnits >= 0;
    const dailyUnits = eligible ? recentTotals.units / historyDays : null;
    const forecastUnits30 = dailyUnits == null ? null : dailyUnits * 30;
    const coverageDays = dailyUnits > 0 ? available / dailyUnits : null;
    const replenishUnits = forecastUnits30 == null ? null : Math.max(0, Math.ceil(Math.max(forecastUnits30, product.minStock)) - available);
    const idleDays = lastSale ? daysSince(today, lastSale) : first ? daysSince(today, first) : null;
    totals.stockUnits += available; totals.stockCostKnownCents += product.stockCostKnownCents;
    totals.stockCostKnownUnits += product.stockCostKnownUnits;
    totals.stockCostUnknownUnits += Math.max(0, available - product.stockCostKnownUnits);
    return { ...product, stockUnits: available, historyDays, lastSale, stockAgeDays, idleDays, last30, last90: recentTotals, forecastUnits30, coverageDays, replenishUnits, confidence: eligible ? historyDays >= 60 && recent.length >= 10 ? 'moderada' : 'baixa' : 'insuficiente' };
  });
  const ranking = results.filter(product => product.last90.units > 0).sort((a, b) => b.last90.units - a.last90.units || (!a.last90.revenueUnknownUnits && !b.last90.revenueUnknownUnits ? b.last90.revenueCents - a.last90.revenueCents : 0) || a.name.localeCompare(b.name, 'pt-BR'));
  const forecastProducts = results.filter(product => product.forecastUnits30 != null);
  const forecast = { products: forecastProducts, units30: forecastProducts.length ? forecastProducts.reduce((sum, product) => sum + product.forecastUnits30, 0) : null, eligibleProducts: forecastProducts.length, excludedProducts: results.length - forecastProducts.length };
  const insights = [];
  const replenish = forecastProducts.filter(product => product.replenishUnits > 0).sort((a, b) => (a.coverageDays ?? Infinity) - (b.coverageDays ?? Infinity));
  const idle = results.filter(product => product.stockUnits > 0 && product.idleDays != null && product.idleDays >= 30).sort((a, b) => b.idleDays - a.idleDays);
  for (const product of replenish.slice(0, 3)) insights.push({ kind: 'restock', title: `Revisar reposição: ${product.name}`, text: `Faltam aproximadamente ${count(product.replenishUnits)} un. para cobrir 30 dias no ritmo observado${product.minStock ? ' e respeitar o mínimo cadastrado' : ''}. Confirme prazo e custo atual antes de comprar.`, productKey: product.key });
  for (const product of idle.slice(0, 3)) insights.push({ kind: 'idle', title: `Conferir giro: ${product.name}`, text: `${count(product.stockUnits)} un. no estoque; ${product.lastSale ? `última saída registrada há ${count(product.idleDays)} dias` : `sem saída registrada em ${count(product.idleDays)} dias de histórico`}. Confira saldo físico, demanda e cadastro.`, productKey: product.key });
  if (totals.stockCostUnknownUnits) insights.push({ kind: 'data', title: 'Completar custos, moedas e câmbio', text: `${count(totals.stockCostUnknownUnits)} un. ainda não têm custo apurado na moeda selecionada. Confira o valor, a moeda de compra e o câmbio salvo. Essas unidades ficam fora do capital conhecido.` });
  if (!forecast.eligibleProducts) insights.push({ kind: 'data', title: 'Construir histórico antes de projetar', text: 'Cada produto precisa de pelo menos 14 dias observados e 3 registros de saída com data nos últimos 90 dias para receber uma estimativa.' });
  for (const summary of [totals, ...Object.values(windows), ...results.flatMap(product => [product, product.last30, product.last90])]) {
    if (Object.entries(summary).some(([key, value]) => key.endsWith('Cents') && value != null && !Number.isSafeInteger(value))) throw new Error('O total excede o limite seguro de centavos. Revise os valores cadastrados.');
  }
  return { today, category, currency, totals, windows, products: results, ranking, forecast, insights, warnings };
}

export function decisionView(legacyData, state, options) {
  const analysis = analyze(legacyData, state, options);
  const { totals, windows, ranking, forecast, warnings, insights } = analysis;
  const money = value => formatMoney(value, analysis.currency);
  const revenueText = summary => summary.revenueKnownUnits || !summary.revenueUnknownUnits ? money(summary.revenueCents) : 'Não apurado';
  const cashText = (amount, omitted) => `${omitted && !amount ? 'Não apurado' : money(amount)}${omitted ? `<small>Parcial · ${count(omitted)} registro(s) pendente(s)</small>` : ''}`;
  const dateBR = analysis.today.split('-').reverse().join('/');
  const stat = (label, value, note) => `<div class="decision-stat"><span>${label}</span><strong>${value}</strong><small>${esc(note)}</small></div>`;
  const list = insights.length ? insights.map(insight => `<li class="decision-insight decision-${insight.kind}"><h3>${esc(insight.title)}</h3><p>${esc(insight.text)}</p></li>`).join('') : '<li class="decision-insight"><h3>Continue acompanhando os registros</h3><p>Não há alertas de reposição ou falta de giro nos dados desta seleção.</p></li>';
  const rankingRows = ranking.slice(0, 10).map((product, index) => `<tr><td><span class="decision-rank">${index + 1}</span><span><strong>${esc(product.name)}</strong><small>${esc(categories[product.category])}</small></span></td><td>${count(product.last90.units)}</td><td>${revenueText(product.last90)}${product.last90.revenueUnknownUnits ? `<small>Parcial · ${count(product.last90.revenueUnknownUnits)} un. sem valor apurado</small>` : ''}</td><td>${product.last90.profitKnownUnits ? money(product.last90.profitKnownCents) : '—'}${product.last90.profitUnknownUnits ? '<small>Custo, moeda ou câmbio pendente</small>' : ''}</td></tr>`).join('');
  const forecastRows = forecast.products.slice().sort((a, b) => (b.replenishUnits || 0) - (a.replenishUnits || 0)).slice(0, 10).map(product => `<tr><td><strong>${esc(product.name)}</strong><small>${product.historyDays} dias · ${product.last90.saleRecords} registros</small></td><td>${count(product.stockUnits)} un.</td><td>≈ ${count(product.forecastUnits30)} un.</td><td>${product.coverageDays == null ? '—' : `≈ ${count(product.coverageDays)} dias`}</td><td>${product.replenishUnits ? `${count(product.replenishUnits)} un.` : 'Sem falta estimada'}<small>Confiança ${product.confidence}</small></td></tr>`).join('');
  const problems = [];
  if (warnings.undatedSales) problems.push(`${count(warnings.undatedSales)} venda(s) sem data válida ficaram fora das janelas e previsões.`);
  if (warnings.futureRecords) problems.push(`${count(warnings.futureRecords)} registro(s) futuro(s) ficaram fora dos resultados até hoje.`);
  if (warnings.invalidMovements) problems.push(`${count(warnings.invalidMovements)} movimento(s) inválido(s) foram ignorados. Confira datas e quantidades.`);
  if (warnings.unknownRevenueSales) problems.push(`${count(warnings.unknownRevenueSales)} saída(s) sem valor apurado na moeda selecionada não contribuíram para o faturamento. As unidades continuam no ranking.`);
  if (warnings.unknownCurrencyValues) problems.push(`${count(warnings.unknownCurrencyValues)} valor(es) com moeda a confirmar ficaram fora dos totais monetários. Identifique a moeda pelo lápis, sem alterar o número original.`);
  if (warnings.missingExchangeRateValues) problems.push(`${count(warnings.missingExchangeRateValues)} valor(es) em outra moeda sem câmbio salvo ficaram fora dos totais monetários. Informe o câmbio no registro ou troque a moeda da análise.`);
  if (warnings.duplicateRecords) problems.push(`${count(warnings.duplicateRecords)} registro(s) duplicado(s) foram desconsiderados.`);
  if (warnings.negativeStockProducts) problems.push(`${count(warnings.negativeStockProducts)} produto(s) com saldo negativo precisam de conferência; a projeção foi bloqueada.`);
  return `<details id="decision-details" class="decision-disclosure" open><summary><span>Análise do negócio</span><span class="decision-disclosure-hint"><span class="decision-open-hint">Recolher</span><span class="decision-closed-hint">Expandir</span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg></span></summary><section class="decision-board" aria-label="Tomada de decisão">
    <header class="decision-intro"><div><span class="decision-tag">Visão de gestão</span><h2>Clareza para a próxima decisão.</h2><p>Vendas registradas, estoque atual e sinais de reposição${analysis.category ? ` · ${esc(categories[analysis.category])}` : ''}.</p></div><div><span class="decision-date">Referência: ${esc(dateBR)}</span><label class="decision-currency" for="decision-currency">Valores da análise<select id="decision-currency"><option value="BRL"${analysis.currency === 'BRL' ? ' selected' : ''}>R$ · Real</option><option value="USD"${analysis.currency === 'USD' ? ' selected' : ''}>US$ · Dólar</option></select></label></div></header>
    <p class="decision-method">Todos os valores abaixo estão em ${analysis.currency === 'USD' ? 'dólares (US$)' : 'reais (R$)'}. Conversões usam o câmbio salvo em cada registro; a cotação de referência atual não altera o histórico. Moeda ou câmbio pendente deixam os totais parciais.</p>
    <div class="decision-metrics">
      ${stat('Faturamento · 30 dias', revenueText(windows.days30), `${count(windows.days30.units)} unidades em saídas${windows.days30.revenueUnknownUnits ? ` · parcial: ${count(windows.days30.revenueUnknownUnits)} un. sem valor apurado` : ' registradas'}`)}
      ${stat('Lucro bruto conhecido · 30 dias', windows.days30.profitKnownUnits ? money(windows.days30.profitKnownCents) : 'Não apurado', `${count(windows.days30.profitKnownUnits)} un. apuradas · ${count(windows.days30.profitUnknownUnits)} pendentes`)}
      ${stat('Capital conhecido em estoque', totals.stockCostKnownUnits ? money(totals.stockCostKnownCents) : 'Não apurado', `${count(totals.stockCostKnownUnits)} un. apuradas · ${count(totals.stockCostUnknownUnits)} pendentes`)}
      ${stat('Estoque atual', `${count(totals.stockUnits)} un.`, 'Disponível e pendente; exclui o já vendido')}
    </div>
    <section class="decision-section"><div class="decision-heading"><div><h2>O que está saindo</h2><p>Ranking por unidades nos últimos 90 dias. O faturamento só desempata quando ambos os valores estão completos.</p></div><span class="decision-period">${count(windows.days90.units)} un. · ${revenueText(windows.days90)}${windows.days90.revenueUnknownUnits ? ' · parcial' : ''}</span></div>${rankingRows ? `<div class="decision-table-wrap" tabindex="0" aria-label="Ranking de saídas, tabela com rolagem horizontal"><table class="decision-table"><thead><tr><th scope="col">Produto</th><th scope="col">Saídas</th><th scope="col">Faturamento</th><th scope="col">Lucro conhecido</th></tr></thead><tbody>${rankingRows}</tbody></table></div>` : '<p class="decision-empty">Ainda não há saídas com data válida nos últimos 90 dias nesta seleção.</p>'}</section>
    <section class="decision-section"><div class="decision-heading"><div><h2>Próximos 30 dias</h2><p>Estimativa operacional de demanda; não é venda garantida.</p></div><span class="decision-period">${forecast.units30 == null ? 'Histórico insuficiente' : `≈ ${count(forecast.units30)} un. estimadas`}</span></div>${forecastRows ? `<div class="decision-table-wrap" tabindex="0" aria-label="Estimativas de reposição, tabela com rolagem horizontal"><table class="decision-table"><thead><tr><th scope="col">Produto / base</th><th scope="col">Saldo</th><th scope="col">Demanda em 30 dias</th><th scope="col">Cobertura</th><th scope="col">Revisar reposição</th></tr></thead><tbody>${forecastRows}</tbody></table></div>` : '<p class="decision-empty">A projeção aparece quando um produto reúne pelo menos 14 dias de histórico e 3 registros de saída com data nos últimos 90 dias.</p>'}<p class="decision-method">Método: saídas ÷ dias observados (máximo de 90) × 30. A cobertura usa o mesmo ritmo; a reposição desconta o saldo e considera o mínimo cadastrado. Não inclui sazonalidade ou prazo do fornecedor. ${forecast.excludedProducts ? `${count(forecast.excludedProducts)} produto(s) sem base suficiente ficaram fora da estimativa.` : ''}</p></section>
    <section class="decision-section"><div class="decision-heading"><div><h2>Onde vale olhar agora</h2><p>Ações práticas a partir dos registros disponíveis.</p></div></div><ul class="decision-insights">${list}</ul></section>
    <section class="decision-cash"><div><h3>Receber não é vender de novo</h3><p>Pagamentos e dívidas aparecem separados e nunca são somados ao faturamento.</p></div><dl><div><dt>A receber · aparelhos${analysis.category ? ' nesta categoria' : ''}</dt><dd>${cashText(totals.legacyOutstandingCents, totals.legacyOutstandingUnknownRecords)}</dd></div><div><dt>Devedores · saldo geral</dt><dd>${cashText(totals.newOutstandingCents, totals.newOutstandingUnknownDebts)}</dd></div><div><dt>Pagamentos de devedores · 30 dias</dt><dd>${cashText(totals.newPayments30Cents, totals.newPayments30UnknownRecords)}</dd></div></dl><p class="decision-method">Dívidas avulsas não têm categoria e continuam no saldo geral. O saldo usa a moeda e o câmbio da dívida; o caixa usa o valor, a moeda e o câmbio salvos no pagamento. Recebimentos antigos sem esses dados ficam pendentes de conferência. Aparelhos marcados como recebidos não têm data de recebimento disponível; esse status não é tratado como entrada de caixa do mês.</p></section>
    ${problems.length ? `<aside class="decision-quality"><h3>Qualidade dos dados</h3><ul>${problems.map(problem => `<li>${esc(problem)}</li>`).join('')}</ul></aside>` : ''}
    <details class="decision-methods"><summary>Como estes números são calculados</summary><p>Dados do painel carregados nesta sessão; nenhuma amostra ou valor fictício é usado. Cada linha do estoque principal representa uma unidade. Saídas de mercadorias usam quantidade × preço da saída; transferências não são vendas. Produtos de mesmo nome no estoque principal são agrupados, enquanto cadastros de mercadorias mantêm seu identificador. As quantidades incluem todas as moedas; os valores só entram quando a moeda é conhecida e há câmbio salvo para a conversão necessária.</p><p>Lucro bruto conhecido = venda − compra dos aparelhos com custo de compra positivo informado; não desconta gastos gerais, impostos ou fretes. Custo zero/ausente no cadastro antigo fica pendente de conferência. O custo unitário cadastrado nas mercadorias valoriza o estoque atual, mas não comprova o custo das vendas passadas: a margem histórica continua não apurada. O preço sugerido nas entradas não é usado como custo. Valores de venda sem custo ainda contam no faturamento se a moeda estiver identificada e a conversão puder ser apurada. Compra e venda são convertidas separadamente com seus câmbios salvos; o lucro pode ser negativo. Alterar a moeda atual de um produto não muda a moeda das saídas passadas.</p><p>As janelas de 30 e 90 dias incluem a data de referência. Registros sem data não entram em rankings ou estimativas; datas futuras são excluídas. A ausência de saídas registradas não prova ausência de demanda. A confiança é baixa na base mínima e moderada a partir de 60 dias e 10 registros. Não há projeção de lucro ou caixa sem os custos e recebimentos necessários.</p></details>
  </section></details>`;
}
