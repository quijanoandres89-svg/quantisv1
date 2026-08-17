/* ============================================================
   RULE ENGINE — reglas de challenge configurables por firma
   (Fase 4, Entrega 12). Estructura genérica, sin firmas
   precargadas — el usuario crea sus propios Rule Sets.
   ------------------------------------------------------------
   evaluateChallenge() es el corazón de este módulo: dado un
   Challenge + un Rule Set + los trades, devuelve el estado de
   cada regla (ok/warning/violation/n-a). Entrega 13
   (ChallengeMonitor) va a consumir esta función para el
   monitoreo continuo — aquí solo se construye y se prueba.

   Nota honesta: "Maximum Position Size" se guarda en el Rule Set
   pero NO se evalúa — KAME no registra tamaño de posición (lotaje)
   por trade todavía. Se marca status "n-a" en vez de inventar un
   chequeo falso.
   ============================================================ */

import { ruleSets, saveRuleSets, trades } from "./state.js";
import { today, weekStart, weekEnd, escapeHTML } from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { challengeRiskResolver } from "./tradeManager.js";
import { showToast } from "./toast.js";

/** Valores por defecto al crear un Rule Set nuevo — ninguno viene de una firma real. */
export function defaultRuleSet() {
  return {
    id: null,
    nombre: "",
    dailyDrawdownPct: 5,
    maxDrawdownPct: 10,
    profitTargetPct: 10,
    consistencyRulePct: null, // null = regla desactivada
    minTradingDays: null,
    maxPositionSize: null, // guardado, no evaluado (ver nota arriba)
    maxRiskPerTradePct: 1,
    maxDailyRiskPct: null,
    maxTradesPerDay: null,
    weeklyLossLimitPct: null,
  };
}

// Uso interno — llamada por submitRuleSetForm() (esa sí está en window)
export function saveRuleSet(rs) {
  let idx = rs.id ? ruleSets.findIndex((r) => r.id === rs.id) : -1;
  let replaced = null;
  if (idx >= 0) {
    replaced = ruleSets[idx];
    ruleSets[idx] = rs;
  } else {
    if (!rs.id) rs.id = Date.now();
    ruleSets.push(rs);
    idx = ruleSets.length - 1;
  }
  if (!saveRuleSets()) {
    // Revierte el cambio en memoria si no se pudo persistir.
    if (replaced) ruleSets[idx] = replaced;
    else ruleSets.splice(idx, 1);
    return null;
  }
  return rs;
}

// Uso interno — llamada por deleteRuleSetConfirm() (esa sí está en window)
export function deleteRuleSet(id) {
  const idx = ruleSets.findIndex((r) => r.id === id);
  if (idx >= 0) ruleSets.splice(idx, 1);
  saveRuleSets();
}

export function getRuleSet(id) {
  return ruleSets.find((r) => String(r.id) === String(id)) || null;
}

// [window] onclick="openNewRuleSet()"
export function openNewRuleSet() {
  document.getElementById("modal-rs-title").textContent =
    "Nuevo conjunto de reglas";
  document.getElementById("modal-rs").dataset.editId = "";
  const d = defaultRuleSet();
  document.getElementById("rs-nombre").value = "";
  document.getElementById("rs-dailydd").value = d.dailyDrawdownPct;
  document.getElementById("rs-maxdd").value = d.maxDrawdownPct;
  document.getElementById("rs-target").value = d.profitTargetPct;
  document.getElementById("rs-maxrisk").value = d.maxRiskPerTradePct;
  [
    "rs-consistency",
    "rs-mindays",
    "rs-dailyrisk",
    "rs-maxtrades",
    "rs-weeklyloss",
    "rs-maxpos",
  ].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("modal-rs").classList.add("open");
}

// [window] onclick="editRuleSetForm(id)"
export function editRuleSetForm(id) {
  const rs = getRuleSet(id);
  if (!rs) return;
  document.getElementById("modal-rs-title").textContent =
    "Editar conjunto de reglas";
  document.getElementById("modal-rs").dataset.editId = String(id);
  document.getElementById("rs-nombre").value = rs.nombre || "";
  document.getElementById("rs-dailydd").value = rs.dailyDrawdownPct ?? "";
  document.getElementById("rs-maxdd").value = rs.maxDrawdownPct ?? "";
  document.getElementById("rs-target").value = rs.profitTargetPct ?? "";
  document.getElementById("rs-maxrisk").value = rs.maxRiskPerTradePct ?? "";
  document.getElementById("rs-consistency").value = rs.consistencyRulePct ?? "";
  document.getElementById("rs-mindays").value = rs.minTradingDays ?? "";
  document.getElementById("rs-dailyrisk").value = rs.maxDailyRiskPct ?? "";
  document.getElementById("rs-maxtrades").value = rs.maxTradesPerDay ?? "";
  document.getElementById("rs-weeklyloss").value = rs.weeklyLossLimitPct ?? "";
  document.getElementById("rs-maxpos").value = rs.maxPositionSize ?? "";
  document.getElementById("modal-rs").classList.add("open");
}

