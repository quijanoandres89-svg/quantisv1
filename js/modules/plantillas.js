/* ============================================================
   PLANTILLAS — setups guardados como plantilla reutilizable.
   openModal/closeModal viven en challengeManager.js (se
   construyeron primero ahí) — se importan aquí en vez de duplicar.
   ============================================================ */

import { plantillas, savePlantillas } from "./state.js";
import { closeModal } from "./challengeManager.js";
import { showToast } from "./toast.js";
import { escapeHTML } from "./utils.js";

// [window] go('plantillas', ...) la dispara desde main.js
export function renderPlantillas() {
  const el = document.getElementById("plantillas-list");
  if (!plantillas.length) {
    el.innerHTML =
      '<div class="empty">Sin plantillas. Crea la primera arriba.</div>';
    return;
  }
  el.innerHTML = plantillas
    .map(
      (p, i) => `
    <div class="tpl-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:13px;font-weight:600">${escapeHTML(p.nombre)}</div>
        <button class="btn btn-d btn-sm" onclick="deletePlantilla(${i})">Eliminar</button>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        <span class="badge binf">${escapeHTML(p.par)}</span>
        <span class="badge ${p.dir === "Compra" ? "btp" : "bsl"}">${escapeHTML(p.dir)}</span>
        <span class="badge bbe">${escapeHTML(p.tipo)}</span>
        <span class="badge" style="background:var(--bg3);color:var(--text2);border:1px solid var(--border)">${escapeHTML(p.ses)}</span>
      </div>
      ${p.desc ? `<div style="font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg3);border-radius:6px;border:1px solid var(--border);font-family:var(--mono)">${escapeHTML(p.desc)}</div>` : ""}
    </div>`,
    )
    .join("");
}

// [window] onclick="savePlantilla()"
export function savePlantilla() {
  const p = {
    id: Date.now(),
    nombre: document.getElementById("tpl-nombre").value || "Sin nombre",
    par: document.getElementById("tpl-par").value,
    dir: document.getElementById("tpl-dir").value,
    tipo: document.getElementById("tpl-tipo").value,
    ses: document.getElementById("tpl-ses").value,
    desc: document.getElementById("tpl-desc").value,
  };
  plantillas.push(p);
  if (!savePlantillas()) {
    plantillas.pop();
    showToast("error", "No se pudo guardar", "Almacenamiento local lleno.");
    return;
  }
  closeModal("modal-tpl");
  renderPlantillas();
  document.getElementById("tpl-nombre").value = "";
  document.getElementById("tpl-desc").value = "";
  showToast("success", "Plantilla guardada", p.nombre);
}

// [window] onclick="deletePlantilla(i)"
export function deletePlantilla(i) {
  if (!confirm("Eliminar plantilla?")) return;
  const nombre = plantillas[i].nombre;
  plantillas.splice(i, 1);
  savePlantillas();
  renderPlantillas();
  showToast("warning", "Plantilla eliminada", nombre);
}
