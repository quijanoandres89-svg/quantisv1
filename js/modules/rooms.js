/* ============================================================
   ROOMS (Salas) — comunidad de Quantis.
   ------------------------------------------------------------
   Vive por completo en Supabase (tablas rooms / room_members /
   room_messages, ver supabase_salas_setup.sql) — NO usa state.js
   ni quantis_state, porque esto no es dato privado de un usuario,
   es dato compartido entre varios. Todo el control de acceso real
   (quién puede crear, aprobar, expulsar) lo hacen las políticas
   RLS del lado de Supabase; este módulo solo pide datos y confía
   en que el servidor rechace lo que no corresponda.

   El conteo de participantes (badge "N participantes" en cada
   tarjeta) viene de get_room_approved_counts(), una función aparte
   que SOLO expone el número — no quiénes son. Así "Salas públicas"
   puede mostrar el conteo real incluso en salas a las que todavía
   no perteneces, sin exponer la lista de miembros de otra gente
   (eso sí sigue protegido por RLS normal).
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";
import { escapeHTML, fmtDate } from "./utils.js";
import { avatarHTML } from "./avatar.js";
import * as RoomCall from "./roomCall.js";
import { prepareFile, uploadRoomFile, attachmentHTML, hydrateAttachments, purgeRoomFiles, fmtSize } from "./roomFiles.js";
import { showToast } from "./toast.js";
import { getMyRole } from "./admin.js";
import { openModal, closeModal } from "./challengeManager.js";

let myUserId = null;
let activeTab = "mias"; // mias | publicas | invitaciones | solicitudes
let allRooms = [];
let allMembers = []; // todas las filas de room_members visibles para mí (RLS)
let profilesCache = new Map(); // id -> {id, display_name, email, avatar_url}
let currentRoom = null;
let messagesChannel = null;
let pendingFile = null; // { prepared, previewUrl } — archivo elegido y aún no enviado
let sendingMessage = false;
let approvedCounts = new Map(); // room_id -> número de aprobados (público, sin exponer quiénes)
let roomsQuery = ""; // texto del buscador de salas
let liveCounts = new Map(); // room_id -> conectados ahora mismo a la llamada (vía Edge Function)
let livePoll = null;
let roomsChannel = null; // Realtime permanente de salas y membresías (desde que inicias sesión)
let syncTimer = null;
let syncing = false;
let syncAgain = false;
let lastSig = ""; // firma de los datos: si no cambió nada, no se re-pinta (sin parpadeos ni menús que se cierran)
let detailMembers = []; // filas de room_members de la sala abierta
let newRoomPublic = false; // tipo elegido en el modal de crear sala
const pickers = { create: { selected: new Map() }, detail: { selected: new Map() } }; // selector de usuarios a invitar

const TZ = "America/Bogota"; // todo el producto muestra hora de Colombia (UTC-5, sin horario de verano)
const ICON = (n) => `<span class="material-symbols-outlined">${n}</span>`;

const TABS = [
  { id: "mias", label: "Mis salas" },
  { id: "publicas", label: "Salas públicas" },
  { id: "invitaciones", label: "Invitaciones" },
  { id: "solicitudes", label: "Mis solicitudes" },
];

async function ensureProfiles(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !profilesCache.has(id));
  if (!missing.length) return;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .in("id", missing);
  if (error) return;
  (data || []).forEach((p) => profilesCache.set(p.id, p));
}

function profileName(id) {
  const p = profilesCache.get(id);
  return p ? p.display_name || p.email : "Usuario";
}

// Avatar de cualquier usuario ya cargado en profilesCache (mismo componente que el sidebar).
function userAvatar(id, size = "sm") {
  return avatarHTML(profilesCache.get(id) || { id }, size);
}

// [window] go('salas', ...) la dispara desde main.js
export async function renderRooms() {
  profilesCache.clear(); // por si alguien cambió su nombre o foto desde la última vez
  closeRoomDetail(); // por si quedó un detalle/chat abierto de una visita anterior
  document.getElementById("salas-list-view").style.display = "";

  const user = await getCurrentUser();
  myUserId = user?.id || null;

  const btnNueva = document.getElementById("btn-nueva-sala");
  if (btnNueva) {
    btnNueva.style.display = ["room_creator", "superadmin"].includes(getMyRole())
      ? ""
      : "none";
  }

  renderTabs();
  await loadRoomsData();
  renderTabs(); // de nuevo: ahora que hay datos, el contador de Invitaciones es real
  renderRoomsList();
  startRoomsRealtime(); // ya corre desde el login; aquí solo garantiza que exista
  lastSig = dataSignature();
  refreshLive();
  if (!livePoll) livePoll = setInterval(refreshLive, 20000);
}

function myInvitedCount() {
  return allRooms.filter((r) => myStatusFor(r.id) === "invited").length;
}

function renderTabs() {
  const inv = myInvitedCount();
  document.getElementById("rooms-tabs").innerHTML = TABS.map(
    (t) =>
      `<button class="seg-item ${t.id === activeTab ? "active" : ""}" onclick="switchRoomsTab('${t.id}')">${t.label}${t.id === "invitaciones" && inv ? `<span class="seg-badge">${inv}</span>` : ""}</button>`,
  ).join("");
}

// [window] onclick="switchRoomsTab('...')"
export function switchRoomsTab(tab) {
  activeTab = tab;
  renderTabs();
  renderRoomsList();
}

// [window] oninput="filterRooms(value)" — buscador de salas (nombre, etiquetas, descripción)
export function filterRooms(q) {
  roomsQuery = q || "";
  renderRoomsList();
}

async function loadRoomsData() {
  const supabase = await getSupabase();
  const [roomsRes, membersRes, countsRes] = await Promise.all([
    supabase.from("rooms").select("*").order("created_at", { ascending: false }),
    supabase.from("room_members").select("*"),
    supabase.rpc("get_room_approved_counts"),
  ]);
  if (roomsRes.error) {
    console.error("QUANTIS: error cargando rooms:", roomsRes.error);
    showToast("error", "No se pudieron cargar las salas", roomsRes.error.message);
  }
  if (membersRes.error) {
    console.error("QUANTIS: error cargando room_members:", membersRes.error);
    showToast("error", "No se pudieron cargar las membresías", membersRes.error.message);
  }
  if (countsRes.error) {
    console.error("QUANTIS: error cargando conteos de salas:", countsRes.error);
  }
  allRooms = roomsRes.data || [];
  allMembers = membersRes.data || [];
  approvedCounts = new Map((countsRes.data || []).map((c) => [c.room_id, c.approved_count]));
  await ensureProfiles(allRooms.map((r) => r.created_by));
}

function myStatusFor(roomId) {
  return allMembers.find((m) => m.room_id === roomId && m.user_id === myUserId)?.status || null;
}

function approvedCountFor(roomId) {
  return approvedCounts.get(roomId) || 0;
}

function pendingCountFor(roomId) {
  return allMembers.filter((m) => m.room_id === roomId && m.status === "pending").length;
}

/* ---------------- Fechas (siempre hora de Colombia) ---------------- */

