const SOUND_KEY = 'painel-puff:sound';
let enabled = true, context, initialized = false, hideTimer, balanceTimer, previousBalance;
try { enabled = localStorage.getItem(SOUND_KEY) !== 'off'; } catch { /* A confirmação visual funciona sem armazenamento. */ }

function onReady(callback) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
  else callback();
}

function reducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export async function unlockSound() {
  if (!enabled) return false;
  try {
    const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Audio) return false;
    context ||= new Audio();
    if (context.state !== 'running') await context.resume();
    return context.state === 'running';
  } catch { return false; }
}

function confirmation() {
  let element = document.getElementById('transaction-feedback');
  if (element) return element;
  element = document.createElement('div');
  element.id = 'transaction-feedback'; element.className = 'transaction-feedback';
  element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  const icon = document.createElement('span');
  icon.className = 'feedback-check'; icon.textContent = '✓'; icon.setAttribute('aria-hidden', 'true');
  const message = document.createElement('span'); message.className = 'feedback-message';
  const units = document.createElement('span'); units.className = 'feedback-units';
  element.append(icon, message, units); document.body.append(element);
  return element;
}

function paintSoundToggle() {
  const button = document.getElementById('sound-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(enabled));
  button.setAttribute('aria-label', enabled ? 'Desativar som de confirmação' : 'Ativar som de confirmação');
  button.title = enabled ? 'Som de confirmação ativado' : 'Som de confirmação desativado';
  button.textContent = enabled ? 'Som ativado' : 'Som desativado';
}

export function setupFeedback() {
  onReady(() => {
    if (initialized) return;
    initialized = true; confirmation(); paintSoundToggle();
    document.getElementById('sound-toggle')?.addEventListener('click', () => {
      enabled = !enabled;
      try { localStorage.setItem(SOUND_KEY, enabled ? 'on' : 'off'); } catch { /* Preferência válida nesta sessão. */ }
      paintSoundToggle(); if (enabled) void unlockSound();
    });
    document.addEventListener('pointerdown', () => { void unlockSound(); }, { once: true, passive: true });
    document.addEventListener('keydown', () => { void unlockSound(); }, { once: true });
  });
}

// Chamado exclusivamente depois da confirmação de gravação do servidor.
export function reward(message, units = 0) {
  onReady(() => {
    const element = confirmation();
    element.querySelector('.feedback-message').textContent = String(message || 'Salvo com sucesso.');
    element.querySelector('.feedback-units').textContent = Number.isSafeInteger(units) && units > 0 ? `${units} un.` : '';
    element.classList.add('feedback-visible');
    clearTimeout(hideTimer); hideTimer = setTimeout(() => element.classList.remove('feedback-visible'), 3400);
  });
  if (!enabled || context?.state !== 'running') return;
  try {
    const start = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator(), gain = context.createGain();
      const at = start + index * 0.19, duration = index ? 0.25 : 0.18;
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.025, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(at); oscillator.stop(at + duration + 0.01);
    });
  } catch { /* O feedback visual continua disponível se o áudio falhar. */ }
}

export function setAlissonBalance(cents) {
  if (!Number.isSafeInteger(cents)) return false;
  onReady(() => {
    const target = document.querySelector('#alisson-balance strong');
    if (!target) return;
    target.textContent = (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    if (previousBalance !== undefined && cents > previousBalance && !reducedMotion()) {
      clearTimeout(balanceTimer); target.classList.remove('feedback-balance-up');
      void target.offsetWidth;
      target.classList.add('feedback-balance-up');
      balanceTimer = setTimeout(() => target.classList.remove('feedback-balance-up'), 650);
    }
    previousBalance = cents;
  });
  return true;
}
