/* ============================================================
   JOURNAL MANAGER — checklist pre-sesión, journal diario del
   día activo, y el listado de journals previos.
   ------------------------------------------------------------
   updateCL() llama a updateSessionCL(), que vive en session.js
   (Bloque 11) — dependencia hacia adelante, se prueba integrada
   cuando ese módulo exista.

   REDISEÑO (Tier 1/2/3, a pedido del usuario): la página se sentía
   "monótona y aburrida" — 21 campos con el mismo peso visual, sin
   indicación de progreso, y las mismas 21 preguntas exactas todos
   los días para siempre. Se agregó:
   - Tier 1: barra de progreso, identidad de color por fase,
     tarjetas de "reflexión profunda" con tratamiento visual propio,
     checklist con barra segmentada.
   - Tier 2: acordeón por fase (colapsa la ya completada), racha de
     journaling, banco de variantes de copy rotado por día para las
     3 preguntas de cierre más repetitivas.
   - Tier 3: autosave silencioso con indicador, resumen semanal.
   ============================================================ */

import { journals, preChecks, dayScore, setDayScore, saveJournals, CL } from "./state.js";
import { today, daysAgo, addDaysStr, isWeekend, fmtDate, weekStart, escapeHTML } from "./utils.js";
import { updateSessionCL } from "./session.js";
import { showToast } from "./toast.js";

// Campos del journal — un solo lugar, reutilizado tanto por el
// guardado explícito (saveJournal, con toast) como por el autosave
// silencioso (doAutosave, sin toast) — evita tener la misma lista de
// 21 claves duplicada en dos funciones distintas.
const JOURNAL_FIELDS = [
  "sesgo", "estado", "not", "niv", "setup", "setup-alt", "razon", "inv",
  "res", "plan", "emo", "fallo", "emofallo", "prev",
  "emergente-par", "emergente-accion", "emergente-desc",
  "sorp", "op", "apr", "dif",
];

let journalListenerAttached = false;
let autosaveTimer = null;
let autosaveErrorShown = false;

