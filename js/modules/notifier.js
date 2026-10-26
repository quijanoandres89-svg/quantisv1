/* ============================================================
   NOTIFIER — avisos que llegan aunque no estés mirando Quantis.
   ------------------------------------------------------------
   notifyUser() hace, según el caso:
     1. Suena el aviso (si los sonidos están activados).
     2. Si estás MIRANDO la app, nada más (el toast ya lo muestra
        quien llama). Si NO la estás mirando (pestaña oculta o
        ventana sin foco):
          · el título de la pestaña parpadea: "(2) Quantis" ↔ "🔔 Nueva
            invitación", hasta que vuelvas;
          · aparece una notificación del sistema, si diste permiso.
   Alcance (nivel 2): funciona mientras Quantis siga abierto en alguna
   pestaña o como app instalada, aunque esté en segundo plano. No llega
   con la app CERRADA del todo — eso necesita notificaciones push
   (nivel 3, aparte).
   Preferencias (se guardan en este navegador):
     quantis_title_flash         parpadeo del título (por defecto sí)
     quantis_system_notifs       avisos del sistema (por defecto sí, pero
                                 además hace falta el permiso del navegador)
   ============================================================ */

import { showToast } from "./toast.js";
import { playSound } from "./sounds.js";

const LS_TITLE = "quantis_title_flash";
const LS_SYS = "quantis_system_notifs";
const LS_HINTED = "quantis_notif_hint_shown";
const ICON = "img/icon-192.png";

const clickHandlers = new Map(); // tag -> función a ejecutar al tocar la notificación
let baseTitle = document.title || "QUANTIS";
let unread = 0;
let flashTimer = null;

/* ---------------- Preferencias y permiso ---------------- */

export const titleFlashEnabled = () => localStorage.getItem(LS_TITLE) !== "0";
export const setTitleFlashEnabled = (on) => localStorage.setItem(LS_TITLE, on ? "1" : "0");
export const systemNotifsEnabled = () => localStorage.getItem(LS_SYS) !== "0";
export const setSystemNotifsEnabled = (on) => localStorage.setItem(LS_SYS, on ? "1" : "0");

export const notificationsSupported = () => typeof Notification !== "undefined";
/** "granted" | "denied" | "default" | "unsupported" */
export const notificationPermission = () => (notificationsSupported() ? Notification.permission : "unsupported");

/** Pide el permiso al navegador. Debe llamarse desde un clic del usuario. Devuelve el estado final. */
export async function requestNotificationPermission() {
  if (!notificationsSupported()) return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/* ---------------- ¿Está el usuario mirando la app? ---------------- */

const isAway = () => document.hidden || !document.hasFocus();

/* ---------------- Parpadeo del título ---------------- */

function stopTitleFlash() {
  if (flashTimer) clearInterval(flashTimer);
  flashTimer = null;
  unread = 0;
  document.title = baseTitle;
}

function startTitleFlash(label) {
  if (!titleFlashEnabled()) return;
  if (flashTimer) clearInterval(flashTimer);
  let on = false;
  const tick = () => {
    on = !on;
    document.title = on ? `🔔 ${label}` : `(${unread}) ${baseTitle}`;
  };
  tick();
  flashTimer = setInterval(tick, 1200);
}

/** Al volver a la app se detiene el parpadeo y se restaura el título. */
function onReturn() {
  if (!document.hidden && document.hasFocus()) stopTitleFlash();
}
document.addEventListener("visibilitychange", onReturn);
window.addEventListener("focus", onReturn);

/* ---------------- Notificación del sistema ---------------- */

async function showSystemNotification(title, body, tag) {
  if (!notificationsSupported() || Notification.permission !== "granted" || !systemNotifsEnabled()) return false;
  const opts = { body, icon: ICON, badge: ICON, tag: tag || undefined, renotify: !!tag, data: { tag } };
  try {
    // En celular (Chrome/Android) las notificaciones deben salir por el service worker.
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(title, opts);
    } else {
      const n = new Notification(title, opts);
      n.onclick = () => {
        window.focus();
        const fn = clickHandlers.get(tag);
        if (fn) fn();
        n.close();
      };
    }
    return true;
  } catch (e) {
    console.warn("QUANTIS: no se pudo mostrar la notificación del sistema:", e.message);
    return false;
  }
}

// El service worker avisa aquí cuando tocan una notificación (ver sw.js → notificationclick).
if (navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "quantis-notification-click") {
      const fn = clickHandlers.get(e.data.tag);
      if (fn) fn();
    }
  });
}

/** Una sola vez, explica cómo activar los avisos del sistema (sin molestar más). */
function hintOnce() {
  if (!notificationsSupported() || Notification.permission !== "default" || localStorage.getItem(LS_HINTED)) return;
  localStorage.setItem(LS_HINTED, "1");
  setTimeout(() => {
    showToast(
      "info",
      "¿Quieres enterarte sin tener Quantis a la vista?",
      "Activa las notificaciones del sistema en Configuración → Sonidos y avisos.",
    );
  }, 2800);
}

/**
 * Avisa al usuario de algo importante.
 *   title / body → texto del aviso
 *   sound        → nombre de un sonido de sounds.js (o null)
 *   level        → 0–1, volumen relativo del sonido
 *   tag          → agrupa/reemplaza notificaciones iguales y enlaza onClick
 *   onClick      → qué hacer si tocan la notificación del sistema
 * El toast (aviso dentro de la app) lo muestra quien llama: aquí solo va lo que
 * sirve cuando no estás mirando la pantalla.
 */
export function notifyUser({ title, body = "", sound = null, level = 1, tag = null, onClick = null }) {
  if (sound) playSound(sound, { level });
  if (tag && onClick) clickHandlers.set(tag, onClick);
  if (!isAway()) {
    hintOnce();
    return;
  }
  unread++;
  startTitleFlash(title);
  showSystemNotification(title, body, tag);
}

/** Muestra una notificación del sistema de prueba (para el botón de Configuración), sin esperar a estar "ausente". */
export async function showTestNotification() {
  return showSystemNotification("Prueba de QUANTIS", "Así se verán tus avisos del sistema.", "test");
}
