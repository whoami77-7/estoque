import { balance, classifyCategory } from './model.mjs';
import { currencyOf, formatMoney } from './money.mjs';
import { modelCandidates, exactModel, specificationText, modelLabel } from './express-specs.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const normalized = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const array = value => Array.isArray(value) ? value : [];

export function parseExpressPrice(value) {
  if (typeof value !== 'string' || value.length > 24) throw new Error('Preço: informe um valor válido, com até duas casas decimais.');
  let amount = value.trim();
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(amount)) amount = amount.replaceAll('.', '').replace(',', '.');
  else if (/^\d+(?:[.,]\d{1,2})?$/.test(amount)) amount = amount.replace(',', '.');
  else throw new Error('Preço: use 1.500,00 ou 1500.00, sem o símbolo da moeda.');
  const [whole, fraction = ''] = amount.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Preço: informe um valor maior que zero dentro do limite permitido.');
  return cents;
}

export function getExpressProducts(legacy = {}, state = {}) {
  const products = [], seen = new Set();
  for (const item of array(legacy?.itens)) {
    if (!item || item.deletedAt !== undefined || normalized(item.situacao) === 'vendido' || classifyCategory(item) !== 'ar-condicionados') continue;
    const row = Number(item.row), name = String(item.modelo || '').trim();
    if (!Number.isSafeInteger(row) || row < 2 || !name || seen.has(`legacy:${row}`)) continue;
    const key = `legacy:${row}`;
    let priceCents = null;
    try { priceCents = parseExpressPrice(String(item.venda ?? '')); } catch {}
    seen.add(key);
    products.push({ key, name, source: 'principal', location: String(item.local || 'Sem local'), available: 1, priceCents, currency: currencyOf(item) });
  }
  const movements = array(state?.movements), stock = { movements };
  for (const product of array(state?.products)) {
    if (!product || product.deletedAt !== undefined || classifyCategory(product) !== 'ar-condicionados' || typeof product.id !== 'string' || !product.id || !product.name) continue;
    const key = `catalog:${product.id}`, available = balance(stock, product.id);
    if (seen.has(key) || !Number.isSafeInteger(available) || available <= 0) continue;
    const places = [...new Set(movements.filter(m => m.productId === product.id).flatMap(m => [m.location, m.toLocation]).filter(Boolean))].filter(location => balance(stock, product.id, location) > 0);
    seen.add(key);
    products.push({ key, name: String(product.name), source: product.stock === 'principal' ? 'principal' : 'mercadorias', location: places.join(' · ') || 'Sem local', available, priceCents: Number.isSafeInteger(product.priceCents) && product.priceCents > 0 ? product.priceCents : null, currency: currencyOf(product) });
  }
  return products.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.location.localeCompare(b.location, 'pt-BR') || a.key.localeCompare(b.key));
}

function readText(value, label, max, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new Error(`${label}: ${required ? 'preencha com' : 'use'} até ${max} caracteres.`);
  return value.trim();
}

export function readExpressForm(products, form) {
  const product = products.find(item => item.key === form.get('productKey'));
  if (!product || product.available <= 0) throw new Error('Selecione um ar-condicionado disponível no estoque.');
  const currency = readText(form.get('currency'), 'Moeda', 3, true);
  if (!currencyOf({ currency })) throw new Error('Selecione a moeda da oferta: real ou dólar.');
  const modelId = readText(form.get('catalogModelId'), 'Modelo', 80);
  const profile = modelId ? modelCandidates(product.name).find(model => model.id === modelId) : null;
  if (modelId && (!profile || form.get('catalogProductName') !== product.name)) throw new Error('Confira novamente o modelo da Rio Paraná para este aparelho. O cadastro mudou ou a versão não combina.');
  const extra = readText(form.get('specifications'), 'Especificações', 600);
  return {
    product,
    priceCents: parseExpressPrice(form.get('price')),
    currency,
    customer: readText(form.get('customer'), 'Nome do cliente', 120),
    specifications: [specificationText(product.name, profile), extra].filter(Boolean).join('\n'),
    conditions: readText(form.get('conditions'), 'Condições da oferta', 600),
  };
}

export function buildExpressMessage(input) {
  const name = readText(input?.product?.name, 'Ar-condicionado', 200, true).replace(/\s+/g, ' ');
  if (!['BRL', 'USD'].includes(input.currency)) throw new Error('Selecione a moeda da oferta: real ou dólar.');
  if (!Number.isSafeInteger(input.priceCents) || input.priceCents <= 0) throw new Error('Informe um preço válido maior que zero.');
  const customer = readText(input.customer, 'Nome do cliente', 120).replace(/\s+/g, ' ');
  const specs = readText(input.specifications, 'Especificações', 1200);
  const conditions = readText(input.conditions, 'Condições da oferta', 600);
  return [customer ? `Olá, ${customer}! Segue a oferta:` : 'Olá! Segue a oferta:', `❄️ ${name}`, specs, `Valor: ${formatMoney(input.priceCents, input.currency)}`, conditions].filter(Boolean).join('\n\n');
}

export function expressProductOptions(products, selectedKey = '') {
  const missing = selectedKey && !products.some(product => product.key === selectedKey);
  return `<option value="">Escolha o aparelho</option>${missing ? `<option value="${esc(selectedKey)}" selected>Produto indisponível · escolha outro aparelho</option>` : ''}${products.map(product => `<option value="${esc(product.key)}"${product.key === selectedKey ? ' selected' : ''}>${esc(product.name)} · ${esc(product.location)} · ${esc(product.available)} un.${product.key.startsWith('legacy:') ? ` · #${esc(product.key.slice(7))}` : ''}</option>`).join('')}`;
}

