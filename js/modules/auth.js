/* ============================================================
   AUTH — pantalla de login (usuario/contraseña) y control de
   sesión de Supabase. La app real (todo lo que hoy hace init())
   no arranca hasta que requireSession() resuelve con un usuario
   logueado.
   ------------------------------------------------------------
   Usa el MISMO usuario/contraseña en todos tus PCs: el login
   aquí es la puerta de entrada, no un separador de datos por
   equipo. Si creas un usuario distinto por PC, cada uno verá
   sus propios datos, vacíos.
   ============================================================ */

import { getSupabase } from "./supabaseClient.js";

const OVERLAY_ID = "quantis-auth-overlay";

function renderLoginForm(onSubmit, errorMsg) {
  let overlay = document.getElementById(OVERLAY_ID);

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="quantis-auth-split">
      <div class="quantis-auth-left">
        <img src="img/quantis-white.svg" alt="Quantis" class="quantis-auth-logo" />
        <div class="quantis-auth-quote">
          <p>Cada operación, cada patrón, en un solo lugar.</p>
          <span>Tu diario de trading</span>
        </div>
      </div>
      <div class="quantis-auth-right">
        <div class="quantis-auth-box">
          <h2>Bienvenido de nuevo</h2>
          <p class="quantis-auth-sub">Inicia sesión para continuar en QUANTIS</p>
          <form id="quantis-auth-form">
            <label for="quantis-auth-email">Correo</label>
            <input type="email" id="quantis-auth-email" placeholder="tucorreo@ejemplo.com" required autocomplete="username" />
            <label for="quantis-auth-password">Contraseña</label>
            <input type="password" id="quantis-auth-password" placeholder="••••••••" required autocomplete="current-password" />
            ${errorMsg ? `<p class="quantis-auth-error">${errorMsg}</p>` : ""}
            <button type="submit">Entrar</button>
          </form>
        </div>
      </div>
    </div>
  `;

  overlay.querySelector("#quantis-auth-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = overlay.querySelector("#quantis-auth-email").value.trim();
    const password = overlay.querySelector("#quantis-auth-password").value;
    onSubmit(email, password);
  });
}

function renderConnectionError(message, onRetry) {
  let overlay = document.getElementById(OVERLAY_ID);

  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="quantis-auth-center">
      <div class="quantis-auth-box">
        <h2>QUANTIS</h2>
        <p class="quantis-auth-error">${message}</p>
        <button id="quantis-auth-retry">Reintentar</button>
      </div>
    </div>
  `;

  overlay.querySelector("#quantis-auth-retry").addEventListener("click", onRetry);
}

function removeOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();
}

/**
 * Bloquea hasta que exista una sesión activa. Si ya hay una sesión
 * guardada en este navegador (login previo en este PC), resuelve
 * de inmediato sin pedir nada. Si Supabase no se puede cargar (sin
 * internet, DNS bloqueado), muestra un error con botón de
 * reintentar en vez de dejar la app colgada en silencio.
 */
export function requireSession() {
  return new Promise((resolve) => {
    async function attempt() {
      let supabase;
      try {
        supabase = await getSupabase();
      } catch (error) {
        renderConnectionError(error.message, attempt);
        return;
      }

      const { data } = await supabase.auth.getSession();

      if (data?.session?.user) {
        resolve(data.session.user);
        return;
      }

      showLogin(resolve, supabase);
    }

    attempt();
  });
}

function showLogin(resolve, supabase, errorMsg) {
  renderLoginForm(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      showLogin(resolve, supabase, "Correo o contraseña incorrectos.");
      return;
    }

    removeOverlay();
    resolve(data.user);
  }, errorMsg);
}

export async function logout() {
  const supabase = await getSupabase();
  await supabase.auth.signOut();
  window.location.reload();
}

/** Pinta el nombre del usuario logueado + botón de cerrar sesión al
 * final del sidebar. Llamar una vez ya con sesión activa. */
export function renderSessionInfo(user, containerId = "sidebar-session") {
  const container = document.getElementById(containerId);
  if (!container || !user) return;

  const label = user.email || "Usuario";
  const initial = label.trim().charAt(0).toUpperCase() || "?";

  container.innerHTML = `
    <div class="sidebar-session-user" data-tooltip="${label}">
      <span class="sidebar-session-avatar">${initial}</span>
      <span class="sidebar-session-name">${label}</span>
    </div>
    <button class="sidebar-session-logout" data-tooltip="Cerrar sesión" onclick="logout()">
      <span class="material-symbols-outlined">logout</span>
    </button>
  `;
}

/* ============================================================
CIERRE POR INACTIVIDAD — si pasa este tiempo sin ningún clic,
tecla o movimiento del mouse, se cierra la sesión sola. Útil si
compartes el PC o dejas la app abierta en un equipo público.
============================================================ */

const INACTIVITY_LIMIT_MS = 60 * 60 * 1000; // 1 hora
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];

let inactivityTimer = null;

function resetInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    console.warn("QUANTIS: sesión cerrada por 1 hora de inactividad.");
    logout();
  }, INACTIVITY_LIMIT_MS);
}

/** Arranca el cronómetro de inactividad. Llamar una sola vez, después
 * de que requireSession() resuelva (ya con sesión activa). */
export function startInactivityWatcher() {
  resetInactivityTimer();
  ACTIVITY_EVENTS.forEach((evt) =>
    window.addEventListener(evt, resetInactivityTimer, { passive: true }),
  );
}
