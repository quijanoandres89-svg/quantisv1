/* ============================================================
   AVATAR — foto de perfil: componente único + recorte + subida.
   ------------------------------------------------------------
   1) avatarHTML(perfil, tamaño): UN solo componente para todo el
      proyecto (sidebar, Configuración, Administración, Salas...).
      Siempre pinta la inicial con un color propio de cada usuario y,
      si hay foto, la imagen va encima con object-fit: cover. Si la
      imagen falla (404, sin red), se quita sola y queda la inicial.
      El tamaño sale de una clase (.avatar-xs/sm/md/lg/xl), así que
      ninguna foto se ve deformada ni desproporcionada: siempre es un
      círculo con la foto recortada a cuadrado.
   2) openAvatarPicker(): elegir archivo → ajustar (arrastrar +
      zoom) → se exporta a 256x256 WebP (~15-30 KB) → se sube a
      Storage (avatars/<uid>/avatar.webp) → update_my_avatar() guarda
      la URL en profiles. Ver supabase_avatars_setup.sql.
   Este módulo NO importa admin.js ni auth.js (evita ciclos): avisa
   del cambio con el evento "quantis:profile-patch", que admin.js
   escucha para refrescar sidebar y Configuración.
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";
import { escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";

const BUCKET = "avatars";
const OUT_SIZE = 256; // px del archivo final
const STAGE = 240; // px del recuadro de recorte en pantalla
const MAX_INPUT_BYTES = 10 * 1024 * 1024; // tope de la foto original

/* ---------------- Componente ---------------- */

