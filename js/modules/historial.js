/* ============================================================
   HISTORIAL — listado filtrable de todos los trades registrados.
   ============================================================ */

import { trades } from "./state.js";
import { fmtShort, fmtUSD, calcDuracion, escapeHTML } from "./utils.js";
import { tradePnlUSD } from "./tradeManager.js";
import * as TradeEngine from "./tradeEngine.js";

// [window] go('historial', ...) y onchange de los filtros f-par/f-res/f-plan
export function renderHistorial() {
  const fp = document.getElementById("f-par").value,
    fr = document.getElementById("f-res").value,
    fpl = document.getElementById("f-plan").value;
  const f = [...trades]
    .reverse()
    .filter(
      (t) =>
        (!fp || t.par === fp) &&
        (!fr || t.res === fr) &&
        (!fpl || t.plan === fpl),
    );
  if (!f.length) {
    document.getElementById("hist-list").innerHTML =
      `<div class="empty">Sin trades con estos filtros</div>`;
    return;
  }
  document.getElementById("hist-list").innerHTML = f
    .map((t) => {
      const pnl = tradePnlUSD(t);
      const eff = TradeEngine.captureEfficiency(t);
      return `
    <div class="ti">
      <div class="th">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtShort(t.fecha)}${t.hora ? " " + escapeHTML(t.hora) : ""}</span>
          <span style="font-size:13px;font-weight:600">${escapeHTML(t.par)}</span>
          <span style="font-size:11px;color:var(--text3)">${escapeHTML(t.dir)} · ${escapeHTML(t.tipo)}</span>
        </div>
        <div style="display:flex;gap:5px;align-items:center">
          <span class="badge b${escapeHTML(String(t.res).toLowerCase())}">${escapeHTML(t.res)}</span>
          <span class="badge b${t.plan === "Sí" ? "yes" : "no"}">Plan: ${escapeHTML(t.plan)}</span>
          ${t.rr ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">RR ${escapeHTML(t.rr)}</span>` : ""}
          ${pnl !== null ? `<span style="font-size:10px;font-family:var(--mono);font-weight:600;color:${pnl >= 0 ? "var(--green)" : "var(--red)"}">${fmtUSD(pnl)}</span>` : ""}
          ${eff !== null ? `<span style="font-size:10px;font-family:var(--mono);color:${eff >= 70 ? "var(--green)" : eff >= 30 ? "var(--yellow)" : "var(--red)"}">Efic. ${eff.toFixed(0)}%</span>` : ""}
          ${t.hora && t.horaCierre ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">⏱ ${calcDuracion(t.hora, t.horaCierre)}</span>` : ""}
          <span style="font-size:10px;color:var(--text3)">${escapeHTML(t.emo || "")}</span>
          ${t.imgHTF || t.imgLTF || t.img ? `<button class="btn btn-sm" style="padding:2px 8px;font-size:10px;margin-left:4px" onclick="verImagenes(${t.id})">Ver imágenes</button>` : ""}
        </div>
      </div>
      ${t.notas ? `<div style="font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);font-family:var(--mono);margin-top:4px">${escapeHTML(t.notas)}</div>` : ""}
      </div>`;
    })
    .join("");
}
