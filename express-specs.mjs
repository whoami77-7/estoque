import { RIO_CATALOG } from './rio-catalog.mjs';

const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const brands = ['Climax', 'Conlux', 'Gree', 'Sleiman', 'TCL'];
const number = value => Number(value).toLocaleString('pt-BR');

export function stockTraits(name) {
  const source = normalize(name), traits = {}, conflicts = [];
  const keep = (field, values) => {
    const unique = [...new Set(values)];
    if (unique.length === 1) traits[field] = unique[0];
    else if (unique.length > 1) conflicts.push(field);
  };
  keep('brand', brands.filter(brand => new RegExp(`\\b${normalize(brand)}\\b`).test(source)));
  const capacities = [];
  for (const match of source.matchAll(/\b(\d{1,3}(?:[.,]\d{3})?|\d{4,6})\s*(mil|btus?)\b/g)) capacities.push(Number(match[1].replace(/[.,]/g, '')) * (match[2] === 'mil' ? 1000 : 1));
  // Only standalone common thousand-unit capacities; never extract numbers embedded in model codes.
  for (const match of source.matchAll(/(?<![\w./-])((?:[6-9]|[1-9]\d)(?:000|\.000))(?![\w./-])/g)) capacities.push(Number(match[1].replace('.', '')));
  keep('btu', capacities.filter(value => value >= 6000 && value <= 100000));
  keep('voltage', [...source.matchAll(/\b(110|127|220|230)\s*(?:v(?:olts?|lts?)?)?\b/g)].map(match => `${match[1]} V`));
  keep('technology', [/(?:^|\W)inverter\b/.test(source) && 'Inverter', /\bconvencional\b/.test(source) && 'Convencional'].filter(Boolean));
  const hotCold = /\bq\s*[/+-]\s*f\b|\bquente\s*(?:e|[/+-])\s*frio\b|\bfrio\s*(?:e|[/+-])\s*quente\b/;
  keep('cycle', [hotCold.test(source) ? 'Quente e frio' : /\bfrio\b/.test(source) ? 'Frio' : null].filter(Boolean));
  const frequencies = [...source.matchAll(/\b(50\s*[/+-]\s*60|50\s+e\s+60|50|60)\s*hz\b/g)].map(match => /50.*60/.test(match[1]) ? '50/60 Hz' : `${match[1]} Hz`);
  keep('frequency', frequencies);
  for (const [field, term] of [['wifi', 'wi[ -]?fi'], ['kit', 'kit']]) {
    if (!new RegExp(`\\b${term}\\b`).test(source) || new RegExp(`\\b${term}\\s+opcional\\b`).test(source)) continue;
    traits[field] = !new RegExp(`(?:\\bsem\\s+|\\bs\\s*[/]\\s*|\\bnao\\s+(?:tem|acompanha|inclui)\\s+)${term}\\b|\\b${term}\\s+nao\\s+(?:incluso|incluido|acompanha)\\b`).test(source);
  }
  keep('kind', [ /\bsplit\b/.test(source) && 'Split', /\bportatil\b/.test(source) && 'Portátil', /\bjanela\b/.test(source) && 'Janela' ].filter(Boolean));
  if (conflicts.length) traits.conflicts = conflicts;
  return traits;
}

function profileTraits(profile) {
  const traits = {};
  for (const key of ['brand', 'btu', 'voltage', 'technology', 'cycle', 'frequency', 'wifi']) if (profile?.[key] !== undefined) traits[key] = profile[key];
  const kind = stockTraits(profile?.name).kind;
  if (kind) traits.kind = kind;
  return traits;
}

function compatible(stock, profile) {
  if (stock.conflicts?.length) return false;
  const offered = profileTraits(profile);
  return Object.keys(offered).every(key => {
    if (stock[key] === undefined) return true;
    if (key === 'frequency') {
      const requested = stock[key].match(/\d+/g), supported = String(offered[key]).match(/\d+/g) || [];
      return requested.every(value => supported.includes(value));
    }
    return normalize(stock[key]) === normalize(offered[key]);
  });
}

export function modelCandidates(name, catalog = RIO_CATALOG) {
  const stock = stockTraits(name);
  const identified = catalog.filter(profile => codeInName(name, profile.model));
  if (identified.length) return identified.filter(profile => compatible(stock, profile));
  if (!stock.brand || !stock.btu) return [];
  return catalog.filter(profile => normalize(profile.brand) === normalize(stock.brand) && profile.btu === stock.btu && compatible(stock, profile));
}

function codeInName(name, model) {
  if (typeof model !== 'string' || !model.trim()) return false;
  const escaped = normalize(model.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9_./-])${escaped}(?=$|[^a-z0-9_./-])`).test(normalize(name));
}

export function exactModel(name, catalog = RIO_CATALOG) {
  const stock = stockTraits(name), matches = catalog.filter(profile => codeInName(name, profile.model) && compatible(stock, profile));
  return matches.length === 1 ? matches[0] : null;
}

export function modelLabel(profile) {
  return [profile?.name, profile?.model, profile?.voltage, profile?.frequency].filter(Boolean).join(' · ');
}

export function specificationText(name, profile = null) {
  const stock = stockTraits(name);
  if (profile && !exactModel(name, [profile]) && !modelCandidates(name, [profile]).length) throw new Error('Esta ficha não combina com as informações do aparelho. Escolha outro modelo ou preencha as especificações manualmente.');
  const facts = profile ? profileTraits(profile) : stock;
  return [
    facts.brand && `Marca: ${facts.brand}`,
    profile?.model && `Modelo: ${profile.model}`,
    facts.btu && `Capacidade: ${number(facts.btu)} BTUs`,
    facts.kind && `Tipo: ${facts.kind}`,
    facts.voltage && `Tensão: ${facts.voltage}`,
    facts.technology && `Tecnologia: ${facts.technology}`,
    facts.cycle && `Ciclo: ${facts.cycle}`,
    facts.frequency && `Frequência: ${facts.frequency}`,
    facts.wifi !== undefined && `Wi-Fi: ${facts.wifi ? 'Sim' : 'Não'}`,
    stock.kit !== undefined && (stock.kit ? 'Com kit' : 'Sem kit'),
  ].filter(Boolean).join('\n');
}
