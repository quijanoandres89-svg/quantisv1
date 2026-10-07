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
import { closeModal } from "./challengeManager.js";

let myUserId = null;
let activeTab = "mias"; // mias | publicas | solicitudes
let allRooms = [];
let allMembers = []; // todas las filas de room_members visibles para mí (RLS)
let profilesCache = new Map(); // id -> {id, display_name, email, avatar_url}
let currentRoom = null;
let messagesChannel = null;
let pendingFile = null; // { prepared, previewUrl } — archivo elegido y aún no enviado
let sendingMessage = false;
let approvedCounts = new Map(); // room_id -> número de aprobados (público, sin exponer quiénes)

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
      <span class="badge binf">${approved} participante${approved === 1 ? "" : "s"}</span>
    </div>
    ${r.description ? `<div class="jprev">${escapeHTML(r.description)}</div>` : ""}
    <div class="who" style="font-size:11px;color:var(--text3);font-family:var(--mono);margin:4px 0 8px">
      ${userAvatar(r.created_by, "xs")}Creada por ${escapeHTML(profileName(r.created_by))} · ${fmtDate(r.created_at.slice(0, 10))}
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
      </div>
      <button class="btn btn-d btn-sm" onclick="deleteRoom('${room.id}')">Eliminar sala</button>`;
  }

  const callHTML =
    isOwner || myStatus === "approved"
      ? `<div class="card">
        <div class="ct">Llamada de audio y pantalla</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div style="font-size:12px;color:var(--text2)">Habla con la sala y comparte tu pantalla. Si ya estás dentro, aparecerá a pantalla completa.</div>
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
  if (!confirm("¿Eliminar esta sala? Esto borra también su chat, sus archivos y membresías. No se puede deshacer."))
    return;
  const supabase = await getSupabase();
  // Primero los archivos: una vez borrada la sala ya no habría permiso para quitarlos.
  await purgeRoomFiles(roomId);
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
