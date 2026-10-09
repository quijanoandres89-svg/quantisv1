/* ============================================================
   PERSPECTIVAS — muro de la comunidad de Quantis.
   ------------------------------------------------------------
   Todos los usuarios con cuenta pueden publicar su perspectiva del
   día, un trade ganador o lo que ven en sesión (texto + 1 imagen
   opcional, par opcional) y dar "me gusta". El muro es de UN mes:
   el día 1 a las 00:00 (hora de Colombia) todo se borra y empieza en
   blanco — lo hace cleanup-perspectives (Edge Function + pg_cron).
   Además, este módulo SOLO pide publicaciones del mes en curso, así
   que a las 00:00 del día 1 el muro ya se ve vacío aunque el borrado
   todavía no haya corrido.
   Las imágenes se comprimen en el navegador (reutiliza roomFiles.js),
   viven en el bucket privado "perspectives" (carpeta aaaa-mm/<user>/)
   y se ven con URLs firmadas.
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";
import { escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";
import { avatarHTML } from "./avatar.js";
import { getMyRole } from "./admin.js";
import { renderAllInstrumentSelects } from "./instruments.js";
import { prepareFile, getSignedUrls, uploadPreparedTo, extFor, showLightbox, fmtSize } from "./roomFiles.js";

const BUCKET = "perspectives";
const TZ = "America/Bogota";
const PAGE = 30;
const MAX_CHARS = 1000;

const KINDS = {
  perspectiva: { label: "Perspectiva del día", short: "Perspectiva", icon: "insights", cls: "k-persp" },
  trade_ganador: { label: "Trade ganador", short: "Trade ganador", icon: "emoji_events", cls: "k-win" },
  en_sesion: { label: "En sesión", short: "En sesión", icon: "sensors", cls: "k-live" },
};

let myUserId = null;
let posts = []; // publicaciones cargadas (más nuevas primero)
let likes = new Map(); // post_id -> { count, mine }
let authors = new Map(); // user_id -> perfil
let hasMore = false;
let kindFilter = "";
let pairFilter = "";
let composerKind = "perspectiva";
let pending = null; // { prepared, previewUrl }
let publishing = false;
let newCount = 0; // publicaciones de otros que llegaron mientras mirabas el muro
let channel = null;
const pairsSeen = new Set();

/* ---------------- Fechas (hora de Colombia) ---------------- */

const bogotaMonth = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7); // aaaa-mm
const monthStartISO = () => new Date(`${bogotaMonth()}-01T00:00:00-05:00`).toISOString();

