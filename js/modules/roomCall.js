/* ============================================================
   ROOM CALL — llamada de audio + pantalla compartida (LiveKit).
   ------------------------------------------------------------
   Vista a pantalla completa: barra superior (sala, "En curso",
   cronómetro, salir), mosaicos de participantes con avatar (sin
   cámara), pantalla compartida grande, panel lateral con
   Participantes + Chat, y barra inferior de controles.

   REGLA DE ORO (arregla el bug del recuadro en blanco / duplicado):
   la zona de video NO se arma agregando y quitando elementos a mano
   según cada evento. Cada vez que algo cambia (alguien comparte,
   deja de compartir, entra, sale, silencia...) se llama a refresh(),
   que vuelve a leer el estado REAL de la sala de LiveKit y deja el
   DOM igual a ese estado:
     - ¿Hay una pantalla publicada con pista activa? → un solo <video>.
     - ¿No hay ninguna? → no hay escenario, y el <video> viejo se
       desvincula (track.detach) y se elimina.
   Así no puede quedar un video en blanco ni uno duplicado, pase lo
   que pase con el orden de los eventos. Lo mismo aplica a los
   botones: su estado (mic, pantalla) se lee de LiveKit cada vez, no
   de una variable propia, así que si detienes la pantalla desde el
   botón del navegador/sistema el botón vuelve solo a "Compartir".
   ============================================================ */

import { getSupabase } from "./supabaseClient.js";
import { escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";
import { avatarHTML } from "./avatar.js";

let lk = null; // instancia de LivekitClient.Room
let ctx = null; // { roomId, roomName, hostId, myUserId, getUser, ensureUsers, mountChat, unmountChat, onClosed }
let view = null; // elemento raíz de la vista
let startedAt = 0;
let timerId = null;
let rafId = 0;
let stageSid = null; // sid de la pista que hoy se muestra en el escenario
let stageVideo = null;
let shareBusy = false;
let shareAllowed = true; // false si la sala es "solo el anfitrión comparte pantalla" y yo no lo soy
let panels = { people: true, chat: true, req: false };
const audioEls = new Map(); // sid de pista de audio remota -> <audio>
const tileEls = new Map(); // identity -> elemento del mosaico

const MOBILE_MQ = "(max-width: 900px)";

const canShareScreen = () =>
  !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function");

const icon = (n) => `<span class="material-symbols-outlined">${n}</span>`;

/* ---------------- Utilidades de estado ---------------- */

function allParticipants() {
  if (!lk) return [];
  return [lk.localParticipant, ...Array.from(lk.remoteParticipants.values())];
}

function userOf(p) {
  const u = ctx.getUser(p.identity);
  return {
    id: p.identity,
    display_name: u?.display_name || p.name || null,
    avatar_url: u?.avatar_url || null,
  };
}

function nameOf(p) {
  const u = userOf(p);
  return u.display_name || "Participante";
}

function isMicOn(p) {
  return p.isMicrophoneEnabled;
}

/** Pantalla compartida activa hoy (la última publicada), o null. */
function findActiveShare() {
  const { Track } = window.LivekitClient;
  let found = null;
  for (const p of allParticipants()) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub && pub.track && !pub.isMuted) found = { p, pub, track: pub.track };
  }
  return found;
}

/* ---------------- Render derivado del estado ---------------- */

function scheduleRefresh() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    refresh();
  });
}

function refresh() {
  if (!view || !lk) return;
  renderStage();
  renderTiles();
  renderPeople();
  renderControls();
  const count = view.querySelector("#call-count");
  if (count) count.textContent = String(allParticipants().length);
}

