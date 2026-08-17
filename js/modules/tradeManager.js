/* ============================================================
   TRADE MANAGER — registro de trades y su vínculo con el
   Challenge activo (snapshot de capital/riesgo en ese momento).
   ------------------------------------------------------------
   saveTrade() es lógica de negocio pura: guarda el trade y avisa
   éxito/fracaso (true/false). NO refresca UI (eso es trabajo de
   quien la invoque, ej. main.js llamando a Dashboard.renderSidebar()
   después). Mantenerlas separadas evita acoplar módulos de datos
   con módulos de presentación.
   ============================================================ */

import { trades, challenges, saveTrades } from "./state.js";
import { today } from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { clearZoneManual } from "./imageZones.js";
import { simulateNewViolations } from "./preventiveAlerts.js";
import { showToast } from "./toast.js";
import * as ImageStore from "./imageStore.js";

/**
 * Resuelve qué riskResolver de TradeEngine usar según el tipo de riesgo
 * configurado en el Challenge (Fijo o Dinámico). Único lugar donde se
 * decide esto — challengeManager.js importa esta misma función en vez
 * de reimplementarla, para que Trade y Challenge nunca queden
 * desincronizados en este cálculo.
 */
export function challengeRiskResolver(ch) {
  return ch.tipoRiesgo === "Dinamico"
    ? TradeEngine.dynamicRiskResolver(ch.riesgo || 1)
    : TradeEngine.fixedRiskResolver(ch.size, ch.riesgo || 1);
}

/**
 * Construye el snapshot del Challenge activo para adjuntarlo a un trade
 * nuevo. Usa TradeEngine.equitySeries sobre los trades del challenge
 * registrados hasta ahora para saber el capital real en este momento
 * (imprescindible en riesgo Dinámico, donde el capital cambia trade a
 * trade). Así, si el Challenge cambia después, este trade ya guardó su
 * propia foto y no se recalcula mal.
 */
export function buildChallengeSnapshot(ch) {
  const chTradesSoFar = trades.filter(
    (t) => t.challengeSnapshot?.challengeId === ch.id,
  );
  const series = TradeEngine.equitySeries(
    chTradesSoFar,
    ch.size,
    challengeRiskResolver(ch),
  );
  const last = series[series.length - 1];
  const capitalEnEseMomento = last ? last.balanceDespues : ch.size;
  const tipoRiesgo = ch.tipoRiesgo || "Fijo";
  const riesgoUSD =
    tipoRiesgo === "Dinamico"
      ? TradeEngine.riskUSD(capitalEnEseMomento, ch.riesgo || 1)
      : TradeEngine.riskUSD(ch.size, ch.riesgo || 1);
  return {
    challengeId: ch.id,
    challengeName: ch.nombre,
    capitalInicial: ch.size,
    riesgoPorcentaje: ch.riesgo || 1,
    tipoRiesgo,
    riesgoUSD,
    capitalEnEseMomento,
  };
}

/**
 * PnL real en USD de un trade ya registrado, usando SU PROPIO snapshot
 * (no el riesgo actual del Challenge, que pudo haber cambiado desde
 * entonces). Devuelve null si el trade no tiene snapshot (trades de
 * antes de la Entrega 2) — en ese caso la UI no debe inventar un valor.
 */
export function tradePnlUSD(t) {
  if (!t.challengeSnapshot) return null;
  return TradeEngine.pnlUSD(t, t.challengeSnapshot.riesgoUSD);
}

/**
 * Mayor ganancia y mayor pérdida en USD, entre un conjunto de trades
 * (Fase 4, bloque 4C — Entrega 28). Mismo criterio de clasificación
 * que TradeEngine.stats() (por t.res, no por el signo del monto):
 * "ganancia" son los TP, "pérdida" los SL — consistente con cómo el
 * resto de la app ya distingue wins/losses. Se calcula en USD (no en
 * R como TradeEngine.stats()) porque acá sí importa el riesgoUSD real
 * de cada trade, guardado en su propio snapshot. Trades sin snapshot
 * (o con snapshot pero riesgoUSD inválido) quedan fuera, igual que en
 * cualquier otro widget que usa tradePnlUSD().
 */
export function usdExtremes(list) {
  const wins = list
    .filter((t) => t.res === "TP")
    .map(tradePnlUSD)
    .filter((v) => v !== null);
  const losses = list
    .filter((t) => t.res === "SL")
    .map(tradePnlUSD)
    .filter((v) => v !== null);
  return {
    maxWin: wins.length ? Math.max(...wins) : null,
    maxLoss: losses.length ? Math.min(...losses) : null,
  };
}
export function updateResPreview() {
  const rrRaw = document.getElementById("t-rr").value;
  const el = document.getElementById("t-res-preview");
  if (rrRaw === "") {
    el.innerHTML = "";
    return;
  }
  const res = TradeEngine.interpretResult(rrRaw);
  if (!res) {
    el.innerHTML = "";
    return;
  }
  const cls = res === "TP" ? "btp" : res === "SL" ? "bsl" : "bbe";
  el.innerHTML = `<span class="badge ${cls}">${res}</span>`;
}

/**
 * Registra un trade nuevo. Devuelve:
 *   true      -> se guardó
 *   false     -> se bloqueó (RR vacío o sin Challenge activo o falló el guardado)
 *   {pending:true, trade, violations} -> guardarlo rompería una regla
 *   nueva del Challenge; no se guardó todavía, main.js debe mostrar el
 *   modal de alerta preventiva. Llamar de nuevo con force=true para
 *   guardarlo de todas formas.
 *
 * Async desde la migración de imágenes a IndexedDB (corrige el
 * hallazgo 🔴 Crítico de la auditoría): guardar una captura ya no es
 * una operación síncrona de "leer .src y listo", así que saveTrade()
 * y todo lo que la llama (main.js) esperan la promesa antes de seguir.
 */
