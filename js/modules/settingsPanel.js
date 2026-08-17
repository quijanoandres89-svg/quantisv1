/* ============================================================
   SETTINGS PANEL — modal de Configuración
   ------------------------------------------------------------
   Arquitectura: un registro de secciones (SECTIONS) en vez de una
   estructura hardcodeada por sección. Cada sección es
   { id, label, icon, render(container) } — agregar una nueva
   sección futura (Copias de seguridad, Exportar datos, Restablecer,
   Apariencia, etc.) es agregar un objeto a este array, sin tocar el
   shell del modal, el nav lateral, ni el manejo de apertura/cierre.

   Reemplaza dos piezas que antes vivían sueltas en el nav lateral:
   - "Como conectar" (page-instrucciones) -> sección "Acerca de".
   - El botón de ícono "settings" que existía en el sidebar pero
     tenía un id duplicado ("theme-toggle") y estaba mal conectado
     a toggleTheme() en vez de abrir esto -> corregido en el HTML.

   Estado efímero (sección activa recordada durante la sesión) vive
   como variable de módulo, mismo patrón que ya usan replay.js
   (posición del scrubber) y calendarPro.js (mes/año visible) — se
   resetea solo al recargar la página, no necesita una clave de
   localStorage nueva para algo tan menor.
   ============================================================ */

import { trades, journals, challenges, plantillas, ruleSets, load, resetServerState } from "./state.js";
import * as Backup from "./backup.js";
import * as ImageStore from "./imageStore.js";
import { queueToastAfterReload } from "./toast.js";
import * as Instruments from "./instruments.js";

let activeSectionId = null;
let escListenerAttached = false;

function onEscKey(e) {
  if (e.key === "Escape") closeSettings();
}

// [window] onclick="openSettings()" — botón de engranaje en el sidebar
export function openSettings() {
  const modal = document.getElementById("modal-settings");
  if (!modal) return;
  renderSettingsNav();
  selectSettingsSection(activeSectionId || SECTIONS[0].id);
  modal.classList.add("open");
  if (!escListenerAttached) {
    document.addEventListener("keydown", onEscKey);
    escListenerAttached = true;
  }
}

// [window] onclick="closeSettings()" — X, click fuera, o Escape
export function closeSettings() {
  const modal = document.getElementById("modal-settings");
  if (modal) modal.classList.remove("open");
  if (escListenerAttached) {
    document.removeEventListener("keydown", onEscKey);
    escListenerAttached = false;
  }
}

// [window] onclick="selectSettingsSection('perfil')" — ítems del nav lateral
export function selectSettingsSection(id) {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) return;
  activeSectionId = id;
  renderSettingsNav();
  const container = document.getElementById("settings-content");
  if (!container) return;
  container.innerHTML = "";
  section.render(container);
}

function renderSettingsNav() {
  const nav = document.getElementById("settings-nav");
  if (!nav) return;
  nav.innerHTML = SECTIONS.map(
    (s) => `
    <button
      class="settings-nav-item${s.id === activeSectionId ? " active" : ""}${s.id === "reset" ? " danger" : ""}"
      onclick="selectSettingsSection('${s.id}')"
    >
      <span class="material-symbols-outlined">${s.icon}</span>
      ${s.label}
    </button>`,
  ).join("");
}

/* ------------------------------------------------------------
   SECCIÓN: Copias de seguridad
   ------------------------------------------------------------
   Consolida dos piezas que antes vivían sueltas:
   - El panel "Backups Automáticos" (rotación de 5, Entrega 31),
     que estaba fijo en el sidebar visible en TODAS las páginas —
     le quitaba espacio vertical a la app entera, no solo cuando el
     usuario quería ver sus backups.
   - La página "Backup / Restaurar" (export/import manual de JSON).

   No se tocó la lógica de backup.js — solo se movió el contenedor
   #backup-panel de sitio. renderBackups() ya apunta a ese id por su
   cuenta (document.getElementById("backup-panel")), así que sigue
   funcionando igual estando dentro del modal de Configuración.

   El "Resumen de datos almacenados" que tenía la página vieja se
   quitó de acá a propósito — es la misma info que ya muestra la
   sección "Acerca de" (y esa versión es más completa, también
   cuenta Conjuntos de Reglas). No tiene sentido mostrarla dos veces
   en el mismo modal.
   ------------------------------------------------------------ */
