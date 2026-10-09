/* ============================================================
   ROOM FILES — imágenes y PDF en el chat de las salas.
   ------------------------------------------------------------
   - Las imágenes se reducen en el navegador (máx. 1600 px, WebP)
     ANTES de subirlas: una captura de pantalla de 3 MB queda en
     ~150-300 KB, así Storage no se llena.
   - Los PDF se suben tal cual (tope 10 MB).
   - Bucket PRIVADO "room-files": cada archivo se ve con una URL
     firmada de 1 hora que solo se entrega a admin/miembros
     aprobados de la sala (ver supabase_room_files_setup.sql).
   - Ruta: <room_id>/<user_id>/<nombre-único>. El nombre original
     NO va en la ruta (se guarda aparte en el mensaje), así no hay
     problemas con tildes, espacios ni caracteres raros.
   - Todo se borra cuando la sala se borra (cleanup-rooms, cada
     medianoche de Colombia, o al eliminarla a mano).
   ============================================================ */

import { getSupabase } from "./supabaseClient.js";
import { escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";

const BUCKET = "room-files";
const MAX_IMAGE_INPUT = 20 * 1024 * 1024; // foto original (antes de comprimir)
const MAX_PDF = 10 * 1024 * 1024;
const MAX_DIM = 1600;
const SIGN_SECONDS = 3600;

const urlCache = new Map(); // ruta -> { url, exp }

export const fmtSize = (n) =>
  n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/* ---------------- Preparar (validar + comprimir) ---------------- */

function canvasToBlob(canvas, type, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, q));
}

async function decodeImage(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode"));
      img.src = URL.createObjectURL(file);
    });
  }
}

/** Devuelve { blob, name, type, size, kind } o lanza Error con mensaje para el usuario. */
export async function prepareFile(file, { imagesOnly = false } = {}) {
  const isPdf = file.type === "application/pdf";
  const isImg = /^image\/(png|jpe?g|webp)$/.test(file.type);
  if (imagesOnly ? !isImg : !isPdf && !isImg) {
    throw new Error(imagesOnly ? "Solo se pueden subir imágenes (PNG, JPG o WebP)." : "Solo se pueden enviar imágenes (PNG, JPG, WebP) o PDF.");
  }
  if (isPdf) {
    if (file.size > MAX_PDF) throw new Error("El PDF pesa más de 10 MB.");
    return { blob: file, name: file.name || "documento.pdf", type: "application/pdf", size: file.size, kind: "pdf" };
  }
  if (file.size > MAX_IMAGE_INPUT) throw new Error("La imagen pesa más de 20 MB.");
  let bmp;
  try {
    bmp = await decodeImage(file);
  } catch {
    throw new Error("No se pudo leer la imagen. Prueba con otro archivo.");
  }
  const k = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  let blob = await canvasToBlob(canvas, "image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") {
    // Navegador sin export WebP: JPEG con fondo blanco (JPEG no tiene transparencia)
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    blob = await canvasToBlob(canvas, "image/jpeg", 0.88);
  }
  // Si la imagen ya cabía en 1600 px y la original pesa menos que la versión
  // recomprimida (PNG simples, imágenes ya optimizadas), se sube la original:
  // re-comprimir no debe agrandar el archivo.
  if (k === 1 && file.size <= blob.size) {
    return { blob: file, name: (file.name || "imagen").slice(0, 120), type: file.type, size: file.size, kind: "image" };
  }
  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const base = (file.name || "imagen").replace(/\.[^.]+$/, "").slice(0, 60) || "imagen";
  // Las capturas pegadas del portapapeles llegan siempre como "image.png": se renombran.
  const name = /^image$/i.test(base) ? `captura-${new Date().toTimeString().slice(0, 5).replace(":", "-")}.${ext}` : `${base}.${ext}`;
  return { blob, name, type: blob.type, size: blob.size, kind: "image" };
}

/* ---------------- Subir ---------------- */