function renderStage() {
  const main = view.querySelector(".call-main");
  const stage = view.querySelector("#call-stage");
  const share = findActiveShare();

  if (!share) {
    if (stageVideo) {
      // Desvincular SIEMPRE antes de quitar: evita que quede un <video> en blanco.
      try {
        if (stageVideo._track) stageVideo._track.detach(stageVideo);
      } catch {
        /* la pista ya no existe */
      }
      stageVideo.remove();
      stageVideo = null;
    }
    stageSid = null;
    stage.innerHTML = "";
    main.classList.remove("has-stage");
    return;
  }

  main.classList.add("has-stage");
  const sid = share.pub.trackSid;
  if (stageSid !== sid || !stageVideo || !stage.contains(stageVideo)) {
    // Cambió la pantalla mostrada (o es la primera): se reconstruye UNA sola vez.
    if (stageVideo && stageVideo._track) {
      try {
        stageVideo._track.detach(stageVideo);
      } catch {
        /* ya no existe */
      }
    }
    stage.innerHTML = "";
    const v = document.createElement("video");
    v.className = "call-stage-video";
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true; // el audio de la llamada va por los <audio>; el video no necesita sonar
    share.track.attach(v);
    v._track = share.track;
    stage.appendChild(v);
    stageVideo = v;
    stageSid = sid;
  }
  const mine = share.p === lk.localParticipant;
  let label = stage.querySelector(".call-stage-label");
  if (!label) {
    label = document.createElement("div");
    label.className = "call-stage-label";
    stage.appendChild(label);
    const fs = document.createElement("button");
    fs.className = "btn btn-sm btn-icon call-stage-fs";
    fs.setAttribute("aria-label", "Pantalla completa");
    fs.innerHTML = icon("fullscreen");
    fs.onclick = () => {
      if (stage.requestFullscreen) stage.requestFullscreen().catch(() => {});
    };
    stage.appendChild(fs);
  }
  label.innerHTML = `${icon(mine ? "present_to_all" : "screen_share")} ${mine ? "Estás compartiendo tu pantalla" : `Pantalla de ${escapeHTML(nameOf(share.p))}`}`;
}

function renderTiles() {
  const grid = view.querySelector("#call-tiles");
  const seen = new Set();
  for (const p of allParticipants()) {
    seen.add(p.identity);
    let el = tileEls.get(p.identity);
    if (!el) {
      el = document.createElement("div");
      el.className = "call-tile";
      el.dataset.id = p.identity;
      tileEls.set(p.identity, el);
      grid.appendChild(el);
    }
    const u = userOf(p);
    const me = p === lk.localParticipant;
    const host = p.identity === ctx.hostId;
    const sig = `${u.display_name}|${u.avatar_url}|${me}|${host}`;
    if (el._sig !== sig) {
      // Contenido que solo cambia con el perfil: se reconstruye únicamente cuando cambia.
      el._sig = sig;
      el.innerHTML = `
        ${avatarHTML({ ...u, id: p.identity }, "lg", "call-tile-avatar")}
        <div class="call-tile-name">${escapeHTML(nameOf(p))}${me ? " (Tú)" : ""}</div>
        ${host ? `<div class="call-tile-role">Anfitrión</div>` : ""}
        <span class="call-tile-mic material-symbols-outlined"></span>`;
    }
    el.classList.toggle("speaking", !!p.isSpeaking && isMicOn(p));
    const mic = el.querySelector(".call-tile-mic");
    const on = isMicOn(p);
    mic.textContent = on ? "mic" : "mic_off";
    mic.classList.toggle("off", !on);
  }
  for (const [id, el] of tileEls) {
    if (!seen.has(id)) {
      el.remove();
      tileEls.delete(id);
    }
  }
}

function renderPeople() {
  const list = view.querySelector("#call-people-list");
  if (!list) return;
  const html = allParticipants()
    .map((p) => {
      const u = userOf(p);
      const me = p === lk.localParticipant;
      const host = p.identity === ctx.hostId;
      const on = isMicOn(p);
      return `<div class="call-person ${p.isSpeaking && on ? "speaking" : ""}">
        ${avatarHTML({ ...u, id: p.identity }, "sm")}
        <div class="call-person-info">
          <div class="call-person-name">${escapeHTML(nameOf(p))}${me ? " (Tú)" : ""}</div>
          <div class="call-person-role">${host ? "Anfitrión" : "Participante"}</div>
        </div>
        <span class="material-symbols-outlined call-person-mic ${on ? "" : "off"}">${on ? "mic" : "mic_off"}</span>
      </div>`;
    })
    .join("");
  if (list._html !== html) {
    list._html = html;
    list.innerHTML = html;
  }
  const title = view.querySelector("#call-people-title");
  if (title) title.textContent = `Participantes (${allParticipants().length})`;
}

function ctl(id, iconName, label, { on = false, danger = false, disabled = false, title = "" } = {}) {
  return `<button class="btn call-ctl ${on ? "btn-p" : ""} ${danger ? "btn-d" : ""}" ${disabled ? "disabled" : ""} title="${escapeHTML(title)}" onclick="${id}">
    ${icon(iconName)}<span>${label}</span></button>`;
}

