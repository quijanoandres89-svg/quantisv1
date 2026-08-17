/* ============================================================
   SIMULATOR — estima probabilidad de éxito de una decisión de
   trade ANTES de tomarla, basado en el historial de patrones
   similares (par, tipo, día, sesión, estado emocional).
   ============================================================ */

import { trades, journals, load } from "./state.js";
import { themeColors } from "./utils.js";

// [window] onclick="simular()"
export function simular() {
  load();
  const T = themeColors();
  const par = document.getElementById("sim-par").value;
  const tipo = document.getElementById("sim-tipo").value;
  const ses = document.getElementById("sim-ses").value;
  const estado = parseInt(document.getElementById("sim-estado").value) || 7;
  const rr = parseFloat(document.getElementById("sim-rr").value) || 2;
  const dia = parseInt(document.getElementById("sim-dia").value);

  if (trades.length < 5) {
    document.getElementById("sim-result").innerHTML =
      '<div class="card"><div class="alert aw">Necesitas al menos 5 trades en el Journal v2 para obtener analisis. Verifica la conexion en "Como conectar".</div></div>';
    return;
  }

  function wr(arr) {
    const dec = arr.filter((t) => t.res === "TP" || t.res === "SL").length;
    return dec
      ? Math.round((arr.filter((t) => t.res === "TP").length / dec) * 100)
      : null;
  }

  const byPar = trades.filter((t) => t.par === par);
  const byTipo = trades.filter((t) => t.tipo === tipo);
  const byDia = trades.filter((t) => {
    const dw = new Date(t.fecha + "T12:00:00").getDay();
    return (dw || 7) - 1 === dia;
  });
  const bySes = trades.filter((t) => t.ses === ses || t.sesion === ses);
  const byEstado = trades.filter((t) => {
    const j = journals[t.fecha];
    return j && Math.abs(parseInt(j.estado || 0) - estado) <= 1;
  });

  const scores = [
    wr(byPar),
    wr(byTipo),
    wr(byDia),
    wr(bySes),
    wr(byEstado),
  ].filter((v) => v !== null);
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 50;
  const expVal = (avgScore / 100) * rr - (1 - avgScore / 100) * 1;
  const rec = avgScore >= 52 && expVal > 0 && estado >= 6;
  const colorV = rec ? "var(--green)" : "var(--red)";

  document.getElementById("sim-result").innerHTML = `
    <div class="card" style="border-color:${colorV}">
      <div style="text-align:center;padding:10px 0 14px">
        <div style="font-size:28px;margin-bottom:6px">${rec ? "&#9989;" : "&#9940;"}</div>
        <div style="font-size:14px;font-weight:600;color:${colorV};margin-bottom:3px">${rec ? "Condiciones favorables" : "Historial sugiere precaucion"}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${trades.length} trades en historial</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
        <div style="background:var(--bg3);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:600;font-family:var(--mono);color:${avgScore >= 50 ? "var(--green)" : "var(--red)"}">${avgScore}%</div>
          <div style="font-size:10px;color:var(--text3)">WR esperado</div>
        </div>
        <div style="background:var(--bg3);border-radius:6px;padding:10px;text-align:center">
          <div style="font-size:20px;font-weight:600;font-family:var(--mono);color:${expVal > 0 ? "var(--green)" : "var(--red)"}">${expVal > 0 ? "+" : ""}${expVal.toFixed(2)}</div>
          <div style="font-size:10px;color:var(--text3)">Valor esperado (RR)</div>
        </div>
      </div>
      ${[
        ["Par (" + par + ")", wr(byPar), byPar.length],
        ["Tipo (" + tipo + ")", wr(byTipo), byTipo.length],
        ["Dia seleccionado", wr(byDia), byDia.length],
        ["Sesion (" + ses + ")", wr(bySes), bySes.length],
        ["Estado emocional ~" + estado, wr(byEstado), byEstado.length],
      ]
        .map(
          ([l, v, n]) =>
            `<div class="srow"><span class="slbl">${l}</span><div class="bw"><div class="bf" style="width:${v || 0}%;background:${(v || 0) >= 50 ? T.green : T.red}"></div></div><span class="sv" style="color:${(v || 0) >= 50 ? "var(--green)" : "var(--red)"}">${v !== null ? v + "% (" + n + ")" : "sin datos"}</span></div>`,
        )
        .join("")}
      ${estado < 6 ? '<div class="alert ae" style="margin-top:10px">Estado emocional bajo. Tu historial puede mostrar peor rendimiento en estos dias.</div>' : ""}
    </div>`;

  const hist = document.getElementById("sim-hist");
  const entry = document.createElement("div");
  entry.style.cssText =
    "font-size:11px;padding:5px 0;border-bottom:1px solid var(--border);font-family:var(--mono);color:var(--text2)";
  entry.textContent = `${new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })} · ${par} ${tipo} · WR ${avgScore}% · EV ${expVal.toFixed(2)} · ${rec ? "Favorable" : "Precaucion"}`;
  if (hist.children[0] && hist.children[0].tagName !== "DIV")
    hist.innerHTML = "";
  hist.prepend(entry);
}
