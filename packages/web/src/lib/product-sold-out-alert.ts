import type { OperatorNotification } from './notifications-presentation';

export function unreadProductSoldOutIds(items: OperatorNotification[]) {
  return (items || [])
    .filter((item) => item.kind === 'product_sold_out' && item.unread)
    .map((item) => item.id);
}

export function freshProductSoldOutIds(seen: Iterable<string>, incoming: string[]) {
  const known = new Set(seen);
  return incoming.filter((id) => !known.has(id));
}

let audioContext: AudioContext | null = null;

function contextConstructor() {
  if (typeof window.AudioContext === 'function') return window.AudioContext;
  if (typeof window.webkitAudioContext === 'function') return window.webkitAudioContext;
  return null;
}

export async function unlockProductSoldOutAudio() {
  const Ctor = contextConstructor();
  if (!Ctor) return null;
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new Ctor();
  }
  if (audioContext.state === 'suspended') {
    try { await audioContext.resume(); } catch { return audioContext; }
  }
  return audioContext;
}

function tone(
  ctx: AudioContext,
  {
    frequency,
    startAt,
    duration,
    gain = 0.16,
    type = 'triangle',
  }: {
    frequency: number;
    startAt: number;
    duration: number;
    gain?: number;
    type?: OscillatorType;
  },
) {
  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  amp.gain.setValueAtTime(0.0001, startAt);
  amp.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(amp);
  amp.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

/** Motivo propio de producto agotado: cae (se acabó) y pega un ping agudo. */
export async function playProductSoldOutAlert() {
  if (typeof document !== 'undefined' && document.hidden) return;
  const ctx = await unlockProductSoldOutAudio();
  if (!ctx) return;
  const t = ctx.currentTime + 0.02;
  tone(ctx, { frequency: 784, startAt: t, duration: 0.1, type: 'triangle', gain: 0.14 });
  tone(ctx, { frequency: 523.25, startAt: t + 0.11, duration: 0.1, type: 'triangle', gain: 0.14 });
  tone(ctx, { frequency: 1174.7, startAt: t + 0.3, duration: 0.22, type: 'square', gain: 0.07 });
}
