/* ============================================================
   BACKUP — exportar CSV/JSON, importar backup manual, resumen
   de datos y el sistema de respaldo automático diario (últimos 5).
   ------------------------------------------------------------
   Entrega 5 (bugfix): createAutoBackup()/restoreBackup() usaban
   las claves "v3_challenges"/"v3_plantillas" (no existían de
   verdad) en vez de CH_KEY/PL_KEY de state.js. El auto-backup
   nunca respaldó challenges ni plantillas correctamente hasta
   esta entrega. Corregido importando las mismas constantes que
   usa state.js — ya no puede desincronizarse.
   ============================================================ */

import {
  trades,
  journals,
  challenges,
  plantillas,
  saveChallenges,
  savePlantillas,
  saveTrades,
  saveJournals,
  load,
  CH_KEY,
  PL_KEY,
  TK,
  JK,
} from "./state.js";
import { today, escapeHTML } from "./utils.js";
import { showToast, queueToastAfterReload } from "./toast.js";

// --- Configuración del panel de Backups Automáticos (sidebar) ---
const BK_KEY = "kame_backups"; // única fuente: antes vivía repetida como string suelto 5 veces
const MAX_BACKUPS = 5; // rotación FIFO: al superar este número se descarta el más viejo
const VISIBLE_COLLAPSED = 2; // backups visibles antes de pulsar "Ver todos"

// Estado de UI efímero del panel — no se persiste (mismo patrón que
// replay.js con su scrubber): se resetea en cada carga de página, y
// ningún otro módulo necesita leerlo ni escribirlo.
let historyExpanded = false;
let openMenuIndex = null;

/** Ícono SVG inline, mismo estilo (stroke, sin relleno) que el resto de la app. */
function icon(paths, size = 14) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const ICONS = {
  cloud: icon(
    '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h.79a4.5 4.5 0 1 1 0 9z"/>',
    18,
  ),
  check: icon('<polyline points="20 6 9 17 4 12"/>', 11),
  shield: icon('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', 14),
  clock: icon(
    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    14,
  ),
  database: icon(
    '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    14,
  ),
  refresh: icon(
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    13,
  ),
  download: icon(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    13,
  ),
  dots: icon(
    '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
    13,
  ),
  chevron: icon('<polyline points="6 9 12 15 18 9"/>', 11),
};

/** Dispara la descarga de un objeto como archivo JSON — único lugar que
 * arma el Blob/enlace, para no repetirlo en exportBackup() y
 * downloadSingleBackup(). */
