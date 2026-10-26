/* ============================================================
   SOUNDS — sonidos propios de QUANTIS, sintetizados con Web Audio
   (no hay archivos de audio: cero peso extra y funcionan sin red).
   ------------------------------------------------------------
   Estilo: campanitas limpias (onda seno con armónicos suaves y
   caída exponencial), como los avisos de iOS/Teams, pero propias.
     join      unirse a una llamada          2 notas que suben
     leave     salir de una llamada          2 notas que bajan
     invite    te invitaron a una sala       arpegio tipo cristal
     approved  te aceptaron en una sala      arpegio brillante
     request   alguien pide unirse (host)    "din-din-dong"
     freno     fin del Freno de 5 minutos    alarma fuerte, UNA vez
   El volumen y el interruptor se guardan en este navegador
   (localStorage) y se cambian en Configuración → Sonidos y avisos.
   Los navegadores solo permiten sonar después de que el usuario
   toca la página al menos una vez: initSounds() "desbloquea" el audio
   en el primer toque/tecla.
   La síntesis (renderSound) es una función pura que sirve igual con
   el audio en vivo y con OfflineAudioContext (muestras y pruebas).
   ============================================================ */

const LS_ENABLED = "quantis_sound_enabled";
const LS_VOLUME = "quantis_sound_volume";

let ctx = null;
/** Registro de lo que sonó (solo para pruebas y depuración). */
export const _log = [];
function logSound(entry) {
  _log.push(entry);
  if (_log.length > 50) _log.shift(); // acotado: antes crecía sin límite
}

/* ---------------- Preferencias ---------------- */

export const soundEnabled = () => localStorage.getItem(LS_ENABLED) !== "0";
export function setSoundEnabled(on) {
  localStorage.setItem(LS_ENABLED, on ? "1" : "0");
}
export function getVolume() {
  const v = parseFloat(localStorage.getItem(LS_VOLUME));
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.7;
}
export function setVolume(v) {
  localStorage.setItem(LS_VOLUME, String(Math.min(1, Math.max(0, v))));
}

/* ---------------- Audio en vivo ---------------- */

function liveCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** Desbloquea el audio con el primer toque/tecla del usuario (política de autoplay de los navegadores). */
export function initSounds() {
  const unlock = () => {
    liveCtx();
    if (ctx && ctx.state === "running") {
      for (const ev of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(ev, unlock);
    }
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { passive: true });
}

/* ---------------- Síntesis ---------------- */

/** Una nota de campana: fundamental + armónicos, ataque corto y caída exponencial. */
function bell(c, out, reg, { freq, t, dur = 0.5, gain = 0.5, type = "sine", harm = [[2, 0.22], [3, 0.07]], attack = 0.006, detune = 0, hold = 0 }) {
  const env = c.createGain();
  const peak = Math.max(gain, 0.0002);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + attack);
  // "hold": la nota se SOSTIENE a pleno nivel antes de apagarse (en vez de decaer desde el inicio).
  // Sube mucho la energía media: es lo que hace que una alarma se oiga por encima de música y ruido.
  if (hold > 0) env.gain.setValueAtTime(peak, t + attack + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  env.connect(out);
  reg.push(env);
  for (const [mult, amp] of [[1, 1], ...harm]) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq * mult, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    const g = c.createGain();
    g.gain.value = amp;
    o.connect(g);
    g.connect(env);
    o.start(t);
    o.stop(t + dur + 0.05);
    reg.push(o, g);
  }
}

// Notas (Hz)
const N = {
  E5: 659.25, A5: 880.0, B5: 987.77, Cs6: 1108.73, D6: 1174.66, E6: 1318.51, G5: 783.99, G6: 1567.98, C6: 1046.5, A6: 1760.0, G7: 3135.96,
};

/** Cada sonido dibuja sus notas empezando en t0 y devuelve su duración (s). */
const DEFS = {
  join(c, out, reg, t0) {
    bell(c, out, reg, { freq: N.E5, t: t0, dur: 0.3, gain: 0.5 });
    bell(c, out, reg, { freq: N.B5, t: t0 + 0.11, dur: 0.6, gain: 0.55 });
    return 0.8;
  },
  leave(c, out, reg, t0) {
    bell(c, out, reg, { freq: N.B5, t: t0, dur: 0.25, gain: 0.45 });
    bell(c, out, reg, { freq: N.E5, t: t0 + 0.11, dur: 0.5, gain: 0.45 });
    return 0.7;
  },
  invite(c, out, reg, t0) {
    [N.C6, N.E6, N.G6].forEach((f, i) => bell(c, out, reg, { freq: f, t: t0 + i * 0.12, dur: 0.7, gain: 0.5 }));
    bell(c, out, reg, { freq: N.G7, t: t0 + 0.38, dur: 0.6, gain: 0.12, harm: [] }); // destello agudo
    return 1.1;
  },
  approved(c, out, reg, t0) {
    [N.G5, N.D6, N.G6, N.A6].forEach((f, i) => bell(c, out, reg, { freq: f, t: t0 + i * 0.1, dur: 0.75, gain: 0.5, detune: i % 2 ? 4 : -4 }));
    return 1.2;
  },
  request(c, out, reg, t0) {
    bell(c, out, reg, { freq: N.A5, t: t0, dur: 0.35, gain: 0.55 });
    bell(c, out, reg, { freq: N.A5, t: t0 + 0.17, dur: 0.35, gain: 0.55 });
    bell(c, out, reg, { freq: N.E6, t: t0 + 0.36, dur: 0.7, gain: 0.55 });
    return 1.1;
  },
  /** Alarma de fin del freno: 3 arpegios ascendentes (~4 s). Timbre más "duro" (triángulo + armónicos
   * fuertes) y notas entre 880 y 1760 Hz, la zona donde más se oye por encima de música y ruido. */
  freno(c, out, reg, t0) {
    const arp = [N.A5, N.Cs6, N.E6, N.A6];
    for (let rep = 0; rep < 3; rep++) {
      const base = t0 + rep * 1.3;
      arp.forEach((f, i) => {
        const t = base + i * 0.13;
        bell(c, out, reg, { freq: f, t, dur: 1.0, hold: 0.42, gain: 0.8, type: "triangle", harm: [[2, 0.5], [3, 0.3], [4, 0.12]], detune: -6 });
        bell(c, out, reg, { freq: f, t, dur: 1.0, hold: 0.42, gain: 0.5, type: "sine", harm: [[2, 0.3]], detune: 6 });
      });
      bell(c, out, reg, { freq: N.A5 / 2, t: base, dur: 0.9, hold: 0.3, gain: 0.4, harm: [[2, 0.4]] }); // apoyo grave al inicio de cada arpegio
    }
    return 4.6;
  },
};
export const SOUND_NAMES = Object.keys(DEFS);

