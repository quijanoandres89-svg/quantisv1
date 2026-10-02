/* ============================================================
   ADMIN — panel de Administración (solo superadmin).
   ------------------------------------------------------------
   Busca usuarios por correo y cambia su rol (member / room_creator
   / superadmin) llamando a la función de Postgres set_user_role(),
   que es la que de verdad valida que quien llama sea superadmin —
   este módulo nunca decide permisos por su cuenta, solo pide al
   servidor que lo haga y muestra el resultado.
   Requiere haber corrido supabase_salas_setup.sql.
   ============================================================ */

import { getSupabase, getCurrentUser } from "./supabaseClient.js";
import { escapeHTML } from "./utils.js";
import { showToast } from "./toast.js";

let myRole = null;

const ROLE_LABEL = {
  member: "Miembro",
  room_creator: "Creador de salas",
  superadmin: "Superadmin",
};

/** Se llama una vez al iniciar sesión (main.js → init()). Lee el rol
 * del usuario actual y muestra/oculta el botón de nav
 * "Administración" según corresponda. */
export async function loadMyRole() {
  const user = await getCurrentUser();
  const navBtn = document.getElementById("nav-admin");
  if (!user) {
    if (navBtn) navBtn.style.display = "none";
    return null;
  }
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    myRole = data?.role || "member";
  } catch (e) {
    console.error("QUANTIS: no se pudo leer el rol del perfil:", e.message);
    myRole = null;
  }
  if (navBtn) navBtn.style.display = myRole === "superadmin" ? "" : "none";
  return myRole;
}

/** Rol del usuario actual, ya cacheado por loadMyRole(). Lo usa
 * rooms.js para decidir si mostrar el botón de "+ Nueva sala". */
export function getMyRole() {
  return myRole;
}

// [window] go('admin', ...) la dispara desde main.js
export function renderAdmin() {
  const el = document.getElementById("admin-search-result");
  if (el) el.innerHTML = "";
  const input = document.getElementById("admin-search-email");
  if (input) input.value = "";
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
  if (!query) {
    resultEl.innerHTML = "";
    return;
  }
  try {
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, display_name, role")
      .ilike("email", `%${query}%`)
      .order("email")
      .limit(15);
    if (error) throw error;
    if (!data.length) {
      resultEl.innerHTML = `<div class="empty">Sin usuarios que coincidan con ese correo</div>`;
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
