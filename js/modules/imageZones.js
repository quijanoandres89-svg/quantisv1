/* ============================================================
   IMAGE ZONES — carga, preview, drag&drop y visor de imágenes
   de los trades (capturas HTF/LTF adjuntas al registrar).
   ------------------------------------------------------------
   Funciones marcadas [window] son llamadas desde onclick="..."
   en el HTML (estático o inyectado vía innerHTML) — main.js debe
   exponerlas en window al conectar todo.
   ============================================================ */

import { trades } from "./state.js";
import { escapeHTML } from "./utils.js";
import * as ImageStore from "./imageStore.js";

// [window] onchange="previewZone(this, ...)" en los <input type="file">
export function previewZone(input, previewId, zoneId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => setZoneImg(e.target.result, previewId, zoneId);
  reader.readAsDataURL(file);
}

// Uso interno del módulo (previewZone, dropImg, paste, y desde tradeManager
// al restaurar imágenes — se exporta por si algún módulo más la necesita).
export function setZoneImg(src, previewId, zoneId) {
  const preview = document.getElementById(previewId);
  const zone = document.getElementById(zoneId);
  const label = zone.querySelector(".img-zone-label");
  preview.src = src;
  preview.classList.add("visible");
  zone.classList.add("has-img");
  if (label) label.style.display = "none";
}

// [window] onclick="clearZone(event, ...)" en el botón "x" de cada zona
export function clearZone(e, previewId, zoneId, inputId, labelId) {
  e.stopPropagation();
  clearZoneManual(previewId, zoneId, inputId, labelId);
}

// Uso interno + llamada desde tradeManager al resetear el form tras guardar
export function clearZoneManual(previewId, zoneId, inputId, labelId) {
  const preview = document.getElementById(previewId);
  const zone = document.getElementById(zoneId);
  const label = document.getElementById(labelId);
  if (preview) {
    preview.src = "";
    preview.classList.remove("visible");
  }
  if (zone) zone.classList.remove("has-img");
  if (label) label.style.display = "block";
  const input = document.getElementById(inputId);
  if (input) input.value = "";
}

// [window] ondragover="dragOver(event, ...)"
export function dragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add("drag");
}

// [window] ondragleave="dragLeave(...)"
export function dragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove("drag");
}

// [window] ondrop="dropImg(event, ...)"
export function dropImg(e, previewId, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (ev) => setZoneImg(ev.target.result, previewId, zoneId);
  reader.readAsDataURL(file);
}

// [window] onclick="verImagenes(id)" — visor doble HTF/LTF (Historial)
export async function verImagenes(id) {
  const t = trades.find((t) => t.id === id || t.id === parseInt(id));
  if (!t) return;
  const htfRef = t.imgHTF || t.img || "";
  const ltfRef = t.imgLTF || "";
  if (!htfRef && !ltfRef) return;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:flex;flex-direction:column;padding:20px;cursor:pointer;align-items:center;justify-content:center";
  overlay.innerHTML = `<div style="color:#888;font-size:12px;font-family:var(--mono)">Cargando capturas…</div>`;
  overlay.onclick = (e) => {
    if (e.target === overlay) document.body.removeChild(overlay);
  };
  document.body.appendChild(overlay);

  // Resolución asíncrona: htfRef/ltfRef pueden ser una clave de
  // IndexedDB (trades nuevos) o una data URL Base64 ya embebida
  // (trades guardados antes de la migración a IndexedDB) —
  // resolveImage() distingue ambos casos de forma transparente.
  const [htf, ltf] = await Promise.all([
    ImageStore.resolveImage(htfRef),
    ImageStore.resolveImage(ltfRef),
  ]);

  if (!document.body.contains(overlay)) return; // el usuario cerró mientras cargaba
  if (!htf && !ltf) {
    overlay.innerHTML = `<div style="color:#c66;font-size:12px;font-family:var(--mono)">No se pudieron cargar las capturas de este trade.</div>`;
    return;
  }

  const header = `<div style="text-align:center;margin-bottom:14px;font-size:12px;color:#aaa;font-family:var(--mono)">${escapeHTML(t.par)} ${escapeHTML(t.dir || "")} · ${escapeHTML(t.res)} · RR ${escapeHTML(t.rr) || "—"} · ${escapeHTML(t.fecha)} <span style="margin-left:12px;font-size:10px;color:#666">Click en imagen para ampliar · Click fuera para cerrar</span></div>`;

  const imgs = `<div style="display:flex;gap:14px;flex:1;align-items:center;justify-content:center;min-height:0">
    ${
      htf
        ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;max-height:100%">
      <div style="font-size:10px;color:#888;font-family:var(--mono);margin-bottom:6px;letter-spacing:1px">TEMPORALIDAD MAYOR</div>
      <img src="${escapeHTML(htf)}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;cursor:zoom-in;border:1px solid #333" onclick="expandImg(this,event)" alt="HTF">
    </div>`
        : ""
    }
    ${htf && ltf ? `<div style="width:1px;background:#333;align-self:stretch"></div>` : ""}
    ${
      ltf
        ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;max-height:100%">
      <div style="font-size:10px;color:#888;font-family:var(--mono);margin-bottom:6px;letter-spacing:1px">TEMPORALIDAD MENOR</div>
      <img src="${escapeHTML(ltf)}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;cursor:zoom-in;border:1px solid #333" onclick="expandImg(this,event)" alt="LTF">
    </div>`
        : ""
    }
  </div>`;

  overlay.style.alignItems = "";
  overlay.style.justifyContent = "";
  overlay.innerHTML = header + imgs;
  overlay.onclick = (e) => {
    if (e.target === overlay || e.target.tagName !== "IMG") {
      document.body.removeChild(overlay);
    }
  };
}

