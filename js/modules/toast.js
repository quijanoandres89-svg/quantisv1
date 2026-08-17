/* ============================================================
   TOAST — notificaciones flotantes reutilizables en toda la app,
   a pedido del usuario con una imagen de referencia (estilo tarjeta
   con ícono + título + mensaje + botón cerrar).
   ------------------------------------------------------------
   Decisión de arquitectura: existe un sistema de alertas DISTINTO
   (alertSystem.js, Entrega 14) para avisos PERSISTENTES embebidos en
   la página (violaciones de reglas del Challenge — deben seguir
   visibles mientras el usuario trabaja). Este módulo es para
   confirmaciones TRANSITORIAS de una acción puntual (guardar,
   eliminar, activar) — no reemplaza ni se mezcla con ese otro
   sistema, cada uno resuelve un problema distinto.
   ------------------------------------------------------------
   Las preguntas de "¿estás seguro?" siguen usando confirm() nativo
   (o un modal, según el caso) — un toast se autodesaparece, así que
   no sirve para pedir una decisión. Este módulo solo confirma
   resultados DESPUÉS de que la acción ya ocurrió.
   ============================================================ */

import { escapeHTML } from "./utils.js";

const ICONS = {
  success: "check_circle",
  info: "info",
  error: "error",
  warning: "warning",
};

const DEFAULT_DURATION = 3500;
const FLASH_KEY = "kame_toast_flash"; // ver showToastAfterReload()

let seq = 0;

/**
 * Muestra un toast flotante. type: "success" | "info" | "error" | "warning".
 * Se apila con los que ya estén visibles (varios pueden coexistir).
 */
export function showToast(type, title, message, duration = DEFAULT_DURATION) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const id = `toast-${++seq}`;
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.id = id;
  el.innerHTML = `
    <span class="material-symbols-outlined toast-icon">${ICONS[type] || ICONS.info}</span>
    <div class="toast-body">
      <div class="toast-title">${escapeHTML(title)}</div>
      ${message ? `<div class="toast-msg">${escapeHTML(message)}</div>` : ""}
    </div>
    <button class="toast-close" aria-label="Cerrar" onclick="dismissToast('${id}')">
      <span class="material-symbols-outlined">close</span>
    </button>
  `;
  container.appendChild(el);
  // Forzar reflow antes de agregar la clase de animación de entrada.
  requestAnimationFrame(() => el.classList.add("toast-in"));

  if (duration > 0) {
    setTimeout(() => dismissToast(id), duration);
  }
}

// [window] onclick="dismissToast(id)" (botón de cerrar del toast)
export function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("toast-out");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  // Red de seguridad por si transitionend no dispara (ej. display:none
  // heredado de un padre oculto) — igual se limpia del DOM.
  setTimeout(() => el.remove(), 400);
}

/**
 * Para acciones que recargan la página inmediatamente después (hoy,
 * solo restoreBackup()): un toast normal desaparecería antes de que
 * el usuario lo vea, porque el reload destruye el DOM. Se guarda el
 * mensaje pendiente en localStorage y se muestra una sola vez al
 * arrancar la app de nuevo — mismo patrón "flash message" que usan
 * los frameworks web clásicos tras un redirect.
 */
export function queueToastAfterReload(type, title, message) {
  localStorage.setItem(FLASH_KEY, JSON.stringify({ type, title, message }));
}

/** Llamado una sola vez desde init() en main.js. Si hay un toast en
 * espera (dejado por queueToastAfterReload antes de un reload), lo
 * muestra y lo borra para que no reaparezca en la siguiente carga. */
export function showQueuedToast() {
  const raw = localStorage.getItem(FLASH_KEY);
  if (!raw) return;
  localStorage.removeItem(FLASH_KEY);
  try {
    const { type, title, message } = JSON.parse(raw);
    showToast(type, title, message);
  } catch (e) {}
}
