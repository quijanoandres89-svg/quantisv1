/* ============================================================
   ADMIN — panel de Administración (solo superadmin) + perfil propio.
   ------------------------------------------------------------
   Dos responsabilidades relacionadas pero distintas:
   1) Buscar usuarios y cambiar su rol (member / room_creator /
      superadmin) vía set_user_role() — solo superadmin puede, y lo
      valida el servidor, no este archivo.
   2) Cachear el PROPIO perfil del usuario actual (nombre, correo,
      rol) para que el resto de la app (sidebar, Configuración →
      Perfil, rooms.js) lo use sin volver a pedirlo cada vez, y
      mantenerlo al día en vivo si el superadmin te cambia el rol
      mientras tienes Quantis abierto.
   Requiere haber corrido supabase_salas_setup.sql.
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";
import { escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";

let myProfile = null; // { id, email, display_name, role }
let roleChangeChannel = null;

export const ROLE_LABEL = {
  member: "Miembro",
  room_creator: "Creador de salas",
  superadmin: "Superadmin",
};

function applyNavVisibility() {
  const navBtn = document.getElementById("nav-admin");
  if (navBtn) navBtn.style.display = myProfile?.role === "superadmin" ? "" : "none";
}

/** Si la sección Perfil de Configuración está abierta en este
 * momento, refresca sus campos de correo/rol con el valor actual —
 * así un cambio de rol en vivo (Realtime) se ve sin recargar. El
 * campo Nombre no se toca acá para no pisar lo que el usuario esté
 * escribiendo. */
function refreshOpenProfileSection() {
  const roleEl = document.getElementById("profile-role-display");
  if (roleEl && myProfile) roleEl.value = ROLE_LABEL[myProfile.role] || myProfile.role;
}

/** Se llama una vez al iniciar sesión (main.js → init()). Carga el
 * perfil completo del usuario actual, muestra/oculta el nav de
 * Administración, y se suscribe a cambios en vivo de SU PROPIA fila
 * (ej. si el superadmin le cambia el rol mientras está conectado). */
export async function loadMyRole() {
  const user = await getCurrentUser();
  if (!user) {
    myProfile = null;
    applyNavVisibility();
    return null;
  }
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, display_name, role")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    myProfile = data;
  } catch (e) {
    console.error("QUANTIS: no se pudo leer el perfil propio:", e.message);
    myProfile = null;
  }
  applyNavVisibility();
  subscribeToOwnRoleChanges(user.id);
  return myProfile?.role || null;
}

async function subscribeToOwnRoleChanges(userId) {
  const supabase = await getSupabase();
  if (roleChangeChannel) roleChangeChannel.unsubscribe();
  roleChangeChannel = supabase
    .channel(`own-profile-${userId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` },
      (payload) => {
        const prevRole = myProfile?.role;
        myProfile = payload.new;
        applyNavVisibility();
        refreshOpenProfileSection();
        if (prevRole && prevRole !== payload.new.role) {
          showToast(
            "info",
            "Tu rol cambió",
            `Ahora eres ${ROLE_LABEL[payload.new.role] || payload.new.role}.`,
          );
        }
      },
    )
    .subscribe();
}

/** Rol del usuario actual, ya cacheado por loadMyRole(). Lo usa
 * rooms.js para decidir si mostrar el botón de "+ Nueva sala". */
export function getMyRole() {
  return myProfile?.role || null;
}

/** Perfil completo del usuario actual (id, email, display_name,
 * role), cacheado por loadMyRole(). Lo usa settingsPanel.js para
 * pintar la sección Perfil. */
export function getMyProfile() {
  return myProfile;
}

// [window] onclick="saveMyDisplayName()" en Configuración → Perfil
export async function saveMyDisplayName(newName) {
  const name = (newName || "").trim();
  if (!name) {
    showToast("error", "Falta el nombre", "El nombre no puede quedar vacío.");
    return false;
  }
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("update_my_display_name", { new_name: name });
    if (error) throw error;
    if (myProfile) myProfile.display_name = name;
    showToast("success", "Nombre actualizado", name);
    return true;
  } catch (e) {
    showToast("error", "No se pudo actualizar el nombre", e.message);
    return false;
  }
}

// [window] go('admin', ...) la dispara desde main.js
export function renderAdmin() {
  const input = document.getElementById("admin-search-email");
  if (input) input.value = "";
  searchUserByEmail(); // sin texto en el buscador, esto trae TODOS los usuarios
}

function roleButtonsHTML(profile) {
  return Object.keys(ROLE_LABEL)
    .map(
      (r) =>
        `<button class="btn btn-sm" ${r === profile.role ? "disabled" : ""} onclick="setUserRole(${JSON.stringify(profile.email)}, '${r}')">${ROLE_LABEL[r]}</button>`,
    )
    .join("");
}

// [window] onclick="searchUserByEmail()" / oninput en el buscador
export async function searchUserByEmail() {
  const query = (document.getElementById("admin-search-email")?.value || "").trim();
  const resultEl = document.getElementById("admin-search-result");
  if (!resultEl) return;
  try {
    const supabase = await getSupabase();
    let req = supabase
      .from("profiles")
      .select("id, email, display_name, role")
      .order("email")
      .limit(100);
    if (query) req = req.ilike("email", `%${query}%`);
    const { data, error } = await req;
    if (error) throw error;
    if (!data.length) {
      resultEl.innerHTML = query
        ? `<div class="empty">Sin usuarios que coincidan con ese correo</div>`
        : `<div class="empty">Todavía no hay usuarios registrados</div>`;
      return;
    }
    resultEl.innerHTML = data
      .map(
        (p) => `<div class="ji" style="cursor:default">
        <div class="jh">
          <div class="jdate">${escapeHTML(p.display_name || p.email)}</div>
          <span class="badge binf">${ROLE_LABEL[p.role] || p.role}</span>
        </div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:8px">${escapeHTML(p.email)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${roleButtonsHTML(p)}</div>
      </div>`,
      )
      .join("");
  } catch (e) {
    resultEl.innerHTML = `<div class="empty">Error buscando: ${escapeHTML(e.message)}</div>`;
  }
}

// [window] onclick="setUserRole(email, role)" en los botones de rol
export async function setUserRole(email, role) {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.rpc("set_user_role", {
      target_email: email,
      new_role: role,
    });
    if (error) throw error;
    showToast("success", "Rol actualizado", `${email} ahora es ${ROLE_LABEL[role]}`);
    searchUserByEmail();
  } catch (e) {
    showToast("error", "No se pudo cambiar el rol", e.message);
  }
}