/** Cadena de salida: volumen → compresor (evita saturar y sube lo suave) → destino, con un eco corto de brillo. */
function makeBus(c, dest, volume) {
  const master = c.createGain();
  master.gain.value = volume;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  // Limitador final: ningún pico pasa del tope (sin esto, una alarma fuerte distorsiona en los parlantes).
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.08;
  const trim = c.createGain();
  trim.gain.value = 0.9;
  master.connect(comp);
  comp.connect(limiter);
  limiter.connect(trim);
  trim.connect(dest);
  const dry = c.createGain();
  dry.gain.value = 1;
  const delay = c.createDelay(0.5);
  delay.delayTime.value = 0.12;
  const fb = c.createGain();
  fb.gain.value = 0.28;
  const wet = c.createGain();
  wet.gain.value = 0.22;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5000;
  const input = c.createGain();
  input.connect(dry);
  dry.connect(master);
  input.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(wet);
  wet.connect(master);
  return { input, nodes: [master, comp, limiter, trim, dry, delay, fb, wet, lp, input] };
}

/** Dibuja un sonido en cualquier contexto de audio (en vivo u offline). Devuelve { duration, stop }. */
export function renderSound(c, dest, name, t0, level = 1, volume = 1) {
  const def = DEFS[name];
  if (!def) throw new Error(`Sonido desconocido: ${name}`);
  const bus = makeBus(c, dest, volume * level);
  const reg = [];
  const duration = def(c, bus.input, reg, t0);
  return {
    duration,
    stop() {
      for (const n of reg) {
        try {
          if (n.stop) n.stop(0);
          n.disconnect();
        } catch {
          /* ya terminó */
        }
      }
      for (const n of bus.nodes) {
        try {
          n.disconnect();
        } catch {
          /* ya desconectado */
        }
      }
    },
  };
}

/** Suena ahora (si los sonidos están activados). level 0–1 baja el volumen de ese aviso. */
export function playSound(name, { level = 1 } = {}) {
  if (!soundEnabled()) return null;
  const c = liveCtx();
  if (!c) return null;
  try {
    const h = renderSound(c, c.destination, name, c.currentTime + 0.02, level, getVolume());
    logSound({ name, at: Date.now(), level, scheduled: false });
    // Desconecta los nodos al terminar (cada sonido crea su propia cadena con eco realimentado).
    setTimeout(() => h.stop(), (h.duration + 3) * 1000);
    return h;
  } catch (e) {
    console.warn("QUANTIS: no se pudo reproducir el sonido:", e.message);
    return null;
  }
}

/** Programa un sonido para dentro de `delaySec` segundos usando el RELOJ DE AUDIO (exacto, no lo retrasa
 * un navegador que aletargue los temporizadores de una pestaña en segundo plano). Devuelve { cancel } o null. */
export function scheduleSound(name, delaySec, { level = 1 } = {}) {
  if (!soundEnabled()) return null;
  const c = liveCtx();
  if (!c) return null;
  try {
    const when = c.currentTime + delaySec;
    const h = renderSound(c, c.destination, name, when, level, getVolume());
    logSound({ name, at: Date.now(), level, scheduled: true, delaySec });
    const cleanup = setTimeout(() => h.stop(), (delaySec + h.duration + 3) * 1000);
    return {
      cancel: () => {
        clearTimeout(cleanup);
        h.stop();
      },
      // El reloj de audio se detiene si el navegador suspende el audio (celulares con la pantalla
      // apagada, p. ej.). Si al llegar la hora el reloj no llegó, la alarma NO sonó y hay que
      // reproducirla ahora.
      hasFired: () => c.state === "running" && c.currentTime >= when - 1,
    };
  } catch (e) {
    console.warn("QUANTIS: no se pudo programar el sonido:", e.message);
    return null;
  }
}

/** Vibración (solo celulares que la soportan). */
export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* no soportado */
  }
}

/** Renderiza un sonido a un AudioBuffer (sin reproducirlo): lo usan las pruebas y las muestras de audio. */
export async function renderToBuffer(name, { level = 1, volume = 1, sampleRate = 44100 } = {}) {
  const probe = new OfflineAudioContext(1, sampleRate, sampleRate);
  const length = Math.ceil((renderSound(probe, probe.destination, name, 0, level, volume).duration + 1.2) * sampleRate);
  const off = new OfflineAudioContext(1, length, sampleRate);
  renderSound(off, off.destination, name, 0, level, volume);
  return off.startRendering();
}