function nextMonthStart() {
  const [y, m] = bogotaMonth().split("-").map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00-05:00`);
}

function timeAgo(iso) {
  const d = new Date(iso);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return d.toLocaleString("es-CO", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

const fullDate = (iso) =>
  new Date(iso).toLocaleString("es-CO", { timeZone: TZ, dateStyle: "full", timeStyle: "short" });

const icon = (n) => `<span class="material-symbols-outlined">${n}</span>`;

/* ---------------- Datos ---------------- */

async function ensureAuthors(ids) {
  const missing = [...new Set(ids)].filter((id) => !authors.has(id));
  if (!missing.length) return;
  const supabase = await getSupabase();
  const { data } = await supabase.from("profiles").select("id, display_name, email, avatar_url").in("id", missing);
  (data || []).forEach((p) => authors.set(p.id, p));
}

async function loadLikes(ids) {
  if (!ids.length) return;
  const supabase = await getSupabase();
  const { data } = await supabase.from("perspective_likes").select("perspective_id, user_id").in("perspective_id", ids);
  for (const id of ids) likes.set(id, { count: 0, mine: false });
  (data || []).forEach((l) => {
    const e = likes.get(l.perspective_id);
    if (!e) return;
    e.count++;
    if (l.user_id === myUserId) e.mine = true;
  });
}

async function fetchPage(offset) {
  const supabase = await getSupabase();
  let q = supabase
    .from("perspectives")
    .select("*")
    .gte("created_at", monthStartISO()) // solo el mes en curso
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE - 1);
  if (kindFilter) q = q.eq("kind", kindFilter);
  if (pairFilter) q = q.eq("pair", pairFilter);
  const { data, error } = await q;
  if (error) throw error;
  const rows = data || [];
  await Promise.all([ensureAuthors(rows.map((r) => r.user_id)), loadLikes(rows.map((r) => r.id))]);
  rows.forEach((r) => r.pair && pairsSeen.add(r.pair));
  return rows;
}

/* ---------------- Pantalla ---------------- */

export async function renderPerspectives() {
  const user = await getCurrentUser();
  if (!user) return;
  myUserId = user.id;
  renderShell();
  newCount = 0;
  await reload();
  subscribe();
}

function renderShell() {
  const root = document.getElementById("persp-root");
  if (!root) return;
  const daysLeft = Math.max(0, Math.ceil((nextMonthStart().getTime() - Date.now()) / 864e5));
  const nextName = nextMonthStart().toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric", month: "long" });
  root.innerHTML = `
    <div class="persp-banner">${icon("event_repeat")}<span>El muro se reinicia el <b>${escapeHTML(nextName)}</b> (${daysLeft === 0 ? "hoy" : daysLeft === 1 ? "en 1 día" : `en ${daysLeft} días`}). Las publicaciones del mes anterior se borran.</span></div>

    <div class="card persp-composer">
      <div class="seg" id="persp-kinds">${Object.entries(KINDS)
        .map(([k, v]) => `<button class="seg-item ${k === composerKind ? "active" : ""}" onclick="setPerspKind('${k}')">${v.label}</button>`)
        .join("")}</div>
      <textarea id="persp-text" maxlength="${MAX_CHARS}" placeholder="¿Qué estás viendo en el mercado? Comparte tu perspectiva, tu trade o lo que pasa en sesión..." oninput="onPerspInput()" onpaste="handlePerspPaste(event)" onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){publishPerspective()}"></textarea>
      <div id="persp-pending" class="room-chat-pending" style="display:none"></div>
      <div class="persp-composer-bar">
        <select id="persp-pair" class="instrument-select" data-empty-label="Par (opcional)"></select>
        <button class="btn btn-sm btn-g" onclick="pickPerspImage()">${icon("image")} Imagen</button>
        <input type="file" id="persp-file" accept="image/*" style="display:none" onchange="onPerspImageChosen(this)" />
        <span class="persp-count" id="persp-count">0 / ${MAX_CHARS}</span>
        <button class="btn btn-p" id="persp-publish" onclick="publishPerspective()">Publicar</button>
      </div>
    </div>

    <div class="persp-filters">
      <div class="seg" id="persp-kind-filter"></div>
      <select id="persp-pair-filter" onchange="filterPerspPair(this.value)"></select>
    </div>

    <div id="persp-newpill" style="display:none"></div>
    <div id="persp-feed"></div>
    <div id="persp-more" style="text-align:center;margin:14px 0"></div>`;
  // Repuebla el selector de pares con la lista de instrumentos del usuario (mecanismo del resto de la app).
  renderAllInstrumentSelects();
  renderKindFilter();
  renderPairFilter();
}

function renderKindFilter() {
  const el = document.getElementById("persp-kind-filter");
  if (!el) return;
  const items = [["", "Todo"], ...Object.entries(KINDS).map(([k, v]) => [k, v.short])];
  el.innerHTML = items
    .map(([k, label]) => `<button class="seg-item ${k === kindFilter ? "active" : ""}" onclick="filterPerspKind('${k}')">${label}</button>`)
    .join("");
}

function renderPairFilter() {
  const el = document.getElementById("persp-pair-filter");
  if (!el) return;
  el.innerHTML =
    `<option value="">Todos los pares</option>` +
    [...pairsSeen]
      .sort()
      .map((p) => `<option value="${escapeHTML(p)}" ${p === pairFilter ? "selected" : ""}>${escapeHTML(p)}</option>`)
      .join("");
}

async function reload() {
  const feed = document.getElementById("persp-feed");
  if (!feed) return;
  feed.innerHTML = `<div class="loading-row"><span class="spinner"></span> Cargando publicaciones…</div>`;
  try {
    posts = await fetchPage(0);
    hasMore = posts.length === PAGE;
    renderFeed();
    renderPairFilter();
  } catch (e) {
    feed.innerHTML = `<div class="empty">No se pudo cargar el muro: ${escapeHTML(e.message)}</div>`;
  }
}

function postHTML(p) {
  const a = authors.get(p.user_id) || { id: p.user_id };
  const k = KINDS[p.kind] || KINDS.perspectiva;
  const l = likes.get(p.id) || { count: 0, mine: false };
  const canDelete = p.user_id === myUserId || getMyRole() === "superadmin";
  return `<article class="persp-card" data-id="${p.id}">
    <div class="persp-head">
      ${avatarHTML(a, "md")}
      <div class="persp-who">
        <div class="persp-name">${escapeHTML(a.display_name || a.email || "Usuario")}</div>
        <div class="persp-time" title="${escapeHTML(fullDate(p.created_at))}">${escapeHTML(timeAgo(p.created_at))}</div>
      </div>
      <span class="persp-kind ${k.cls}">${icon(k.icon)}${k.short}</span>
      ${p.pair ? `<span class="room-tag">${escapeHTML(p.pair)}</span>` : ""}
      ${canDelete ? `<button class="btn btn-icon btn-sm btn-g" aria-label="Eliminar publicación" data-id="${p.id}" onclick="deletePerspective(this.dataset.id)">${icon("delete")}</button>` : ""}
    </div>
    ${p.content ? `<div class="persp-body">${escapeHTML(p.content)}</div>` : ""}
    ${p.image_path ? `<img class="chat-img persp-img" data-path="${escapeHTML(p.image_path)}" alt="Imagen de la publicación" onclick="openPerspImage(this)" />` : ""}
    <div class="persp-foot">
      <button class="btn btn-sm btn-g persp-like ${l.mine ? "on" : ""}" data-id="${p.id}" onclick="togglePerspLike(this.dataset.id)" aria-pressed="${l.mine}">${icon("favorite")}<span>${l.count || ""}</span></button>
    </div>
  </article>`;
}

function renderFeed() {
  const feed = document.getElementById("persp-feed");
  if (!feed) return;
  feed.innerHTML = posts.length
    ? posts.map(postHTML).join("")
    : `<div class="empty">${kindFilter || pairFilter ? "Ninguna publicación coincide con el filtro" : "Todavía no hay publicaciones este mes. ¡Sé el primero en compartir tu perspectiva!"}</div>`;
  const more = document.getElementById("persp-more");
  if (more) more.innerHTML = hasMore ? `<button class="btn" onclick="loadMorePerspectives()">Cargar más</button>` : "";
  hydrateImages(feed);
}

async function hydrateImages(container) {
  const imgs = [...container.querySelectorAll("img.persp-img:not([src])")];
  if (!imgs.length) return;
  try {
    const urls = await getSignedUrls(imgs.map((i) => i.dataset.path), BUCKET);
    imgs.forEach((img, i) => {
      if (urls[i]) img.src = urls[i];
      else img.classList.add("chat-img-broken");
    });
  } catch {
    imgs.forEach((i) => i.classList.add("chat-img-broken"));
  }
}

/* ---------------- Filtros ---------------- */

// [window] onclick="filterPerspKind('')"
export async function filterPerspKind(k) {
  kindFilter = k;
  renderKindFilter();
  await reload();
}
// [window] onchange="filterPerspPair(value)"
export async function filterPerspPair(p) {
  pairFilter = p;
  await reload();
}
// [window] onclick="loadMorePerspectives()"
export async function loadMorePerspectives() {
  try {
    const rows = await fetchPage(posts.length);
    posts = posts.concat(rows);
    hasMore = rows.length === PAGE;
    renderFeed();
  } catch (e) {
    showToast("error", "No se pudo cargar más", e.message);
  }
}

/* ---------------- Publicar ---------------- */

// [window] onclick="setPerspKind('...')"
export function setPerspKind(k) {
  composerKind = k;
  document.querySelectorAll("#persp-kinds .seg-item").forEach((b, i) => {
    b.classList.toggle("active", Object.keys(KINDS)[i] === k);
  });
}

// [window] oninput="onPerspInput()"
export function onPerspInput() {
  const t = document.getElementById("persp-text");
  const c = document.getElementById("persp-count");
  if (t && c) c.textContent = `${t.value.length} / ${MAX_CHARS}`;
}

function renderPending() {
  const box = document.getElementById("persp-pending");
  if (!box) return;
  if (!pending) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  box.style.display = "flex";
  box.innerHTML = `<img src="${pending.previewUrl}" alt="" />
    <span class="room-chat-pending-name">${escapeHTML(pending.prepared.name)}<small>${fmtSize(pending.prepared.size)}</small></span>
    <button class="btn btn-icon btn-sm btn-g" aria-label="Quitar imagen" onclick="clearPerspImage()">${icon("close")}</button>`;
}

async function setPending(file) {
  clearPerspImage();
  try {
    const prepared = await prepareFile(file, { imagesOnly: true });
    pending = { prepared, previewUrl: URL.createObjectURL(prepared.blob) };
    renderPending();
  } catch (e) {
    showToast("error", "No se puede adjuntar", e.message);
  }
}

// [window] onclick="pickPerspImage()"
export function pickPerspImage() {
  document.getElementById("persp-file")?.click();
}
// [window] onchange="onPerspImageChosen(this)"
export function onPerspImageChosen(input) {
  const f = input.files && input.files[0];
  input.value = "";
  if (f) setPending(f);
}
// [window] onpaste="handlePerspPaste(event)" — Ctrl+V con una captura en el portapapeles
export function handlePerspPaste(e) {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) {
    e.preventDefault();
    setPending(f);
  }
}
// [window] onclick="clearPerspImage()"
export function clearPerspImage() {
  if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
  pending = null;
  renderPending();
}

// [window] onclick="publishPerspective()"
export async function publishPerspective() {
  if (publishing) return;
  const textEl = document.getElementById("persp-text");
  const content = (textEl?.value || "").trim();
  if (!content && !pending) {
    showToast("info", "Escribe algo o adjunta una imagen", "");
    return;
  }
  const btn = document.getElementById("persp-publish");
  publishing = true;
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.innerHTML = `<span class="spinner"></span> Publicando…`;
  let uploadedPath = null;
  try {
    const supabase = await getSupabase();
    let image_path = null;
    if (pending) {
      const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      image_path = `${bogotaMonth()}/${myUserId}/${unique}.${extFor(pending.prepared.type)}`;
      await uploadPreparedTo(BUCKET, image_path, pending.prepared);
      uploadedPath = image_path;
    }
    const pair = document.getElementById("persp-pair")?.value || null;
    const { data, error } = await supabase
      .from("perspectives")
      .insert({ user_id: myUserId, kind: composerKind, pair, content, image_path })
      .select("*")
      .single();
    if (error) throw error;
    uploadedPath = null; // quedó referenciada: ya no es huérfana
    if (pair) pairsSeen.add(pair);
    await ensureAuthors([myUserId]);
    likes.set(data.id, { count: 0, mine: false });
    if (textEl) textEl.value = "";
    onPerspInput();
    clearPerspImage();
    // Se agrega arriba SOLO si respeta el filtro activo; si no, igual se publicó.
    if ((!kindFilter || kindFilter === data.kind) && (!pairFilter || pairFilter === data.pair)) {
      posts.unshift(data);
      renderFeed();
    } else {
      showToast("success", "Publicado", "Tu publicación no coincide con el filtro actual, pero ya está en el muro.");
    }
    renderPairFilter();
  } catch (e) {
    // Si la imagen subió pero la publicación falló, se retira para no dejarla huérfana.
    if (uploadedPath) {
      const supabase = await getSupabase();
      supabase.storage.from(BUCKET).remove([uploadedPath]).then(() => {}, () => {});
    }
    showToast("error", "No se pudo publicar", e.message);
  } finally {
    publishing = false;
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.textContent = "Publicar";
  }
}

/* ---------------- Me gusta / borrar / ampliar ---------------- */

// [window] onclick="togglePerspLike(id)"
export async function togglePerspLike(id) {
  const l = likes.get(id) || { count: 0, mine: false };
  const was = l.mine;
  l.mine = !was;
  l.count += was ? -1 : 1;
  likes.set(id, l);
  paintLike(id);
  try {
    const supabase = await getSupabase();
    const { error } = was
      ? await supabase.from("perspective_likes").delete().eq("perspective_id", id).eq("user_id", myUserId)
      : await supabase.from("perspective_likes").insert({ perspective_id: id, user_id: myUserId });
    if (error) throw error;
  } catch (e) {
    l.mine = was; // se revierte lo que se mostró de forma optimista
    l.count += was ? 1 : -1;
    paintLike(id);
    showToast("error", "No se pudo guardar tu me gusta", e.message);
  }
}

function paintLike(id) {
  const btn = document.querySelector(`.persp-like[data-id="${id}"]`);
  const l = likes.get(id);
  if (!btn || !l) return;
  btn.classList.toggle("on", l.mine);
  btn.setAttribute("aria-pressed", String(l.mine));
  btn.querySelector("span:last-child").textContent = l.count || "";
}

// [window] onclick="deletePerspective(id)"
export async function deletePerspective(id) {
  const p = posts.find((x) => x.id === id);
  if (!p || !confirm("¿Eliminar esta publicación? No se puede deshacer.")) return;
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.from("perspectives").delete().eq("id", id);
    if (error) throw error;
    if (p.image_path) {
      supabase.storage.from(BUCKET).remove([p.image_path]).then(() => {}, () => {});
    }
    removeFromFeed(id);
  } catch (e) {
    showToast("error", "No se pudo eliminar", e.message);
  }
}

function removeFromFeed(id) {
  posts = posts.filter((x) => x.id !== id);
  document.querySelector(`.persp-card[data-id="${id}"]`)?.remove();
  if (!posts.length) renderFeed();
}

// [window] onclick="openPerspImage(this)"
export function openPerspImage(img) {
  if (img.src) showLightbox(img.src, "perspectiva.webp");
}

/* ---------------- Aviso de publicaciones nuevas (sin mover el muro) ---------------- */

function subscribe() {
  if (channel) return;
  getSupabase().then((supabase) => {
    channel = supabase
      .channel("perspectives-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "perspectives" }, (payload) => {
        if (payload.new?.user_id === myUserId) return; // las propias ya se ven al publicar
        newCount++;
        const pill = document.getElementById("persp-newpill");
        if (pill) {
          pill.style.display = "block";
          pill.innerHTML = `<button class="btn btn-p btn-sm persp-pill" onclick="showNewPerspectives()">${icon("arrow_upward")} ${newCount} publicación${newCount === 1 ? "" : "es"} nueva${newCount === 1 ? "" : "s"}</button>`;
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "perspectives" }, (payload) => {
        const id = payload.old?.id;
        if (id && posts.some((p) => p.id === id)) removeFromFeed(id);
      })
      .subscribe();
  });
}

// [window] onclick="showNewPerspectives()"
export async function showNewPerspectives() {
  newCount = 0;
  const pill = document.getElementById("persp-newpill");
  if (pill) pill.style.display = "none";
  await reload();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
