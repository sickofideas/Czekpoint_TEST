/**
 * Web Audio synthesizer and animation effects.
 * Safe in non-browser environments and respects accessibility preferences.
 */

let audioCtx = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContextClass();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Triggers safe haptic vibration if supported and enabled.
 */
export function triggerHaptic(pattern = 40) {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(pattern);
    } catch {}
  }
}

/**
 * Subtle wooden tick for filter toggles or point selection.
 */
export function playTick(enabled = true) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.035);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.04);
  } catch {}
}

/**
 * Double metallic clink for hammering a badge onto the stick or greeting with crossed sticks.
 */
export function playHammer(enabled = true) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const playClinkPulse = (time, freq, vol) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.25, time + 0.06);

      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.08);
    };

    const now = ctx.currentTime;
    playClinkPulse(now, 1760, 0.15); // A6
    playClinkPulse(now + 0.07, 2349, 0.18); // D7
    triggerHaptic([30, 40, 30]);
  } catch {}
}

/**
 * Gentle sonic sonar pulse when radar detects a collectible point within 150m.
 */
export function playRadar(enabled = true) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.28);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.48);
    triggerHaptic(60);
  } catch {}
}

/**
 * Pleasant major chord arpeggio for GPS stamp discovery or completed expedition.
 */
export function playStampChord(enabled = true) {
  if (!enabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    // C5 (523), E5 (659), G5 (784), C6 (1046)
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const time = now + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);

      gain.gain.setValueAtTime(0.12, time);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(time);
      osc.stop(time + 0.38);
    });
    triggerHaptic([50, 60, 90]);
  } catch {}
}

/**
 * Rolling numbers animation: smoothly counts up/down from current to targetNumber.
 * Fully honors prefers-reduced-motion.
 */
export function animateValue(element, targetNumber, durationMs = 380, formatFn = n => Math.round(n).toString()) {
  if (!element) return;
  const target = Number(targetNumber) || 0;

  if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
    element.textContent = formatFn(target);
    return;
  }

  const rawCurrent = parseFloat(element.textContent?.replace(/[^\d.-]/g, ''));
  const start = Number.isFinite(rawCurrent) ? rawCurrent : 0;
  if (Math.abs(start - target) < 0.001) {
    element.textContent = formatFn(target);
    return;
  }

  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // Ease out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * ease;
    element.textContent = formatFn(current);

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = formatFn(target);
    }
  }

  requestAnimationFrame(update);
}

/**
 * Applies smooth staggered animation to grid items (0 to 12 items).
 * Respects prefers-reduced-motion.
 */
export function applyStaggerAnimation(containerOrSelector, itemSelector = ':scope > *') {
  if (typeof document === 'undefined') return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

  const container = typeof containerOrSelector === 'string'
    ? document.querySelector(containerOrSelector)
    : containerOrSelector;
  if (!container) return;

  const items = container.querySelectorAll(itemSelector);
  items.forEach((item, index) => {
    const stagger = Math.min(index, 12);
    item.style.setProperty('--stagger-i', stagger.toString());
    item.classList.remove('tile-animate-in');
    void item.offsetWidth; // Trigger reflow for re-animation
    item.classList.add('tile-animate-in');
  });
}