// [window] onclick="expandImg(this,event)" — inyectado dentro del HTML
// generado por verImagenes(), por eso TIENE que estar en window.
export function expandImg(img, e) {
  e.stopPropagation();
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.97);z-index:1001;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:16px";
  overlay.innerHTML = `<img src="${img.src}" style="max-width:100%;max-height:95vh;object-fit:contain;border-radius:8px">`;
  overlay.onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
}

// [window] onclick="toggleImgFull(this)" — screenshot de journal (legacy)
export function toggleImgFull(img) {
  if (img.style.maxHeight === "none") {
    img.style.maxHeight = "300px";
  } else {
    img.style.maxHeight = "none";
  }
}

// [window] onclick="verImagen(id)" — visor de imagen única (legacy, t.img)
export async function verImagen(id) {
  const t = trades.find((t) => t.id === id || t.id === parseInt(id));
  if (!t || !t.img) return;
  const src = await ImageStore.resolveImage(t.img);
  if (!src) return;
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:20px";
  overlay.innerHTML = `
    <div style="position:relative;max-width:95vw;max-height:95vh">
      <img src="${escapeHTML(src)}" style="max-width:100%;max-height:90vh;border-radius:10px;object-fit:contain;display:block">
      <div style="text-align:center;margin-top:10px;font-size:11px;color:#888;font-family:var(--mono)">${escapeHTML(t.par)} ${escapeHTML(t.dir)} &middot; ${escapeHTML(t.res)} &middot; ${escapeHTML(t.fecha)} &middot; Click para cerrar</div>
    </div>`;
  overlay.onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
}

/**
 * Registra el listener de "pegar" (Ctrl+V) que llena las zonas HTF/LTF
 * del formulario de registro con una imagen del portapapeles. Se expone
 * como función (no se ejecuta solo al importar el módulo) para que
 * main.js decida explícitamente cuándo activarla.
 */
export function initPasteHandler() {
  document.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      const reader = new FileReader();
      const page = document.querySelector(".page.active");
      if (!page) return;
      const isRegistrar = page.id === "page-registrar";
      if (!isRegistrar) return;
      reader.onload = (ev) => {
        const htfPreview = document.getElementById("t-img-htf-preview");
        const ltfPreview = document.getElementById("t-img-ltf-preview");
        if (!htfPreview.src || htfPreview.src === window.location.href) {
          setZoneImg(ev.target.result, "t-img-htf-preview", "zone-htf");
        } else if (!ltfPreview.src || ltfPreview.src === window.location.href) {
          setZoneImg(ev.target.result, "t-img-ltf-preview", "zone-ltf");
        } else {
          setZoneImg(ev.target.result, "t-img-htf-preview", "zone-htf");
        }
      };
      reader.readAsDataURL(file);
      break;
    }
  });
}