const dayKey = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });
function dayLabel(d) {
  const k = dayKey(d);
  if (k === dayKey(new Date())) return "Hoy";
  if (k === dayKey(new Date(Date.now() + 864e5))) return "Mañana";
  return d.toLocaleDateString("es-CO", { timeZone: TZ, day: "numeric", month: "short" });
}
const hm = (d) => d.toLocaleTimeString("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

/** "Hoy, 08:15 – 11:00 (UTC-5)" — vacío si la sala no tiene horario. */
function fmtWhen(r) {
  if (!r.scheduled_at) return "";
  const s = new Date(r.scheduled_at);
  const e = r.ends_at ? new Date(r.ends_at) : null;
  return `${dayLabel(s)}, ${hm(s)}${e ? ` – ${hm(e)}` : ""} (UTC-5)`;
}

/** live = hay gente en la llamada ahora · scheduled = empieza más adelante · open = disponible */
function roomPhase(r) {
  if ((liveCounts.get(r.id) || 0) > 0) return "live";
  if (r.scheduled_at && new Date(r.scheduled_at).getTime() > Date.now()) return "scheduled";
  return "open";
}

function phasePillHTML(phase) {
  if (phase === "live")
    return `<span class="room-pill live"><span class="room-pill-dot"></span>En curso</span>`;
  if (phase === "scheduled") return `<span class="room-pill">${ICON("schedule")}Programada</span>`;
  return `<span class="room-pill">Disponible</span>`;
}

/* ---------------- Tarjetas ---------------- */

function roomMenuHTML(r, isOwner) {
  const items = isOwner
    ? `<button onclick="openRoom('${r.id}')">${ICON("settings")} Administrar</button>
       <button class="danger" onclick="deleteRoom('${r.id}')">${ICON("delete")} Eliminar sala</button>`
    : `<button onclick="openRoom('${r.id}')">${ICON("open_in_new")} Abrir sala</button>
       <button class="danger" onclick="leaveRoom('${r.id}')">${ICON("logout")} Salir de la sala</button>`;
  return `<div class="room-menu-wrap">
    <button class="btn btn-icon btn-sm btn-g" aria-label="Más opciones" onclick="toggleRoomMenu('${r.id}', event)">${ICON("more_vert")}</button>
    <div class="room-menu" id="room-menu-${r.id}">${items}</div>
  </div>`;
}

function roomCardHTML(r) {
  const isOwner = r.created_by === myUserId;
  const status = myStatusFor(r.id);
  const phase = roomPhase(r);
  const people = approvedCountFor(r.id) + 1; // + el anfitrión
  const pending = pendingCountFor(r.id);
  const liveN = liveCounts.get(r.id) || 0;
  const when = fmtWhen(r);

  let primary = "";
  let menu = "";
  if (isOwner) {
    primary =
      phase === "live"
        ? `<button class="btn btn-sm btn-p" onclick="joinRoomNow('${r.id}')">Unirse</button>`
        : `<button class="btn btn-sm btn-p" onclick="openRoom('${r.id}')">Administrar${pending ? ` (${pending})` : ""}</button>`;
    menu = roomMenuHTML(r, true);
  } else if (status === "approved") {
    primary =
      phase === "live"
        ? `<button class="btn btn-sm btn-p" onclick="joinRoomNow('${r.id}')">Unirse</button>`
        : phase === "scheduled"
          ? `<button class="btn btn-sm" onclick="openRoom('${r.id}')">Ver detalles</button>`
          : `<button class="btn btn-sm btn-p" onclick="openRoom('${r.id}')">Entrar</button>`;
    menu = roomMenuHTML(r, false);
  } else if (status === "invited") {
    primary = `<button class="btn btn-sm btn-p" onclick="openRoom('${r.id}')">Ver invitación</button>`;
  } else if (status === "pending") {
    primary = `<button class="btn btn-sm" disabled>Pendiente de aprobación</button>`;
  } else if (status === "kicked") {
    primary = `<span style="font-size:11px;color:var(--red)">Fuiste removido de esta sala</span>`;
  } else {
    primary = `<button class="btn btn-sm btn-p" onclick="requestJoinRoom('${r.id}')">Solicitar unirse</button>`;
  }

  const tags = (r.tags || []).map((t) => `<span class="room-tag">${escapeHTML(t)}</span>`).join("");
  return `<div class="room-card ${phase === "live" ? "is-live" : ""}">
    <div class="room-card-ico">${ICON(r.is_public ? "groups" : "lock")}</div>
    <div class="room-card-main">
      <div class="room-card-title"><span class="t">${escapeHTML(r.name)}</span>${!r.is_public ? ICON("lock") : ""}</div>
      <div class="room-card-sub">
        ${phasePillHTML(phase)}
        <span>${people} participante${people === 1 ? "" : "s"}</span>
        ${liveN ? `<span style="color:var(--acc)">${liveN} conectado${liveN === 1 ? "" : "s"}</span>` : ""}
      </div>
      ${r.description ? `<div class="room-card-desc">${escapeHTML(r.description)}</div>` : ""}
      ${tags ? `<div class="room-card-tags">${tags}</div>` : ""}
      <div class="who" style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-top:8px">
        ${userAvatar(r.created_by, "xs")}Creada por ${escapeHTML(profileName(r.created_by))}
      </div>
    </div>
    <div class="room-card-side">
      ${when ? `<div class="room-card-when">${ICON("schedule")}${escapeHTML(when)}</div>` : ""}
      <div class="room-card-actions">${primary}${menu}</div>
    </div>
  </div>`;
}

function renderRoomsList() {
  const el = document.getElementById("salas-list");
  let list;
  if (activeTab === "mias") {
    list = allRooms.filter((r) => r.created_by === myUserId || myStatusFor(r.id) === "approved");
  } else if (activeTab === "publicas") {
    list = allRooms.filter((r) => r.is_public && r.created_by !== myUserId);
  } else if (activeTab === "invitaciones") {
    list = allRooms.filter((r) => myStatusFor(r.id) === "invited");
  } else {
    list = allRooms.filter((r) => myStatusFor(r.id) === "pending");
  }
  const q = roomsQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q) ||
        (r.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }
  if (!list.length) {
    const emptyMsg = q
      ? "Ninguna sala coincide con tu búsqueda"
      : {
          mias: "No perteneces a ninguna sala todavía",
          publicas: "No hay salas públicas por ahora",
          invitaciones: "No tienes invitaciones pendientes",
          solicitudes: "No tienes solicitudes pendientes",
        }[activeTab];
    el.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }
  // En curso primero, luego programadas por fecha, luego el resto.
  const order = { live: 0, scheduled: 1, open: 2 };
  list = [...list].sort((a, b) => {
    const pa = roomPhase(a);
    const pb = roomPhase(b);
    if (pa !== pb) return order[pa] - order[pb];
    if (pa === "scheduled") return new Date(a.scheduled_at) - new Date(b.scheduled_at);
    return new Date(b.created_at) - new Date(a.created_at);
  });
  el.innerHTML = list.map(roomCardHTML).join("");
}