const numOrNull = (v) => (v === "" || v == null ? null : parseFloat(v));

// [window] onclick="submitRuleSetForm()"
export function submitRuleSetForm() {
  const editId = document.getElementById("modal-rs").dataset.editId;
  const rs = {
    id: editId ? parseInt(editId) : null,
    nombre: document.getElementById("rs-nombre").value || "Sin nombre",
    dailyDrawdownPct: numOrNull(document.getElementById("rs-dailydd").value),
    maxDrawdownPct: numOrNull(document.getElementById("rs-maxdd").value),
    profitTargetPct: numOrNull(document.getElementById("rs-target").value),
    maxRiskPerTradePct: numOrNull(document.getElementById("rs-maxrisk").value),
    consistencyRulePct: numOrNull(document.getElementById("rs-consistency").value),
    minTradingDays: numOrNull(document.getElementById("rs-mindays").value),
    maxDailyRiskPct: numOrNull(document.getElementById("rs-dailyrisk").value),
    maxTradesPerDay: numOrNull(document.getElementById("rs-maxtrades").value),
    weeklyLossLimitPct: numOrNull(document.getElementById("rs-weeklyloss").value),
    maxPositionSize: numOrNull(document.getElementById("rs-maxpos").value),
  };
  const isEdit = !!editId;
  const result = saveRuleSet(rs);
  if (!result) {
    showToast("error", "No se pudo guardar", "Almacenamiento local lleno.");
    return;
  }
  document.getElementById("modal-rs").classList.remove("open");
  renderRuleSets();
  showToast(
    "success",
    isEdit ? "Conjunto de reglas actualizado" : "Conjunto de reglas creado",
    rs.nombre,
  );
}

// [window] go('reglas', ...) la dispara desde main.js
export function renderRuleSets() {
  const el = document.getElementById("ruleset-list");
  if (!ruleSets.length) {
    el.innerHTML =
      '<div class="empty">Sin conjuntos de reglas. Crea el primero arriba.</div>';
    return;
  }
  el.innerHTML = ruleSets
    .map((rs) => {
      const rows = [
        ["Daily Drawdown", rs.dailyDrawdownPct, "%"],
        ["Max Drawdown", rs.maxDrawdownPct, "%"],
        ["Profit Target", rs.profitTargetPct, "%"],
        ["Riesgo máx/trade", rs.maxRiskPerTradePct, "%"],
        ["Consistency Rule", rs.consistencyRulePct, "%"],
        ["Días mínimos", rs.minTradingDays, ""],
        ["Riesgo diario", rs.maxDailyRiskPct, "%"],
        ["Máx trades/día", rs.maxTradesPerDay, ""],
        ["Pérdida semanal", rs.weeklyLossLimitPct, "%"],
      ]
        .filter(([, v]) => v != null)
        .map(
          ([l, v, u]) =>
            `<span class="badge" style="background:var(--bg3);color:var(--text2);border:1px solid var(--border);margin:2px">${l}: ${v}${u}</span>`,
        )
        .join("");
      return `<div class="tpl-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:13px;font-weight:600">${escapeHTML(rs.nombre)}</div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="editRuleSetForm(${rs.id})">Editar</button>
          <button class="btn btn-d btn-sm" onclick="deleteRuleSetConfirm(${rs.id})">Eliminar</button>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:2px">${rows || '<span style="font-size:11px;color:var(--text3)">Sin reglas configuradas</span>'}</div>
    </div>`;
    })
    .join("");
}

// [window] onclick="deleteRuleSetConfirm(id)"
export function deleteRuleSetConfirm(id) {
  if (!confirm("¿Eliminar este conjunto de reglas?")) return;
  const rs = getRuleSet(id);
  deleteRuleSet(id);
  renderRuleSets();
  showToast("warning", "Conjunto de reglas eliminado", rs?.nombre || "");
}

