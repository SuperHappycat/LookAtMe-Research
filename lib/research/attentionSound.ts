"use client";

/**
 * lib/research/attentionSound.ts
 * ================================
 * Gentle synthesized sounds that pair with calibration targets (infant studies pair animated
 * targets with sound to draw the eyes). No audio files: tones are generated with Web Audio.
 *
 * Sensory care for autistic children: soft attack (no sudden onset), low default volume,
 * pentatonic pitches (never harsh), and a mute/volume control the operator can change any time.
 */

const PREF_KEY = "lookatme_attention_sound";
const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]; // C5 D5 E5 G5 A5 C6

export interface SoundPrefs {
  on: boolean;
  volume: number; // 0..1
}

let ctx: AudioContext | null = null;

export function loadSoundPrefs(): SoundPrefs {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SoundPrefs;
      return { on: !!p.on, volume: Math.min(1, Math.max(0, Number(p.volume) || 0)) };
    }
  } catch {
    // ignore
  }
  return { on: true, volume: 0.4 };
}

export function saveSoundPrefs(p: SoundPrefs) {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

/** Must be called from a click handler (browsers only allow audio after a user gesture). */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
}

function tone(freq: number, startIn: number, dur: number, peak: number) {
  if (!ctx) return;
  const t0 = ctx.currentTime + startIn;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.04); // soft attack
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  gain.connect(ctx.destination);
  for (const [mult, level] of [
    [1, 1],
    [2, 0.25],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    const g = ctx.createGain();
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }
}

/** A short chime; `index` picks the pitch so each target sounds a little different. */
export function playChime(index: number, prefs: SoundPrefs) {
  if (!prefs.on || prefs.volume <= 0) return;
  const f = PENTATONIC[((index % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];
  tone(f, 0, 0.7, 0.22 * prefs.volume);
}

/** A two-note "boing" used to re-attract attention when the child looks away. */
export function playReattract(prefs: SoundPrefs) {
  if (!prefs.on || prefs.volume <= 0) return;
  tone(659.25, 0, 0.35, 0.2 * prefs.volume);
  tone(987.77, 0.18, 0.5, 0.2 * prefs.volume);
}

/** A rising three-note arpeggio as a small reward after each point. */
export function playReward(prefs: SoundPrefs) {
  if (!prefs.on || prefs.volume <= 0) return;
  [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.09, 0.45, 0.15 * prefs.volume));
}