function closeRoomMenus() {
  document.querySelectorAll(".room-menu.open").forEach((m) => m.classList.remove("open"));
}
document.addEventListener("click", closeRoomMenus);

// [window] onclick="toggleRoomMenu('id', event)"
export function toggleRoomMenu(id, ev) {
  ev.stopPropagation();
  const m = document.getElementById(`room-menu-${id}`);
  const wasOpen = m?.classList.contains("open");
  closeRoomMenus();
  if (m && !wasOpen) m.classList.add("open");
}

// [window] onclick="joinRoomNow('id')" — entra a la sala y a la llamada de una vez
export async function joinRoomNow(roomId) {
  await openRoom(roomId);
  if (currentRoom && currentRoom.id === roomId) startAudioCall(roomId);
}

/* ---------------- "En curso": conectados por sala + invitaciones en vivo ---------------- */

function listViewVisible() {
  const lv = document.getElementById("salas-list-view");
  const page = document.getElementById("page-salas");
  return !!lv && lv.style.display !== "none" && !!page && page.offsetParent !== null;
}

async function refreshLive() {
  if (!listViewVisible() || document.hidden) return;
  const ids = allRooms.map((r) => r.id).slice(0, 50);
  if (!ids.length) return;
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.functions.invoke("create-livekit-token", {
      body: { action: "live", room_ids: ids },
    });
    if (error || !data || data.error) return; // sin la función actualizada: simplemente no hay "en curso"
    const next = new Map(Object.entries(data.live || {}));
    const changed = JSON.stringify([...next].sort()) !== JSON.stringify([...liveCounts].sort());
    liveCounts = next;
    if (changed) renderRoomsList();
  } catch {
    /* sin conexión: se reintenta en el próximo ciclo */
  }
}

/* ---------------- Sincronización en vivo (todo lo compartido entre usuarios) ----------------
   Una sola suscripción permanente a room_members y rooms, creada al iniciar
   sesión (no al abrir Salas), más un respaldo cada 30 s y al volver a la
   pestaña. Cada cambio dispara syncRooms(), que recarga, COMPARA con el
   estado de antes y:
     - avisa de lo que importa (invitación, solicitud aprobada, solicitud
       nueva si eres anfitrión, sala eliminada, te removieron),
     - refresca lo que esté abierto SIN reconstruirlo entero: la lista, o en
       el detalle solo las listas de solicitudes/participantes — así una
       llamada o un chat en curso no se tocan,
     - saca de la sala (y de la llamada) a quien ya no tiene acceso.
   Antes solo se refrescaba si estabas mirando la LISTA; quien esperaba una
   aprobación dentro del detalle de la sala no veía nada hasta salir y volver. */

function dataSignature() {
  return JSON.stringify([
    allRooms.map((r) => [r.id, r.name, r.description, r.is_public, r.scheduled_at, r.ends_at, r.tags, r.screen_share_policy]),
    allMembers.map((m) => [m.room_id, m.user_id, m.status]),
    [...approvedCounts],
  ]);
}

const hasAccess = (st) => st === "owner" || st === "approved";
const roleIn = (r) => (r.created_by === myUserId ? "owner" : myStatusFor(r.id));

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncRooms, 350);
}

