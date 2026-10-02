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

   Nota de alcance: el conteo de participantes de una sala solo se
   ve preciso en "Mis salas" (donde sos admin o ya estás aprobado);
   para salas públicas en las que todavía no entraste, RLS no te
   deja ver las filas de room_members de otra gente, así que no se
   muestra un conteo (mostrar un número inventado sería peor que no
   mostrar nada).
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";
import { escapeHTML, fmtDate } from "./utils.js";
import { showToast } from "./toast.js";
import { getMyRole } from "./admin.js";
import { closeModal } from "./challengeManager.js";

let myUserId = null;
let activeTab = "mias"; // mias | publicas | solicitudes
let allRooms = [];
let allMembers = []; // todas las filas de room_members visibles para mí (RLS)
let profilesCache = new Map(); // id -> {display_name, email}
let currentRoom = null;
let messagesChannel = null;

const TABS = [
  { id: "mias", label: "Mis salas" },
  { id: "publicas", label: "Salas públicas" },
  { id: "solicitudes", label: "Mis solicitudes" },
];

async function ensureProfiles(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !profilesCache.has(id));
  if (!missing.length) return;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email")
    .in("id", missing);
  if (error) return;
  (data || []).forEach((p) => profilesCache.set(p.id, p));
}

function profileName(id) {
  const p = profilesCache.get(id);
  return p ? p.display_name || p.email : "Usuario";
}

// [window] go('salas', ...) la dispara desde main.js
export async function renderRooms() {
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
  renderRoomsList();
}

function renderTabs() {
  document.getElementById("rooms-tabs").innerHTML = TABS.map(
    (t) =>
      `<button class="btn btn-sm ${t.id === activeTab ? "btn-p" : ""}" onclick="switchRoomsTab('${t.id}')">${t.label}</button>`,
  ).join("");
}

// [window] onclick="switchRoomsTab('...')"
export function switchRoomsTab(tab) {
  activeTab = tab;
  renderTabs();
  renderRoomsList();
}

async function loadRoomsData() {
  const supabase = await getSupabase();
  const [roomsRes, membersRes] = await Promise.all([
    supabase.from("rooms").select("*").order("created_at", { ascending: false }),
    supabase.from("room_members").select("*"),
  ]);
  allRooms = roomsRes.data || [];
  allMembers = membersRes.data || [];
  await ensureProfiles(allRooms.map((r) => r.created_by));
}

function myStatusFor(roomId) {
  return allMembers.find((m) => m.room_id === roomId && m.user_id === myUserId)?.status || null;
}

function approvedCountFor(roomId) {
  // Solo exacto si soy admin de la sala o ya estoy aprobado ahí (ver nota de alcance arriba)
  return allMembers.filter((m) => m.room_id === roomId && m.status === "approved").length;
}

function pendingCountFor(roomId) {
  return allMembers.filter((m) => m.room_id === roomId && m.status === "pending").length;
}

function roomCardHTML(r) {
  const isOwner = r.created_by === myUserId;
  const status = myStatusFor(r.id);
  const approved = approvedCountFor(r.id);
  const pending = pendingCountFor(r.id);
  let actionHTML = "";
  if (isOwner) {
    actionHTML = `<button class="btn btn-sm btn-p" onclick="openRoom('${r.id}')">Administrar${pending ? ` (${pending})` : ""}</button>`;
  } else if (status === "approved") {
    actionHTML = `<button class="btn btn-sm btn-p" onclick="openRoom('${r.id}')">Entrar</button>`;
  } else if (status === "pending") {
    actionHTML = `<button class="btn btn-sm" disabled>Pendiente de aprobación</button>`;
  } else if (status === "kicked") {
    actionHTML = `<span style="font-size:11px;color:var(--red)">Fuiste removido de esta sala</span>`;
  } else {
    actionHTML = `<button class="btn btn-sm btn-p" onclick="requestJoinRoom('${r.id}')">Solicitar unirse</button>`;
  }
  return `<div class="ji" style="cursor:default">
    <div class="jh">
      <div class="jdate">${escapeHTML(r.name)}${!r.is_public ? ' <span class="badge binf">Privada</span>' : ""}</div>
      ${isOwner || status === "approved" ? `<span class="badge binf">${approved} participante${approved === 1 ? "" : "s"}</span>` : ""}
    </div>
    ${r.description ? `<div class="jprev">${escapeHTML(r.description)}</div>` : ""}
    <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin:4px 0 8px">
      Creada por ${escapeHTML(profileName(r.created_by))} · ${fmtDate(r.created_at.slice(0, 10))}
      ${r.scheduled_at ? ` · Programada: ${escapeHTML(new Date(r.scheduled_at).toLocaleString())}` : ""}
    </div>
    ${actionHTML}
  </div>`;
}

function renderRoomsList() {
  const el = document.getElementById("salas-list");
  let list;
  if (activeTab === "mias") {
    list = allRooms.filter(
      (r) => r.created_by === myUserId || myStatusFor(r.id) === "approved",
    );
  } else if (activeTab === "publicas") {
    list = allRooms.filter((r) => r.is_public && r.created_by !== myUserId);
  } else {
    list = allRooms.filter((r) => myStatusFor(r.id) === "pending");
  }
  if (!list.length) {
    const emptyMsg = {
      mias: "No perteneces a ninguna sala todavía",
      publicas: "No hay salas públicas por ahora",
      solicitudes: "No tienes solicitudes pendientes",
    }[activeTab];
    el.innerHTML = `<div class="empty">${emptyMsg}</div>`;
    return;
  }
  el.innerHTML = list.map(roomCardHTML).join("");
}

