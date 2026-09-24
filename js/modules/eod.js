/* ============================================================
   EOD (End of Day) — bitácora de contexto de mercado.
   ------------------------------------------------------------
   Un registro por día con 3 capturas (HTF/MTF/LTF), un resumen
   por cada una y un resumen general del día. Vive en su propia
   colección (eodEntries, keyed por fecha) en state.js — mismo
   patrón que journals, y las imágenes usan el mismo ImageStore
   (IndexedDB + Supabase Storage) que ya usan los trades, así no
   se repite el problema de cuota que tenían las capturas en
   Base64 dentro del propio registro.
   Cada 15 días, renderEod() arma un resumen automático de las
   entradas de esa quincena para detectar patrones en el tiempo.
   ------------------------------------------------------------
   Funciones marcadas [window] son llamadas desde onclick="..."
   en el HTML — main.js las expone en window.
   ============================================================ */

import { eodEntries, saveEodEntries } from "./state.js";
import { today, fmtDate, daysAgo, escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";
import { clearZoneManual } from "./imageZones.js";
import * as ImageStore from "./imageStore.js";

const SLOTS = [
  { key: "HTF", label: "Temporalidad mayor (HTF)", preview: "eod-img-htf-preview", zone: "eod-zone-htf", input: "eod-img-htf", labelId: "eod-zone-htf-label", resumen: "eod-resumen-htf" },
  { key: "MTF", label: "Temporalidad media (MTF)", preview: "eod-img-mtf-preview", zone: "eod-zone-mtf", input: "eod-img-mtf", labelId: "eod-zone-mtf-label", resumen: "eod-resumen-mtf" },
  { key: "LTF", label: "Temporalidad menor (LTF)", preview: "eod-img-ltf-preview", zone: "eod-zone-ltf", input: "eod-img-ltf", labelId: "eod-zone-ltf-label", resumen: "eod-resumen-ltf" },
];

function readSrc(previewId) {
  const src = document.getElementById(previewId)?.src || "";
  return src && src !== window.location.href ? src : "";
}

// [window] onclick="saveEod()"
export async function saveEod() {
  const fecha = document.getElementById("eod-fecha").value || today();
  const resumenGeneral = document.getElementById("eod-resumen-general").value.trim();

  const dataUrls = SLOTS.map((s) => readSrc(s.preview));
  const hasAnyImg = dataUrls.some(Boolean);
  const hasAnyText =
    resumenGeneral || SLOTS.some((s) => document.getElementById(s.resumen).value.trim());

  if (!hasAnyImg && !hasAnyText) {
    showToast(
      "error",
      "Nada que guardar",
      "Agrega al menos una captura o un resumen antes de guardar.",
    );
    return false;
  }

  const keys = dataUrls.map((url) => (url ? ImageStore.newImageKey() : ""));

  const entry = {
    fecha,
    imgHTF: keys[0],
    imgMTF: keys[1],
    imgLTF: keys[2],
    resumenHTF: document.getElementById("eod-resumen-htf").value.trim(),
    resumenMTF: document.getElementById("eod-resumen-mtf").value.trim(),
    resumenLTF: document.getElementById("eod-resumen-ltf").value.trim(),
    resumenGeneral,
    guardadoEn: new Date().toISOString(),
  };

  eodEntries[fecha] = entry;
  const saved = saveEodEntries();
  if (!saved) {
    delete eodEntries[fecha];
    showToast(
      "error",
      "No se pudo guardar el EOD",
      "El almacenamiento local está lleno. Libera espacio y vuelve a intentar.",
    );
    return false;
  }

  const imgFailures = [];
  for (let i = 0; i < SLOTS.length; i++) {
    if (dataUrls[i] && !(await ImageStore.saveImage(keys[i], dataUrls[i]))) {
      imgFailures.push(SLOTS[i].key);
    }
  }
  if (imgFailures.length) {
    showToast(
      "warning",
      "EOD guardado, capturas no",
      `El registro se guardó, pero la(s) captura(s) ${imgFailures.join("/")} no se pudieron guardar (almacenamiento lleno).`,
    );
  } else {
    showToast("success", "EOD guardado", fmtDate(fecha));
  }

  document.getElementById("eod-resumen-general").value = "";
  SLOTS.forEach((s) => {
    document.getElementById(s.resumen).value = "";
    clearZoneManual(s.preview, s.zone, s.input, s.labelId);
  });

  renderEod();
  return true;
}

// [window] onclick="verImagenesEod('YYYY-MM-DD')"
export async function verImagenesEod(fecha) {
  const e = eodEntries[fecha];
  if (!e) return;
  const refs = [
    ["HTF", e.imgHTF],
    ["MTF", e.imgMTF],
    ["LTF", e.imgLTF],
  ].filter(([, ref]) => ref);
  if (!refs.length) return;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:flex;flex-direction:column;padding:20px;cursor:pointer;align-items:center;justify-content:center";
  overlay.innerHTML = `<div style="color:#888;font-size:12px;font-family:var(--mono)">Cargando capturas…</div>`;
  overlay.onclick = (e2) => {
    if (e2.target === overlay) document.body.removeChild(overlay);
  };
  document.body.appendChild(overlay);

  const resolved = await Promise.all(refs.map(([, ref]) => ImageStore.resolveImage(ref)));
  if (!document.body.contains(overlay)) return;
  if (!resolved.some(Boolean)) {
    overlay.innerHTML = `<div style="color:#c66;font-size:12px;font-family:var(--mono)">No se pudieron cargar las capturas de este día.</div>`;
    return;
  }

  const header = `<div style="text-align:center;margin-bottom:14px;font-size:12px;color:#aaa;font-family:var(--mono)">EOD · ${escapeHTML(fmtDate(fecha))} <span style="margin-left:12px;font-size:10px;color:#666">Click en imagen para ampliar · Click fuera para cerrar</span></div>`;
  const imgs = `<div style="display:flex;gap:14px;flex:1;align-items:center;justify-content:center;min-height:0">
    ${resolved
      .map((src, i) =>
        src
          ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;max-height:100%">
        <div style="font-size:10px;color:#888;font-family:var(--mono);margin-bottom:6px;letter-spacing:1px">${refs[i][0]}</div>
        <img src="${escapeHTML(src)}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;cursor:zoom-in;border:1px solid #333" onclick="expandImg(this,event)" alt="${refs[i][0]}">
      </div>`
          : "",
      )
      .join('<div style="width:1px;background:#333;align-self:stretch"></div>')}
  </div>`;

  overlay.style.alignItems = "";
  overlay.style.justifyContent = "";
  overlay.innerHTML = header + imgs;
  overlay.onclick = (e2) => {
    if (e2.target === overlay || e2.target.tagName !== "IMG") {
      document.body.removeChild(overlay);
    }
  };
}

// [window] onclick="toggleEod('eod-...')"
export function toggleEod(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("open");
}

function renderEodList() {
  const dates = Object.keys(eodEntries).sort().reverse();
  const el = document.getElementById("eod-list");
  if (!dates.length) {
    el.innerHTML = `<div class="empty">Sin registros EOD todavía</div>`;
    return;
  }
  el.innerHTML = dates
    .map((d) => {
      const e = eodEntries[d];
      const nImgs = [e.imgHTF, e.imgMTF, e.imgLTF].filter(Boolean).length;
      const idSafe = d.replace(/-/g, "");
      return `<div class="ji" onclick="toggleEod('eod-d-${idSafe}')">
      <div class="jh">
        <div class="jdate">${fmtDate(d)}</div>
        ${nImgs ? `<span class="badge binf">${nImgs} captura${nImgs === 1 ? "" : "s"}</span>` : ""}
      </div>
      ${e.resumenGeneral ? `<div class="jprev">${escapeHTML(e.resumenGeneral.slice(0, 90))}${e.resumenGeneral.length > 90 ? "..." : ""}</div>` : ""}
      <div class="jdet" id="eod-d-${idSafe}">
        ${nImgs ? `<button class="btn btn-sm" onclick="event.stopPropagation(); verImagenesEod('${d}')">Ver capturas</button>` : ""}
        ${e.resumenHTF ? `<div class="jf"><div class="jfl">Resumen HTF</div><div class="jfv">${escapeHTML(e.resumenHTF)}</div></div>` : ""}
        ${e.resumenMTF ? `<div class="jf"><div class="jfl">Resumen MTF</div><div class="jfv">${escapeHTML(e.resumenMTF)}</div></div>` : ""}
        ${e.resumenLTF ? `<div class="jf"><div class="jfl">Resumen LTF</div><div class="jfv">${escapeHTML(e.resumenLTF)}</div></div>` : ""}
        ${e.resumenGeneral ? `<div class="jf"><div class="jfl">Resumen del día</div><div class="jfv">${escapeHTML(e.resumenGeneral)}</div></div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

/** Resumen automático de los últimos 15 días con registro EOD: no
 * reinventa análisis de mercado, solo agrupa lo que ya escribiste
 * para que puedas leer la quincena de corrido en vez de entrada por
 * entrada. */
function renderResumenQuincenal() {
  const el = document.getElementById("eod-quincenal");
  if (!el) return;
  const desde = daysAgo(14);
  const dates = Object.keys(eodEntries)
    .filter((d) => d >= desde)
    .sort();

  if (!dates.length) {
    el.innerHTML = `<div class="empty">Sin registros EOD en los últimos 15 días</div>`;
    return;
  }

  const conCapturas = dates.filter(
    (d) => eodEntries[d].imgHTF || eodEntries[d].imgMTF || eodEntries[d].imgLTF,
  ).length;

  el.innerHTML = `
    <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:10px">
      ${dates.length} de 15 días con registro · ${conCapturas} con capturas
    </div>
    ${dates
      .map((d) => {
        const e = eodEntries[d];
        const partes = [e.resumenHTF, e.resumenMTF, e.resumenLTF, e.resumenGeneral].filter(
          Boolean,
        );
        if (!partes.length) return "";
        return `<div class="jf">
          <div class="jfl">${fmtDate(d)}</div>
          <div class="jfv">${partes.map(escapeHTML).join(" — ")}</div>
        </div>`;
      })
      .join("")}`;
}

// [window] go('eod', ...) la dispara desde main.js
export function renderEod() {
  const fechaEl = document.getElementById("eod-fecha");
  if (fechaEl && !fechaEl.value) fechaEl.value = today();
  renderEodList();
  renderResumenQuincenal();
}
