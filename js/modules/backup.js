/* ============================================================
   BACKUP — copias de seguridad en la nube (Supabase), exportar /
   importar JSON y exportar CSV.
   ------------------------------------------------------------
   Cómo funciona (versión Fase E):
   - Cada copia es una FOTO COMPLETA de las 8 colecciones de datos
     (trades, journals, EOD, frenos, challenges, plantillas, reglas,
     instrumentos) guardada en la tabla quantis_backups, privada por
     usuario. Por eso aparece igual en todos tus dispositivos y no se
     pierde si borras los datos del navegador.
     (Las capturas de pantalla viven en Storage y se guardan solo por
     referencia: no se duplican en cada copia.)
   - Automática: una por día al abrir la app (se conservan las 7
     últimas). Manual: botón "Crear copia ahora".
   - Antes de restaurar o importar, la app guarda SOLA una copia de
     tus datos actuales ("Antes de restaurar"), así cualquier
     restauración se puede deshacer.
   - Restaurar/importar usa replaceAllState() (state.js): escribe todo
     en la nube de una vez y solo después actualiza lo local. Antes,
     restaurar un backup automático no hacía nada (la nube mandaba al
     recargar) e importar uno lanzaba 4 guardados que se pisaban.
   ============================================================ */

import {
  snapshotState,
  countState,
  validateSnapshot,
  replaceAllState,
  STATE_KEYS,
  trades,
} from "./state.js";
import { today, escapeHTML } from "./utils.js";
import { showToast, queueToastAfterReload } from "./toast.js";
import { getSupabase, getCurrentUser } from "./supabaseClient.js";

const LEGACY_KEY = "kame_backups"; // copias antiguas que vivían solo en este navegador
const LEGACY_DONE_KEY = "quantis_legacy_backups_migrated";
const KEEP = { auto: 7, pre: 5, legacy: 5, manual: 20 }; // cuántas se conservan por tipo
const VISIBLE_COLLAPSED = 3;
const TZ = "America/Bogota";

const LABELS = {
  trades: "trades",
  journals: "journals",
  eodEntries: "EOD",
  frenoLog: "frenos",
  challenges: "challenges",
  plantillas: "plantillas",
  ruleSets: "conjuntos de reglas",
  instruments: "instrumentos",
};
const KIND_LABEL = {
  auto: "Automático",
  manual: "Manual",
  pre_restore: "Antes de restaurar",
  pre_reset: "Antes de restablecer",
  legacy: "Copia local antigua",
};

let historyExpanded = false;
let cachedList = []; // última lista descargada (para los resúmenes de restauración)

/* ---------------- Utilidades ---------------- */