export async function uploadRoomFile(roomId, userId, prepared) {
  const ext = extFor(prepared.type);
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${roomId}/${userId}/${unique}.${ext}`;
  const supabase = await getSupabase();
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, prepared.blob, { contentType: prepared.type, cacheControl: "3600", upsert: false });
  if (error) throw error;
  return {
    attachment_path: path,
    attachment_name: prepared.name.slice(0, 120),
    attachment_type: prepared.type,
    attachment_size: prepared.size,
  };
}

/* ---------------- URLs firmadas ---------------- */

/** URLs firmadas (1 h) de varias rutas de un bucket, con caché. Devuelve un array en el mismo orden. */
export async function getSignedUrls(paths, bucket = BUCKET) {
  const now = Date.now();
  const key = (p) => `${bucket}:${p}`;
  const missing = paths.filter((p) => !(urlCache.get(key(p))?.exp > now));
  if (missing.length) {
    const supabase = await getSupabase();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(missing, SIGN_SECONDS);
    if (error) throw error;
    for (const item of data || []) {
      if (item.signedUrl) urlCache.set(key(item.path), { url: item.signedUrl, exp: now + (SIGN_SECONDS - 300) * 1000 });
    }
  }
  return paths.map((p) => urlCache.get(key(p))?.url || null);
}
const signedUrls = (paths) => getSignedUrls(paths, BUCKET);

/** Sube una imagen ya preparada (prepareFile) a la ruta indicada de cualquier bucket. */
export async function uploadPreparedTo(bucket, path, prepared) {
  const supabase = await getSupabase();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, prepared.blob, { contentType: prepared.type, cacheControl: "3600", upsert: false });
  if (error) throw error;
  return path;
}

/** Extensión para la ruta según el tipo del archivo preparado. */
export const extFor = (type) =>
  type === "application/pdf" ? "pdf" : type === "image/webp" ? "webp" : type === "image/png" ? "png" : "jpg";

/* ---------------- Pintar adjuntos ---------------- */

const icon = (n) => `<span class="material-symbols-outlined">${n}</span>`;

/** HTML del adjunto de un mensaje ("" si no tiene). Las URLs reales se
 * piden después, en lote, con hydrateAttachments(). */
export function attachmentHTML(m) {
  if (!m.attachment_path) return "";
  const path = escapeHTML(m.attachment_path);
  const name = escapeHTML(m.attachment_name || "archivo");
  if (m.attachment_type === "application/pdf") {
    return `<button class="chat-file" data-path="${path}" onclick="openRoomFile(this.dataset.path)">
      ${icon("picture_as_pdf")}
      <span class="chat-file-info"><span class="chat-file-name">${name}</span><span class="chat-file-size">PDF · ${fmtSize(m.attachment_size || 0)}</span></span>
      ${icon("open_in_new")}
    </button>`;
  }
  return `<img class="chat-img" data-path="${path}" data-name="${name}" alt="${name}" onclick="openRoomImage(this.dataset.path, this.dataset.name)" />`;
}

/** Pide las URLs firmadas de todas las imágenes sin cargar y las asigna. */
export async function hydrateAttachments(container) {
  if (!container) return;
  const imgs = [...container.querySelectorAll("img.chat-img:not([src])")];
  if (!imgs.length) return;
  try {
    const urls = await signedUrls(imgs.map((i) => i.dataset.path));
    imgs.forEach((img, i) => {
      if (!urls[i]) return;
      const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      // Al cargar la imagen cambia la altura del chat: si estabas abajo, sigues abajo.
      img.addEventListener(
        "load",
        () => {
          if (nearBottom) container.scrollTop = container.scrollHeight;
        },
        { once: true },
      );
      img.addEventListener("error", () => img.classList.add("chat-img-broken"), { once: true });
      img.src = urls[i];
    });
  } catch {
    imgs.forEach((i) => i.classList.add("chat-img-broken"));
  }
}

/* ---------------- Abrir ---------------- */

// [window] onclick="openRoomFile(path)" — PDF en pestaña nueva
export async function openRoomFile(path) {
  try {
    const [url] = await signedUrls([path]);
    if (!url) throw new Error("No se pudo generar el enlace");
    window.open(url, "_blank", "noopener");
  } catch (e) {
    showToast("error", "No se pudo abrir el archivo", e.message);
  }
}

/** Muestra una imagen ampliada con botón de descargar. La usan Salas y Perspectivas. */
export function showLightbox(url, name = "imagen") {
  closeRoomLightbox();
  const box = document.createElement("div");
  box.className = "lightbox";
  box.id = "room-lightbox";
  box.innerHTML = `
    <img src="${escapeHTML(url)}" alt="${escapeHTML(name)}" />
    <div class="lightbox-bar">
      <a class="btn btn-sm" href="${escapeHTML(url)}" download="${escapeHTML(name)}" target="_blank" rel="noopener">${icon("download")} Descargar</a>
      <button class="btn btn-sm btn-icon" aria-label="Cerrar" onclick="closeRoomLightbox()">${icon("close")}</button>
    </div>`;
  box.addEventListener("mousedown", (e) => {
    if (e.target === box) closeRoomLightbox();
  });
  document.body.appendChild(box);
  document.addEventListener("keydown", onLightboxKey);
}

// [window] onclick="openRoomImage(path, name)" — imagen del chat ampliada
export async function openRoomImage(path, name = "imagen") {
  try {
    const [url] = await signedUrls([path]);
    if (!url) throw new Error("No se pudo generar el enlace");
    showLightbox(url, name);
  } catch (e) {
    showToast("error", "No se pudo abrir la imagen", e.message);
  }
}

function onLightboxKey(e) {
  if (e.key === "Escape") closeRoomLightbox();
}

// [window] onclick="closeRoomLightbox()"
export function closeRoomLightbox() {
  document.removeEventListener("keydown", onLightboxKey);
  document.getElementById("room-lightbox")?.remove();
}

/* ---------------- Borrar los archivos de una sala ---------------- */

async function listAll(supabase, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: 100, offset });
    if (error) throw error;
    if (!data || !data.length) break;
    for (const it of data) {
      const p = `${prefix}/${it.name}`;
      if (it.id === null) out.push(...(await listAll(supabase, p)));
      else out.push(p);
    }
    if (data.length < 100) break;
  }
  return out;
}

/** Borra TODOS los archivos de una sala (la llama deleteRoom). Mejor
 * esfuerzo: si falla, el barrido de medianoche limpia lo que quede. */
export async function purgeRoomFiles(roomId) {
  try {
    const supabase = await getSupabase();
    const files = await listAll(supabase, roomId);
    for (let i = 0; i < files.length; i += 100) {
      await supabase.storage.from(BUCKET).remove(files.slice(i, i + 100));
    }
  } catch {
    /* lo recoge cleanup-rooms */
  }
}