function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// [window] onclick="exportCSV()"
export function exportCSV() {
  if (!trades.length) {
    showToast("error", "Nada para exportar", "No hay trades registrados.");
    return;
  }
  const h = [
    "ID",
    "Fecha",
    "Hora",
    "Par",
    "Dirección",
    "Resultado",
    "RR",
    "Tipo",
    "Sesión",
    "Plan respetado",
    "Emoción",
    "Notas",
  ];
  const rows = trades.map((t) => [
    t.id,
    t.fecha,
    t.hora || "",
    t.par,
    t.dir,
    t.res,
    t.rr || "",
    t.tipo,
    t.ses,
    t.plan,
    t.emo,
    `"${(t.notas || "").replace(/"/g, "'")}"`,
  ]);
  const csv = [h.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trades_${today()}.csv`;
  a.click();
  showToast("success", "CSV exportado", `${trades.length} trade(s).`);
}

// [window] onclick="exportBackup()"
export function exportBackup() {
  load();
  const data = {
    version: "v3_modulos",
    exportDate: new Date().toISOString(),
    trades,
    journals,
    challenges,
    plantillas,
  };
  downloadJSON(data, `trading_backup_${today()}.json`);
  showToast(
    "success",
    "Backup exportado",
    `${trades.length} trade(s), ${challenges.length} challenge(s).`,
  );
}

// [window] onchange="importBackup(this)" en el <input type="file">
export function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const msg = `Backup contiene:\n- ${(data.trades || []).length} trades\n- ${Object.keys(data.journals || {}).length} journals\n- ${(data.challenges || []).length} challenges\n\nReemplazara todos los datos actuales. Continuar?`;
      if (!confirm(msg)) return;
      const failed = [];
      // Mutación en el lugar: "trades"/"journals"/"challenges"/"plantillas"
      // son bindings importados de state.js, no se pueden reasignar
      // directamente (trades = ... rompería el binding de ES modules).
      if (data.trades) {
        trades.length = 0;
        trades.push(...data.trades);
        if (!saveTrades()) failed.push("trades");
      }
      if (data.journals) {
        Object.keys(journals).forEach((k) => delete journals[k]);
        Object.assign(journals, data.journals);
        if (!saveJournals()) failed.push("journals");
      }
      if (data.challenges) {
        challenges.length = 0;
        challenges.push(...data.challenges);
        if (!saveChallenges()) failed.push("challenges");
      }
      if (data.plantillas) {
        plantillas.length = 0;
        plantillas.push(...data.plantillas);
        if (!savePlantillas()) failed.push("plantillas");
      }
      load();
      if (failed.length) {
        showToast(
          "error",
          "Backup importado con errores",
          `El almacenamiento local está lleno — no se pudo guardar: ${failed.join(", ")}. Libera espacio (borra capturas viejas) e importa de nuevo.`,
        );
        return;
      }
      showToast(
        "success",
        "Backup importado",
        `${(data.trades || []).length} trades, ${Object.keys(data.journals || {}).length} journals.`,
      );
    } catch (err) {
      showToast("error", "Error al importar", "Archivo inválido o corrupto.");
    }
  };
  reader.readAsText(file);
}

/**
 * ⚠️ Nota de la auditoría, encontrada al blindar esta función: cada
 * backup automático duplica TODOS los datos (incluidas las capturas de
 * pantalla en Base64 de cada trade) en la clave BK_KEY, y se guardan
 * hasta MAX_BACKUPS (5) copias en rotación FIFO. Esto significa que la
 * capacidad real y segura de imágenes no es "hasta que se llene
 * localStorage una vez" — es hasta que se llene con potencialmente 6
 * copias de los mismos datos (1 copia viva + hasta 5 backups),
 * agravando el hallazgo crítico de la auditoría (imágenes en
 * localStorage). No se resuelve en este fix puntual — la solución de
 * fondo sigue siendo migrar las imágenes a IndexedDB.
 */
export function createAutoBackup() {
  try {
    const backup = {
      timestamp: new Date().toISOString(),
      trades: JSON.parse(localStorage.getItem(TK) || "[]"),
      journals: JSON.parse(localStorage.getItem(JK) || "{}"),
      challenges: JSON.parse(localStorage.getItem(CH_KEY) || "[]"),
      plantillas: JSON.parse(localStorage.getItem(PL_KEY) || "[]"),
    };

    let backups = JSON.parse(localStorage.getItem(BK_KEY) || "[]");
    backups.unshift(backup);
    if (backups.length > MAX_BACKUPS) {
      backups = backups.slice(0, MAX_BACKUPS);
    }
    localStorage.setItem(BK_KEY, JSON.stringify(backups));
    renderBackups();
  } catch (e) {
    console.error("Auto-backup falló (posible cuota de localStorage llena):", e);
    // A propósito, sin toast aquí: esta función corre en silencio en
    // segundo plano al arrancar la app (startAutoBackup(), desde
    // init()). Interrumpir el arranque con un aviso por un backup
    // automático fallido sería más disruptivo que útil — el usuario
    // sigue pudiendo usar la app y exportar un backup manual. Sí queda
    // registrado en consola para poder diagnosticarlo.
  }
}

/**
 * Panel "Backups Automáticos" del sidebar (rediseño — a pedido del
 * usuario, siguiendo un mockup de referencia). Controla un único
 * contenedor (`#backup-panel`) en vez de los 2 divs separados que
 * tenía antes — todo el HTML del panel se arma acá, así el estado de
 * UI efímero (historyExpanded/openMenuIndex) queda encapsulado en este
 * módulo sin que Quantis.html necesite saber nada de eso.
 */
export function renderBackups() {
  const panel = document.getElementById("backup-panel");
  if (!panel) return;
  const backups = JSON.parse(localStorage.getItem(BK_KEY) || "[]");

  const header = `<div class="bk-head"><span class="bk-title">Backups automáticos</span><span class="bk-badge-active"><span class="bk-dot"></span>Activo</span></div>`;

  if (!backups.length) {
    panel.innerHTML = `${header}<div class="bk-empty">Aún no hay backups guardados. Se generará el primero automáticamente hoy.</div>`;
    return;
  }

  const last = backups[0];
  const lastDate = new Date(last.timestamp);
  const nextDate = new Date();
  nextDate.setDate(nextDate.getDate() + 1);
  const pct = Math.round((backups.length / MAX_BACKUPS) * 100);

  const lastBlock = `
    <div class="bk-last">
      <div class="bk-last-icon">${ICONS.cloud}</div>
      <div class="bk-last-info">
        <div class="bk-last-label">Último backup</div>
        <div class="bk-last-date">${lastDate.toLocaleDateString("es-CO")} <span class="bk-check">${ICONS.check}</span></div>
        <div class="bk-last-time">${lastDate.toLocaleTimeString("es-CO")}</div>
      </div>
    </div>`;

  const metaRow = `
    <div class="bk-meta-row">
      <div class="bk-meta-item">${ICONS.shield}<div><div class="bk-meta-label">Frecuencia</div><div class="bk-meta-value">Diario</div></div></div>
      <div class="bk-meta-item">${ICONS.clock}<div><div class="bk-meta-label">Siguiente</div><div class="bk-meta-value">${nextDate.toLocaleDateString("es-CO")}</div></div></div>
      <div class="bk-meta-item">${ICONS.database}<div><div class="bk-meta-label">Ubicación</div><div class="bk-meta-value">Local</div></div></div>
    </div>`;

  const progress = `
    <div class="bk-progress-label"><span>Backups guardados</span><span>${backups.length} / ${MAX_BACKUPS}</span></div>
    <div class="bk-progress-bar"><div class="bk-progress-fill" style="width:${pct}%"></div></div>`;

  const visibleCount = historyExpanded
    ? backups.length
    : Math.min(VISIBLE_COLLAPSED, backups.length);

  const items = backups
    .slice(0, visibleCount)
    .map((backup, index) => {
      const n = backups.length - index; // Backup 5 = el más nuevo, Backup 1 = el más viejo
      const d = new Date(backup.timestamp);
      return `
      <div class="bk-item">
        <div class="bk-item-check">${ICONS.check}</div>
        <div class="bk-item-info">
          <div class="bk-item-name">Backup ${n}${index === 0 ? '<span class="bk-item-tag">Más reciente</span>' : ""}</div>
          <div class="bk-item-date">${d.toLocaleDateString("es-CO")}, ${d.toLocaleTimeString("es-CO")}</div>
        </div>
        <div class="bk-item-actions">
          <button class="bk-icon-btn" onclick="downloadSingleBackup(${index})" title="Descargar este backup">${ICONS.download}</button>
          <button class="bk-icon-btn" onclick="toggleBackupMenu(${index})" title="Más opciones">${ICONS.dots}</button>
          ${
            openMenuIndex === index
              ? `<div class="bk-menu"><button class="bk-menu-item" onclick="restoreBackup(${index})">Restaurar este backup</button></div>`
              : ""
          }
        </div>
      </div>`;
    })
    .join("");

  const seeAll =
    backups.length > VISIBLE_COLLAPSED
      ? `<button class="bk-see-all" onclick="toggleBackupHistory()">${historyExpanded ? "Ver menos backups" : "Ver todos los backups"} <span class="bk-chevron${historyExpanded ? " bk-chevron-up" : ""}">${ICONS.chevron}</span></button>`
      : "";

  panel.innerHTML = `${header}${lastBlock}${metaRow}${progress}
    <div class="bk-hist-head">
      <span>Historial de backups</span>
      <button class="bk-icon-btn" onclick="renderBackups()" title="Actualizar">${ICONS.refresh}</button>
    </div>
    <div class="bk-list">${items}</div>
    ${seeAll}`;
}

// [window] onclick="toggleBackupHistory()" — botón "Ver todos los backups"
export function toggleBackupHistory() {
  historyExpanded = !historyExpanded;
  renderBackups();
}

// [window] onclick="toggleBackupMenu(index)" — botón de 3 puntos por backup
export function toggleBackupMenu(index) {
  openMenuIndex = openMenuIndex === index ? null : index;
  renderBackups();
}

/** Cierra cualquier menú de 3 puntos abierto — usado por el listener
 * global de click-afuera (ver initBackupMenuAutoClose). */
function closeBackupMenu() {
  if (openMenuIndex !== null) {
    openMenuIndex = null;
    renderBackups();
  }
}

/** Listener único, registrado una sola vez desde main.js al arrancar
 * (mismo patrón que IZ.initPasteHandler()): cierra el menú de 3 puntos
 * si el click fue fuera de él. No se llama a nivel de módulo porque
 * document.addEventListener con lógica de UI debe quedar diferido al
 * arranque real de la app, no al import. */
export function initBackupMenuAutoClose() {
  document.addEventListener("click", (e) => {
    if (openMenuIndex === null) return;
    if (!e.target.closest(".bk-item-actions")) closeBackupMenu();
  });
}

// [window] onclick="downloadSingleBackup(index)" — ícono de descarga por backup
export function downloadSingleBackup(index) {
  const backups = JSON.parse(localStorage.getItem(BK_KEY) || "[]");
  const backup = backups[index];
  if (!backup) return;
  const n = backups.length - index;
  const dateStr = backup.timestamp.slice(0, 10);
  downloadJSON(
    { version: "quantis_auto_backup", ...backup },
    `quantis_backup_${n}_${dateStr}.json`,
  );
}

// [window] onclick="restoreBackup(index)"
export function restoreBackup(index) {
  const backups = JSON.parse(localStorage.getItem(BK_KEY) || "[]");
  const backup = backups[index];
  if (!backup) return;
  const ok = confirm("¿Deseas restaurar este backup?");
  if (!ok) return;
  try {
    localStorage.setItem(TK, JSON.stringify(backup.trades));
    localStorage.setItem(JK, JSON.stringify(backup.journals));
    localStorage.setItem(CH_KEY, JSON.stringify(backup.challenges));
    localStorage.setItem(PL_KEY, JSON.stringify(backup.plantillas));
  } catch (e) {
    // No se reversa lo ya escrito antes del fallo (localStorage no tiene
    // transacciones) — pero SÍ se evita el reload(), para no dejar al
    // usuario viendo una app "restaurada" a medias sin ningún aviso.
    showToast(
      "error",
      "No se pudo restaurar el backup",
      "El almacenamiento local está lleno. Libera espacio (borra capturas viejas) y vuelve a intentar.",
    );
    return;
  }
  // Un toast normal no se vería: location.reload() destruye el DOM de
  // inmediato. Se encola y showQueuedToast() (main.js, en init()) lo
  // muestra una sola vez apenas la app vuelve a cargar.
  queueToastAfterReload("success", "Backup restaurado", "");
  location.reload();
}

export function startAutoBackup() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastBackup = localStorage.getItem("last_backup_day");
  if (lastBackup !== todayStr) {
    createAutoBackup();
    localStorage.setItem("last_backup_day", todayStr);
  }
}