function renderBackupsSection(container) {
  container.innerHTML = `
    <div class="settings-section-title">Copias de seguridad</div>
    <div class="settings-section-sub">Backups automáticos y manuales de todos tus datos.</div>
    <div class="card-bk">
      <div id="backup-panel"></div>
    </div>
    <div class="settings-section-title" style="font-size:13px;margin-top:22px">Backup manual</div>
    <div class="fr">
      <div class="fg" style="flex:1;min-width:220px">
        <label>Exportar todo</label>
        <p style="font-size:12px;color:var(--text2);margin:4px 0 10px;line-height:1.6">
          Descarga un JSON con trades, journals, challenges y plantillas. Ideal para cambiar de computador o navegador.
        </p>
        <button class="btn btn-p" onclick="exportBackup()">Descargar backup JSON</button>
      </div>
      <div class="fg" style="flex:1;min-width:220px">
        <label>Importar backup</label>
        <p style="font-size:12px;color:var(--text2);margin:4px 0 10px;line-height:1.6">
          Selecciona un archivo JSON exportado antes.
          <strong style="color:var(--red)">Reemplazará todos los datos actuales.</strong>
        </p>
        <input type="file" id="backup-file" accept=".json" onchange="importBackup(this)" />
      </div>
    </div>`;
  // El panel de backups automáticos recién quedó montado en el DOM —
  // ahora sí se puede poblar (antes de esto, document.getElementById
  // ("backup-panel") no encontraba nada porque el modal estaba cerrado
  // y esta sección ni existía todavía).
  Backup.renderBackups();
}

/* ------------------------------------------------------------
   SECCIÓN: Exportar datos
   ------------------------------------------------------------
   Junta el botón "Exportar reporte PDF" y "Exportar CSV" que antes
   vivían como botones sueltos y permanentes en el sidebar (visibles
   en todas las páginas, no solo cuando el usuario quería exportar
   algo). El PDF en sí (pdfExport.js) también se rediseñó en esta
   misma entrega con la paleta Quantis real en vez del índigo viejo
   — ver el comentario al inicio de pdfExport.js para el detalle.
   ------------------------------------------------------------ */
