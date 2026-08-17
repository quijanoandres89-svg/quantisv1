/* ============================================================
   CHALLENGE MANAGER — progreso del challenge activo, CRUD de
   challenges y el modal genérico open/close (usado también por
   Plantillas más adelante).
   ------------------------------------------------------------
   challengeRiskResolver() vive en tradeManager.js (la necesitaba
   primero, en la Entrega 4 bloque 5) — aquí solo se importa, para
   no duplicar la decisión de Fijo/Dinámico en dos lugares.
   ============================================================ */

import {
  challenges,
  saveChallenges,
  load,
  balanceC,
  ddC,
  setChart,
} from "./state.js";
import { today, fmtShort, themeColors, escapeHTML } from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { trades } from "./state.js";
import { challengeRiskResolver } from "./tradeManager.js";
import { populateRuleSetSelect } from "./ruleEngine.js";
import {
  renderMonitorBadge,
  renderMonitorDetailed,
} from "./challengeMonitor.js";
import { showToast } from "./toast.js";

// [window] onclick="openModal('modal-ch')" / usado también por plantillas.js
export function openModal(id) {
  document.getElementById(id).classList.add("open");
}

// [window] onclick="closeModal('modal-ch')" / usado también por plantillas.js
export function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

/** Progreso financiero y de reglas de un Challenge (netUSD, drawdown, etc.). */
export function calcChProgress(ch) {
  const inicio = ch.inicio || today();
  const chTrades = trades.filter(
    (t) => t.challengeSnapshot?.challengeId === ch.id,
  );
  const series = TradeEngine.equitySeries(
    chTrades,
    ch.size,
    challengeRiskResolver(ch),
  );
  const last = series[series.length - 1];
  const riskUSD = last
    ? last.riskUSD
    : TradeEngine.riskUSD(ch.size, ch.riesgo || 1);
  const netRR = TradeEngine.netRR(chTrades);
  const netUSD = last ? last.balanceDespues - ch.size : 0;
  const targetUSD = (ch.size * parseFloat(ch.target)) / 100;
  const pct =
    targetUSD > 0
      ? Math.min(100, Math.max(0, Math.round((netUSD / targetUSD) * 100)))
      : 0;
  const dayLossUSD = TradeEngine.dayLossUSDFromSeries(series, today());
  const dayLossPct = ch.size > 0 ? (dayLossUSD / ch.size) * 100 : 0;
  const totalLoss = Math.max(0, -netUSD);
  const totalLossPct = ch.size > 0 ? (totalLoss / ch.size) * 100 : 0;
  const diasPasados = Math.floor(
    (new Date() - new Date(inicio + "T12:00:00")) / 86400000,
  );
  const diasRestantes =
    ch.dias > 0 ? Math.max(0, parseInt(ch.dias) - diasPasados) : null;
  const wins = chTrades.filter((t) => t.res === "TP").length;
  const decisivosC = chTrades.filter(
    (t) => t.res === "TP" || t.res === "SL",
  ).length;
  const wr = decisivosC ? Math.round((wins / decisivosC) * 100) : 0;
  const failed = totalLossPct >= parseFloat(ch.maxTotal);
  const completed = pct >= 100;
  const balance = last ? last.balanceDespues : ch.size;
  const dd = TradeEngine.drawdown(series);
  return {
    netRR,
    netUSD,
    targetUSD,
    pct,
    dayLossPct,
    totalLossPct,
    diasRestantes,
    diasPasados,
    chTrades,
    riskUSD,
    wr,
    wins,
    failed,
    completed,
    balance,
    drawdownUSD: dd.currentDD,
    drawdownPct: dd.currentDDPct,
  };
}

