/* ============================================================
   NAV UI — comportamiento del menú lateral (Fase I)
   ------------------------------------------------------------
   - Las secciones (Principal, Sesión, Análisis...) se pliegan y
     recuerdan su estado (localStorage). Si navegas a una pantalla
     que está dentro de una sección plegada, se despliega sola.
   - Cuando la lista de pantallas es más larga que el alto de la
     ventana, hace scroll SOLO en el medio: el logo, "Puedes operar"
     y el challenge quedan fijos arriba, y la racha, tu usuario y
     Configuración fijos abajo. Una sombra suave arriba/abajo avisa
     que hay más contenido.
   El HTML de los botones no cambia: aquí solo se agrupan en
   contenedores plegables (los botones conservan su onclick).
   ============================================================ */

const LS_KEY = "quantis_nav_collapsed";

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}
function saveCollapsed(set) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify([...set]));
  } catch {
    /* sin espacio: no pasa nada, solo no se recuerda */
  }
}

function setGroup(sec, group, collapsed) {
  group.classList.toggle("collapsed", collapsed);
  sec.setAttribute("aria-expanded", String(!collapsed));
}

export function initNavUi() {
  const nav = document.querySelector("#sidebar .nav");
  if (!nav || nav.dataset.ready) return;
  nav.dataset.ready = "1";
  const collapsed = loadCollapsed();
  const secs = [...nav.querySelectorAll(":scope > .nav-sec")];

  for (const label of secs) {
    const name = label.textContent.trim();
    // El título pasa a ser un botón con flecha.
    const sec = document.createElement("button");
    sec.type = "button";
    sec.className = "nav-sec";
    sec.dataset.name = name; // nombre "limpio" (el texto del botón incluye el icono de la flecha)
    sec.innerHTML = `<span>${name}</span><span class="material-symbols-outlined chev">expand_more</span>`;
    // Todo lo que hay hasta el siguiente título va a un grupo plegable.
    const group = document.createElement("div");
    group.className = "nav-group";
    const inner = document.createElement("div");
    inner.className = "nav-group-inner";
    group.appendChild(inner);
    let next = label.nextElementSibling;
    while (next && !next.classList.contains("nav-sec")) {
      const after = next.nextElementSibling;
      inner.appendChild(next);
      next = after;
    }
    label.replaceWith(sec);
    sec.after(group);
    setGroup(sec, group, collapsed.has(name));
    sec.addEventListener("click", () => {
      const now = !group.classList.contains("collapsed");
      setGroup(sec, group, now);
      if (now) collapsed.add(name);
      else collapsed.delete(name);
      saveCollapsed(collapsed);
      updateFades();
    });
  }

  // Al activarse una pantalla dentro de una sección plegada, se despliega.
  // Solo reacciona cuando cambia la clase de un BOTÓN de pantalla (.ni); si reaccionara
  // también a los cambios de los grupos, al plegar la sección donde estás se volvería a abrir sola.
  new MutationObserver((muts) => {
    if (!muts.some((m) => m.target.classList.contains("ni") && m.target.classList.contains("active"))) return;
    const active = nav.querySelector(".ni.active");
    const group = active && active.closest(".nav-group.collapsed");
    if (group) {
      const sec = group.previousElementSibling;
      setGroup(sec, group, false);
      collapsed.delete(sec.dataset.name);
      saveCollapsed(collapsed);
    }
  }).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });

  // Sombras de "hay más arriba/abajo".
  function updateFades() {
    const top = nav.scrollTop > 4;
    const bottom = nav.scrollHeight - nav.clientHeight - nav.scrollTop > 4;
    nav.classList.toggle("fade-top", top);
    nav.classList.toggle("fade-bottom", bottom);
  }
  nav.addEventListener("scroll", updateFades, { passive: true });
  window.addEventListener("resize", updateFades);
  new ResizeObserver(updateFades).observe(nav);
  setTimeout(updateFades, 300); // tras la animación de pliegue inicial
}