/**
 * Prellena los campos del modal de Challenge (maxday/maxtotal/target/
 * riesgo) con los valores del Rule Set elegido. El Challenge sigue
 * siendo dueño de sus propios valores — esto es solo una plantilla de
 * arranque, no una dependencia obligatoria.
 */
// [window] onchange="applyRuleSetToChallenge()" en el selector del modal de Challenge
export function applyRuleSetToChallenge() {
  const sel = document.getElementById("ch-ruleset");
  if (!sel.value) return;
  const rs = getRuleSet(sel.value);
  if (!rs) return;
  if (rs.dailyDrawdownPct != null)
    document.getElementById("ch-maxday").value = rs.dailyDrawdownPct;
  if (rs.maxDrawdownPct != null)
    document.getElementById("ch-maxtotal").value = rs.maxDrawdownPct;
  if (rs.profitTargetPct != null)
    document.getElementById("ch-target").value = rs.profitTargetPct;
  if (rs.maxRiskPerTradePct != null)
    document.getElementById("ch-riesgo").value = rs.maxRiskPerTradePct;
}

/** Llena el <select> de Rule Sets del modal de Challenge. Llamada por challengeManager.js. */
export function populateRuleSetSelect(selectedId) {
  const sel = document.getElementById("ch-ruleset");
  if (!sel) return;
  sel.innerHTML =
    '<option value="">Ninguno (valores manuales)</option>' +
    ruleSets
      .map((rs) => `<option value="${rs.id}">${escapeHTML(rs.nombre)}</option>`)
      .join("");
  sel.value = selectedId || "";
}

/**
 * Evalúa un Challenge contra un Rule Set. Devuelve un array de checks:
 * { key, label, status: 'ok'|'warning'|'violation'|'n-a', detail }
 * Reglas desactivadas (valor null en el Rule Set) se omiten del
 * resultado — no tiene sentido evaluar un límite que no configuraste.
 */