// [window] onclick="requestJoinRoom('id')"
export async function requestJoinRoom(roomId) {
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("room_members")
    .insert({ room_id: roomId, user_id: myUserId, status: "pending" });
  if (error) {
    showToast("error", "No se pudo enviar la solicitud", error.message);
    return;
  }
  showToast("success", "Solicitud enviada", "El admin de la sala debe aprobarla.");
  await loadRoomsData();
  renderRoomsList();
}

// [window] onclick="saveRoom()" en el modal de crear sala
export async function saveRoom() {
  const name = document.getElementById("room-nombre").value.trim();
  if (!name) {
    showToast("error", "Falta el nombre", "Ponle un nombre a la sala.");
    return;
  }
  const description = document.getElementById("room-desc").value.trim();
  const isPublic = document.getElementById("room-visibilidad").value === "true";
  const supabase = await getSupabase();
  const { error } = await supabase.from("rooms").insert({
    name,
    description: description || null,
    is_public: isPublic,
    created_by: myUserId,
  });
  if (error) {
    showToast("error", "No se pudo crear la sala", error.message);
    return;
  }
  document.getElementById("room-nombre").value = "";
  document.getElementById("room-desc").value = "";
  closeModal("modal-room");
  showToast("success", "Sala creada", name);
  await loadRoomsData();
  renderRoomsList();
}

/* ---------------- Vista de detalle (administrar / chat) ---------------- */

// [window] onclick="openRoom('id')"
export async function openRoom(roomId) {
  const room = allRooms.find((r) => r.id === roomId);
  if (!room) return;
  currentRoom = room;

  document.getElementById("salas-list-view").style.display = "none";
  document.getElementById("salas-detail-view").style.display = "";
  document.getElementById("salas-detail-content").innerHTML =
    `<div class="empty">Cargando sala…</div>`;

  const supabase = await getSupabase();
  const { data: members } = await supabase
    .from("room_members")
    .select("*")
    .eq("room_id", roomId);
  const roomMembers = members || [];
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

function renderRoomDetail(room, members, isOwner, myStatus) {
  const pending = members.filter((m) => m.status === "pending");
  const approved = members.filter((m) => m.status === "approved");

  let adminHTML = "";
  if (isOwner) {
    adminHTML = `
      <div class="card">
        <div class="ct">Solicitudes pendientes (${pending.length})</div>
        ${
          pending.length
            ? pending
                .map(
                  (m) => `<div class="jf">
              <div class="jfl">${escapeHTML(profileName(m.user_id))}</div>
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
              <div class="jfl">${escapeHTML(profileName(m.user_id))}</div>
              <button class="btn btn-sm btn-d" onclick="kickMember('${room.id}','${m.user_id}', false)">Expulsar</button>
            </div>`,
                )
                .join("")
            : `<div class="empty" style="padding:14px">Todavía nadie aprobado</div>`
        }
      </div>
      <button class="btn btn-d btn-sm" onclick="deleteRoom('${room.id}')">Eliminar sala</button>`;
  }

  const chatHTML =
    isOwner || myStatus === "approved"
      ? `<div class="card">
        <div class="ct">Chat</div>
        <div id="room-chat-messages" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
        <div style="display:flex;gap:8px">
          <input type="text" id="room-chat-input" placeholder="Escribe un mensaje..." onkeydown="if(event.key==='Enter'){sendRoomMessage()}" />
          <button class="btn btn-p btn-sm" onclick="sendRoomMessage()">Enviar</button>
        </div>
      </div>`
      : myStatus === "pending"
        ? `<div class="empty">Tu solicitud está pendiente de aprobación del admin de la sala.</div>`
        : `<div class="empty">No tienes acceso al chat de esta sala.</div>`;

  const leaveBtn =
    !isOwner && myStatus === "approved"
      ? `<button class="btn btn-sm" onclick="leaveRoom('${room.id}')">Salir de la sala</button>`
      : "";

  document.getElementById("salas-detail-content").innerHTML = `
    <div class="pt" style="margin-top:10px">${escapeHTML(room.name)}</div>
    <div class="ps">${room.is_public ? "Pública" : "Privada"} · Creada por ${escapeHTML(profileName(room.created_by))}</div>
    ${room.description ? `<div class="jprev" style="margin-bottom:14px">${escapeHTML(room.description)}</div>` : ""}
    ${leaveBtn}
    ${adminHTML}
    ${chatHTML}`;
}

// [window] onclick="closeRoomDetail()"
export function closeRoomDetail() {
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
  openRoom(roomId);
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
  showToast("success", isReject ? "Solicitud rechazada" : "Usuario expulsado", "");
  openRoom(roomId);
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
  if (!confirm("¿Eliminar esta sala? Esto borra también su chat y membresías. No se puede deshacer."))
    return;
  const supabase = await getSupabase();
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
      },
    )
    .subscribe();
}

function chatMessageHTML(m) {
  const mine = m.user_id === myUserId;
  return `<div style="align-self:${mine ? "flex-end" : "flex-start"};max-width:80%">
    <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:2px;text-align:${mine ? "right" : "left"}">${escapeHTML(profileName(m.user_id))}</div>
    <div style="background:${mine ? "var(--acc)" : "var(--bg3)"};color:${mine ? "#fff" : "var(--text)"};padding:7px 11px;border-radius:12px;font-size:13px">${escapeHTML(m.content)}</div>
  </div>`;
}

// [window] onclick="sendRoomMessage()"
export async function sendRoomMessage() {
  const input = document.getElementById("room-chat-input");
  const content = input.value.trim();
  if (!content || !currentRoom) return;
  input.value = "";
  const supabase = await getSupabase();
  const { error } = await supabase
    .from("room_messages")
    .insert({ room_id: currentRoom.id, user_id: myUserId, content });
  if (error) {
    showToast("error", "No se pudo enviar el mensaje", error.message);
  }
}