function hueFor(seed) {
  let h = 0;
  for (const ch of String(seed || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/** perfil: { id, display_name, email, avatar_url } — todo opcional.
 * size: "xs" | "sm" | "md" | "lg" | "xl". */
export function avatarHTML(p, size = "md", extraClass = "") {
  const name = String(p?.display_name || p?.email || "?").trim();
  const initial = (Array.from(name)[0] || "?").toUpperCase();
  const hue = hueFor(p?.id || p?.email || name);
  const url =
    typeof p?.avatar_url === "string" && /^https:\/\//.test(p.avatar_url)
      ? p.avatar_url
      : "";
  const img = url
    ? `<img src="${escapeHTML(url)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`
    : "";
  return `<span class="avatar avatar-${size} ${extraClass}" style="--av-h:${hue}">${escapeHTML(initial)}${img}</span>`;
}

/** Bloque "foto + botones" de Configuración → Perfil. */
export function profileAvatarRowHTML(p) {
  const has = !!p?.avatar_url;
  return `<div class="profile-avatar-row">
    ${avatarHTML(p, "xl")}
    <div class="profile-avatar-actions">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-sm btn-p" onclick="openAvatarPicker()"><span class="material-symbols-outlined">photo_camera</span>${has ? "Cambiar foto" : "Subir foto"}</button>
        ${has ? `<button class="btn btn-sm btn-d" onclick="removeMyAvatar()"><span class="material-symbols-outlined">delete</span>Quitar</button>` : ""}
      </div>
      <div class="profile-avatar-hint">JPG, PNG o WebP. Se recorta en círculo y se reduce sola.</div>
    </div>
  </div>`;
}

function announce(patch) {
  document.dispatchEvent(new CustomEvent("quantis:profile-patch", { detail: patch }));
}

/* ---------------- Subir / quitar ---------------- */

export async function uploadAvatar(blob) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No hay sesión activa");
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/avatar.${ext}`;
  const supabase = await getSupabase();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: "3600" });
  if (error) throw error;
  // Si antes había una foto en el otro formato, se borra para no dejar huérfanos.
  const other = ext === "webp" ? "jpg" : "webp";
  supabase.storage
    .from(BUCKET)
    .remove([`${user.id}/avatar.${other}`])
    .then(
      () => {},
      () => {},
    );
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // ?v= fuerza a navegadores y CDN a pedir la foto nueva (misma ruta, otro contenido).
  const url = `${data.publicUrl}?v=${Date.now()}`;
  const { error: e2 } = await supabase.rpc("update_my_avatar", { new_url: url });
  if (e2) throw e2;
  announce({ avatar_url: url });
}

// [window] onclick="removeMyAvatar()" en Configuración → Perfil
export async function removeMyAvatar() {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const supabase = await getSupabase();
    await supabase.storage
      .from(BUCKET)
      .remove([`${user.id}/avatar.webp`, `${user.id}/avatar.jpg`]);
    const { error } = await supabase.rpc("update_my_avatar", { new_url: null });
    if (error) throw error;
    announce({ avatar_url: null });
    showToast("success", "Foto eliminada", "Volverás a ver tu inicial.");
  } catch (e) {
    showToast("error", "No se pudo quitar la foto", e.message);
  }
}

/* ---------------- Selector + recorte ---------------- */

// [window] onclick="openAvatarPicker()" en Configuración → Perfil
export function openAvatarPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const f = input.files && input.files[0];
    if (f) openCropper(f);
  };
  input.click();
}

function loadImageFallback(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = url;
  });
}

function canvasToBlob(canvas, type, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

async function openCropper(file) {
  if (!file.type.startsWith("image/")) {
    showToast("error", "Archivo no válido", "Elige una imagen (JPG, PNG o WebP).");
    return;
  }
  if (file.size > MAX_INPUT_BYTES) {
    showToast("error", "Imagen muy pesada", "Elige una foto de menos de 10 MB.");
    return;
  }
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      bmp = await loadImageFallback(file);
    } catch {
      showToast("error", "No se pudo leer la imagen", "Prueba con otro archivo (JPG, PNG o WebP).");
      return;
    }
  }
  const w = bmp.width;
  const h = bmp.height;
  const minScale = STAGE / Math.min(w, h); // con esto la foto siempre cubre el círculo
  let scale = minScale;
  let cx = w / 2; // punto de la imagen que está en el centro del recuadro
  let cy = h / 2;

  const overlay = document.createElement("div");
  overlay.className = "modal-bg open";
  overlay.id = "avatar-cropper";
  overlay.innerHTML = `
    <div class="modal" style="max-width:340px;width:92vw">
      <div class="modal-title">Ajusta tu foto</div>
      <div class="crop-stage" id="crop-stage"><canvas id="crop-canvas" width="${STAGE}" height="${STAGE}"></canvas></div>
      <div class="crop-hint">Arrastra para encuadrar</div>
      <div class="crop-zoom-row">
        <span class="material-symbols-outlined">zoom_out</span>
        <input type="range" id="crop-zoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom" />
        <span class="material-symbols-outlined">zoom_in</span>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm" id="crop-cancel">Cancelar</button>
        <button class="btn btn-sm btn-p" id="crop-save">Guardar foto</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const stage = overlay.querySelector("#crop-stage");
  const canvas = overlay.querySelector("#crop-canvas");
  const ctx = canvas.getContext("2d");
  const zoomEl = overlay.querySelector("#crop-zoom");
  const saveBtn = overlay.querySelector("#crop-save");

  function clamp() {
    const half = STAGE / 2 / scale;
    cx = Math.min(w - half, Math.max(half, cx));
    cy = Math.min(h - half, Math.max(half, cy));
  }
  function draw(c, size, bg) {
    const k = size / STAGE;
    c.clearRect(0, 0, size, size);
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, size, size);
    }
    c.imageSmoothingQuality = "high";
    c.drawImage(bmp, (STAGE / 2 - cx * scale) * k, (STAGE / 2 - cy * scale) * k, w * scale * k, h * scale * k);
  }
  clamp();
  draw(ctx, STAGE);

  let drag = null;
  stage.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    cx -= (e.clientX - drag.x) / scale;
    cy -= (e.clientY - drag.y) / scale;
    drag = { x: e.clientX, y: e.clientY };
    clamp();
    draw(ctx, STAGE);
  });
  const endDrag = () => (drag = null);
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  zoomEl.addEventListener("input", () => {
    scale = minScale * parseFloat(zoomEl.value);
    clamp();
    draw(ctx, STAGE);
  });

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };
  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (bmp.close) bmp.close();
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#crop-cancel").onclick = close;

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.classList.add("is-loading");
    saveBtn.innerHTML = `<span class="spinner"></span> Guardando…`;
    try {
      const out = document.createElement("canvas");
      out.width = out.height = OUT_SIZE;
      const octx = out.getContext("2d");
      draw(octx, OUT_SIZE);
      let blob = await canvasToBlob(out, "image/webp", 0.86);
      if (!blob || blob.type !== "image/webp") {
        // Navegador sin export WebP: JPEG con fondo sólido (JPEG no tiene transparencia).
        draw(octx, OUT_SIZE, "#ffffff");
        blob = await canvasToBlob(out, "image/jpeg", 0.88);
      }
      await uploadAvatar(blob);
      showToast("success", "Foto actualizada", "Ya se ve en tu perfil y en las salas.");
      close();
    } catch (e) {
      saveBtn.disabled = false;
      saveBtn.classList.remove("is-loading");
      saveBtn.textContent = "Guardar foto";
      showToast("error", "No se pudo subir la foto", e.message);
    }
  };
}