// [window] onclick="go('challenge', this)" dispara esto vía go() en main.js
export function renderChallenges() {
  load();
  const el = document.getElementById("challenge-list");
  renderChSidebar();
  if (!challenges.length) {
    el.innerHTML =
      '<div class="empty">Sin challenges. Crea el primero arriba.</div>';
    return;
  }
  el.innerHTML = challenges
    .map((ch, i) => {
      const p = calcChProgress(ch);
      const color =
        p.pct >= 80
          ? "var(--green)"
          : p.pct >= 40
            ? "var(--yellow)"
            : "var(--acc)";
      const status = p.failed
        ? "&#10060; Fallido"
        : p.completed
          ? "&#9989; Completado"
          : "&#128260; En curso";
      const dayAlert = p.dayLossPct >= parseFloat(ch.maxDay) * 0.8;
      const totalAlert = p.totalLossPct >= parseFloat(ch.maxTotal) * 0.8;
      return `<div class="ch-card ${ch.active ? "active-ch" : ""}">
      ${ch.active ? '<div class="ch-active-badge">ACTIVO</div>' : ""}
      <div class="ch-name">${escapeHTML(ch.nombre)}</div>
      <div class="ch-meta">${escapeHTML(ch.firma) || "Sin firma"} &middot; $${Number(ch.size).toLocaleString()} &middot; Riesgo: ${ch.riesgo || 1}% (${escapeHTML(ch.tipoRiesgo) || "Fijo"}) &middot; Fase: ${escapeHTML(ch.fase) || "Evaluacion"} &middot; Inicio: ${fmtShort(ch.inicio)} &middot; ${status}</div>
      ${
        dayAlert
          ? `<div class="alert ae" style="margin-bottom:10px"><span class="material-symbols-outlined icons">
disabled_by_default
</span> Perdida diaria: ${p.dayLossPct.toFixed(1)}% / limite ${ch.maxDay}%</div>`
          : ""
      }
      ${
        totalAlert
          ? `<div class="alert ae" style="margin-bottom:10px"><span class="material-symbols-outlined icons">
disabled_by_default
</span> Perdida total: ${p.totalLossPct.toFixed(1)}% / limite ${ch.maxTotal}%</div>`
          : ""
      }
      <div class="ch-stats">
        <div class="ch-stat"><div class="ch-sv" style="color:${p.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${p.netUSD >= 0 ? "+" : ""}$${p.netUSD.toFixed(0)}</div><div class="ch-sl">P&amp;L USD</div></div>
        <div class="ch-stat"><div class="ch-sv" style="color:${p.wr >= 50 ? "var(--green)" : "var(--red)"}">${p.wr}%</div><div class="ch-sl">Win rate</div></div>
        <div class="ch-stat"><div class="ch-sv" style="color:${p.totalLossPct >= parseFloat(ch.maxTotal) * 0.7 ? "var(--red)" : "var(--text)"}">${p.totalLossPct.toFixed(1)}%</div><div class="ch-sl">Perd. total</div></div>
        <div class="ch-stat"><div class="ch-sv">${p.diasRestantes !== null ? p.diasRestantes : "&infin;"}</div><div class="ch-sl">Dias rest.</div></div>
      </div>
      <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-bottom:4px">Objetivo: ${p.pct}% &middot; $${p.netUSD.toFixed(0)} / $${p.targetUSD.toFixed(0)} &middot; ${p.chTrades.length} trades</div>
      <div class="prog-wrap"><div class="prog-fill" style="width:${p.pct}%;background:${color}"></div></div>
      <div style="margin-top:6px;font-size:10px;color:var(--text3);font-family:var(--mono)">
        Limite diario: ${ch.maxDay}% ($${((ch.size * ch.maxDay) / 100).toFixed(0)}) &middot;
        Limite total: ${ch.maxTotal}% ($${((ch.size * ch.maxTotal) / 100).toFixed(0)}) &middot;
        Objetivo: ${ch.target}% ($${((ch.size * ch.target) / 100).toFixed(0)})
      </div>
      <div class="divider"></div>
      <div class="ct" style="margin-bottom:2px">Monitor de reglas</div>
      ${renderMonitorDetailed(ch)}
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${!ch.active ? `<button class="btn btn-p btn-sm" onclick="setActive(${i})">Activar</button>` : ""}
        <button class="btn btn-sm" onclick="editChallenge(${i})">Editar</button>
        <button class="btn btn-d btn-sm" onclick="deleteChallenge(${i})">Eliminar</button>
      </div>
    </div>`;
    })
    .join("");
  renderChallengeCurves();
}

/**
 * Balance Curve + Drawdown Curve del Challenge ACTIVO (Fase 3 —
 * Entrega 10). Reutiliza TradeEngine.equitySeries (Entrega 1) y
 * runningDrawdownFromValues (Entrega 10) — ningún cálculo nuevo,
 * solo visualización.
 */