export function evaluateChallenge(ch, ruleSet) {
  const checks = [];
  if (!ch || !ruleSet) return checks;

  const chTrades = trades.filter(
    (t) => t.challengeSnapshot?.challengeId === ch.id,
  );
  const series = TradeEngine.equitySeries(
    chTrades,
    ch.size,
    challengeRiskResolver(ch),
  );
  const last = series[series.length - 1];
  const netUSD = last ? last.balanceDespues - ch.size : 0;

  const statusFor = (usedPct, limitPct) => {
    if (limitPct == null) return null;
    if (usedPct >= limitPct) return "violation";
    if (usedPct >= limitPct * 0.9) return "high-risk";
    if (usedPct >= limitPct * 0.8) return "warning";
    return "ok";
  };

  // 1. Daily Drawdown
  if (ruleSet.dailyDrawdownPct != null) {
    const dayLoss = TradeEngine.dayLossUSDFromSeries(series, today());
    const usedPct = ch.size > 0 ? (dayLoss / ch.size) * 100 : 0;
    checks.push({
      key: "dailyDrawdown",
      label: "Daily Drawdown",
      status: statusFor(usedPct, ruleSet.dailyDrawdownPct),
      detail: `${usedPct.toFixed(1)}% usado / límite ${ruleSet.dailyDrawdownPct}%`,
    });
  }

  // 2. Max Drawdown
  if (ruleSet.maxDrawdownPct != null) {
    const dd = TradeEngine.drawdown(series);
    checks.push({
      key: "maxDrawdown",
      label: "Max Drawdown",
      status: statusFor(dd.currentDDPct, ruleSet.maxDrawdownPct),
      detail: `${dd.currentDDPct.toFixed(1)}% actual / límite ${ruleSet.maxDrawdownPct}%`,
    });
  }

  // 3. Profit Target
  if (ruleSet.profitTargetPct != null) {
    const achievedPct = ch.size > 0 ? (netUSD / ch.size) * 100 : 0;
    checks.push({
      key: "profitTarget",
      label: "Profit Target",
      status: achievedPct >= ruleSet.profitTargetPct ? "ok" : "warning",
      detail: `${achievedPct.toFixed(1)}% logrado / objetivo ${ruleSet.profitTargetPct}%`,
    });
  }

  // 4. Consistency Rule (ningún día > X% de la ganancia total)
  if (ruleSet.consistencyRulePct != null && netUSD > 0) {
    const porDia = {};
    series.forEach((p) => {
      porDia[p.trade.fecha] = (porDia[p.trade.fecha] || 0) + p.pnlUSD;
    });
    const peorDiaPct = Math.max(
      0,
      ...Object.values(porDia).map((v) => (v / netUSD) * 100),
    );
    checks.push({
      key: "consistency",
      label: "Consistency Rule",
      status: statusFor(peorDiaPct, ruleSet.consistencyRulePct),
      detail: `Tu mejor día representa ${peorDiaPct.toFixed(1)}% de la ganancia total / límite ${ruleSet.consistencyRulePct}%`,
    });
  }

  // 5. Minimum Trading Days
  if (ruleSet.minTradingDays != null) {
    const diasOperados = new Set(chTrades.map((t) => t.fecha)).size;
    checks.push({
      key: "minTradingDays",
      label: "Minimum Trading Days",
      status: diasOperados >= ruleSet.minTradingDays ? "ok" : "warning",
      detail: `${diasOperados} / ${ruleSet.minTradingDays} días mínimos`,
    });
  }

  // 6. Maximum Position Size — NO EVALUADO (falta dato de lotaje por trade)
  if (ruleSet.maxPositionSize != null) {
    checks.push({
      key: "maxPositionSize",
      label: "Maximum Position Size",
      status: "n-a",
      detail: `Configurado en ${ruleSet.maxPositionSize}, pero no se evalúa — KAME no registra tamaño de posición por trade todavía`,
    });
  }

  // 7. Riesgo máximo por trade (contra el riesgo REAL usado, del snapshot)
  if (ruleSet.maxRiskPerTradePct != null) {
    const excedidos = chTrades.filter(
      (t) =>
        t.challengeSnapshot &&
        t.challengeSnapshot.riesgoPorcentaje > ruleSet.maxRiskPerTradePct,
    );
    checks.push({
      key: "maxRiskPerTrade",
      label: "Riesgo máximo por trade",
      status: excedidos.length > 0 ? "violation" : "ok",
      detail:
        excedidos.length > 0
          ? `${excedidos.length} trade(s) excedieron el límite de ${ruleSet.maxRiskPerTradePct}%`
          : `Ningún trade excedió el límite de ${ruleSet.maxRiskPerTradePct}%`,
    });
  }

  // 8. Riesgo acumulado del día
  if (ruleSet.maxDailyRiskPct != null) {
    const hoyTrades = chTrades.filter((t) => t.fecha === today());
    const riesgoHoy = hoyTrades.reduce(
      (a, t) => a + (t.challengeSnapshot ? t.challengeSnapshot.riesgoPorcentaje : 0),
      0,
    );
    checks.push({
      key: "maxDailyRisk",
      label: "Riesgo acumulado del día",
      status: statusFor(riesgoHoy, ruleSet.maxDailyRiskPct),
      detail: `${riesgoHoy.toFixed(1)}% usado hoy / límite ${ruleSet.maxDailyRiskPct}%`,
    });
  }

  // 9. Máximo de operaciones por día
  if (ruleSet.maxTradesPerDay != null) {
    const hoyCount = chTrades.filter((t) => t.fecha === today()).length;
    checks.push({
      key: "maxTradesPerDay",
      label: "Máximo de operaciones por día",
      status: hoyCount > ruleSet.maxTradesPerDay ? "violation" : "ok",
      detail: `${hoyCount} / ${ruleSet.maxTradesPerDay} operaciones hoy`,
    });
  }

  // 10. Límite de pérdida semanal
  if (ruleSet.weeklyLossLimitPct != null) {
    const ws = weekStart(today());
    const we = weekEnd(ws);
    const weekSeries = series.filter(
      (p) => p.trade.fecha >= ws && p.trade.fecha <= we,
    );
    const weekLoss = Math.max(
      0,
      -weekSeries.reduce((a, p) => a + p.pnlUSD, 0),
    );
    const usedPct = ch.size > 0 ? (weekLoss / ch.size) * 100 : 0;
    checks.push({
      key: "weeklyLossLimit",
      label: "Límite de pérdida semanal",
      status: statusFor(usedPct, ruleSet.weeklyLossLimitPct),
      detail: `${usedPct.toFixed(1)}% perdido esta semana / límite ${ruleSet.weeklyLossLimitPct}%`,
    });
  }

  return checks;
}