// [window] onclick="saveTrade()" en el botón "Registrar trade"
export async function saveTrade(force = false) {
  const rrRaw = document.getElementById("t-rr").value;
  if (rrRaw === "") {
    showToast(
      "error",
      "Falta el RR",
      "Ingresa el RR obtenido (positivo si fue TP, negativo si fue SL, 0 si fue BE).",
    );
    return false;
  }
  const res = TradeEngine.interpretResult(rrRaw);
  const activeCh = challenges.find((c) => c.active);
  if (!activeCh) {
    showToast(
      "error",
      "Sin Challenge activo",
      'Activa uno en la sección "Challenge" antes de registrar un trade.',
    );
    return false;
  }

  // Lee las previews del formulario como data URL. Nota: un <img> sin
  // atributo src devuelve "" al leer .src, PERO después de que
  // clearZoneManual() hace preview.src = "" una vez, el atributo queda
  // presente-y-vacío, y a partir de ahí .src se resuelve a la URL de
  // la propia página (comportamiento estándar del navegador, no un
  // bug de KAME) — por eso se descarta también ese caso, igual que ya
  // hacía initPasteHandler() en imageZones.js.
  const htfSrc = document.getElementById("t-img-htf-preview").src || "";
  const ltfSrc = document.getElementById("t-img-ltf-preview").src || "";
  const htfDataUrl = htfSrc && htfSrc !== window.location.href ? htfSrc : "";
  const ltfDataUrl = ltfSrc && ltfSrc !== window.location.href ? ltfSrc : "";
  const htfKey = htfDataUrl ? ImageStore.newImageKey() : "";
  const ltfKey = ltfDataUrl ? ImageStore.newImageKey() : "";

  const t = {
    id: Date.now(),
    fecha: document.getElementById("t-fecha").value || today(),
    hora: document.getElementById("t-hora").value,
    horaCierre: document.getElementById("t-hora-cierre").value,
    par: document.getElementById("t-par").value,
    dir: document.getElementById("t-dir").value,
    res,
    rr: rrRaw,
    tipo: document.getElementById("t-tipo").value,
    ses: document.getElementById("t-ses").value,
    plan: document.getElementById("t-plan").value,
    emo: document.getElementById("t-emo").value,
    notas: document.getElementById("t-notas").value,
    precioEntrada: document.getElementById("t-precio-entrada").value,
    precioTP: document.getElementById("t-precio-tp").value,
    precioSalida: document.getElementById("t-precio-salida").value,
    // Ya no se guarda la imagen completa acá — solo la clave de
    // IndexedDB. Ver ImageStore.saveImage() más abajo.
    imgHTF: htfKey,
    imgLTF: ltfKey,
    challengeSnapshot: buildChallengeSnapshot(activeCh),
  };

  if (!force) {
    const newViolations = simulateNewViolations(t, activeCh);
    if (newViolations.length) {
      return { pending: true, trade: t, violations: newViolations };
    }
  }

  trades.push(t);
  const saved = saveTrades();
  if (!saved) {
    // Falló la escritura en localStorage. Con las imágenes ya fuera del
    // trade (viven en IndexedDB, no acá), esto debería ser mucho más
    // raro que antes de esta migración — pero si igual ocurre (ej. el
    // resto de los datos de la app ya venía cerca del límite), se
    // revierte el push en memoria y se avisa, en vez de perder el
    // trade en silencio.
    trades.pop();
    showToast(
      "error",
      "No se pudo guardar el trade",
      "El almacenamiento local está lleno. Libera espacio o exporta/limpia backups antiguos y vuelve a intentar — tus datos del formulario siguen aquí.",
    );
    return false;
  }

  // El trade (sin las imágenes) ya quedó persistido y a salvo. Ahora sí
  // se guardan las capturas en IndexedDB — si esto falla, el trade en
  // sí NO se pierde (a diferencia del comportamiento anterior a esta
  // migración, donde todo era una sola escritura atómica en
  // localStorage: o se guardaba todo, o se perdía todo).
  const imgFailures = [];
  if (htfDataUrl && !(await ImageStore.saveImage(htfKey, htfDataUrl))) {
    imgFailures.push("HTF");
  }
  if (ltfDataUrl && !(await ImageStore.saveImage(ltfKey, ltfDataUrl))) {
    imgFailures.push("LTF");
  }
  if (imgFailures.length) {
    showToast(
      "warning",
      "Trade guardado, capturas no",
      `El trade se registró correctamente, pero la(s) captura(s) ${imgFailures.join("/")} no se pudieron guardar (almacenamiento lleno).`,
    );
  } else {
    showToast("success", "Trade registrado", `Resultado: ${res}`);
  }

  document.getElementById("t-rr").value = "";
  document.getElementById("t-res-preview").innerHTML = "";
  document.getElementById("t-notas").value = "";
  document.getElementById("t-precio-entrada").value = "";
  document.getElementById("t-precio-tp").value = "";
  document.getElementById("t-precio-salida").value = "";
  clearZoneManual(
    "t-img-htf-preview",
    "zone-htf",
    "t-img-htf",
    "zone-htf-label",
  );
  clearZoneManual(
    "t-img-ltf-preview",
    "zone-ltf",
    "t-img-ltf",
    "zone-ltf-label",
  );
  document.getElementById("t-hora").value = "";
  document.getElementById("t-hora-cierre").value = "";
  return true;
}
