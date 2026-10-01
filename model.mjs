export const LOCATIONS = Object.freeze(['Loja', 'Depósito SP']);

function text(value, label, max = 1000, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new Error(`${label}: informe um texto${required ? ' obrigatório' : ''} de até ${max} caracteres.`);
  }
  return value.trim();
}

function integer(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label}: informe um número inteiro entre ${min} e ${max}.`);
  }
  return value;
}

function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}: informe uma data válida.`);
  }
  return value;
}

function location(value) {
  return text(value, 'Local', 120, true);
}

function catalog(input) {
  const stock = input.stock === undefined ? 'mercadorias' : input.stock;
  if (!['principal', 'mercadorias'].includes(stock)) throw new Error('Selecione um estoque válido.');
  const photo = input.photo ?? '';
  if (typeof photo !== 'string' || photo.length > 1024 * 1024 ||
      (photo && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photo))) {
    throw new Error('Use uma foto PNG, JPEG ou WebP de até 1 MB.');
  }
  return {
    stock,
    name: text(input.name, 'Produto', 120, true),
    category: text(input.category, 'Categoria', 80),
    priceCents: integer(input.priceCents, 'Preço em centavos'),
    costCents: input.costCents == null ? null : integer(input.costCents, 'Custo em centavos'),
    minStock: integer(input.minStock ?? 0, 'Estoque mínimo', 0, 1_000_000),
    notes: text(input.notes, 'Observações'), photo,
  };
}

function debtFields(input) {
  const origin = date(input.date, 'Data da dívida');
  const dueDate = input.dueDate ? date(input.dueDate, 'Vencimento') : '';
  if (dueDate && dueDate < origin) throw new Error('O vencimento não pode ser anterior à dívida.');
  return {
    name: text(input.name, 'Devedor', 120, true),
    description: text(input.description, 'Motivo da dívida', 1000, true),
    totalCents: integer(input.totalCents, 'Valor da dívida em centavos', 1),
    units: integer(input.units ?? 1, 'Quantidade de itens', 1, 1000000),
    date: origin, dueDate, notes: text(input.notes, 'Observações'),
  };
}

function paymentFields(debt, input) {
  const amountCents = integer(input.amountCents, 'Pagamento em centavos', 1);
  const paidDate = date(input.date, 'Data do pagamento');
  if (paidDate < debt.date) throw new Error('O pagamento não pode ser anterior à dívida.');
  if (amountCents > debtBalance(debt)) throw new Error('O pagamento não pode superar o saldo devedor.');
  return { amountCents, date: paidDate, note: text(input.note, 'Observação do pagamento') };
}

function movementFields(state, productId, input) {
  if (!state.products.some(product => product.id === productId)) throw new Error('Produto não encontrado.');
  if (!['entrada', 'saida', 'transferencia'].includes(input.type)) throw new Error('Selecione um tipo de movimentação válido.');
  const quantity = integer(input.quantity, 'Quantidade', 1, 1_000_000);
  const source = location(input.location);
  const toLocation = input.type === 'transferencia' ? location(input.toLocation) : '';
  if (source === toLocation) throw new Error('Escolha um destino diferente da origem.');
  if (input.type !== 'entrada' && quantity > balance(state, productId, source)) {
    throw new Error('Não há estoque suficiente nesse local.');
  }
  const unitPriceCents = integer(input.unitPriceCents ?? 0, 'Preço unitário em centavos');
  if (!Number.isSafeInteger(unitPriceCents * quantity)) throw new Error('O valor total da movimentação excede o limite permitido.');
  return {
    productId, type: input.type, quantity, location: source, toLocation,
    client: text(input.client, 'Cliente', 120, input.type === 'saida'), unitPriceCents,
    date: date(input.date, 'Data da movimentação'), notes: text(input.notes, 'Observações'),
  };
}

export function balance(state, productId, selectedLocation) {
  if (selectedLocation !== undefined) location(selectedLocation);
  return state.movements.reduce((total, movement) => {
    if (movement.productId !== productId) return total;
    if (selectedLocation === undefined || movement.location === selectedLocation) {
      total += movement.type === 'entrada' ? movement.quantity : -movement.quantity;
    }
    if (movement.type === 'transferencia' && (selectedLocation === undefined || movement.toLocation === selectedLocation)) {
      total += movement.quantity;
    }
    return total;
  }, 0);
}

export function debtBalance(debt) {
  return debt.payments.reduce((remaining, payment) => remaining - payment.amountCents, debt.totalCents);
}

export function addProduct(state, input) {
  const product = { id: crypto.randomUUID(), ...catalog(input) };
  state.products.push(product);
  return product;
}

export function updateProduct(state, id, input) {
  const product = state.products.find(item => item.id === id);
  if (!product) throw new Error('Produto não encontrado.');
  Object.assign(product, catalog({ ...product, ...input }));
  return product;
}

export function addDebt(state, input) {
  const debt = { id: crypto.randomUUID(), ...debtFields(input), payments: [] };
  state.debts.push(debt);
  return debt;
}

export function addPayment(state, debtId, input) {
  const debt = state.debts.find(item => item.id === debtId);
  if (!debt) throw new Error('Dívida não encontrada.');
  const payment = { id: crypto.randomUUID(), ...paymentFields(debt, input), createdAt: new Date().toISOString() };
  debt.payments.push(payment);
  return payment;
}

export function addMovement(state, productId, input) {
  const movement = { id: crypto.randomUUID(), ...movementFields(state, productId, input), createdAt: new Date().toISOString() };
  state.movements.push(movement);
  return movement;
}

export function validateState(state) {
  if (!state || state.version !== 1 || !['products', 'movements', 'debts'].every(key => Array.isArray(state[key]))) {
    throw new Error('Arquivo inválido: use um backup desta prévia do Painel Puff.');
  }
  const ids = new Set();
  function identify(item, timestamp = false) {
    if (!item || typeof item !== 'object') throw new Error('Registro inválido no backup.');
    const id = text(item.id, 'Identificador', 120, true);
    if (id !== item.id || ids.has(id)) throw new Error('O backup contém identificadores inválidos ou repetidos.');
    ids.add(id);
    if (timestamp && (typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)))) {
      throw new Error('Registro sem data de criação válida.');
    }
  }
  state.products.forEach(product => { identify(product); catalog(product); });
  // ponytail: replay O(n²) serve à prévia local; históricos grandes devem acumular saldos em um Map.
  const ledger = { products: state.products, movements: [] };
  for (const movement of state.movements) {
    identify(movement, true);
    movementFields(ledger, movement.productId, movement);
    ledger.movements.push(movement);
  }
  for (const debt of state.debts) {
    identify(debt);
    debtFields(debt);
    if (!Array.isArray(debt.payments)) throw new Error('Histórico de pagamentos inválido.');
    const replay = { ...debt, payments: [] };
    for (const payment of debt.payments) {
      identify(payment, true);
      paymentFields(replay, payment);
      replay.payments.push(payment);
    }
  }
  return true;
}
