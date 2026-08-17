/* ============================================================
   MOBILE — sidebar off-canvas (Fase 4, bloque 4B, Entrega 17)
   ------------------------------------------------------------
   Mismo mecanismo para Tablet (768–1023px) y Mobile (≤767px):
   la sidebar vive fuera de pantalla (CSS: transform translateX)
   y este módulo solo agrega/quita la clase "open" — el CSS hace
   el resto (transición, overlay, etc). En Desktop (≥1024px) la
   sidebar sigue fija como siempre; estas funciones no tienen
   ningún efecto visual ahí porque la media query ni siquiera
   aplica el transform.
   ============================================================ */

// [window] onclick="toggleSidebar()" en el botón hamburguesa del topbar
// móvil, y en el overlay (para cerrar tocando fuera del menú).
export function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("sidebar-overlay").classList.toggle("open");
}

// Se llama desde go() en main.js, sin condición: en Desktop la sidebar
// nunca tiene la clase "open" puesta (el usuario no la abrió), así que
// quitarla ahí no hace nada — es seguro llamarla siempre, sin chequear
// el ancho de pantalla.
export function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.remove("open");
}
