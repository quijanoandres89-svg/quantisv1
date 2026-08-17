/* ============================================================
   IMAGE STORE — capturas de pantalla de los trades.
   ------------------------------------------------------------
   Corrige el hallazgo 🔴 Crítico de la auditoría: las capturas se
   guardaban como Base64 directo dentro de cada trade, y el array
   completo de trades se serializaba en localStorage — que tiene un
   límite típico de 5-10MB por origen, no configurable. Con una
   captura por trade, entre 10 y 30 trades ya podían agotar la cuota,
   y como saveTrades() no tenía manejo de error, el trade nuevo se
   perdía en silencio.

   IndexedDB no tiene ese límite práctico (cientos de MB a varios GB
   según navegador/disco) y está diseñado para blobs grandes — a
   diferencia de localStorage, que es texto plano síncrono.

   Los trades ahora guardan solo una CLAVE (string corto) en los
   campos imgHTF/imgLTF, no la imagen completa. La imagen real vive
   acá, y se resuelve de forma asíncrona (getImage) solo cuando hay
   que mostrarla (visor de imágenes), no en cada guardado/carga de
   trades.

   Compatibilidad con datos viejos: trades guardados ANTES de esta
   migración siguen teniendo la imagen completa en Base64 (empieza
   con "data:") directo en imgHTF/imgLTF/img — isImageKey() distingue
   ambos casos, así que no hace falta migrar datos existentes a la
   fuerza; conviven los dos formatos.
   ------------------------------------------------------------
   SINCRONIZACIÓN CON SUPABASE STORAGE (multi-PC):
   IndexedDB es 100% local a este navegador — nunca viajaba entre
   equipos, ni siquiera después de migrar los DATOS a Supabase (los
   trades solo llevan la clave, no la imagen). Ahora, además de
   guardar en IndexedDB (rápido, funciona sin internet), cada imagen
   se sube en segundo plano a Supabase Storage bajo una carpeta
   privada por usuario (trade-images/<user_id>/<clave>). Al pedir una
   imagen que no está en este navegador (por ejemplo, un trade creado
   en otro PC), se descarga sola desde ahí y se cachea localmente
   para la próxima vez.
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";

const DB_NAME = "quantis_images_db";
const STORE_NAME = "images";
const DB_VERSION = 1;
const BUCKET = "trade-images";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("Este navegador no soporta IndexedDB."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/* ============================================================
UTILIDADES data URL <-> Blob (Storage guarda bytes, no texto)
============================================================ */

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = (header.match(/data:(.*);base64/) || [])[1] || "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/* ============================================================
NUBE (Supabase Storage) — todo "best effort": si falla (sin
internet, etc.) el guardado LOCAL ya se completó y no se pierde
nada; solo no queda disponible todavía en otros equipos.
============================================================ */

