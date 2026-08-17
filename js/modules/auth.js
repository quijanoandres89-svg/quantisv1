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
    <div class="quantis-auth-box">
      <h2>QUANTIS</h2>
      <p class="quantis-auth-sub">Inicia sesión para continuar</p>
      <form id="quantis-auth-form">
        <input type="email" id="quantis-auth-email" placeholder="Correo" required autocomplete="username" />
        <input type="password" id="quantis-auth-password" placeholder="Contraseña" required autocomplete="current-password" />
        ${errorMsg ? `<p class="quantis-auth-error">${errorMsg}</p>` : ""}
        <button type="submit">Entrar</button>
      </form>
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
    <div class="quantis-auth-box">
      <h2>QUANTIS</h2>
      <p class="quantis-auth-error">${message}</p>
      <button id="quantis-auth-retry">Reintentar</button>
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