function renderControls() {
  const bar = view.querySelector("#call-bar");
  if (!bar) return;
  const lp = lk.localParticipant;
  const micOn = lp.isMicrophoneEnabled;
  const sharing = lp.isScreenShareEnabled;
  const canShare = canShareScreen() && shareAllowed;
  const html = [
    ctl("toggleMute()", micOn ? "mic" : "mic_off", micOn ? "Micrófono" : "Silenciado", { on: micOn }),
    ctl(
      "toggleScreenShare()",
      sharing ? "stop_screen_share" : "screen_share",
      sharing ? "Dejar de compartir" : "Compartir pantalla",
      {
        on: sharing,
        disabled: !canShare,
        title: canShare
          ? ""
          : !shareAllowed
            ? "En esta sala solo el anfitrión puede compartir pantalla."
            : "Tu navegador o dispositivo no permite compartir pantalla (en celular suele estar disponible solo para ver).",
      },
    ),
    requestList().length > 0 && window.matchMedia(MOBILE_MQ).matches
      ? ctl("toggleCallPanel('req')", "person_add", `Solicitudes (${requestList().length})`, { on: panels.req })
      : "",
    ctl("toggleCallPanel('chat')", "chat", "Chat", { on: panels.chat }),
    ctl("toggleCallPanel('people')", "group", "Participantes", { on: panels.people }),
    ctl("leaveAudioCall()", "call_end", "Salir", { danger: true }),
  ].join("");
  // Solo se reescribe si algo cambió: si se reconstruyera en cada evento
  // (alguien hablando dispara muchos), un clic podía perderse a medias.
  if (bar._html !== html) {
    bar._html = html;
    bar.innerHTML = html;
  }
}

/* ---------------- Solicitudes de ingreso (solo el anfitrión) ---------------- */

const requestList = () => (ctx && ctx.isHost && ctx.getRequests ? ctx.getRequests() : []);

function renderRequests() {
  const sec = view && view.querySelector("#call-req-sec");
  if (!sec) return;
  const list = requestList();
  const mobile = window.matchMedia(MOBILE_MQ).matches;
  const show = list.length > 0 && (!mobile || panels.req);
  sec.style.display = show ? "" : "none";
  if (!show) return;
  const title = sec.querySelector("#call-req-title");
  if (title) title.textContent = `Solicitudes de ingreso (${list.length})`;
  const html = list
    .map(
      (u) => `<div class="call-person">
        ${avatarHTML(u, "sm")}
        <div class="call-person-info">
          <div class="call-person-name">${escapeHTML(u.display_name || "Usuario")}</div>
          <div class="call-person-role">Quiere unirse a la sala</div>
        </div>
        <button class="btn btn-sm btn-icon btn-p" aria-label="Aprobar" data-id="${escapeHTML(u.id)}" onclick="callApprove(this.dataset.id)">${icon("check")}</button>
        <button class="btn btn-sm btn-icon btn-d" aria-label="Rechazar" data-id="${escapeHTML(u.id)}" onclick="callReject(this.dataset.id)">${icon("close")}</button>
      </div>`,
    )
    .join("");
  const box = sec.querySelector("#call-req-list");
  if (box && box._html !== html) {
    box._html = html;
    box.innerHTML = html;
  }
}

// [window] onclick="callApprove(userId)" / callReject(userId) — desde el panel de la llamada
export function approveRequest(userId) {
  if (ctx && ctx.approve) ctx.approve(userId);
}
export function rejectRequest(userId) {
  if (ctx && ctx.reject) ctx.reject(userId);
}

/** rooms.js lo llama cuando cambian los miembros de la sala (llega/sale una solicitud). */
export function notifyRequestsChanged() {
  if (!view || !lk) return;
  applyPanels();
  renderControls();
}

function applyPanels() {
  if (!view) return;
  const mobile = window.matchMedia(MOBILE_MQ).matches;
  const reqShown = requestList().length > 0 && (!mobile || panels.req);
  const any = panels.people || panels.chat || reqShown;
  view.classList.toggle("panel-open", any);
  view.classList.toggle("panel-mobile", mobile);
  view.querySelector("#call-people-sec").style.display = panels.people ? "" : "none";
  view.querySelector("#call-chat-sec").style.display = panels.chat ? "" : "none";
  renderRequests();
}