export function renderDashJournal() {
  const j = journals[today()];
  if (!j) {
    document.getElementById("dash-journal").innerHTML =
      `<div style="display:flex;align-items:center;gap:8px;color:var(--text3);font-size:12px">Sin journal hoy.<button class="btn btn-sm btn-p" style="margin-left:6px" onclick="go('journal',null)">Ir al journal</button></div>`;
    return;
  }
  document.getElementById("dash-journal").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
      <div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Sesgo</div><div style="font-size:13px;font-weight:600;margin-top:2px">${escapeHTML(j.sesgo) || "—"}</div></div>
      <div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Estado</div><div style="font-size:13px;font-weight:600;margin-top:2px">${escapeHTML(j.estado) || "—"}/10</div></div>
      <div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Calificación</div><div style="font-size:13px;font-weight:600;margin-top:2px">${escapeHTML(j.score) || "—"}/10</div></div>
    </div>
    ${j.setup ? `<div style="font-size:11px;color:var(--text3);padding:7px 9px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);font-family:var(--mono)"><strong style="color:var(--text2)">Setup:</strong> ${escapeHTML(j.setup)}</div>` : ""}
    ${j.apr ? `<div style="font-size:11px;color:var(--text3);padding:7px 9px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);margin-top:5px;font-family:var(--mono)"><strong style="color:var(--text2)">Aprendizaje:</strong> ${escapeHTML(j.apr)}</div>` : ""}`;
}

/* ------------------------------------------------------------
   Tier 2.5 — banco de variantes de copy, rotado por día
   ------------------------------------------------------------
   La misma pregunta con las mismas palabras, todos los días, para
   siempre, es una causa directa de monotonía en un hábito diario.
   Selección determinística por fecha (no aleatoria en cada render):
   el mismo día siempre muestra la misma variante, pero cambia de un
   día a otro — sin sorprender a mitad de una sesión de journaling.
   ------------------------------------------------------------ */
const PROMPT_VARIANTS = {
  apr: [
    "¿Qué aprendí HOY — una sola cosa concreta?",
    "Si tuvieras que resumir el día en una lección, ¿cuál sería?",
    "¿Qué te llevás hoy que sirva para mañana?",
    "¿Qué confirmaste hoy sobre tu propio proceso?",
  ],
  op: [
    "¿Perdí alguna oportunidad hoy? ¿Por qué?",
    "¿Hubo algo que viste y no tomaste? ¿Qué te detuvo?",
    "¿Qué setup dejaste pasar hoy, a propósito o no?",
  ],
  dif: [
    "¿Qué haría diferente? (acción concreta)",
    "Si repitieras el día, ¿qué cambiarías exactamente?",
    "¿Qué ajuste concreto harías para la próxima sesión similar?",
  ],
};

function hashDateString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function renderRotatingPrompts() {
  const seed = hashDateString(today());
  Object.keys(PROMPT_VARIANTS).forEach((field, idx) => {
    const variants = PROMPT_VARIANTS[field];
    const pick = variants[(seed + idx) % variants.length];
    const label = document.getElementById(`j-${field}-label`);
    if (label) label.textContent = pick;
  });
}

/* ------------------------------------------------------------
   Tier 2.6 — acordeón por fase
   ------------------------------------------------------------ */
// [window] onclick="toggleJPhase(n)" en la cabecera de cada fase
export function toggleJPhase(n) {
  const card = document.getElementById(`jcard-${n}`);
  if (card) card.classList.toggle("collapsed");
}

function setPhaseCollapsed(n, collapsed) {
  const card = document.getElementById(`jcard-${n}`);
  if (card) card.classList.toggle("collapsed", collapsed);
}

/* ------------------------------------------------------------
   Tier 1.1 / 1.4 — progreso general + checklist segmentado +
   checkmarks de fase completa
   ------------------------------------------------------------ */
function fieldVal(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || "").trim() : "";
}

function computeJournalProgress() {
  const planNo = fieldVal("j-plan") === "No";
  const hasEmergente = !!fieldVal("j-emergente-par");

  const phase1Fields = ["j-sesgo", "j-estado", "j-not", "j-niv", "j-setup", "j-setup-alt"];
  const phase2Fields = ["j-razon", "j-inv"];
  const phase3Fields = ["j-res", "j-plan", "j-emo", "j-sorp"]
    .concat(planNo ? ["j-fallo", "j-emofallo", "j-prev"] : [])
    .concat(hasEmergente ? ["j-emergente-accion", "j-emergente-desc"] : []);
  const phase4Fields = ["j-op", "j-apr", "j-dif"];

  const countFilled = (ids) => ids.filter((id) => fieldVal(id) !== "").length;

  const checklistDone = CL.length
    ? Object.values(preChecks).filter(Boolean).length === CL.length
    : true;

  const perPhase = [
    { n: 1, filled: countFilled(phase1Fields), total: phase1Fields.length },
    {
      n: 2,
      filled: countFilled(phase2Fields) + (checklistDone ? 1 : 0),
      total: phase2Fields.length + 1, // +1 = el checklist cuenta como un "campo" de la fase
    },
    { n: 3, filled: countFilled(phase3Fields), total: phase3Fields.length },
    {
      n: 4,
      filled: countFilled(phase4Fields) + (dayScore ? 1 : 0),
      total: phase4Fields.length + 1, // +1 = la calificación 1-10
    },
  ];

  const overallFilled = perPhase.reduce((a, p) => a + p.filled, 0);
  const overallTotal = perPhase.reduce((a, p) => a + p.total, 0);

  return { perPhase, overallFilled, overallTotal };
}

// [window] no expuesta directamente — se llama desde los listeners internos
export function updateJournalProgress() {
  const { perPhase, overallFilled, overallTotal } = computeJournalProgress();

  const fill = document.getElementById("jprog-fill");
  const label = document.getElementById("jprog-label");
  if (fill) fill.style.width = `${overallTotal ? Math.round((overallFilled / overallTotal) * 100) : 0}%`;
  if (label) label.textContent = `${overallFilled} / ${overallTotal}`;

  perPhase.forEach((p) => {
    const check = document.getElementById(`jcheck-${p.n}`);
    if (check) check.classList.toggle("show", p.total > 0 && p.filled === p.total);
  });

  // Checklist segmentado (7 casilleros) — un solo lugar que lo dibuja,
  // llamado también desde updateCL() cada vez que se marca un ítem.
  const segbar = document.getElementById("cl-segbar");
  if (segbar && CL.length) {
    const n = Object.values(preChecks).filter(Boolean).length;
    segbar.innerHTML = CL.map((_, i) => `<div class="cl-seg${i < n ? " on" : ""}"></div>`).join("");
  }
}

/* ------------------------------------------------------------
   Tier 2.7 / 3.9 — racha de journaling + resumen semanal
   ------------------------------------------------------------ */
export function computeJournalStreak() {
  // Cuenta hacia atrás día a día, pero el sábado y el domingo NO
  // rompen la racha ni la hacen avanzar — forex cierra el viernes y
  // recién reabre el domingo en la noche, así que un fin de semana
  // "vacío" no es un día perdido, es simplemente que no había mercado.
  // Si hoy ya tiene journal, arranca en hoy; si no, arranca ayer, para
  // que el contador no se vea "roto" a mitad del día de hoy solo
  // porque todavía no llegaste a guardar.
  let streak = 0;
  let i = journals[today()] ? 0 : 1;
  for (let guard = 0; guard < 400; guard++) {
    const d = daysAgo(i);
    if (isWeekend(d)) {
      i++;
      continue;
    }
    if (journals[d]) {
      streak++;
      i++;
    } else break;
  }
  return streak;
}

function computeWeekCount() {
  // Solo lunes a viernes (5 días reales de mercado) — antes decía
  // "de 7 días", lo cual no aplica a forex: sábado y domingo no son
  // días en los que se pueda haber journaleado.
  const ws = weekStart(today());
  let filled = 0;
  for (let i = 0; i < 5; i++) {
    if (journals[addDaysStr(ws, i)]) filled++;
  }
  return { filled, total: 5 };
}

/** Recorre TODO el historial de journals (no solo hacia atrás desde
 * hoy, como computeJournalStreak) y devuelve la racha más larga que
 * hayas tenido alguna vez. Misma regla de fin de semana: sábado y
 * domingo no cuentan como día perdido. */
export function computeBestJournalStreak() {
  const dates = Object.keys(journals).sort();
  if (!dates.length) return 0;
  let best = 0;
  let current = 0;
  let prev = null;
  for (const d of dates) {
    if (prev) {
      let cursor = addDaysStr(prev, 1);
      let brokenByWeekday = false;
      while (cursor < d) {
        if (!isWeekend(cursor)) {
          brokenByWeekday = true;
          break;
        }
        cursor = addDaysStr(cursor, 1);
      }
      if (brokenByWeekday) current = 0;
    }
    current++;
    if (current > best) best = current;
    prev = d;
  }
  return best;
}

// Hitos que celebran la racha ACTUAL (no la histórica) con un toast.
// localStorage (no Supabase) porque es puramente cosmético por
// dispositivo — no hace falta sincronizarlo entre PCs.
const STREAK_MILESTONES = [7, 30, 60, 100, 150, 200, 365];
const STREAK_MILESTONE_KEY = "quantis_last_streak_milestone";

function checkStreakMilestone(streak) {
  const last = parseInt(localStorage.getItem(STREAK_MILESTONE_KEY) || "0", 10);
  const reached = STREAK_MILESTONES.filter((m) => streak >= m && m > last).pop();
  if (!reached) return;
  localStorage.setItem(STREAK_MILESTONE_KEY, String(reached));
  showToast(
    "success",
    `🔥 ${reached} días seguidos`,
    "Racha de journaling — la disciplina se está volviendo hábito.",
  );
}

/** Misma racha que se muestra dentro del Journal, pero renderizada en
 * el pie del sidebar (siempre visible, sin necesidad de abrir el
 * Journal). Se llama al arrancar la app y cada vez que se guarda un
 * journal (manual o autosave), que es el único momento en que la
 * racha puede cambiar. */
// [window] no expuesta directamente — la llama main.js en init()
export function renderSidebarStreak() {
  const el = document.getElementById("sidebar-streak");
  const n = document.getElementById("sidebar-streak-n");
  if (!el || !n) return;
  const streak = computeJournalStreak();
  const best = computeBestJournalStreak();
  n.textContent = streak;
  el.title =
    streak > 0
      ? `${streak} día${streak === 1 ? "" : "s"} seguido${streak === 1 ? "" : "s"} journaleando · Mejor racha: ${best}`
      : "";
  el.style.display = streak > 0 ? "flex" : "none";
  checkStreakMilestone(streak);
}

function renderJournalMeta() {
  const el = document.getElementById("journal-meta");
  if (!el) return;
  const streak = computeJournalStreak();
  const best = computeBestJournalStreak();
  const week = computeWeekCount();
  el.innerHTML = `
    ${
      streak > 0
        ? `<div class="jmeta-pill streak"><span class="material-symbols-outlined">local_fire_department</span>${streak} día${streak === 1 ? "" : "s"} seguido${streak === 1 ? "" : "s"}</div>`
        : ""
    }
    ${
      best > 0
        ? `<div class="jmeta-pill"><span class="material-symbols-outlined">emoji_events</span>Mejor racha: ${best}</div>`
        : ""
    }
    <div class="jmeta-pill"><span class="material-symbols-outlined">calendar_month</span>${week.filled} de ${week.total} días esta semana</div>`;
  renderSidebarStreak();
}

/* ------------------------------------------------------------
   Tier 3.8 — autosave silencioso
   ------------------------------------------------------------ */
function collectJournalFields() {
  const j = { score: dayScore, savedAt: new Date().toISOString() };
  JOURNAL_FIELDS.forEach((k) => {
    const el = document.getElementById("j-" + k);
    if (el) j[k] = el.value;
  });
  return j;
}

function setAutosaveIndicator(text, saving) {
  const el = document.getElementById("j-autosave");
  if (!el) return;
  el.classList.toggle("saving", !!saving);
  el.innerHTML = `<span class="material-symbols-outlined">${saving ? "sync" : "check_circle"}</span>${text}`;
}

function doAutosave() {
  const prev = journals[today()];
  journals[today()] = collectJournalFields();
  const saved = saveJournals();
  if (!saved) {
    if (prev) journals[today()] = prev;
    else delete journals[today()];
    setAutosaveIndicator("No se pudo guardar automáticamente", false);
    if (!autosaveErrorShown) {
      autosaveErrorShown = true;
      showToast(
        "error",
        "Autosave falló",
        "El almacenamiento local está lleno. Guarda manualmente y libera espacio.",
      );
    }
    return;
  }
  const hora = new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  setAutosaveIndicator(`Guardado automáticamente · ${hora}`, false);
  renderJournalMeta();
}

function scheduleAutosave() {
  setAutosaveIndicator("Guardando…", true);
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(doAutosave, 1500);
}

function onJournalPageInput() {
  updateJournalProgress();
  scheduleAutosave();
}

// [window] go('journal', ...) la dispara desde main.js
export function initJournal() {
  document.getElementById("journal-date").textContent = fmtDate(today());
  document.getElementById("pre-cl").innerHTML = CL.map(
    (c) => `
    <label class="cli"><input class="cl-check" type="checkbox" id="${c.id}" onchange="updateCL()" ${preChecks[c.id] ? "checked" : ""}>
    <div><div class="clt">${c.t}</div><div class="cls">${c.s}</div></div></label>`,
  ).join("");
  updateCL();
  renderScoreRow();
  renderRotatingPrompts();
  renderJournalMeta();

  const j = journals[today()];
  if (j) {
    JOURNAL_FIELDS.forEach((k) => {
      const el = document.getElementById("j-" + k);
      if (el && j[k] != null) el.value = j[k];
    });
    if (j.score) {
      setDayScore(j.score);
      renderScoreRow();
    }
    if (j.plan === "No")
      document.getElementById("fallo-sec").style.display = "block";
    if (j["emergente-par"]) {
      document.getElementById("j-emergente-box").style.display = "block";
    }
  }
  document.getElementById("j-plan").addEventListener("change", toggleFallo);
  document
    .getElementById("j-emergente-par")
    .addEventListener("change", toggleEmergente);

  // Colapso inicial inteligente: abre la primera fase incompleta,
  // colapsa las que ya están completas — así la página no arranca
  // como un scroll largo de las 4 fases a la vez. Si es un journal
  // nuevo (sin datos), solo la fase 1 queda abierta (orden natural de
  // un día de trading: preparación -> checklist -> post-trade ->
  // cierre).
  const { perPhase } = computeJournalProgress();
  let firstIncompleteFound = false;
  perPhase.forEach((p) => {
    const complete = p.total > 0 && p.filled === p.total;
    if (complete) {
      setPhaseCollapsed(p.n, true);
    } else if (!firstIncompleteFound) {
      setPhaseCollapsed(p.n, false);
      firstIncompleteFound = true;
    } else {
      setPhaseCollapsed(p.n, true);
    }
  });

  updateJournalProgress();
  if (j) setAutosaveIndicator("Sin cambios sin guardar", false);
  else document.getElementById("j-autosave").innerHTML = "";

  // Listener delegado, una sola vez (initJournal() corre cada vez que
  // se navega a la página) — progreso en vivo mientras se escribe +
  // autosave debounced.
  if (!journalListenerAttached) {
    const page = document.getElementById("page-journal");
    page.addEventListener("input", onJournalPageInput);
    page.addEventListener("change", onJournalPageInput);
    journalListenerAttached = true;
  }
  autosaveErrorShown = false;
}

// [window] onchange="updateCL()" en cada checkbox del checklist
export function updateCL() {
  CL.forEach((c) => {
    preChecks[c.id] = document.getElementById(c.id)?.checked;
  });
  const n = Object.values(preChecks).filter(Boolean).length,
    tot = CL.length,
    pass = n === tot;
  document.getElementById("cl-res").innerHTML =
    `<div class="clr ${pass ? "clpass" : "clfail"}">${pass ? " " : " "} ${n}/${tot} — ${pass ? "Checklist completo. Puedes operar." : "Completa todo antes de operar."}</div>`;
  updateSessionCL();
  updateJournalProgress();
  scheduleAutosave();
}

export function toggleEmergente() {
  const par = document.getElementById("j-emergente-par").value;
  document.getElementById("j-emergente-box").style.display = par
    ? "block"
    : "none";
  updateJournalProgress();
}

export function toggleFallo() {
  document.getElementById("fallo-sec").style.display =
    document.getElementById("j-plan").value === "No" ? "block" : "none";
  updateJournalProgress();
}

export function renderScoreRow() {
  document.getElementById("score-row").innerHTML = Array.from(
    { length: 10 },
    (_, i) => i + 1,
  )
    .map(
      (n) =>
        `<button class="scbtn ${dayScore === n ? "sel" : ""}" onclick="setScore(${n})">${n}</button>`,
    )
    .join("");
}

// [window] onclick="setScore(n)" en los botones 1-10 del score
export function setScore(n) {
  setDayScore(n);
  renderScoreRow();
  updateJournalProgress();
  scheduleAutosave();
}

// [window] onclick="saveJournal()"
export function saveJournal() {
  const prev = journals[today()];
  journals[today()] = collectJournalFields();
  const saved = saveJournals();
  if (!saved) {
    // Mismo caso que saveTrade(): si la escritura falla (cuota llena),
    // se revierte al valor anterior en memoria en vez de dejar un
    // journal "guardado" que en realidad no persistió.
    if (prev) journals[today()] = prev;
    else delete journals[today()];
    showToast(
      "error",
      "No se pudo guardar el journal",
      "El almacenamiento local está lleno. Libera espacio y vuelve a intentar.",
    );
    return;
  }
  clearTimeout(autosaveTimer);
  setAutosaveIndicator("Guardado", false);
  renderJournalMeta();
  showToast("success", "Journal guardado", "");
}

// [window] go('journals', ...) la dispara desde main.js
export function renderJournals() {
  const dates = Object.keys(journals).sort().reverse();
  if (!dates.length) {
    document.getElementById("journals-list").innerHTML =
      `<div class="empty">Sin journals guardados todavía</div>`;
    return;
  }
  document.getElementById("journals-list").innerHTML = dates
    .map((d) => {
      const j = journals[d];
      return `<div class="ji" onclick="toggleJ('jd-${d.replace(/-/g, "")}')">
      <div class="jh">
        <div class="jdate">${fmtDate(d)}</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${j.sesgo ? `<span class="badge binf">${escapeHTML(j.sesgo)}</span>` : ""}
          ${j.res && j.res !== "Sin trade hoy" ? `<span class="badge b${escapeHTML(String(j.res).toLowerCase())}">${escapeHTML(j.res)}</span>` : ""}
          ${j.score ? `<span class="badge" style="background:var(--bg3);color:var(--text2);border:1px solid var(--border)">${escapeHTML(j.score)}/10</span>` : ""}
          ${j.plan === "No" ? `<span class="badge bno">Fallo</span>` : ""}
        </div>
      </div>
      ${j.setup ? `<div class="jprev">Setup: ${escapeHTML(j.setup.slice(0, 90))}${j.setup.length > 90 ? "..." : ""}</div>` : ""}
      <div class="jdet" id="jd-${d.replace(/-/g, "")}">
        ${j.niv ? `<div class="jf"><div class="jfl">Niveles</div><div class="jfv">${escapeHTML(j.niv)}</div></div>` : ""}
        ${j.razon ? `<div class="jf"><div class="jfl">Razón de entrada</div><div class="jfv">${escapeHTML(j.razon)}</div></div>` : ""}
        ${j["setup-alt"] ? `<div class="jf"><div class="jfl">Setup alternativo</div><div class="jfv">${escapeHTML(j["setup-alt"])}</div></div>` : ""}
        ${j["emergente-par"] ? `<div class="jf"><div class="jfl">Setup emergente</div><div class="jfv"><strong>${escapeHTML(j["emergente-par"])}</strong> — ${escapeHTML(j["emergente-accion"] || "")}<br>${escapeHTML(j["emergente-desc"] || "")}</div></div>` : ""}
        ${j.sorp ? `<div class="jf"><div class="jfl">¿Qué pasó?</div><div class="jfv">${escapeHTML(j.sorp)}</div></div>` : ""}
        ${j.img ? `<div class="jf"><div class="jfl">Screenshot</div><img src="${escapeHTML(j.img)}" class="img-thumb" onclick="toggleImgFull(this)" title="Click para expandir"></div>` : ""}
        ${j.op ? `<div class="jf"><div class="jfl">Oportunidades</div><div class="jfv">${escapeHTML(j.op)}</div></div>` : ""}
        ${j.apr ? `<div class="jf"><div class="jfl">Aprendizaje</div><div class="jfv">${escapeHTML(j.apr)}</div></div>` : ""}
        ${j.dif ? `<div class="jf"><div class="jfl">¿Qué haría diferente?</div><div class="jfv">${escapeHTML(j.dif)}</div></div>` : ""}
        ${j.plan === "No" && j.fallo ? `<div class="jf"><div class="jfl" style="color:var(--red)">Regla violada</div><div class="jfv" style="border-color:var(--rbr)">${escapeHTML(j.fallo)}</div></div>` : ""}
        ${j.plan === "No" && j.prev ? `<div class="jf"><div class="jfl" style="color:var(--yellow)">Acción preventiva</div><div class="jfv" style="border-color:var(--ybr)">${escapeHTML(j.prev)}</div></div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

// [window] onclick="toggleJ('jd-...')"
export function toggleJ(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("open");
}
