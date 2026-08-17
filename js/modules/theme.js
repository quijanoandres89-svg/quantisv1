/* ============================================================
   THEME — tema claro/oscuro, persistido en localStorage.
   Módulo standalone, sin dependencias de state.js.
   ============================================================ */

/** Aplica el tema guardado al cargar la página. main.js la llama una vez al iniciar. */
export function applySavedTheme() {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
}

// [window] onclick="toggleTheme()" en el botón del sidebar
export function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  const btn = document.getElementById("theme-toggle");
  const icon = document.querySelector(
    "#theme-toggle .material-symbols-outlined",
  );
  if (icon) {
    icon.textContent = isLight ? "bedtime" : "wb_sunny";
  }
  if (btn) {
    btn.dataset.tooltip = isLight
      ? "Cambiar a modo oscuro"
      : "Cambiar a modo claro";
  }
  localStorage.setItem("theme", isLight ? "light" : "dark");
}

/** Sincroniza el ícono del botón con el tema actual. Llamada desde init(). */
export function applyThemeBtn() {
  const btn = document.getElementById("theme-toggle");
  const icon = document.querySelector(".material-symbols-outlined");
  const isLight = document.body.classList.contains("light");
  if (icon) {
    icon.textContent = document.body.classList.contains("light")
      ? "bedtime"
      : "wb_sunny";
    btn.dataset.tooltip = isLight
      ? "Cambiar a modo oscuro"
      : "Cambiar a modo claro";
  }
}