function renderChallengeCurves() {
  const ac = challenges.find((c) => c.active);
  const emptyEl = document.getElementById("ch-curves-empty");
  const bodyEl = document.getElementById("ch-curves-body");
  if (balanceC) {
    balanceC.destroy();
    setChart("balanceC", null);
  }
  if (ddC) {
    ddC.destroy();
    setChart("ddC", null);
  }
  if (!ac) {
    emptyEl.innerHTML = `<div class="empty">No hay ningún Challenge activo — activa uno para ver su Balance y Drawdown acá.</div>`;
    bodyEl.style.display = "none";
    return;
  }
  const inicio = ac.inicio || today();
  const T = themeColors();
  const chTrades = trades.filter(
    (t) => t.challengeSnapshot?.challengeId === ac.id,
  );
  const series = TradeEngine.equitySeries(
    chTrades,
    ac.size,
    challengeRiskResolver(ac),
  );
  if (!series.length) {
    emptyEl.innerHTML = `<div class="empty">"${escapeHTML(ac.nombre)}" todavía no tiene trades registrados — el Balance y Drawdown aparecen acá apenas registres el primero.</div>`;
    bodyEl.style.display = "none";
    return;
  }
  emptyEl.innerHTML = "";
  bodyEl.style.display = "block";
  document.getElementById("ch-curves-name").textContent = ac.nombre;
  document.getElementById("ch-curves-name2").textContent = ac.nombre;

  const labels = series.map((_, i) => `#${i + 1}`);
  const balances = series.map((p) => parseFloat(p.balanceDespues.toFixed(2)));
  // Con un solo trade, una línea no tiene nada que conectar (hacen
  // falta 2+ puntos) — pointRadius:0 dejaba el gráfico visualmente en
  // blanco aunque el dato SÍ estuviera ahí. Con exactamente 1 trade se
  // muestra un punto visible; con 2 o más, la línea limpia de siempre.
  const singlePoint = series.length === 1;

  const balCtx = document.getElementById("ch-balance");
  if (balCtx)
    setChart(
      "balanceC",
      new Chart(balCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: balances,
              borderColor: T.green,
              borderWidth: 2,
              pointRadius: singlePoint ? 4 : 0,
              pointBackgroundColor: T.green,
              fill: true,
              backgroundColor: T.green + "12",
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { display: false }, grid: { display: false } },
            y: {
              ticks: {
                color: "#555c72",
                font: { size: 9 },
                callback: (v) => "$" + v,
              },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );

  const running = TradeEngine.runningDrawdownFromValues(ac.size, balances);
  const ddValues = running.map((r) => -parseFloat(r.dd.toFixed(2)));

  const ddCtx = document.getElementById("ch-drawdown");
  if (ddCtx)
    setChart(
      "ddC",
      new Chart(ddCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              data: ddValues,
              borderColor: T.red,
              borderWidth: 2,
              pointRadius: singlePoint ? 4 : 0,
              pointBackgroundColor: T.red,
              fill: true,
              backgroundColor: T.red + "14",
              tension: 0.3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { display: false }, grid: { display: false } },
            y: {
              max: 0,
              ticks: {
                color: "#555c72",
                font: { size: 9 },
                callback: (v) => "$" + v,
              },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );
}

export function renderChSidebar() {
  const ac = challenges.find((c) => c.active);
  const el = document.getElementById("ch-sb");
  if (!ac) {
    el.innerHTML = "";
    return;
  }
  const p = calcChProgress(ac);
  const T = themeColors();
  const color =
    p.pct >= 80 ? "var(--green)" : p.pct >= 40 ? "var(--yellow)" : "var(--acc)";
  el.innerHTML = `<div style="margin:8px;padding:9px 11px;background:var(--abg);border:1px solid ${T.acc}33;border-radius:6px;font-size:10px;font-family:var(--mono);cursor:pointer" onclick="go('challenge',null)">
    <div style="color:var(--acc);font-weight:600;margin-bottom:4px">${escapeHTML(ac.nombre)}</div>
    <div style="color:var(--text3);margin-bottom:5px">${p.pct}% del objetivo</div>
    <div style="background:var(--bg3);border-radius:3px;height:4px;overflow:hidden"><div style="height:100%;border-radius:3px;background:${color};width:${p.pct}%"></div></div>
    <div style="color:var(--text3);margin-top:4px">PL: <span style="color:${p.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${p.netUSD >= 0 ? "+" : ""}$${p.netUSD.toFixed(0)}</span></div>
    ${renderMonitorBadge(ac)}
  </div>`;
}

// [window] onclick="openNewChallenge()"
export function openNewChallenge() {
  document.getElementById("modal-ch-title").textContent = "Nuevo challenge";
  [
    "nombre",
    "firma",
    "size",
    "target",
    "maxday",
    "maxtotal",
    "inicio",
    "dias",
    "riesgo",
  ].forEach((k) => {
    const el = document.getElementById("ch-" + k);
    if (el) {
      if (k === "size") el.value = "5000";
      else if (k === "target") el.value = "10";
      else if (k === "maxday") el.value = "5";
      else if (k === "maxtotal") el.value = "10";
      else if (k === "dias") el.value = "30";
      else if (k === "riesgo") el.value = "1";
      else if (k === "inicio") el.value = today();
      else el.value = "";
    }
  });
  document.getElementById("ch-tiporiesgo").value = "Fijo";
  populateRuleSetSelect("");
  document.getElementById("modal-ch").dataset.editIdx = "";
  openModal("modal-ch");
}

// [window] onclick="editChallenge(i)"
export function editChallenge(i) {
  const ch = challenges[i];
  document.getElementById("modal-ch-title").textContent = "Editar challenge";
  document.getElementById("ch-nombre").value = ch.nombre || "";
  document.getElementById("ch-firma").value = ch.firma || "";
  document.getElementById("ch-size").value = ch.size || 5000;
  document.getElementById("ch-target").value = ch.target || 10;
  document.getElementById("ch-maxday").value = ch.maxDay || 5;
  document.getElementById("ch-maxtotal").value = ch.maxTotal || 10;
  document.getElementById("ch-inicio").value = ch.inicio || today();
  document.getElementById("ch-dias").value = ch.dias || 0;
  document.getElementById("ch-riesgo").value = ch.riesgo || 1;
  document.getElementById("ch-tiporiesgo").value = ch.tipoRiesgo || "Fijo";
  document.getElementById("ch-fase").value = ch.fase || "Evaluacion";
  populateRuleSetSelect(ch.ruleSetId || "");
  document.getElementById("modal-ch").dataset.editIdx = i;
  openModal("modal-ch");
}

// [window] onclick="saveChallenge()"
export function saveChallenge() {
  const idx = document.getElementById("modal-ch").dataset.editIdx;
  const ch = {
    // Al editar (idx !== ""), se conserva el id existente del
    // challenge — generarlo de nuevo con Date.now() desvincula todos
    // los trades ya registrados (su challengeSnapshot.challengeId
    // guarda el id viejo) y el balance/progreso se ve en $0 aunque los
    // trades sigan intactos. Solo un challenge realmente NUEVO recibe
    // un id nuevo.
    id: idx !== "" ? challenges[parseInt(idx)].id : Date.now(),
    nombre:
      document.getElementById("ch-nombre").value || "Challenge sin nombre",
    firma: document.getElementById("ch-firma").value,
    size: parseFloat(document.getElementById("ch-size").value) || 5000,
    target: parseFloat(document.getElementById("ch-target").value) || 10,
    maxDay: parseFloat(document.getElementById("ch-maxday").value) || 5,
    maxTotal: parseFloat(document.getElementById("ch-maxtotal").value) || 10,
    inicio: document.getElementById("ch-inicio").value || today(),
    dias: parseInt(document.getElementById("ch-dias").value) || 0,
    riesgo: parseFloat(document.getElementById("ch-riesgo").value) || 1,
    tipoRiesgo: document.getElementById("ch-tiporiesgo").value || "Fijo",
    fase: document.getElementById("ch-fase").value,
    ruleSetId: document.getElementById("ch-ruleset").value || null,
    active: false,
  };
  if (idx !== "") {
    const old = challenges[parseInt(idx)];
    ch.active = old.active;
    challenges[parseInt(idx)] = ch;
    if (!saveChallenges()) {
      challenges[parseInt(idx)] = old;
      showToast("error", "No se pudo guardar", "Almacenamiento local lleno.");
      return;
    }
    closeModal("modal-ch");
    renderChallenges();
    showToast("success", "Challenge actualizado", ch.nombre);
  } else {
    if (!challenges.length) ch.active = true;
    challenges.push(ch);
    if (!saveChallenges()) {
      challenges.pop();
      showToast("error", "No se pudo guardar", "Almacenamiento local lleno.");
      return;
    }
    closeModal("modal-ch");
    renderChallenges();
    showToast("success", "Challenge creado", ch.nombre);
  }
}

// [window] onclick="setActive(i)"
export function setActive(i) {
  challenges.forEach((c, j) => (c.active = j === i));
  if (!saveChallenges()) {
    showToast("error", "No se pudo guardar", "Almacenamiento local lleno.");
    return;
  }
  renderChallenges();
  showToast("info", "Challenge activado", challenges[i].nombre);
}

// [window] onclick="deleteChallenge(i)"
export function deleteChallenge(i) {
  if (!confirm("Eliminar este challenge?")) return;
  const nombre = challenges[i].nombre;
  challenges.splice(i, 1);
  saveChallenges();
  renderChallenges();
  showToast("warning", "Challenge eliminado", nombre);
}
