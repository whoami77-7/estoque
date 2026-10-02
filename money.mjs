export function currencyOf(record, field = 'currency') {
  return ['BRL', 'USD'].includes(record?.[field]) ? record[field] : null;
}

export function formatMoney(cents, currency) {
  if (!Number.isSafeInteger(cents)) return 'Valor inválido';
  const amount = (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === 'BRL' ? `R$ ${amount}` : currency === 'USD' ? `US$ ${amount}` : `${amount} · moeda a confirmar`;
}

export function currencyFields(input, required = false, prefix = '') {
  const key = prefix ? `${prefix}Currency` : 'currency';
  const rateKey = prefix ? `${prefix}FxRate` : 'fxRate';
  const dateKey = prefix ? `${prefix}FxDate` : 'fxDate';
  const currency = input[key] == null || input[key] === '' ? null : input[key];
  if ((currency !== null && !['BRL', 'USD'].includes(currency)) || (required && !currency)) {
    throw new Error('Selecione a moeda: real (BRL) ou dólar (USD).');
  }
  const rate = input[rateKey] == null || input[rateKey] === '' ? null : input[rateKey];
  if (rate !== null && (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 ||
      Math.round(rate * 1000000) < 1 || !Number.isSafeInteger(Math.round(rate * 1000000)) || Math.abs(rate * 1000000 - Math.round(rate * 1000000)) > 0.000001)) {
    throw new Error('Informe uma cotação positiva com até seis casas decimais: 1 USD = X BRL.');
  }
  const date = input[dateKey] || '';
  if (typeof date !== 'string' || (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date))) {
    throw new Error('Informe uma data válida para a cotação.');
  }
  return { [key]: currency, [rateKey]: rate, [dateKey]: date };
}

export function convertCents(cents, from, to, fxRate) {
  if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário fora do limite permitido.');
  if (!['BRL', 'USD'].includes(from) || !['BRL', 'USD'].includes(to)) return null;
  if (from === to) return cents;
  const rate = currencyFields({ fxRate }).fxRate;
  if (rate === null) return null;
  const scaled = Math.round(rate * 1000000);
  const numerator = Math.abs(cents) * (from === 'USD' ? scaled : 1000000);
  // ponytail: reject values beyond exact integer multiplication; use decimal arithmetic if larger ledgers become necessary.
  if (!Number.isSafeInteger(numerator)) throw new Error('Valor e cotação excedem o limite de conversão segura.');
  const converted = Math.round(numerator / (from === 'USD' ? 1000000 : scaled)) * Math.sign(cents);
  if (!Number.isSafeInteger(converted)) throw new Error('Conversão fora do limite permitido.');
  return converted === 0 ? 0 : converted;
}

export function transactionCurrencyFields(input, required = false, prefix = '') {
  const fields = currencyFields(input, required, prefix);
  const rateKey = prefix ? `${prefix}FxRate` : 'fxRate';
  const dateKey = prefix ? `${prefix}FxDate` : 'fxDate';
  if (fields[rateKey] !== null && !fields[dateKey]) throw new Error('Informe a data da cotação desta operação.');
  return fields;
}