async function uploadToCloud(key, dataUrl) {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const supabase = await getSupabase();
    const blob = dataUrlToBlob(dataUrl);

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${user.id}/${key}`, blob, { upsert: true, contentType: blob.type });

    if (error) throw error;
  } catch (e) {
    console.warn(`QUANTIS: no se pudo subir la imagen "${key}" a Supabase Storage:`, e);
  }
}

async function downloadFromCloud(key) {
  try {
    const user = await getCurrentUser();
    if (!user) return null;

    const supabase = await getSupabase();
    const { data, error } = await supabase.storage.from(BUCKET).download(`${user.id}/${key}`);

    if (error || !data) return null;

    return await blobToDataUrl(data);
  } catch (e) {
    console.warn(`QUANTIS: no se pudo descargar la imagen "${key}" de Supabase Storage:`, e);
    return null;
  }
}

async function deleteFromCloud(key) {
  try {
    const user = await getCurrentUser();
    if (!user) return;

    const supabase = await getSupabase();
    await supabase.storage.from(BUCKET).remove([`${user.id}/${key}`]);
  } catch (e) {
    console.warn(`QUANTIS: no se pudo borrar la imagen "${key}" de Supabase Storage:`, e);
  }
}

async function deleteAllFromCloud() {
  try {
    const user = await getCurrentUser();
    if (!user) return true;

    const supabase = await getSupabase();
    const { data: files, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(user.id, { limit: 1000 });

    if (listError) throw listError;
    if (!files || files.length === 0) return true;

    const paths = files.map((f) => `${user.id}/${f.name}`);
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths);

    if (removeError) throw removeError;
    return true;
  } catch (e) {
    console.warn("QUANTIS: no se pudieron borrar las imágenes en Supabase Storage:", e);
    return false;
  }
}

/** Borra TODAS las imágenes de una sola vez (elimina la base de datos
 * completa), no una por una. Uso: "Restablecer QUANTIS" en
 * Configuración — un reset que solo limpiara localStorage y dejara
 * las capturas de pantalla huérfanas en IndexedDB reproduciría, en
 * reversa, el mismo problema de espacio que la migración a IndexedDB
 * vino a resolver (hallazgo 🔴 Crítico de la auditoría). También
 * borra la copia en la nube — si no, "restablecer" dejaría las
 * imágenes viejas esperando a que algún otro PC las vuelva a bajar. */
export async function deleteAllImages() {
  const cloudOk = await deleteAllFromCloud();

  try {
    // Si ya había una conexión abierta, hay que cerrarla antes de
    // borrar la base — si no, el navegador demora el borrado
    // (evento "blocked") hasta que se cierre solo, lo cual puede
    // nunca pasar dentro de la misma pestaña.
    if (dbPromise) {
      const db = await dbPromise;
      db.close();
      dbPromise = null;
    }
    const localOk = await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve(true); // se completará solo al recargar
    });
    return localOk && cloudOk;
  } catch (e) {
    console.error("No se pudieron borrar las imágenes de IndexedDB:", e);
    return false;
  }
}

/** Genera una clave corta y única para una imagen nueva. No es el dato
 * de la imagen — es solo la referencia que se guarda en el trade. */
export function newImageKey() {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** true si el valor es una referencia a IndexedDB (clave nuestra),
 * false si es una imagen vieja embebida directo como Base64
 * ("data:image/..."). Así el resto de la app puede seguir mostrando
 * trades guardados antes de esta migración sin ningún cambio de datos. */
export function isImageKey(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("data:");
}

/** Guarda una imagen (data URL) bajo una clave: local en IndexedDB
 * (inmediato, define el true/false que se devuelve) y en paralelo a
 * Supabase Storage (en segundo plano, no bloquea ni afecta el
 * resultado — mismo patrón que syncStateToServer() en state.js). */
export async function saveImage(key, dataUrl) {
  if (!key || !dataUrl) return false;

  uploadToCloud(key, dataUrl); // fire-and-forget, a propósito sin await

  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(dataUrl, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(`No se pudo guardar la imagen (clave: ${key}) en IndexedDB:`, e);
    return false;
  }
}

/** Recupera una imagen por su clave. Primero busca en este navegador
 * (IndexedDB, inmediato); si no está (por ejemplo, un trade creado en
 * otro PC), la baja de Supabase Storage y la cachea localmente para
 * la próxima vez. Devuelve null si no existe en ningún lado o si
 * falla la lectura (nunca lanza, para que un visor de imágenes no
 * rompa toda la página por una imagen faltante/corrupta). */
export async function getImage(key) {
  if (!key) return null;

  let local = null;
  try {
    const db = await openDB();
    local = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.error(`No se pudo leer la imagen (clave: ${key}) de IndexedDB:`, e);
  }

  if (local) return local;

  const fromCloud = await downloadFromCloud(key);
  if (fromCloud) {
    // Cachear localmente para no tener que volver a descargarla.
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(fromCloud, key);
    } catch (e) {
      // No es crítico si el cacheo local falla; ya tenemos la imagen para mostrar.
    }
    return fromCloud;
  }

  return null;
}

/** Elimina una imagen por su clave, local y en la nube. */
export async function deleteImage(key) {
  if (!key) return false;

  deleteFromCloud(key); // fire-and-forget

  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error(`No se pudo borrar la imagen (clave: ${key}) de IndexedDB:`, e);
    return false;
  }
}

/** Resuelve un campo de imagen de un trade (imgHTF/imgLTF/img) a una
 * data URL mostrable, sin importar si es una clave nueva (IndexedDB /
 * Supabase Storage) o una imagen vieja embebida en Base64. Punto
 * único de resolución — los visores de imagen lo usan en vez de
 * decidir cada uno por su cuenta cuál formato es. */
export async function resolveImage(value) {
  if (!value) return "";
  if (isImageKey(value)) return (await getImage(value)) || "";
  return value; // ya es una data URL (trade guardado antes de esta migración)
}

