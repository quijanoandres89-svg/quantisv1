/* ============================================================
   CALCULATOR — calculadora de tamaño de lote a partir del riesgo.
   ------------------------------------------------------------
   Antes decidía la matemática de pips con
   `if (par === "XAUUSD") ... else ...` — solo cubría 2 casos (forex
   estándar y oro). Ahora lee la configuración real del instrumento
   seleccionado (instruments.js) — cada instrumento trae su propio
   pipSize/valorPip, así que un par nuevo (cripto, índices, JPY...)
   calcula correcto desde el momento en que se agrega en
   Configuración > Pares e instrumentos, sin tocar este archivo.
   ============================================================ */

import { getInstrument, INSTRUMENT_TYPES } from "./instruments.js";

function currentInstrument(parId) {
  const symbol = document.getElementById(parId)?.value;
  return getInstrument(symbol) || { ...INSTRUMENT_TYPES.forex, symbol: symbol || "" };
}

// [window] oninput="calcSlFromPrices()"
export function calcSlFromPrices() {
  const entry = parseFloat(document.getElementById("c-entry").value);
  const slp = parseFloat(document.getElementById("c-slprice").value);
  const inst = currentInstrument("c-par");
  if (!isNaN(entry) && !isNaN(slp) && entry > 0 && slp > 0) {
    const pips = Math.abs(entry - slp) / inst.pipSize;
    document.getElementById("c-sl").value = Math.round(pips * 10) / 10;
  }
  calcLote();
}

// [window] oninput="calcLote()" / llamada también desde main.js en init()
export function calcLote() {
  const cuenta = parseFloat(document.getElementById("c-cuenta").value) || 5000;
  const riesgoPct = parseFloat(document.getElementById("c-riesgo").value) || 1;
  const sl = parseFloat(document.getElementById("c-sl").value);
  const inst = currentInstrument("c-par");
  const slLabel = document.getElementById("c-sl-label");
  if (slLabel) slLabel.textContent = `Stop Loss (${inst.unidad || "pips"})`;
  if (!sl || sl <= 0) {
    document.getElementById("calc-result-box").innerHTML =
      `<div class="card" style="text-align:center;padding:28px"><div style="font-size:12px;color:var(--text3)">Ingresa el Stop Loss en ${inst.unidad || "pips"}</div></div>`;
    return;
  }
  const riesgoUSD = cuenta * (riesgoPct / 100);
  const pipValue = inst.valorPip || 10;
  const loteStd = riesgoUSD / (sl * pipValue);
  const loteMicro = loteStd * 100;
  const loteMini = loteStd * 10;
  const tp2 = sl * 2,
    tp3 = sl * 3;
  const ganTP2 = riesgoUSD * 2,
    ganTP3 = riesgoUSD * 3;
  document.getElementById("calc-result-box").innerHTML = `
    <div class="calc-result">
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-bottom:4px">TAMAÑO DE LOTE RECOMENDADO</div>
      <div class="calc-lote">${loteStd.toFixed(2)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px">lotes estándar</div>
      <div class="calc-detail">
        <div class="calc-d"><div class="calc-dv">${loteMini.toFixed(1)}</div><div class="calc-dl">Mini lotes</div></div>
        <div class="calc-d"><div class="calc-dv">${Math.round(loteMicro)}</div><div class="calc-dl">Micro lotes</div></div>
        <div class="calc-d"><div class="calc-dv">$${Math.round(riesgoUSD)}</div><div class="calc-dl">Riesgo USD</div></div>
      </div>
    </div>
    <div class="card" style="margin-top:10px">
      <div class="ct">Proyección de ganancias</div>
      <div class="srow"><span class="slbl">Si TP a 1:1</span><span style="color:var(--green);font-family:var(--mono);font-size:12px">+$${Math.round(riesgoUSD)}</span></div>
      <div class="srow"><span class="slbl">Si TP a 1:2 (${tp2.toFixed(1)} ${inst.unidad || "pips"})</span><span style="color:var(--green);font-family:var(--mono);font-size:12px">+$${Math.round(ganTP2)}</span></div>
      <div class="srow"><span class="slbl">Si TP a 1:3 (${tp3.toFixed(1)} ${inst.unidad || "pips"})</span><span style="color:var(--green);font-family:var(--mono);font-size:12px">+$${Math.round(ganTP3)}</span></div>
      <div class="srow"><span class="slbl">Si SL (${sl} ${inst.unidad || "pips"})</span><span style="color:var(--red);font-family:var(--mono);font-size:12px">-$${Math.round(riesgoUSD)}</span></div>
    </div>`;
}

// [window] go('calc', ...) la dispara desde main.js
export function renderCalcTabla() {
  const cuenta = parseFloat(document.getElementById("c-cuenta")?.value) || 5000;
  const inst = currentInstrument("c-par");
  const pipValue = inst.valorPip || 10;
  const riesgoUSD = cuenta * 0.01;
  const sls = [5, 8, 10, 12, 15, 20, 25, 30];
  document.getElementById("calc-tabla").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px">
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">SL (${inst.unidad || "pips"})</span>
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">Lote estándar</span>
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">Micro lotes</span>
    </div>
    ${sls
      .map((sl) => {
        const lote = riesgoUSD / (sl * pipValue);
        return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:11px;font-family:var(--mono);color:var(--text2)">${sl}</span><span style="font-size:11px;font-family:var(--mono);color:var(--acc)">${lote.toFixed(2)}</span><span style="font-size:11px;font-family:var(--mono);color:var(--text2)">${Math.round(lote * 100)}</span></div>`;
      })
      .join("")}`;
}
