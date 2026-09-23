/* ============================================================
   THEME — tema claro/oscuro, persistido en localStorage.
   Módulo standalone, sin dependencias de state.js.
   ------------------------------------------------------------
   Fix widget TradingView (calendario económico, Dashboard): el
   embed original no pasaba "colorTheme" en su config, así que
   TradingView siempre renderizaba con su tema claro por defecto
   — con isTransparent:true eso se veía como una mezcla ilegible
   sobre el fondo oscuro de la página. El widget vive en un
   <iframe> de otro origen: no se puede recolorear con CSS ni en
   caliente, la única forma es destruirlo y volver a inyectar el
   <script> del embed con el colorTheme correcto. Por eso se
   reconstruye acá (al cargar y en cada toggle), no en el HTML.
   ============================================================ */

const ECON_CAL_CONTAINER_ID = "econ-cal-widget-container";

function currentColorTheme() {
  return document.body.classList.contains("light") ? "light" : "dark";
}

/** Destruye y vuelve a inyectar el widget de TradingView con el
 * colorTheme que corresponda al tema actual de la página. Si el
 * contenedor todavía no existe en el DOM, no hace nada (no debería
 * pasar — el div vive siempre en el HTML, solo su página puede
 * estar oculta). */
export function reloadEconCalWidget() {
  const container = document.getElementById(ECON_CAL_CONTAINER_ID);
  if (!container) return;

  const theme = currentColorTheme();
  container.innerHTML = '<div class="tradingview-widget-container__widget"></div>';

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
  script.async = true;
  script.textContent = JSON.stringify({
    isTransparent: true,
    colorTheme: theme,
    textColor: theme === "light" ? "#131722" : "#d1d4dc",
    width: "100%",
    height: "450",
    locale: "es",
    importanceFilter: "0,1",
    countryFilter: "us,eu,gb,jp",
  });
  container.appendChild(script);
}

/** Aplica el tema guardado al cargar la página. main.js la llama una vez al iniciar. */
export function applySavedTheme() {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
  reloadEconCalWidget();
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
  reloadEconCalWidget();
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