function renderExportSection(container) {
  container.innerHTML = `
    <div class="settings-section-title">Exportar datos</div>
    <div class="settings-section-sub">Genera reportes o descarga tus trades en otros formatos.</div>
    <div class="fr">
      <div class="fg" style="flex:1;min-width:220px">
        <label>Reporte semanal (PDF)</label>
        <p style="font-size:12px;color:var(--text2);margin:4px 0 10px;line-height:1.6">
          Resumen general + detalle semana a semana, con aprendizajes del journal. Listo para imprimir o compartir.
        </p>
        <button class="btn btn-p" onclick="exportarReportePDF()">Descargar reporte PDF</button>
      </div>
      <div class="fg" style="flex:1;min-width:220px">
        <label>Solo trades (CSV)</label>
        <p style="font-size:12px;color:var(--text2);margin:4px 0 10px;line-height:1.6">
          Todos tus trades en una hoja de cálculo — para analizarlos en Excel, Sheets o cualquier otra herramienta.
        </p>
        <button class="btn btn-p" onclick="exportCSV()">Descargar CSV</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------
   SECCIÓN: Perfil
   ------------------------------------------------------------
   QUANTIS no tiene backend ni autenticación (app 100% local, un
   solo usuario, un solo navegador — ver auditoría), así que no
   existe ningún dato de "usuario" real que mostrar todavía. Los
   campos quedan deshabilitados con "Próximamente" en vez de
   simular una identidad que no existe.
   ------------------------------------------------------------ */
function renderProfileSection(container) {
  container.innerHTML = `
    <div class="settings-section-title">Perfil</div>
    <div class="settings-section-sub">Personalización de tu cuenta en QUANTIS.</div>
    <div class="settings-avatar">QT</div>
    <div class="alert ai" style="margin-bottom:16px">
      QUANTIS funciona 100% en este navegador, sin cuentas ni servidor —
      todavía no hay un perfil real que editar. Estos campos quedan listos
      para cuando esa parte se construya.
    </div>
    <div class="fg settings-field-disabled">
      <label>Nombre <span class="settings-soon-badge">Próximamente</span></label>
      <input type="text" disabled placeholder="Tu nombre" />
    </div>
    <div class="fg settings-field-disabled">
      <label>Correo <span class="settings-soon-badge">Próximamente</span></label>
      <input type="email" disabled placeholder="tucorreo@ejemplo.com" />
    </div>
    <div class="fg settings-field-disabled">
      <label>Rol <span class="settings-soon-badge">Próximamente</span></label>
      <input type="text" disabled placeholder="Trader" />
    </div>`;
}

/* ------------------------------------------------------------
   SECCIÓN: Acerca de
   ------------------------------------------------------------
   Migrado de la antigua página "Como conectar" (page-instrucciones),
   que en realidad no era sobre "conectar" nada — era un explicativo
   de cómo funciona la app + un resumen de los datos detectados. Se
   trae el mismo contenido, con el resumen ampliado (ahora también
   cuenta los Conjuntos de Reglas, que la versión vieja no incluía).
   ------------------------------------------------------------ */
function renderAboutSection(container) {
  load();
  const trOk = trades.length > 0;
  const jOk = Object.keys(journals).length > 0;
  container.innerHTML = `
    <div class="settings-section-title">Acerca de</div>
    <div class="settings-section-sub">Cómo funciona QUANTIS y qué datos tiene guardados este navegador.</div>
    <div class="settings-about-block">
      <strong>Un solo archivo:</strong> Journal, Historial, Estadísticas,
      Challenges, Simulador, Plantillas y Backup viven en esta misma app.
      No hace falta abrir nada aparte.
    </div>
    <div class="settings-about-block">
      <strong>Datos unificados:</strong> Trades y journals se guardan una
      sola vez en este navegador (localStorage/IndexedDB) y todas las
      secciones — dashboard, reportes, simulador, comparador — leen de esa
      misma fuente. No hay copias ni riesgo de desincronización.
    </div>
    <div class="settings-about-block">
      <strong>Módulos avanzados:</strong> Usa el menú lateral para crear
      challenges, simular decisiones antes de operar, comparar semanas y
      guardar plantillas de setup — todo conectado al mismo historial de
      trades.
    </div>
    <div class="settings-about-block ok">
      <strong>Respaldo:</strong> Se genera un backup automático diario
      (últimos 5) y puedes exportar/importar un backup completo, o generar
      reportes en PDF/CSV, desde las secciones de esta misma Configuración.
    </div>
    <div class="settings-section-title" style="font-size:13px;margin-top:22px">Datos detectados en este navegador</div>
    <div class="srow"><span class="slbl">Trades registrados</span><span class="sv" style="color:${trOk ? "var(--green)" : "var(--red)"}">${trades.length}${trOk ? "" : " — no detectados"}</span></div>
    <div class="srow"><span class="slbl">Journals registrados</span><span class="sv" style="color:${jOk ? "var(--green)" : "var(--yellow)"}">${Object.keys(journals).length}</span></div>
    <div class="srow"><span class="slbl">Challenges</span><span class="sv">${challenges.length}</span></div>
    <div class="srow"><span class="slbl">Plantillas de setup</span><span class="sv">${plantillas.length}</span></div>
    <div class="srow"><span class="slbl">Conjuntos de reglas</span><span class="sv">${ruleSets.length}</span></div>
    ${!trOk ? '<div class="alert aw" style="margin-top:10px">No se detectaron trades en este navegador. Si esperabas ver tus datos, usa "Importar backup" en Copias de seguridad para cargarlos.</div>' : ""}`;
}

/* ------------------------------------------------------------
   SECCIÓN: Restablecer QUANTIS
   ------------------------------------------------------------
   La lista de "qué se va a borrar" corrige dos huecos reales que
   tenía el pedido original: no mencionaba los Conjuntos de Reglas
   (viven en localStorage igual que el resto) ni las capturas de
   pantalla de los trades (viven en IndexedDB desde la migración
   anterior). Un reset que solo hiciera localStorage.clear() habría
   dejado las imágenes huérfanas para siempre — exactamente el
   problema de espacio que esa migración vino a resolver, pero en
   reversa. Por eso confirmResetQuantis() también llama a
   ImageStore.deleteAllImages().

   El botón de confirmar no es un confirm() nativo (mismo criterio
   que ya usan el resto de las acciones destructivas nuevas de esta
   Configuración) — necesita un checkbox explícito marcado antes de
   habilitarse, un paso más difícil de aceptar sin querer que un
   simple "Aceptar" de un diálogo del navegador.
   ------------------------------------------------------------ */
function renderResetSection(container) {
  load();
  container.innerHTML = `
    <div class="settings-section-title" style="color:var(--red)">Restablecer QUANTIS</div>
    <div class="settings-section-sub">Borra todos los datos guardados en este navegador y deja la app como recién instalada.</div>
    <div class="alert ae">
      <span class="material-symbols-outlined" style="font-size:18px">warning</span>
      <div>Esta acción <strong>no se puede deshacer</strong>. Si quieres conservar tus datos, exporta un backup antes desde "Copias de seguridad".</div>
    </div>
    <div style="font-size:12px;color:var(--text2);margin:16px 0 6px;font-weight:600">Se eliminará permanentemente:</div>
    <ul style="margin:0 0 18px 18px;padding:0;font-size:12px;color:var(--text2);line-height:2">
      <li>Historial de trades (<strong>${trades.length}</strong> registrados) y sus capturas de pantalla</li>
      <li>Journals diarios (<strong>${Object.keys(journals).length}</strong> registrados)</li>
      <li>Challenges (<strong>${challenges.length}</strong>) y su vínculo con Conjuntos de Reglas</li>
      <li>Plantillas de setup (<strong>${plantillas.length}</strong>)</li>
      <li>Conjuntos de reglas (<strong>${ruleSets.length}</strong>)</li>
      <li>Pares e instrumentos personalizados (vuelve a los 3 por defecto: EURUSD, XAUUSD, GBPUSD)</li>
      <li>Backups automáticos guardados en este navegador</li>
      <li>Preferencias (tema claro/oscuro)</li>
    </ul>
    <label class="cli" style="border:none;padding:0 0 18px">
      <input type="checkbox" id="reset-confirm-check" onchange="toggleResetButton()" />
      <span class="clt">Entiendo que esta acción es permanente y no se puede deshacer.</span>
    </label>
    <button class="btn btn-d" id="reset-confirm-btn" disabled onclick="confirmResetQuantis()">
      Restablecer QUANTIS
    </button>`;
}

// [window] onchange="toggleResetButton()" — habilita el botón solo si el checkbox está marcado
export function toggleResetButton() {
  const check = document.getElementById("reset-confirm-check");
  const btn = document.getElementById("reset-confirm-btn");
  if (check && btn) btn.disabled = !check.checked;
}

// [window] onclick="confirmResetQuantis()" — botón "Restablecer QUANTIS"
export async function confirmResetQuantis() {
  const btn = document.getElementById("reset-confirm-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Restableciendo…";
  }

  let serverOk = true;
  try {
    await resetServerState();
  } catch (error) {
    serverOk = false;
    console.error("QUANTIS: no se pudo borrar el estado en Supabase:", error);
  }

  localStorage.clear();
  const imagesOk = await ImageStore.deleteAllImages();

  // Se encola DESPUÉS de localStorage.clear() a propósito — si se
  // encolara antes, el propio clear() borraría el mensaje en espera
  // junto con todo lo demás, y nunca se vería tras el reload.
  const fullyOk = imagesOk && serverOk;
  queueToastAfterReload(
    fullyOk ? "success" : "warning",
    fullyOk ? "QUANTIS restablecido" : "QUANTIS restablecido (parcial)",
    !serverOk
      ? "No se pudo borrar en Supabase (revisa tu conexión). Los datos podrían reaparecer al recargar."
      : imagesOk
        ? "Todos los datos se eliminaron correctamente."
        : "Los datos se eliminaron, pero algunas capturas de pantalla podrían no haberse borrado de este navegador.",
  );
  location.reload();
}

/* ------------------------------------------------------------
   Registro de secciones. Agregar una nueva sección futura es
   agregar un objeto acá — nada más de este archivo (ni el shell,
   ni el nav, ni open/closeSettings) necesita cambiar.
   ------------------------------------------------------------ */
const SECTIONS = [
  { id: "perfil", label: "Perfil", icon: "person", render: renderProfileSection },
  { id: "instrumentos", label: "Pares e instrumentos", icon: "candlestick_chart", render: Instruments.renderInstrumentsSection },
  { id: "backups", label: "Copias de seguridad", icon: "cloud_upload", render: renderBackupsSection },
  { id: "exportar", label: "Exportar datos", icon: "download", render: renderExportSection },
  { id: "acerca", label: "Acerca de", icon: "info", render: renderAboutSection },
  { id: "reset", label: "Restablecer", icon: "restart_alt", render: renderResetSection },
];