// [window] onclick="toggleCallPanel('chat'|'people')"
export function togglePanel(which) {
  const mobile = window.matchMedia(MOBILE_MQ).matches;
  const next = !panels[which];
  // En celular solo cabe un panel a la vez.
  panels = mobile ? { people: false, chat: false, req: false, [which]: next } : { ...panels, [which]: next };
  applyPanels();
  renderControls();
  if (panels.chat) {
    const m = view.querySelector("#room-chat-messages");
    if (m) m.scrollTop = m.scrollHeight;
  }
}

/* ---------------- Audio remoto (aparte del video) ---------------- */

function attachAudio(track) {
  if (audioEls.has(track.sid)) return;
  const el = track.attach();
  el.dataset.sid = track.sid;
  audioEls.set(track.sid, el);
  view.querySelector("#call-audio").appendChild(el);
}

function detachAudio(track) {
  const el = audioEls.get(track.sid);
  try {
    track.detach(el);
  } catch {
    /* ya no existe */
  }
  if (el) el.remove();
  audioEls.delete(track.sid);
}

/* ---------------- Controles ---------------- */

// [window] onclick="toggleMute()"
export async function toggleMute() {
  if (!lk) return;
  try {
    await lk.localParticipant.setMicrophoneEnabled(!lk.localParticipant.isMicrophoneEnabled);
  } catch (e) {
    micError(e);
  }
  scheduleRefresh();
}

function micError(e) {
  const denied = e && (e.name === "NotAllowedError" || e.name === "SecurityError");
  const missing = e && (e.name === "NotFoundError" || e.name === "OverconstrainedError");
  showToast(
    "error",
    "No se pudo activar el micrófono",
    denied
      ? "El navegador bloqueó el permiso. Habilítalo en el candado de la barra de direcciones y vuelve a intentarlo."
      : missing
        ? "No se encontró ningún micrófono en este dispositivo."
        : e?.message || "Error desconocido",
  );
}

// [window] onclick="toggleScreenShare()"
export async function toggleScreenShare() {
  if (!lk || shareBusy) return;
  if (!shareAllowed) {
    showToast("info", "No disponible", "En esta sala solo el anfitrión puede compartir pantalla.");
    return;
  }
  if (!canShareScreen()) {
    showToast("info", "No disponible", "Este navegador o dispositivo no permite compartir pantalla.");
    return;
  }
  shareBusy = true;
  try {
    // El estado se lee de LiveKit AHORA, no de una variable guardada: si la
    // pantalla se detuvo desde el control del navegador, ya figura como apagada.
    const sharing = lk.localParticipant.isScreenShareEnabled;
    await lk.localParticipant.setScreenShareEnabled(!sharing, { audio: false });
  } catch (e) {
    // Cancelar el selector de "qué pantalla compartir" también cae aquí: no es un error real.
    if (e?.name !== "NotAllowedError" && e?.name !== "AbortError") {
      showToast("error", "No se pudo compartir pantalla", e?.message || "Error desconocido");
    }
  } finally {
    shareBusy = false;
    scheduleRefresh();
  }
}