const icon = (n, extra = "") => `<span class="material-symbols-outlined ${extra}">${n}</span>`;
const bogotaDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (iso) =>
  new Date(iso).toLocaleString("es-CO", {
    timeZone: TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** "12 trades, 4 journals, ..." — solo lo que tenga algo. */
function describeCounts(counts) {
  const c = counts || {};
  const parts = STATE_KEYS.filter((k) => c[k] > 0).map((k) => `${c[k]} ${LABELS[k]}`);
  return parts.length ? parts.join(", ") : "sin datos";
}

const isMissingTable = (e) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || (/quantis_backups/.test(e.message || "") && /not find|does not exist/i.test(e.message || "")));

/* ---------------- CSV ---------------- */

// [window] onclick="exportCSV()"
export function exportCSV() {
  if (!trades.length) {
    showToast("error", "Nada para exportar", "No hay trades registrados.");
    return;
  }
  const h = ["ID", "Fecha", "Hora", "Par", "Dirección", "Resultado", "RR", "Tipo", "Sesión", "Plan respetado", "Emoción", "Notas"];
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
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trades_${today()}.csv`;
  a.click();
  showToast("success", "CSV exportado", `${trades.length} trade(s).`);
}

/* ---------------- Copias en la nube ---------------- */

async function pruneBackups(supabase, userId) {
  const { data } = await supabase
    .from("quantis_backups")
    .select("id, kind, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const rows = data || [];
  const groups = {
    auto: rows.filter((r) => r.kind === "auto"),
    pre: rows.filter((r) => r.kind === "pre_restore" || r.kind === "pre_reset"),
    legacy: rows.filter((r) => r.kind === "legacy"),
  };
  const drop = [...groups.auto.slice(KEEP.auto), ...groups.pre.slice(KEEP.pre), ...groups.legacy.slice(KEEP.legacy)].map((r) => r.id);
  if (drop.length) await supabase.from("quantis_backups").delete().in("id", drop);
}

/** Crea una copia en la nube con el estado actual. Devuelve la fila (sin datos) o null si falló. */
export async function createCloudBackup(kind = "manual", label = null, snapshot = null) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new Error("No hay sesión activa.");
    const snap = snapshot || snapshotState();
    const counts = countState(snap);
    const size = new Blob([JSON.stringify(snap)]).size;
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("quantis_backups")
      .insert({ user_id: user.id, kind, label, counts, size_bytes: size, data: snap })
      .select("id, created_at, kind, label, counts, size_bytes")
      .single();
    if (error) throw error;
    await pruneBackups(supabase, user.id);
    return data;
  } catch (e) {
    console.error("QUANTIS: no se pudo crear la copia de seguridad:", e);
    createCloudBackup.lastError = e;
    return null;
  }
}

async function listCloudBackups() {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("quantis_backups")
    .select("id, created_at, kind, label, counts, size_bytes")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function fetchBackupData(id) {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from("quantis_backups").select("data").eq("id", id).single();
  if (error) throw error;
  return data.data;
}

// [window] onclick="createManualBackup()" — botón "Crear copia ahora"
export async function createManualBackup() {
  const btn = document.getElementById("bk-create-btn");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.innerHTML = `<span class="spinner"></span> Guardando…`;
  }
  try {
    const manual = cachedList.filter((b) => b.kind === "manual").length;
    if (manual >= KEEP.manual) {
      showToast("error", "Límite de copias manuales", `Ya tienes ${KEEP.manual}. Elimina alguna para crear otra.`);
      return;
    }
    const b = await createCloudBackup("manual", null);
    if (!b) {
      showToast("error", "No se pudo crear la copia", createCloudBackup.lastError?.message || "Revisa tu conexión.");
      return;
    }
    showToast("success", "Copia creada", describeCounts(b.counts));
  } finally {
    await renderBackups();
  }
}

/* ---------------- Restaurar / importar (flujo común) ---------------- */

/**
 * Muestra el resumen "actual → copia", guarda una copia de seguridad de lo
 * actual y reemplaza los datos. `source` = texto para el aviso ("la copia del 5 de oct").
 */
async function applySnapshot(snap, source) {
  const problem = validateSnapshot(snap);
  if (problem) {
    showToast("error", "Archivo no válido", problem);
    return false;
  }
  const incoming = countState(snap);
  const current = countState(snapshotState());
  const lines = STATE_KEYS.filter((k) => k in snap).map((k) => `• ${LABELS[k]}: ${current[k] ?? 0} actuales → ${incoming[k]} en la copia`);
  const untouched = STATE_KEYS.filter((k) => !(k in snap)).map((k) => LABELS[k]);
  const msg =
    `Vas a restaurar ${source}.\n\nSe reemplazarán:\n${lines.join("\n")}` +
    (untouched.length ? `\n\nNo se tocarán (la copia no los incluye): ${untouched.join(", ")}.` : "") +
    `\n\nAntes de continuar se guardará automáticamente una copia de tus datos actuales ("Antes de restaurar"), por si quieres deshacerlo.\n\n¿Continuar?`;
  if (!confirm(msg)) return false;

  const safety = await createCloudBackup("pre_restore", `Antes de restaurar ${source}`.slice(0, 120));
  if (!safety) {
    const why = createCloudBackup.lastError?.message || "error desconocido";
    if (
      !confirm(
        `No se pudo guardar la copia de seguridad previa (${why}).\n\nSi continúas y algo sale mal, NO podrás deshacerlo.\n\n¿Restaurar de todos modos?`,
      )
    )
      return false;
  }
  try {
    await replaceAllState(snap);
  } catch (e) {
    showToast("error", "No se pudo restaurar", `${e.message}. Tus datos actuales no se modificaron.`);
    return false;
  }
  queueToastAfterReload(
    "success",
    "Copia restaurada",
    safety ? "Tus datos anteriores quedaron guardados en 'Antes de restaurar'." : "",
  );
  location.reload();
  return true;
}

// [window] onclick="restoreBackup(id)"
export async function restoreBackup(id) {
  const meta = cachedList.find((b) => b.id === id);
  try {
    const snap = await fetchBackupData(id);
    await applySnapshot(snap, `la copia del ${meta ? fmtDate(meta.created_at) : "(fecha desconocida)"}`);
  } catch (e) {
    showToast("error", "No se pudo leer la copia", e.message);
  }
}

// [window] onclick="downloadBackup(id)"
export async function downloadBackup(id) {
  const meta = cachedList.find((b) => b.id === id);
  try {
    const snap = await fetchBackupData(id);
    const day = meta ? bogotaDay(new Date(meta.created_at)) : today();
    downloadJSON(
      { version: "quantis_backup_v2", exportDate: meta?.created_at || new Date().toISOString(), ...snap },
      `quantis_backup_${day}.json`,
    );
  } catch (e) {
    showToast("error", "No se pudo descargar", e.message);
  }
}

// [window] onclick="deleteBackup(id)"
export async function deleteBackup(id) {
  if (!confirm("¿Eliminar esta copia de seguridad? No se puede deshacer.")) return;
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from("quantis_backups").delete().eq("id", id);
    if (error) throw error;
    showToast("success", "Copia eliminada", "");
  } catch (e) {
    showToast("error", "No se pudo eliminar", e.message);
  }
  renderBackups();
}

/* ---------------- Exportar / importar archivo JSON ---------------- */

// [window] onclick="exportBackup()"
export function exportBackup() {
  const snap = snapshotState();
  downloadJSON({ version: "quantis_backup_v2", exportDate: new Date().toISOString(), ...snap }, `quantis_backup_${today()}.json`);
  showToast("success", "Backup exportado", describeCounts(countState(snap)));
}

// [window] onchange="importBackup(this)" en el <input type="file">
export function importBackup(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      showToast("error", "Error al importar", "Archivo inválido o corrupto.");
      input.value = "";
      return;
    }
    // Formatos antiguos (v3_modulos, auto-backup) traen solo algunas colecciones: se aceptan igual.
    const snap = {};
    for (const k of STATE_KEYS) if (data && typeof data === "object" && k in data) snap[k] = data[k];
    await applySnapshot(snap, `el archivo "${file.name}"`);
    input.value = "";
  };
  reader.readAsText(file);
}

/* ---------------- Automático + migración de copias antiguas ---------------- */

/** Pasa a la nube (una sola vez) las copias que estaban solo en este navegador. */
async function migrateLegacyBackups() {
  if (localStorage.getItem(LEGACY_DONE_KEY)) return;
  let legacy = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "[]");
  } catch {
    legacy = [];
  }
  let ok = true;
  for (const b of legacy.slice(0, KEEP.legacy)) {
    const snap = {};
    for (const k of STATE_KEYS) if (k in b) snap[k] = b[k];
    if (validateSnapshot(snap)) continue;
    const created = await createCloudBackup("legacy", `Copia local del ${bogotaDay(new Date(b.timestamp))}`, snap);
    if (!created) ok = false;
  }
  if (ok) localStorage.setItem(LEGACY_DONE_KEY, "1"); // si falló, se reintenta en la próxima sesión
}

export async function startAutoBackup() {
  try {
    const snap = snapshotState();
    // No se respalda un estado vacío (no hay nada que cuidar y solo ocuparía un lugar de los 7).
    if (!Object.values(countState(snap)).some((n) => n > 0)) return;
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("quantis_backups")
      .select("created_at")
      .eq("kind", "auto")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    const last = data && data[0];
    if (!last || bogotaDay(new Date(last.created_at)) !== bogotaDay()) {
      await createCloudBackup("auto", null, snap);
    }
    await migrateLegacyBackups();
  } catch (e) {
    // Silencioso a propósito: corre en segundo plano al arrancar. Si la tabla aún no existe
    // (falta el SQL) o no hay red, la app sigue normal y el panel lo explica al abrirlo.
    console.warn("QUANTIS: copia automática omitida:", e.message || e);
  }
}

/* ---------------- Panel "Copias de seguridad" ---------------- */

export async function renderBackups() {
  const panel = document.getElementById("backup-panel");
  if (!panel) return;
  panel.innerHTML = `<div class="loading-row"><span class="spinner"></span> Cargando copias…</div>`;
  let list;
  try {
    list = await listCloudBackups();
  } catch (e) {
    panel.innerHTML = isMissingTable(e)
      ? `<div class="alert aw">${icon("warning")}<div>Falta crear la tabla de copias en Supabase. Ejecuta <strong>supabase_backups_setup.sql</strong> en el SQL Editor y vuelve a abrir esta sección.</div></div>`
      : `<div class="alert aw">${icon("cloud_off")}<div>No se pudo conectar con la nube (${escapeHTML(e.message || "sin conexión")}). <button class="btn btn-sm" onclick="renderBackups()">Reintentar</button></div></div>`;
    return;
  }
  cachedList = list;
  const autos = list.filter((b) => b.kind === "auto");
  const header = `<div class="bk-head"><span class="bk-title">Copias en la nube</span>
    <span class="bk-badge-active"><span class="bk-dot"></span>Activo</span></div>`;
  const create = `<button class="btn btn-p btn-sm" id="bk-create-btn" onclick="createManualBackup()">${icon("add_circle")} Crear copia ahora</button>`;

  if (!list.length) {
    panel.innerHTML = `${header}<div class="bk-empty">Aún no hay copias. La primera se crea sola hoy al abrir la app, o puedes crearla ahora.</div>${create}`;
    return;
  }
  const last = list[0];
  const lastBlock = `
    <div class="bk-last">
      <div class="bk-last-icon">${icon("cloud_done")}</div>
      <div class="bk-last-info">
        <div class="bk-last-label">Última copia</div>
        <div class="bk-last-date">${escapeHTML(fmtDate(last.created_at))}</div>
        <div class="bk-last-time">${escapeHTML(describeCounts(last.counts))}</div>
      </div>
    </div>`;
  const metaRow = `
    <div class="bk-meta-row">
      <div class="bk-meta-item">${icon("event_repeat")}<div><div class="bk-meta-label">Frecuencia</div><div class="bk-meta-value">Diario</div></div></div>
      <div class="bk-meta-item">${icon("cloud")}<div><div class="bk-meta-label">Ubicación</div><div class="bk-meta-value">Nube</div></div></div>
      <div class="bk-meta-item">${icon("inventory_2")}<div><div class="bk-meta-label">Automáticas</div><div class="bk-meta-value">${autos.length} / ${KEEP.auto}</div></div></div>
    </div>`;
  const visible = historyExpanded ? list : list.slice(0, VISIBLE_COLLAPSED);
  const items = visible
    .map((b) => {
      const kind = KIND_LABEL[b.kind] || b.kind;
      return `<div class="bk-item">
        <div class="bk-item-info">
          <div class="bk-item-name">${escapeHTML(b.label || kind)}<span class="bk-item-tag">${escapeHTML(kind)}</span></div>
          <div class="bk-item-date">${escapeHTML(fmtDate(b.created_at))} · ${fmtSize(b.size_bytes)}</div>
          <div class="bk-item-date">${escapeHTML(describeCounts(b.counts))}</div>
        </div>
        <div class="bk-item-actions">
          <button class="btn btn-sm" data-id="${b.id}" onclick="restoreBackup(this.dataset.id)">Restaurar</button>
          <button class="btn btn-icon btn-sm btn-g" aria-label="Descargar" title="Descargar JSON" data-id="${b.id}" onclick="downloadBackup(this.dataset.id)">${icon("download")}</button>
          <button class="btn btn-icon btn-sm btn-g" aria-label="Eliminar" title="Eliminar" data-id="${b.id}" onclick="deleteBackup(this.dataset.id)">${icon("delete")}</button>
        </div>
      </div>`;
    })
    .join("");
  const seeAll =
    list.length > VISIBLE_COLLAPSED
      ? `<button class="bk-see-all" onclick="toggleBackupHistory()">${historyExpanded ? "Ver menos" : `Ver todas (${list.length})`}</button>`
      : "";
  panel.innerHTML = `${header}${lastBlock}${metaRow}
    <div class="bk-hist-head"><span>Historial</span>${create}</div>
    <div class="bk-list">${items}</div>${seeAll}`;
}

// [window] onclick="toggleBackupHistory()"
export function toggleBackupHistory() {
  historyExpanded = !historyExpanded;
  renderBackups();
}