export async function startRoomsRealtime() {
  if (roomsChannel) return;
  const user = await getCurrentUser();
  if (!user) return;
  myUserId = user.id;
  await loadRoomsData(); // línea base silenciosa: así el primer cambio real sí se detecta como cambio
  lastSig = dataSignature();
  const supabase = await getSupabase();
  roomsChannel = supabase
    .channel(`rooms-live-${myUserId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_members" }, scheduleSync)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, scheduleSync)
    .subscribe();
  // Respaldo: si Realtime falla o se durmió la pestaña, igual converge.
  setInterval(() => {
    if (!document.hidden && (listViewVisible() || currentRoom)) scheduleSync();
  }, 30000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleSync();
  });
  window.addEventListener("online", scheduleSync);
}

async function syncRooms() {
  if (!myUserId) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  try {
    // Foto de "antes"
    const prevRooms = new Map(allRooms.map((r) => [r.id, r]));
    const prevRole = new Map(allRooms.map((r) => [r.id, roleIn(r)]));
    const prevPending = new Map(allRooms.filter((r) => r.created_by === myUserId).map((r) => [r.id, new Set(allMembers.filter((m) => m.room_id === r.id && m.status === "pending").map((m) => m.user_id))]));
    const prevInRoom = currentRoom ? prevRole.get(currentRoom.id) : null;

    await loadRoomsData();
    const sig = dataSignature();
    if (sig === lastSig) return; // nada cambió: no se toca la pantalla
    lastSig = sig;

    /* --- avisos --- */
    for (const r of allRooms) {
      const now = roleIn(r);
      const was = prevRole.get(r.id);
      if (now === "invited" && was !== "invited") {
        showToast("info", "Nueva invitación", `Te invitaron a «${r.name}». Revisa la pestaña Invitaciones.`);
      } else if (now === "approved" && was === "pending") {
        showToast("success", "¡Te aprobaron!", `Ya puedes entrar a «${r.name}».`);
      }
      if (r.created_by === myUserId) {
        const before = prevPending.get(r.id) || new Set();
        const fresh = allMembers.filter((m) => m.room_id === r.id && m.status === "pending" && !before.has(m.user_id));
        if (fresh.length) {
          await ensureProfiles(fresh.map((m) => m.user_id));
          const names = fresh.map((m) => profileName(m.user_id)).join(", ");
          showToast("info", "Nueva solicitud", `${names} quiere${fresh.length > 1 ? "n" : ""} unirse a «${r.name}».`);
        }
      }
    }
    for (const [id, r] of prevRooms) {
      if (allRooms.some((x) => x.id === id)) continue;
      const was = prevRole.get(id);
      if (was === "approved" || was === "invited" || was === "pending") {
        showToast("info", "Sala no disponible", `«${r.name}» fue eliminada o ya no tienes acceso.`);
      }
    }
    for (const r of allRooms) {
      const was = prevRole.get(r.id);
      const now = roleIn(r);
      if (was === "approved" && !hasAccess(now)) {
        showToast("error", "Te removieron de la sala", `«${r.name}»`);
      } else if (was === "pending" && now === null) {
        showToast("info", "Solicitud rechazada", `El anfitrión no aceptó tu solicitud para «${r.name}».`);
      } else if (was === "invited" && now === null) {
        showToast("info", "Invitación cancelada", `Ya no tienes invitación a «${r.name}».`);
      }
    }

    /* --- lo que esté abierto --- */
    if (currentRoom) {
      const room = allRooms.find((r) => r.id === currentRoom.id);
      const now = room ? roleIn(room) : null;
      const gone = !room || (hasAccess(prevInRoom) && !hasAccess(now)) || (!hasAccess(prevInRoom) && now === null);
      if (gone) {
        RoomCall.leave(); // si estaba en la llamada, sale
        closeRoomDetail();
        if (listViewVisible()) {
          renderTabs();
          renderRoomsList();
        }
        return;
      }
      currentRoom = room;
      if (!hasAccess(prevInRoom) && hasAccess(now)) {
        await openRoom(room.id); // te aprobaron / aceptaste: aparecen el chat y la llamada
      } else {
        await refreshRoomDetail();
      }
    }
    if (listViewVisible()) {
      renderTabs();
      renderRoomsList();
    }
  } catch (e) {
    console.error("QUANTIS: error sincronizando salas:", e);
  } finally {
    syncing = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

/** Refresca SOLO lo que depende de los miembros de la sala abierta (listas de
 * solicitudes, participantes e invitaciones) y la zona de solicitudes de la
 * llamada. No toca el chat ni la llamada en curso. */
async function refreshRoomDetail() {
  const room = currentRoom;
  if (!room) return;
  detailMembers = allMembers.filter((m) => m.room_id === room.id);
  if (room.created_by !== myUserId) return;
  await ensureProfiles(detailMembers.map((m) => m.user_id));
  const lists = document.getElementById("room-admin-lists");
  if (lists) lists.innerHTML = adminListsHTML(room, detailMembers);
  const inv = document.getElementById("room-invited-sec");
  if (inv) inv.innerHTML = invitedSecHTML(room, detailMembers);
  RoomCall.notifyRequestsChanged();
}

/* ---------------- Crear sala ---------------- */

const todayBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

function parseTags(v) {
  const out = [];
  for (const raw of (v || "").split(",")) {
    const t = raw.trim().slice(0, 20);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

// [window] onclick="openCreateRoomModal()"
export function openCreateRoomModal() {
  for (const id of ["room-nombre", "room-desc", "room-fecha", "room-hora", "room-tags", "invite-search-create"]) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  }
  document.getElementById("room-duracion").value = "0";
  document.getElementById("room-share-policy").value = "all";
  document.getElementById("room-fecha").min = todayBogota();
  setRoomType(false);
  resetPicker("create");
  openModal("modal-room");
}

// [window] onclick="setRoomType(true|false)"
export function setRoomType(isPublic) {
  newRoomPublic = !!isPublic;
  document.querySelectorAll("#room-type-opts .room-type-opt").forEach((b) => {
    b.classList.toggle("active", (b.dataset.val === "true") === newRoomPublic);
  });
}

// [window] onclick="saveRoom()" en el modal de crear sala
export async function saveRoom() {
  const name = document.getElementById("room-nombre").value.trim();
  if (!name) {
    showToast("error", "Falta el nombre", "Ponle un nombre a la sala.");
    return;
  }
  const description = document.getElementById("room-desc").value.trim();
  const fecha = document.getElementById("room-fecha").value;
  const hora = document.getElementById("room-hora").value;
  let scheduled_at = null;
  let ends_at = null;
  if (fecha || hora) {
    if (!fecha || !hora) {
      showToast("error", "Falta fecha u hora", "Para programar la sala completa los dos campos, o deja ambos vacíos.");
      return;
    }
    // Se interpreta SIEMPRE como hora de Colombia (UTC-5), sin importar la zona del navegador.
    const start = new Date(`${fecha}T${hora}:00-05:00`);
    if (isNaN(start.getTime())) {
      showToast("error", "Fecha u hora no válidas", "");
      return;
    }
    if (start.getTime() < Date.now() - 60_000) {
      showToast("error", "Esa fecha y hora ya pasaron", "Elige un momento futuro o deja la fecha vacía.");
      return;
    }
    scheduled_at = start.toISOString();
    const dur = parseInt(document.getElementById("room-duracion").value, 10);
    if (dur > 0) ends_at = new Date(start.getTime() + dur * 60_000).toISOString();
  }
  const tags = parseTags(document.getElementById("room-tags").value);
  const screen_share_policy = document.getElementById("room-share-policy").value === "host" ? "host" : "all";

  const btn = document.getElementById("btn-save-room");
  btn.disabled = true;
  btn.classList.add("is-loading");
  btn.innerHTML = `<span class="spinner"></span> Creando…`;
  try {
    const supabase = await getSupabase();
    const { data: room, error } = await supabase
      .from("rooms")
      .insert({
        name,
        description: description || null,
        is_public: newRoomPublic,
        created_by: myUserId,
        scheduled_at,
        ends_at,
        tags,
        screen_share_policy,
      })
      .select("id")
      .single();
    if (error) throw error;

    const invitees = [...pickers.create.selected.keys()];
    let inviteNote = "";
    if (invitees.length) {
      const { error: invErr } = await supabase
        .from("room_members")
        .insert(invitees.map((uid) => ({ room_id: room.id, user_id: uid, status: "invited" })));
      inviteNote = invErr
        ? " (la sala se creó, pero no se pudieron enviar las invitaciones: " + invErr.message + ")"
        : ` · ${invitees.length} invitación${invitees.length === 1 ? "" : "es"} enviada${invitees.length === 1 ? "" : "s"}`;
    }
    closeModal("modal-room");
    showToast("success", "Sala creada", name + inviteNote);
    activeTab = "mias";
    await loadRoomsData();
    renderTabs();
    renderRoomsList();
  } catch (e) {
    showToast("error", "No se pudo crear la sala", e.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-loading");
    btn.textContent = "Crear sala";
  }
}

/* ---------------- Selector de usuarios a invitar ---------------- */

function resetPicker(scope) {
  pickers[scope].selected = new Map();
  for (const part of ["results", "chips"]) {
    const el = document.getElementById(`invite-${part}-${scope}`);
    if (el) el.innerHTML = "";
  }
  const input = document.getElementById(`invite-search-${scope}`);
  if (input) input.value = "";
}

function renderChips(scope) {
  const el = document.getElementById(`invite-chips-${scope}`);
  if (!el) return;
  el.innerHTML = [...pickers[scope].selected.values()]
    .map(
      (p) => `<span class="invite-chip">${avatarHTML(p, "xs")}${escapeHTML(p.display_name || p.email)}
        <button aria-label="Quitar" onclick="toggleInviteUser('${scope}','${p.id}')">${ICON("close")}</button></span>`,
    )
    .join("");
}

let inviteSearchTimer = null;
// [window] oninput="searchInviteUsers('create'|'detail', value)"
export function searchInviteUsers(scope, q) {
  clearTimeout(inviteSearchTimer);
  inviteSearchTimer = setTimeout(() => runInviteSearch(scope, q), 250);
}

async function runInviteSearch(scope, q) {
  const box = document.getElementById(`invite-results-${scope}`);
  if (!box) return;
  // Se quitan los caracteres con significado especial del filtro de PostgREST (, ( ) % * \ _)
  const term = (q || "").replace(/[,()%*\\_]/g, " ").trim();
  if (term.length < 2) {
    box.innerHTML = "";
    return;
  }
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .or(`display_name.ilike.%${term}%,email.ilike.%${term}%`)
    .neq("id", myUserId)
    .limit(8);
  if (error) {
    box.innerHTML = `<div class="empty" style="padding:10px">No se pudo buscar: ${escapeHTML(error.message)}</div>`;
    return;
  }
  // En una sala ya creada no se ofrece a quien ya es miembro (aprobado, invitado o pendiente).
  const skip = new Set(scope === "detail" ? detailMembers.filter((m) => m.status !== "kicked").map((m) => m.user_id) : []);
  const list = (data || []).filter((p) => !skip.has(p.id));
  if (!list.length) {
    box.innerHTML = `<div class="empty" style="padding:10px">Sin resultados</div>`;
    return;
  }
  box.innerHTML = list
    .map((p) => {
      pickers[scope][`p_${p.id}`] = p; // para poder seleccionarlo después sin volver a pedirlo
      const picked = pickers[scope].selected.has(p.id);
      return `<button class="invite-result ${picked ? "picked" : ""}" onclick="toggleInviteUser('${scope}','${p.id}')">
        ${avatarHTML(p, "sm")}
        <span class="invite-result-info"><span class="invite-result-name">${escapeHTML(p.display_name || p.email)}</span><span class="invite-result-mail">${escapeHTML(p.email)}</span></span>
        ${ICON(picked ? "check_circle" : "add_circle")}
      </button>`;
    })
    .join("");
}

// [window] onclick="toggleInviteUser('create'|'detail', userId)"
export function toggleInviteUser(scope, id) {
  const sel = pickers[scope].selected;
  if (sel.has(id)) sel.delete(id);
  else if (pickers[scope][`p_${id}`]) sel.set(id, pickers[scope][`p_${id}`]);
  renderChips(scope);
  const input = document.getElementById(`invite-search-${scope}`);
  if (input && input.value.trim().length >= 2) runInviteSearch(scope, input.value); // refresca los check
}

// [window] onclick="sendInvites('roomId')" — desde el detalle de una sala propia
export async function sendInvites(roomId) {
  const chosen = [...pickers.detail.selected.values()];
  if (!chosen.length) {
    showToast("info", "Elige a quién invitar", "Busca usuarios y selecciónalos primero.");
    return;
  }
  const existing = new Map(detailMembers.map((m) => [m.user_id, m.status]));
  const toInsert = [];
  const toReinvite = []; // estaban expulsados: se vuelven a invitar
  const toApprove = []; // ya habían pedido entrar: invitarlos equivale a aprobarlos
  for (const p of chosen) {
    const st = existing.get(p.id);
    if (!st) toInsert.push(p.id);
    else if (st === "kicked") toReinvite.push(p.id);
    else if (st === "pending") toApprove.push(p.id);
  }
  const supabase = await getSupabase();
  const errors = [];
  if (toInsert.length) {
    const { error } = await supabase
      .from("room_members")
      .insert(toInsert.map((uid) => ({ room_id: roomId, user_id: uid, status: "invited" })));
    if (error) errors.push(error.message);
  }
  if (toReinvite.length) {
    const { error } = await supabase
      .from("room_members")
      .update({ status: "invited", decided_at: null })
      .eq("room_id", roomId)
      .in("user_id", toReinvite);
    if (error) errors.push(error.message);
  }
  if (toApprove.length) {
    const { error } = await supabase
      .from("room_members")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .in("user_id", toApprove);
    if (error) errors.push(error.message);
  }
  if (errors.length) {
    showToast("error", "No se pudieron enviar algunas invitaciones", errors[0]);
  } else {
    showToast("success", "Invitaciones enviadas", `${chosen.length} usuario${chosen.length === 1 ? "" : "s"}`);
  }
  resetPicker("detail");
  await syncRooms();
}

// [window] onclick="cancelInvite('roomId','userId')"
export async function cancelInvite(roomId, userId) {
  const supabase = await getSupabase();
  const { error } = await supabase.from("room_members").delete().eq("room_id", roomId).eq("user_id", userId);
  if (error) {
    showToast("error", "No se pudo cancelar la invitación", error.message);
    return;
  }
  await syncRooms();
}

// [window] onclick="acceptInvite('roomId')"
export async function acceptInvite(roomId) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("room_members")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("user_id", myUserId);
  if (error) {
    showToast("error", "No se pudo aceptar la invitación", error.message);
    return;
  }
  showToast("success", "¡Te uniste a la sala!", "");
  await loadRoomsData();
  openRoom(roomId);
}

// [window] onclick="declineInvite('roomId')"
export async function declineInvite(roomId) {
  if (!confirm("¿Rechazar la invitación a esta sala?")) return;
  const supabase = await getSupabase();
  const { error } = await supabase.from("room_members").delete().eq("room_id", roomId).eq("user_id", myUserId);
  if (error) {
    showToast("error", "No se pudo rechazar la invitación", error.message);
    return;
  }
  closeRoomDetail();
  await loadRoomsData();
  renderTabs();
  renderRoomsList();
}

/* ---------------- Vista de detalle (administrar / chat) ---------------- */

// [window] onclick="openRoom('id')"
export async function openRoom(roomId) {
  // Con una llamada en curso el detalle NO se reconstruye (movería el chat y duplicaría ids): solo se refrescan las listas.
  if (RoomCall.isInCall() && currentRoom && currentRoom.id === roomId) {
    await refreshRoomDetail();
    return;
  }
  profilesCache.clear();
  const room = allRooms.find((r) => r.id === roomId);
  if (!room) return;
  currentRoom = room;

  document.getElementById("salas-list-view").style.display = "none";
  document.getElementById("salas-detail-view").style.display = "";
  document.getElementById("salas-detail-content").innerHTML =
    `<div class="loading-row"><span class="spinner"></span> Cargando sala…</div>`;

  const supabase = await getSupabase();
  const { data: members } = await supabase
    .from("room_members")
    .select("*")
    .eq("room_id", roomId);
  const roomMembers = members || [];
  detailMembers = roomMembers;
  resetPicker("detail");
  await ensureProfiles(roomMembers.map((m) => m.user_id).concat(room.created_by));

  const isOwner = room.created_by === myUserId;
  const myStatus = isOwner
    ? "approved"
    : roomMembers.find((m) => m.user_id === myUserId)?.status || null;

  renderRoomDetail(room, roomMembers, isOwner, myStatus);

  if (isOwner || myStatus === "approved") {
    await loadAndSubscribeChat(roomId);
  }
}

function renderInviteScreen(room) {
  const phase = roomPhase(room);
  const phaseLabel = { live: "En curso", scheduled: "Programada", open: "Disponible" }[phase];
  const when = fmtWhen(room);
  document.getElementById("salas-detail-content").innerHTML = `
    <div class="invite-screen">
      <div class="invite-ico">${ICON("groups")}</div>
      <div class="invite-title">Sala: ${escapeHTML(room.name)}</div>
      <div class="invite-sub">Te ha invitado a unirte a esta sala</div>
      <div class="who" style="display:flex;justify-content:center;font-size:12px">${userAvatar(room.created_by, "sm")}<span>Creada por <b>${escapeHTML(profileName(room.created_by))}</b></span></div>
      ${room.description ? `<div class="jprev" style="margin-top:12px">${escapeHTML(room.description)}</div>` : ""}
      ${when ? `<div class="room-card-when" style="justify-content:center;margin-top:12px">${ICON("schedule")}${escapeHTML(when)}</div>` : ""}
      <div class="invite-stats">
        <div>${ICON("group")}<b>${approvedCountFor(room.id) + 1}</b>participantes</div>
        <div>${ICON(room.is_public ? "public" : "lock")}<b>${room.is_public ? "Pública" : "Privada"}</b>tipo</div>
        <div>${ICON("radio_button_checked")}<b>${phaseLabel}</b>estado</div>
      </div>
      <button class="btn btn-p btn-lg btn-block" onclick="acceptInvite('${room.id}')">Unirme a la sala</button>
      <button class="btn btn-block" onclick="declineInvite('${room.id}')">Rechazar invitación</button>
    </div>`;
}

/** Tarjetas "Solicitudes pendientes" y "Participantes" del admin (se re-pintan solas). */
function adminListsHTML(room, members) {
  const pending = members.filter((m) => m.status === "pending");
  const approved = members.filter((m) => m.status === "approved");
  return `
      <div class="card">
        <div class="ct">Solicitudes pendientes (${pending.length})</div>
        ${
          pending.length
            ? pending
                .map(
                  (m) => `<div class="jf">
              <div class="jfl who">${userAvatar(m.user_id, "sm")}${escapeHTML(profileName(m.user_id))}</div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-sm btn-p" onclick="approveMember('${room.id}','${m.user_id}')">Aprobar</button>
                <button class="btn btn-sm btn-d" onclick="kickMember('${room.id}','${m.user_id}', true)">Rechazar</button>
              </div>
            </div>`,
                )
                .join("")
            : `<div class="empty" style="padding:14px">Sin solicitudes pendientes</div>`
        }
      </div>
      <div class="card">
        <div class="ct">Participantes (${approved.length})</div>
        ${
          approved.length
            ? approved
                .map(
                  (m) => `<div class="jf">
              <div class="jfl who">${userAvatar(m.user_id, "sm")}${escapeHTML(profileName(m.user_id))}</div>
              <button class="btn btn-sm btn-d" onclick="kickMember('${room.id}','${m.user_id}', false)">Expulsar</button>
            </div>`,
                )
                .join("")
            : `<div class="empty" style="padding:14px">Todavía nadie aprobado</div>`
        }
      </div>`;
}

/** Invitaciones sin responder (dentro de la tarjeta "Invitar usuarios"). */
function invitedSecHTML(room, members) {
  const invited = members.filter((m) => m.status === "invited");
  if (!invited.length) return "";
  return `<div class="ct" style="margin-top:16px">Invitaciones sin responder (${invited.length})</div>` +
    invited
      .map(
        (m) => `<div class="jf">
        <div class="jfl who">${userAvatar(m.user_id, "sm")}${escapeHTML(profileName(m.user_id))}</div>
        <button class="btn btn-sm btn-d" onclick="cancelInvite('${room.id}','${m.user_id}')">Cancelar</button>
      </div>`,
      )
      .join("");
}

function renderRoomDetail(room, members, isOwner, myStatus) {
  if (myStatus === "invited") {
    renderInviteScreen(room);
    return;
  }
  let adminHTML = "";
  if (isOwner) {
    adminHTML = `
      <div id="room-admin-lists">${adminListsHTML(room, members)}</div>
      <div class="card">
        <div class="ct">Invitar usuarios</div>
        <input type="text" id="invite-search-detail" placeholder="Buscar usuarios de Quantis por nombre o correo..." autocomplete="off" oninput="searchInviteUsers('detail', this.value)" />
        <div id="invite-results-detail" class="invite-results"></div>
        <div id="invite-chips-detail" class="invite-chips"></div>
        <button class="btn btn-p btn-sm" style="margin-top:10px" onclick="sendInvites('${room.id}')">Enviar invitaciones</button>
        <div id="room-invited-sec">${invitedSecHTML(room, members)}</div>
      </div>
      <button class="btn btn-d btn-sm" onclick="deleteRoom('${room.id}')">Eliminar sala</button>`;
  }

  const callHTML =
    isOwner || myStatus === "approved"
      ? `<div class="card">
        <div class="ct">Llamada de audio y pantalla</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-size:12px;color:var(--text2)">Habla con la sala${room.screen_share_policy === "host" && !isOwner ? "" : " y comparte tu pantalla"}. Se abre a pantalla completa.${room.screen_share_policy === "host" ? " En esta sala solo el anfitrión comparte pantalla." : ""}</div>
          <button class="btn btn-p" onclick="startAudioCall('${room.id}')"><span class="material-symbols-outlined">call</span> Unirme a la llamada</button>
        </div>
      </div>`
      : "";

  const chatHTML =
    isOwner || myStatus === "approved"
      ? `<div id="room-chat-slot"><div class="card room-chat-card" id="room-chat-card" ondragover="event.preventDefault()" ondrop="handleRoomDrop(event)">
        <div class="ct">Chat</div>
        <div id="room-chat-messages" class="room-chat-msgs"></div>
        <div id="room-chat-pending" class="room-chat-pending" style="display:none"></div>
        <div class="room-chat-form">
          <button class="btn btn-icon btn-g" aria-label="Adjuntar imagen o PDF" title="Adjuntar imagen o PDF (también puedes pegar o arrastrar)" onclick="pickRoomFile()"><span class="material-symbols-outlined">attach_file</span></button>
          <input type="file" id="room-chat-file" accept="image/*,application/pdf" style="display:none" onchange="onRoomFileChosen(this)" />
          <input type="text" id="room-chat-input" maxlength="2000" placeholder="Escribe un mensaje..." onkeydown="if(event.key==='Enter'){sendRoomMessage()}" onpaste="handleRoomPaste(event)" />
          <button class="btn btn-p btn-sm" id="room-chat-send" onclick="sendRoomMessage()">Enviar</button>
        </div>
      </div></div>`
      : myStatus === "pending"
        ? `<div class="empty">Tu solicitud está pendiente de aprobación del admin de la sala.</div>`
        : `<div class="empty">No tienes acceso al chat de esta sala.</div>`;

  const leaveBtn =
    !isOwner && myStatus === "approved"
      ? `<button class="btn btn-sm" onclick="leaveRoom('${room.id}')">Salir de la sala</button>`
      : "";

  document.getElementById("salas-detail-content").innerHTML = `
    <div class="pt" style="margin-top:10px">${escapeHTML(room.name)}</div>
    <div class="ps who">${room.is_public ? "Pública" : "Privada"} · ${userAvatar(room.created_by, "xs")}Creada por ${escapeHTML(profileName(room.created_by))}</div>
    ${fmtWhen(room) ? `<div class="room-card-when" style="margin:6px 0">${ICON("schedule")}${escapeHTML(fmtWhen(room))}</div>` : ""}
    ${(room.tags || []).length ? `<div class="room-card-tags" style="margin:6px 0 10px">${room.tags.map((t) => `<span class="room-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
    ${room.description ? `<div class="jprev" style="margin-bottom:14px">${escapeHTML(room.description)}</div>` : ""}
    ${leaveBtn}
    ${adminHTML}
    ${callHTML}
    ${chatHTML}`;
}

/* ---------------- Audio y pantalla (LiveKit) ----------------
   Toda la lógica de la llamada vive en roomCall.js. Aquí solo se le
   entrega el contexto de la sala y cómo mover el chat (la tarjeta del
   chat se "traslada" al panel de la llamada y vuelve al terminar, sin
   perder mensajes ni la suscripción en vivo). */

// [window] onclick="startAudioCall('roomId')"
export async function startAudioCall(roomId) {
  const room = currentRoom;
  if (!room || room.id !== roomId) return;
  await RoomCall.startCall({
    roomId,
    roomName: room.name,
    hostId: room.created_by,
    myUserId,
    canShare: room.screen_share_policy !== "host" || room.created_by === myUserId,
    isHost: room.created_by === myUserId,
    getRequests: () =>
      detailMembers
        .filter((m) => m.status === "pending")
        .map((m) => ({ ...(profilesCache.get(m.user_id) || {}), id: m.user_id })),
    approve: (userId) => approveMember(roomId, userId),
    reject: (userId) => kickMember(roomId, userId, true),
    getUser: (id) => profilesCache.get(id),
    ensureUsers: ensureProfiles,
    mountChat: (slot) => {
      const card = document.getElementById("room-chat-card");
      if (card) slot.appendChild(card);
    },
    unmountChat: () => {
      const card = document.getElementById("room-chat-card");
      const home = document.getElementById("room-chat-slot");
      if (card && home) home.appendChild(card);
    },
    onClosed: () => {},
  });
}

// [window] onclick="closeRoomDetail()"
export function closeRoomDetail() {
  RoomCall.leave();
  clearRoomPending();
  if (messagesChannel) {
    messagesChannel.unsubscribe();
    messagesChannel = null;
  }
  currentRoom = null;
  const listView = document.getElementById("salas-list-view");
  const detailView = document.getElementById("salas-detail-view");
  if (listView) listView.style.display = "";
  if (detailView) detailView.style.display = "none";
}

// [window] onclick="approveMember(roomId, userId)"
export async function approveMember(roomId, userId) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("room_members")
    .update({ status: "approved", decided_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) {
    showToast("error", "No se pudo aprobar", error.message);
    return;
  }
  showToast("success", "Usuario aprobado", "");
  await syncRooms();
}

// [window] onclick="kickMember(roomId, userId, isReject)"
export async function kickMember(roomId, userId, isReject) {
  if (!confirm(isReject ? "¿Rechazar esta solicitud?" : "¿Expulsar a este usuario de la sala?"))
    return;
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId);
  if (error) {
    showToast("error", "No se pudo completar", error.message);
    return;
  }
  if (!isReject) {
    // Expulsar de verdad: también se le saca de la llamada de LiveKit si está dentro.
    supabase.functions.invoke("create-livekit-token", { body: { action: "remove", room_id: roomId, user_id: userId } }).then(
      () => {},
      () => {},
    );
  }
  showToast("success", isReject ? "Solicitud rechazada" : "Usuario expulsado", "");
  await syncRooms();
}

// [window] onclick="leaveRoom(roomId)"
export async function leaveRoom(roomId) {
  if (!confirm("¿Salir de esta sala?")) return;
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", myUserId);
  if (error) {
    showToast("error", "No se pudo salir de la sala", error.message);
    return;
  }
  closeRoomDetail();
  await loadRoomsData();
  renderRoomsList();
}

// [window] onclick="deleteRoom(roomId)"
export async function deleteRoom(roomId) {
  if (!confirm("¿Eliminar esta sala? Esto borra también su chat, sus archivos y membresías. No se puede deshacer."))
    return;
  const supabase = await getSupabase();
  // Primero los archivos: una vez borrada la sala ya no habría permiso para quitarlos.
  await purgeRoomFiles(roomId);
  // Y se cierra la llamada de LiveKit: quien esté dentro queda desconectado.
  await supabase.functions.invoke("create-livekit-token", { body: { action: "close", room_id: roomId } }).catch(() => {});
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) {
    showToast("error", "No se pudo eliminar la sala", error.message);
    return;
  }
  showToast("success", "Sala eliminada", "");
  closeRoomDetail();
  await loadRoomsData();
  renderRoomsList();
}

/* ---------------- Chat ---------------- */

async function loadAndSubscribeChat(roomId) {
  const supabase = await getSupabase();
  const { data: msgs } = await supabase
    .from("room_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(50);
  await ensureProfiles((msgs || []).map((m) => m.user_id));
  const container = document.getElementById("room-chat-messages");
  if (container) {
    container.innerHTML = (msgs || []).map(chatMessageHTML).join("");
    container.scrollTop = container.scrollHeight;
    hydrateAttachments(container);
  }

  if (messagesChannel) messagesChannel.unsubscribe();
  messagesChannel = supabase
    .channel(`room-messages-${roomId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
      async (payload) => {
        await ensureProfiles([payload.new.user_id]);
        const c = document.getElementById("room-chat-messages");
        if (!c) return;
        c.insertAdjacentHTML("beforeend", chatMessageHTML(payload.new));
        c.scrollTop = c.scrollHeight;
        hydrateAttachments(c);
      },
    )
    .subscribe();
}

function chatMessageHTML(m) {
  const mine = m.user_id === myUserId;
  const text = m.content ? `<div>${escapeHTML(m.content)}</div>` : "";
  return `<div style="display:flex;gap:8px;align-items:flex-end;flex-direction:${mine ? "row-reverse" : "row"};align-self:${mine ? "flex-end" : "flex-start"};max-width:85%">
    ${userAvatar(m.user_id, "sm")}
    <div style="min-width:0">
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:2px;text-align:${mine ? "right" : "left"}">${escapeHTML(profileName(m.user_id))}</div>
      <div style="display:flex;flex-direction:column;gap:6px;background:${mine ? "var(--acc)" : "var(--bg3)"};color:${mine ? "#fff" : "var(--text)"};padding:7px 11px;border-radius:12px;font-size:13px;overflow-wrap:anywhere">${text}${attachmentHTML(m)}</div>
    </div>
  </div>`;
}

/* ---- Archivo adjunto pendiente (elegir / pegar / arrastrar → vista previa → enviar) ---- */

function renderPending() {
  const box = document.getElementById("room-chat-pending");
  if (!box) return;
  if (!pendingFile) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  const p = pendingFile.prepared;
  box.style.display = "flex";
  box.innerHTML = `${p.kind === "image" ? `<img src="${pendingFile.previewUrl}" alt="" />` : `<span class="material-symbols-outlined">picture_as_pdf</span>`}
    <span class="room-chat-pending-name">${escapeHTML(p.name)}<small>${fmtSize(p.size)}</small></span>
    <button class="btn btn-icon btn-sm btn-g" aria-label="Quitar archivo" onclick="clearRoomPending()"><span class="material-symbols-outlined">close</span></button>`;
}

async function setPendingFile(file) {
  clearRoomPending();
  try {
    const prepared = await prepareFile(file);
    pendingFile = {
      prepared,
      previewUrl: prepared.kind === "image" ? URL.createObjectURL(prepared.blob) : null,
    };
    renderPending();
    document.getElementById("room-chat-input")?.focus();
  } catch (e) {
    showToast("error", "No se puede adjuntar", e.message);
  }
}

// [window] onclick="pickRoomFile()" — botón del clip
export function pickRoomFile() {
  document.getElementById("room-chat-file")?.click();
}
// [window] onchange="onRoomFileChosen(this)"
export function onRoomFileChosen(input) {
  const f = input.files && input.files[0];
  input.value = ""; // permite volver a elegir el mismo archivo
  if (f) setPendingFile(f);
}
// [window] onpaste="handleRoomPaste(event)" — Ctrl+V con una captura en el portapapeles
export function handleRoomPaste(e) {
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/") || x.type === "application/pdf");
  if (f) {
    e.preventDefault();
    setPendingFile(f);
  }
}
// [window] ondrop="handleRoomDrop(event)"
export function handleRoomDrop(e) {
  e.preventDefault();
  const f = e.dataTransfer?.files && e.dataTransfer.files[0];
  if (f) setPendingFile(f);
}
// [window] onclick="clearRoomPending()"
export function clearRoomPending() {
  if (pendingFile?.previewUrl) URL.revokeObjectURL(pendingFile.previewUrl);
  pendingFile = null;
  renderPending();
}

// [window] onclick="sendRoomMessage()"
export async function sendRoomMessage() {
  const room = currentRoom;
  if (sendingMessage || !room) return;
  const input = document.getElementById("room-chat-input");
  const content = (input?.value || "").trim();
  if (!content && !pendingFile) return;
  const sendBtn = document.getElementById("room-chat-send");
  const label = sendBtn ? sendBtn.innerHTML : "Enviar";
  sendingMessage = true;
  if (pendingFile && sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="spinner"></span>`;
  }
  try {
    const row = { room_id: room.id, user_id: myUserId, content };
    if (pendingFile) Object.assign(row, await uploadRoomFile(room.id, myUserId, pendingFile.prepared));
    const supabase = await getSupabase();
    const { error } = await supabase.from("room_messages").insert(row);
    if (error) throw error;
    // Solo se limpia si salió bien: si falla, no pierdes lo que escribiste ni el archivo.
    if (input) input.value = "";
    clearRoomPending();
  } catch (e) {
    showToast("error", "No se pudo enviar el mensaje", e.message);
  } finally {
    sendingMessage = false;
    const b = document.getElementById("room-chat-send");
    if (b) {
      b.disabled = false;
      b.innerHTML = label;
    }
  }
}