/* ---------------- Vista ---------------- */

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${ss}` : `${m}:${ss}`;
}

function buildView() {
  view = document.createElement("div");
  view.className = "call-view";
  view.id = "room-call-view";
  view.innerHTML = `
    <div class="call-top">
      <div class="call-title">
        <div class="call-room-name">${escapeHTML(ctx.roomName)}</div>
        <span class="call-live"><span class="call-live-dot"></span>En curso</span>
      </div>
      <div class="call-top-right">
        <span class="call-meta">${icon("group")}<span id="call-count">1</span></span>
        <span class="call-meta" id="call-timer">00:00</span>
        <button class="btn btn-sm btn-d" onclick="leaveAudioCall()">${icon("logout")} Salir</button>
      </div>
    </div>
    <div class="call-body">
      <div class="call-main">
        <div class="call-tiles" id="call-tiles"></div>
        <div class="call-stage" id="call-stage"></div>
      </div>
      <aside class="call-panel">
        <section class="call-sec call-req-sec" id="call-req-sec" style="display:none">
          <div class="call-sec-title" id="call-req-title">Solicitudes de ingreso</div>
          <div class="call-people-list" id="call-req-list"></div>
        </section>
        <section class="call-sec" id="call-people-sec">
          <div class="call-sec-title" id="call-people-title">Participantes</div>
          <div class="call-people-list" id="call-people-list"></div>
        </section>
        <section class="call-sec call-sec-chat" id="call-chat-sec">
          <div class="call-chat-slot" id="call-chat-slot"></div>
        </section>
      </aside>
    </div>
    <div class="call-bar" id="call-bar"></div>
    <div id="call-audio" style="display:none"></div>
    <div class="call-connecting" id="call-connecting"><div class="loading-row"><span class="spinner"></span> Conectando…</div></div>`;
  document.body.appendChild(view);
  document.body.classList.add("call-active");
  ctx.mountChat(view.querySelector("#call-chat-slot"));
  const mobile = window.matchMedia(MOBILE_MQ).matches;
  if (mobile) panels = { people: false, chat: false, req: false };
  applyPanels();
}

function teardownView() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  for (const [, el] of audioEls) el.remove();
  audioEls.clear();
  tileEls.clear();
  if (stageVideo) {
    try {
      stageVideo._track?.detach(stageVideo);
    } catch {
      /* ya no existe */
    }
    stageVideo = null;
  }
  stageSid = null;
  if (ctx) ctx.unmountChat();
  if (view) view.remove();
  view = null;
  document.body.classList.remove("call-active");
}

/** Se llama desde rooms.js (startAudioCall). ctx ver arriba. */
export async function startCall(context) {
  if (lk) return; // ya hay una llamada en curso
  if (!window.LivekitClient) {
    showToast("error", "No se pudo cargar el audio", "El SDK de LiveKit no cargó — revisa tu conexión y recarga la página.");
    return;
  }
  ctx = context;
  panels = { people: true, chat: true, req: false };
  shareAllowed = true;
  buildView();

  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase.functions.invoke("create-livekit-token", {
      body: { room_id: ctx.roomId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    // El servidor manda la última palabra: si el token no trae permiso de pantalla, no hay forma de compartir.
    shareAllowed = ctx.canShare !== false && data.can_share_screen !== false;

    const { Room, RoomEvent } = window.LivekitClient;
    lk = new Room({ adaptiveStream: true, dynacast: true });

    const on = (ev, fn) => lk.on(ev, fn);
    on(RoomEvent.ParticipantConnected, (p) => {
      ctx.ensureUsers([p.identity]).then(scheduleRefresh);
      scheduleRefresh();
    });
    for (const ev of [
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.Reconnected,
    ]) {
      on(ev, scheduleRefresh);
    }
    on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === "audio") attachAudio(track);
      scheduleRefresh();
    });
    on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === "audio") detachAudio(track);
      scheduleRefresh();
    });
    on(RoomEvent.Reconnecting, () => showToast("info", "Reconectando…", "Se cortó la conexión un momento."));
    on(RoomEvent.MediaDevicesError, (e) => micError(e));
    on(RoomEvent.Disconnected, () => {
      if (lk) {
        showToast("info", "Llamada finalizada", "Te desconectaste de la sala.");
        leave();
      }
    });

    await lk.connect(data.url, data.token);
    await ctx.ensureUsers(allParticipants().map((p) => p.identity));
    view.querySelector("#call-connecting")?.remove();
    startedAt = Date.now();
    timerId = setInterval(() => {
      const t = view?.querySelector("#call-timer");
      if (t) t.textContent = fmtElapsed(Date.now() - startedAt);
    }, 1000);

    // Pistas de audio que ya estaban publicadas antes de entrar
    for (const p of lk.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) {
        if (pub.track && pub.kind === "audio") attachAudio(pub.track);
      }
    }
    try {
      await lk.localParticipant.setMicrophoneEnabled(true);
    } catch (e) {
      micError(e); // se entra igual, solo escuchando
    }
    lk.startAudio().catch(() => {});
    view.addEventListener("click", () => lk && lk.startAudio().catch(() => {}), { once: true });
    refresh();
  } catch (e) {
    showToast("error", "No se pudo iniciar la llamada", e.message);
    leave();
  }
}

/** Sale de la llamada y cierra la vista. Segura de llamar varias veces. */
export function leave() {
  const room = lk;
  lk = null; // antes de desconectar: evita que "Disconnected" vuelva a entrar aquí
  if (room) {
    try {
      room.disconnect();
    } catch {
      /* ya estaba cerrada */
    }
  }
  const closing = ctx;
  teardownView();
  ctx = null;
  if (closing && closing.onClosed) closing.onClosed();
}

export function isInCall() {
  return !!lk;
}

window.addEventListener("beforeunload", () => {
  if (lk) {
    try {
      lk.disconnect();
    } catch {
      /* nada */
    }
  }
});
window.matchMedia(MOBILE_MQ).addEventListener?.("change", () => {
  if (view) applyPanels();
});