export function expressModelOptions(product, selectedId = '') {
  const models = product ? modelCandidates(product.name) : [];
  const missing = selectedId && !models.some(model => model.id === selectedId);
  return `<option value="">Usar só os dados do estoque</option>${missing ? `<option value="${esc(selectedId)}" selected>Modelo a revisar · selecione novamente</option>` : ''}${models.map(model => `<option value="${esc(model.id)}"${model.id === selectedId ? ' selected' : ''}>${esc(modelLabel(model))}</option>`).join('')}`;
}

export function expressModelDetails(product, selectedId = '', productName = product?.name) {
  const models = product ? modelCandidates(product.name) : [];
  const profile = productName === product?.name ? models.find(model => model.id === selectedId) : null;
  return {
    hasModels: models.length > 0,
    text: product ? specificationText(product.name, profile) : '',
    sourceUrl: profile?.sourceUrl || '',
    hint: !product ? 'Escolha o aparelho para ver os modelos.' : selectedId && !profile ? 'O cadastro mudou. Confira e selecione novamente o modelo.' : profile ? 'Confira o código na etiqueta do aparelho. A ficha abaixo entra na mensagem.' : models.length ? 'Escolha a versão da etiqueta para completar a ficha. Só marca e BTUs não identificam o modelo.' : 'Sem ficha confirmada para este aparelho. Use os dados do estoque e complete apenas o que souber.',
  };
}

export const expressExactModel = product => product ? exactModel(product.name)?.id || '' : '';

export function expressForm(products, draft = {}) {
  const selected = products.find(item => item.key === draft.productKey);
  const price = draft.price ?? (selected?.priceCents ? (selected.priceCents / 100).toFixed(2).replace('.', ',') : '');
  const currency = draft.currency ?? selected?.currency ?? '';
  const modelId = draft.catalogModelId ?? expressExactModel(selected);
  const catalogProductName = draft.catalogProductName ?? selected?.name ?? '';
  const modelDetails = expressModelDetails(selected, modelId, catalogProductName);
  return `<section class="express-panel" aria-label="Preparar oferta de ar-condicionado">
    <p class="express-intro help">Escolha o ar, ajuste o preço e confira a mensagem para o cliente. A oferta não dá baixa no estoque.</p>
    <p id="express-empty" class="empty"${products.length ? ' hidden' : ''}>Nenhum ar-condicionado disponível. Confira o estoque e a categoria dos produtos.</p>
    <form id="express-form" class="express-layout">
      <div class="express-fields">
      <label for="express-product">Ar-condicionado disponível</label>
      <select id="express-product" name="productKey" required>${expressProductOptions(products, draft.productKey)}</select>
      <div class="express-model">
        <label for="express-model">Modelo da Rio Paraná <span class="meta">· opcional</span></label>
        <select id="express-model" name="catalogModelId" aria-describedby="express-model-hint"${!selected || !modelCandidates(selected.name).length && !modelId ? ' disabled' : ''}>${expressModelOptions(selected, modelId)}</select>
        <input type="hidden" id="express-model-product" name="catalogProductName" value="${esc(catalogProductName)}">
        <p id="express-model-hint" class="help">${esc(modelDetails.hint)}</p>
        <p id="express-model-specs" class="express-model-specs"${modelDetails.text ? '' : ' hidden'}>${esc(modelDetails.text)}</p>
        <a id="express-model-source" class="tracking-link" target="_blank" rel="noopener noreferrer"${modelDetails.sourceUrl ? ` href="${esc(modelDetails.sourceUrl)}"` : ' hidden'}>Conferir ficha na Rio Paraná ↗</a>
      </div>
      <div class="express-price-fields">
        <div><label for="express-price">Preço que você quer cobrar</label><input id="express-price" name="price" inputmode="decimal" maxlength="24" placeholder="Ex.: 1.500,00" value="${esc(price)}" required></div>
        <div><label for="express-currency">Moeda da oferta</label><select id="express-currency" name="currency" required><option value="">Escolha a moeda</option><option value="BRL"${currency === 'BRL' ? ' selected' : ''}>R$ · Real</option><option value="USD"${currency === 'USD' ? ' selected' : ''}>US$ · Dólar</option></select></div>
      </div>
      <p class="help">Preço de um aparelho. Alterar a moeda não converte o valor: informe o preço na moeda escolhida.</p>
      <label for="express-customer">Nome do cliente <span class="meta">· opcional</span></label><input id="express-customer" name="customer" maxlength="120" placeholder="Para quem é a oferta?" value="${esc(draft.customer || '')}">
      <label for="express-specifications">Detalhes adicionais para o cliente <span class="meta">· opcional</span></label><textarea id="express-specifications" name="specifications" rows="2" maxlength="600" placeholder="Estado do aparelho, acessórios ou outra informação confirmada.">${esc(draft.specifications || '')}</textarea>
      <label for="express-conditions">Condições da oferta <span class="meta">· opcional</span></label><textarea id="express-conditions" name="conditions" rows="2" maxlength="600" placeholder="Forma de pagamento, prazo ou entrega que você combinou.">${esc(draft.conditions || '')}</textarea>
      <button type="submit" class="primary" id="express-generate">Gerar mensagem</button>
      </div>
      <div class="express-preview"><label for="express-message">Mensagem pronta para enviar</label><textarea id="express-message" rows="8" readonly placeholder="A mensagem aparece aqui depois de você gerar."></textarea><p class="help">A ficha do modelo, seu preço e os detalhes da oferta entram na mensagem.</p><div class="express-actions card-actions"><button type="button" id="express-copy" class="secondary" disabled>Copiar mensagem</button><button type="button" id="express-share" class="primary" disabled>Compartilhar</button></div><p id="express-status" class="help" role="status" aria-live="polite"></p></div>
    </form>
  </section>`;
}
