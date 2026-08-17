/* ============================================================
   STATISTICS — el módulo más grande: estadísticas generales,
   reporte semanal, score de consistencia, mapa de calor,
   correlación emoción→resultado, comparar semanas y top trades.
   ============================================================ */

import {
  trades,
  journals,
  frenoLog,
  diaC,
  horaC,
  eq2C,
  consC,
  corrC,
  wkWRC,
  wkRRC,
  wkPlanC,
  mesC,
  winsDistC,
  lossesDistC,
  setChart,
  load,
  instruments,
} from "./state.js";
import {
  today,
  fmtShort,
  fmtDate,
  weekStart,
  weekEnd,
  getWeeks,
  themeColors,
  lastValuePillPlugin,
  escapeHTML,
} from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { tradePnlUSD } from "./tradeManager.js";

// [window] go('stats', ...) la dispara desde main.js
export function renderStats() {
  const T = themeColors();
  const tot = trades.length;
  if (!tot) {
    [
      "st-wr",
      "st-rr",
      "st-pl",
      "st-plan-d",
      "st-emo-d",
      "st-par-d",
      "st-tipo-d",
      "st-ses-d",
      "st-racha",
      "adv-rdist",
      "adv-riskdist",
      "st-mes-tabla",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.innerHTML =
          '<div class="empty" style="padding:14px;font-size:11px">Sin datos</div>';
    });
    [
      "adv-pf",
      "adv-exp",
      "adv-rf",
      "adv-dd",
      "adv-avgwin",
      "adv-avgloss",
      "adv-bigwin",
      "adv-bigloss",
      "adv-efficiency",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = "—";
    });
    return;
  }
  const wins = trades.filter((t) => t.res === "TP").length;
  const decisivos = trades.filter(
    (t) => t.res === "TP" || t.res === "SL",
  ).length;
  const wr = decisivos ? Math.round((wins / decisivos) * 100) : 0;
  const rrA = trades
    .filter((t) => t.res === "TP" && t.rr)
    .map((t) => parseFloat(t.rr));
  const rr = rrA.length
    ? (rrA.reduce((a, b) => a + b, 0) / rrA.length).toFixed(2)
    : "-";
  const planPct = Math.round(
    (trades.filter((t) => t.plan === "Sí").length / tot) * 100,
  );
  document.getElementById("st-wr").innerHTML =
    `<span style="color:${wr >= 50 ? "var(--green)" : "var(--red)"}">${wr}%</span>`;
  document.getElementById("st-wrsub").textContent =
    `${wins} TP · ${trades.filter((t) => t.res === "SL").length} SL · ${trades.filter((t) => t.res === "BE").length} BE (BE no cuenta en WR)`;
  document.getElementById("st-rr").innerHTML = `<span>${rr}</span>`;
  document.getElementById("st-pl").innerHTML =
    `<span style="color:${planPct >= 80 ? "var(--green)" : "var(--yellow)"}">${planPct}%</span>`;
  const dias = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const dWR = dias.map((_, i) => {
    const dt = trades.filter((t) => {
      const dw = new Date(t.fecha + "T12:00:00").getDay();
      return (dw || 7) - 1 === i;
    });
    return dt.length
      ? Math.round((dt.filter((t) => t.res === "TP").length / dt.length) * 100)
      : null;
  });
  const horasUsadas = [
    ...new Set(
      trades.filter((t) => t.hora).map((t) => parseInt(t.hora.split(":")[0])),
    ),
  ].sort((a, b) => a - b);
  const horas = horasUsadas.map((h) => `${h}:00`);
  const hWR = horasUsadas.map((hi) => {
    const ht = trades.filter(
      (t) => t.hora && parseInt(t.hora.split(":")[0]) === hi,
    );
    return ht.length
      ? Math.round((ht.filter((t) => t.res === "TP").length / ht.length) * 100)
      : null;
  });
  if (diaC) {
    diaC.destroy();
    setChart("diaC", null);
  }
  if (horaC) {
    horaC.destroy();
    setChart("horaC", null);
  }
  const mk = (id, labels, data) => {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    return new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: data.map((v) =>
              v === null ? "rgba(255,255,255,0.05)" : v >= 50 ? T.green : T.red,
            ),
            borderRadius: 3,
            maxBarThickness: 20,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (v) => (v.raw === null ? "Sin datos" : v.raw + "%"),
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#555c72", font: { size: 9 } },
            grid: { display: false },
          },
          y: {
            min: 0,
            max: 100,
            ticks: {
              color: "#555c72",
              font: { size: 9 },
              callback: (v) => v + "%",
            },
            grid: { color: "rgba(255,255,255,0.03)" },
          },
        },
      },
    });
  };
  setChart("diaC", mk("ch-dia", dias, dWR));
  setChart("horaC", mk("ch-hora", horas, hWR));
  function sbar(id, items) {
    document.getElementById(id).innerHTML = items
      .map(
        ([l, p, n]) =>
          `<div class="srow"><span class="slbl">${l}</span><div class="bw"><div class="bf" style="width:${p}%;background:${p >= 50 ? T.green : T.red}"></div></div><span class="sv" style="color:${p >= 50 ? "var(--green)" : "var(--red)"}">${p}%${n != null ? ` (${n})` : ""}</span></div>`,
      )
      .join("");
  }
  const cp = trades.filter((t) => t.plan === "Sí"),
    sp = trades.filter((t) => t.plan === "No");
  const cpW = cp.length
    ? Math.round((cp.filter((t) => t.res === "TP").length / cp.length) * 100)
    : 0;
  const spW = sp.length
    ? Math.round((sp.filter((t) => t.res === "TP").length / sp.length) * 100)
    : 0;
  document.getElementById("st-plan-d").innerHTML =
    `<div class="srow"><span class="slbl">Con plan</span><div class="bw"><div class="bf" style="width:${cpW}%;background:${T.green}"></div></div><span class="sv" style="color:var(--green)">${cpW}% (${cp.length})</span></div><div class="srow"><span class="slbl">Sin plan</span><div class="bw"><div class="bf" style="width:${spW}%;background:${T.red}"></div></div><span class="sv" style="color:var(--red)">${spW}% (${sp.length})</span></div><div style="margin-top:6px;font-size:10px;color:var(--text3);font-family:var(--mono)">Diferencia: ${cpW - spW > 0 ? "+" : ""}${cpW - spW} pp</div>`;
  const emociones = ["Calma", "FOMO", "Miedo", "Euforia", "Frustración"];
  const emoR = emociones
    .map((e) => {
      const et = trades.filter((t) => t.emo === e);
      if (!et.length) return null;
      return [
        e,
        Math.round((et.filter((t) => t.res === "TP").length / et.length) * 100),
        et.length,
      ];
    })
    .filter(Boolean);
  if (emoR.length) sbar("st-emo-d", emoR);
  else
    document.getElementById("st-emo-d").innerHTML =
      '<div style="font-size:11px;color:var(--text3);padding:8px">Sin datos suficientes</div>';
  sbar(
    "st-par-d",
    instruments.map((i) => i.symbol).map((p) => {
      const pt = trades.filter((t) => t.par === p);
      return [
        p,
        pt.length
          ? Math.round(
              (pt.filter((t) => t.res === "TP").length / pt.length) * 100,
            )
          : 0,
        pt.length,
      ];
    }),
  );
  sbar(
    "st-tipo-d",
    ["Fase de continuidad", "Fase de Pullback", "Fase de Rango", "Fase de Ruptura"].map((tp) => {
      const tt = trades.filter((t) => t.tipo === tp);
      return [
        tp,
        tt.length
          ? Math.round(
              (tt.filter((t) => t.res === "TP").length / tt.length) * 100,
            )
          : 0,
        tt.length,
      ];
    }),
  );
  sbar(
    "st-ses-d",
    ["NY", "Londres", "Asia"].map((s) => {
      const st = trades.filter((t) => t.ses === s);
      return [
        s,
        st.length
          ? Math.round(
              (st.filter((t) => t.res === "TP").length / st.length) * 100,
            )
          : 0,
        st.length,
      ];
    }),
  );
  let racha = 0,
    dir = "";
  for (let i = trades.length - 1; i >= 0; i--) {
    const r = trades[i].res;
    if (r === "BE") continue;
    if (!dir) {
      dir = r;
      racha = 1;
    } else if (r === dir) racha++;
    else break;
  }
  document.getElementById("st-racha").innerHTML =
    `<div class="srow" style="margin-bottom:6px"><span class="slbl">Racha actual</span><span class="badge b${dir === "TP" ? "tp" : dir === "SL" ? "sl" : "be"}">${racha} ${dir || "—"}</span></div>${
      dir === "SL" && racha >= 2
        ? `<div class="alert ae"><span class="material-symbols-outlined icons">
sentiment_sad
</span> ${racha} pérdidas seguidas.</div>`
        : ""
    }${
      dir === "TP" && racha >= 3
        ? `<div class="alert aw"><span class="material-symbols-outlined icons">
sentiment_very_satisfied
</span> Racha de ${racha} TP. Doble checklist.</div>`
        : ""
    }`;
  if (eq2C) {
    eq2C.destroy();
    setChart("eq2C", null);
  }
  const eq2ctx = document.getElementById("ch-eq2");
  if (eq2ctx && trades.length) {
    let c = 0;
    const lb = [],
      d = [];
    trades.forEach((t, i) => {
      c += TradeEngine.resolveRR(t);
      lb.push(`${i + 1}`);
      d.push(parseFloat(c.toFixed(2)));
    });
    setChart(
      "eq2C",
      new Chart(eq2ctx, {
        type: "line",
        data: {
          labels: lb,
          datasets: [
            {
              data: d,
              borderColor: T.acc,
              borderWidth: 2.5,
              pointRadius: d.length > 30 ? 0 : 3,
              pointBackgroundColor: T.acc,
              pointBorderColor: "#fff",
              pointBorderWidth: 1.5,
              fill: true,
              backgroundColor: T.acc + "14",
              tension: 0.3,
            },
          ],
        },
        plugins: [
          lastValuePillPlugin(T.acc, (v) => (v >= 0 ? "+" : "") + v + "R"),
        ],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 40 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: "#0d0f14",
              titleColor: "#e5e7eb",
              titleFont: { size: 11, weight: "600" },
              bodyColor: "#e5e7eb",
              bodyFont: { size: 11 },
              padding: 10,
              cornerRadius: 8,
              displayColors: true,
              boxWidth: 8,
              boxHeight: 8,
              boxPadding: 4,
              callbacks: {
                title: (items) => `Trade ${items[0].label}`,
                label: (item) =>
                  ` RR acumulado: ${item.raw >= 0 ? "+" : ""}${item.raw}R`,
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: "#555c72",
                font: { size: 9 },
                maxTicksLimit: 15,
              },
              grid: { display: false },
            },
            y: {
              ticks: { color: "#555c72", font: { size: 9 } },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );
  }
  renderStatsAvanzadas();
}

/**
 * Métricas avanzadas (Fase 3 — Entrega 6): Profit Factor, Expectancy,
 * Recovery Factor, Average Winner/Loser, Largest Win/Loss, R Distribution
 * y distribución del riesgo realmente usado por trade.
 * Todo en unidades de R (no USD) porque esta página mira TODOS los
 * trades sin importar a qué Challenge pertenecían — mezclar dólares de
 * challenges con capitales distintos no tendría sentido, pero el RR es
 * una unidad universal comparable entre challenges.
 */
function renderStatsAvanzadas() {
  const T = themeColors();
  const s = TradeEngine.stats(trades);

  // Drawdown en R: usamos el RR acumulado como "equity" universal.
  let cum = 0;
  const rSeries = trades.map((t) => (cum += TradeEngine.resolveRR(t)));
  const dd = TradeEngine.drawdownFromValues(0, rSeries);
  const rf = TradeEngine.recoveryFactor(s.netRR, dd.maxDD);

  const setText = (id, txt, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    if (color) el.style.color = color;
  };

  setText(
    "adv-pf",
    s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2),
    s.profitFactor >= 1.5 ? "var(--green)" : "var(--red)",
  );
  setText(
    "adv-exp",
    (s.expectancy >= 0 ? "+" : "") + s.expectancy.toFixed(2),
    s.expectancy >= 0 ? "var(--green)" : "var(--red)",
  );
  setText(
    "adv-rf",
    rf === Infinity ? "∞" : rf.toFixed(2),
    rf >= 1 ? "var(--green)" : "var(--red)",
  );
  setText("adv-dd", "-" + dd.maxDD.toFixed(1) + "R", "var(--red)");
  setText("adv-avgwin", "+" + s.avgWin.toFixed(2), "var(--green)");
  setText("adv-avgloss", "-" + s.avgLoss.toFixed(2), "var(--red)");
  setText("adv-bigwin", "+" + s.largestWin.toFixed(2), "var(--green)");
  setText("adv-bigloss", s.largestLoss.toFixed(2), "var(--red)");

  const effValues = trades
    .map(TradeEngine.captureEfficiency)
    .filter((v) => v !== null);
  if (effValues.length) {
    const avgEff = effValues.reduce((a, v) => a + v, 0) / effValues.length;
    setText(
      "adv-efficiency",
      avgEff.toFixed(0) + "%",
      avgEff >= 70
        ? "var(--green)"
        : avgEff >= 30
          ? "var(--yellow)"
          : "var(--red)",
    );
    document.getElementById("adv-efficiency-sub").textContent =
      `Eficiencia de captura promedio · ${effValues.length} trade(s) con precios registrados`;
  } else {
    setText("adv-efficiency", "—");
    document.getElementById("adv-efficiency-sub").textContent =
      "Eficiencia de captura promedio · registra precio de entrada/TP/salida en tus trades para verla";
  }

  const rdist = TradeEngine.rDistribution(trades);
  const maxCount = Math.max(1, ...rdist.map((b) => b.count));
  document.getElementById("adv-rdist").innerHTML = rdist
    .map(
      (b) => `
    <div class="srow"><span class="slbl">${b.label}</span><div class="bw"><div class="bf" style="width:${(b.count / maxCount) * 100}%;background:${b.label.includes("-") || b.label === "< -2R" ? T.red : b.label === "0R (BE)" ? T.yellow : T.green}"></div></div><span class="sv">${b.count}</span></div>`,
    )
    .join("");

  const riskDist = TradeEngine.riskDistribution(trades);
  if (!riskDist.length) {
    document.getElementById("adv-riskdist").innerHTML =
      '<div class="empty" style="font-size:11px">Sin trades con snapshot de Challenge</div>';
  } else {
    const maxRCount = Math.max(1, ...riskDist.map((b) => b.count));
    document.getElementById("adv-riskdist").innerHTML = riskDist
      .map(
        (b) => `
    <div class="srow"><span class="slbl">${b.pct}%</span><div class="bw"><div class="bf" style="width:${(b.count / maxRCount) * 100}%;background:${T.acc}"></div></div><span class="sv">${b.count}</span></div>`,
      )
      .join("");
  }

  renderGananciasPerdidasDist();
  renderRendimientoMensual();
}

/**
 * Distribución de ganancias y pérdidas como gráficos separados
 * (Fase 3 — Entrega 10). Complementa la R Distribution combinada de
 * la Entrega 6 (que mezcla ganancias y pérdidas en un solo histograma)
 * con dos gráficos dedicados, cada uno con su propia escala.
 */
function renderGananciasPerdidasDist() {
  const T = themeColors();
  const wins = trades
    .filter((t) => t.res === "TP")
    .map(TradeEngine.resolveRR)
    .sort((a, b) => a - b);
  const losses = trades
    .filter((t) => t.res === "SL")
    .map((t) => Math.abs(TradeEngine.resolveRR(t)))
    .sort((a, b) => a - b);

  const bucketize = (values, size) => {
    if (!values.length) return { labels: [], data: [] };
    const max = Math.max(...values);
    const nBuckets = Math.max(1, Math.ceil(max / size));
    const counts = new Array(nBuckets).fill(0);
    values.forEach((v) => {
      const idx = Math.min(nBuckets - 1, Math.floor(v / size));
      counts[idx]++;
    });
    const labels = counts.map(
      (_, i) => `${(i * size).toFixed(1)}-${((i + 1) * size).toFixed(1)}R`,
    );
    return { labels, data: counts };
  };

  if (winsDistC) {
    winsDistC.destroy();
    setChart("winsDistC", null);
  }
  if (lossesDistC) {
    lossesDistC.destroy();
    setChart("lossesDistC", null);
  }

  const winsBucket = bucketize(wins, 1);
  const winsCtx = document.getElementById("ch-wins-dist");
  if (winsCtx && winsBucket.labels.length)
    setChart(
      "winsDistC",
      new Chart(winsCtx, {
        type: "bar",
        data: {
          labels: winsBucket.labels,
          datasets: [
            {
              data: winsBucket.data,
              backgroundColor: T.green,
              borderRadius: 3,
              maxBarThickness: 20,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: "#555c72", font: { size: 8 } },
              grid: { display: false },
            },
            y: {
              ticks: { color: "#555c72", font: { size: 9 }, stepSize: 1 },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );

  const lossesBucket = bucketize(losses, 1);
  const lossesCtx = document.getElementById("ch-losses-dist");
  if (lossesCtx && lossesBucket.labels.length)
    setChart(
      "lossesDistC",
      new Chart(lossesCtx, {
        type: "bar",
        data: {
          labels: lossesBucket.labels,
          datasets: [
            {
              data: lossesBucket.data,
              backgroundColor: T.red,
              borderRadius: 3,
              maxBarThickness: 20,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: "#555c72", font: { size: 8 } },
              grid: { display: false },
            },
            y: {
              ticks: { color: "#555c72", font: { size: 9 }, stepSize: 1 },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );
}

/**
 * Rendimiento mensual (Fase 3 — Entrega 7): agrupa todos los trades por
 * mes calendario (YYYY-MM) y muestra win rate, RR neto y conteo — mismo
 * patrón que "Comparar semanas", pero a nivel mensual.
 */
function renderRendimientoMensual() {
  const meses = [...new Set(trades.map((t) => t.fecha.slice(0, 7)))].sort();
  const T = themeColors();
  if (mesC) {
    mesC.destroy();
    setChart("mesC", null);
  }
  if (!meses.length) return;

  const data = meses.map((m) => {
    const mt = trades.filter((t) => t.fecha.slice(0, 7) === m);
    const wins = mt.filter((t) => t.res === "TP").length;
    const decisivos = mt.filter((t) => t.res === "TP" || t.res === "SL").length;
    const wr = decisivos ? Math.round((wins / decisivos) * 100) : null;
    const netRR = mt.reduce((a, t) => a + TradeEngine.resolveRR(t), 0);
    return { m, wr, netRR, tot: mt.length };
  });

  const labels = meses.map((m) => {
    const [y, mm] = m.split("-");
    return new Date(`${y}-${mm}-01T12:00:00`).toLocaleDateString("es-CO", {
      month: "short",
      year: "2-digit",
    });
  });

  const ctx = document.getElementById("ch-mes");
  if (ctx)
    setChart(
      "mesC",
      new Chart(ctx, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              data: data.map((d) => d.wr),
              backgroundColor: data.map((d) =>
                d.wr === null
                  ? "rgba(255,255,255,0.05)"
                  : d.wr >= 50
                    ? T.green
                    : T.red,
              ),
              borderRadius: 3,
              maxBarThickness: 20,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (v) => (v.raw === null ? "Sin datos" : v.raw + "% WR"),
              },
            },
          },
          scales: {
            x: {
              ticks: { color: "#555c72", font: { size: 9 } },
              grid: { display: false },
            },
            y: {
              min: 0,
              max: 100,
              ticks: {
                color: "#555c72",
                font: { size: 9 },
                callback: (v) => v + "%",
              },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );

  document.getElementById("st-mes-tabla").innerHTML = `
    <div style="overflow-x:auto">
    <table class="data-table" style="width:100%;border-collapse:collapse;font-size:11px;font-family:var(--mono)">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:6px 8px;color:var(--text3);font-weight:500">Mes</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">Trades</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">Win rate</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">RR neto</th>
      </tr></thead>
      <tbody>${[...data]
        .reverse()
        .map(
          (d, i) => `
        <tr style="border-bottom:1px solid var(--border)">
          <td data-label="Mes" style="padding:6px 8px;color:var(--text2)">${labels[data.length - 1 - i]}</td>
          <td data-label="Trades" style="padding:6px 8px;text-align:center">${d.tot}</td>
          <td data-label="Win rate" style="padding:6px 8px;text-align:center;color:${(d.wr || 0) >= 50 ? "var(--green)" : "var(--red)"}">${d.wr !== null ? d.wr + "%" : "—"}</td>
          <td data-label="RR neto" style="padding:6px 8px;text-align:center;color:${d.netRR >= 0 ? "var(--green)" : "var(--red)"}">${d.netRR >= 0 ? "+" : ""}${d.netRR.toFixed(1)}R</td>
        </tr>`,
        )
        .join("")}
      </tbody>
    </table></div>`;
}

// [window] go('reporte', ...) la dispara desde main.js
export function renderReporte() {
  const weeks = getWeeks();
  if (!weeks.length) {
    document.getElementById("reporte-content").innerHTML =
      `<div class="empty">Sin datos suficientes para generar reportes</div>`;
    return;
  }
  document.getElementById("reporte-content").innerHTML = weeks
    .map((ws) => {
      const we = weekEnd(ws);
      const wt = trades.filter((t) => t.fecha >= ws && t.fecha <= we);
      const wj = Object.keys(journals)
        .filter((d) => d >= ws && d <= we)
        .map((d) => journals[d]);
      const wins = wt.filter((t) => t.res === "TP").length,
        losses = wt.filter((t) => t.res === "SL").length,
        bes = wt.filter((t) => t.res === "BE").length;
      const decisivos = wt.filter(
        (t) => t.res === "TP" || t.res === "SL",
      ).length;
      const wr = decisivos ? Math.round((wins / decisivos) * 100) : 0;
      const rrA = wt
        .filter((t) => t.res === "TP" && t.rr)
        .map((t) => parseFloat(t.rr));
      const rr = rrA.length
        ? (rrA.reduce((a, b) => a + b, 0) / rrA.length).toFixed(1)
        : "-";
      const planOk = wt.length
        ? Math.round(
            (wt.filter((t) => t.plan === "Sí").length / wt.length) * 100,
          )
        : 0;
      const netRR = wt.reduce((a, t) => a + TradeEngine.resolveRR(t), 0);
      const aprendizajes = wj.filter((j) => j.apr).map((j) => j.apr);
      const fallos = wt.filter((t) => t.plan === "No").length;
      const scoreAvg = wj.filter((j) => j.score).length
        ? Math.round(
            wj.filter((j) => j.score).reduce((a, j) => a + (j.score || 0), 0) /
              wj.filter((j) => j.score).length,
          )
        : null;
      const isCurrentWeek = ws === weekStart(today());
      const sinOp = wt.length === 0;
      const soloBE = decisivos === 0 && bes > 0;
      const tieneTP = wins > 0;
      const tieneSL = losses > 0;
      const badge = sinOp
        ? `<span class="rw-badge" style="background:var(--bg3);color:var(--text3);border:1px solid var(--border)">Sin operaciones</span>`
        : soloBE
          ? `<span class="rw-badge" style="background:var(--bbg);color:var(--blue);border:1px solid var(--bbr)">Solo BE</span>`
          : tieneTP && !tieneSL
            ? `<span class="rw-badge" style="background:var(--gbg);color:var(--green);border:1px solid var(--gbr)">Buena semana</span>`
            : tieneSL && !tieneTP
              ? `<span class="rw-badge" style="background:var(--rbg);color:var(--red);border:1px solid var(--rbr)">Semana difícil</span>`
              : tieneTP && tieneSL
                ? `<span class="rw-badge" style="background:var(--ybg);color:var(--yellow);border:1px solid var(--ybr)">Semana mixta</span>`
                : `<span class="rw-badge" style="background:var(--bg3);color:var(--text3);border:1px solid var(--border)">Sin operaciones</span>`;
      return `<div class="report-week">
      <div class="rw-head" onclick="toggleJ('rw-${ws.replace(/-/g, "")}')">
        <div>
          <div class="rw-title">${isCurrentWeek ? "Esta semana — " : ""} ${fmtShort(ws)} → ${fmtShort(we)}</div>
          <div style="font-size:10px;color:var(--text3);font-family:var(--mono);margin-top:2px">${wt.length} trades · ${wj.length} journals</div>
        </div>
        ${badge}
      </div>
      <div class="rw-grid">
        <div class="rw-m"><div class="rw-mv" style="color:${wr >= 50 ? "var(--green)" : "var(--red)"}">${wr}%</div><div class="rw-ml">Win rate</div></div>
        <div class="rw-m"><div class="rw-mv">${rr}</div><div class="rw-ml">RR prom</div></div>
        <div class="rw-m"><div class="rw-mv" style="color:${netRR >= 0 ? "var(--green)" : "var(--red)"}">${netRR >= 0 ? "+" : ""}${netRR.toFixed(1)}</div><div class="rw-ml">RR neto</div></div>
        <div class="rw-m"><div class="rw-mv" style="color:${planOk >= 80 ? "var(--green)" : "var(--yellow)"}">${planOk}%</div><div class="rw-ml">Plan OK</div></div>
        <div class="rw-m"><div class="rw-mv">${scoreAvg || "—"}</div><div class="rw-ml">Score prom</div></div>
      </div>
      <div class="rw-body open" id="rw-${ws.replace(/-/g, "")}">
        <div style="display:flex;gap:10px;margin-bottom:10px;font-size:11px;font-family:var(--mono)">
          <span style="color:var(--green)">${wins}W</span><span style="color:var(--red)">${losses}L</span><span style="color:var(--yellow)">${bes}BE</span>
          ${fallos > 0 ? `<span style="color:var(--red)">· ${fallos} fallos al plan</span>` : ""}
        </div>
        ${aprendizajes.length ? `<div style="margin-bottom:8px"><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase;margin-bottom:5px">Aprendizajes de la semana</div>${aprendizajes.map((a) => `<div style="font-size:11px;padding:6px 8px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);margin-bottom:4px;font-family:var(--mono);color:var(--text2)">· ${a}</div>`).join("")}</div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}

/** Puntaje de consistencia (0-100+) de una semana dada. */
export function calcConsistenciaWeek(ws) {
  const we = weekEnd(ws);
  const wt = trades.filter((t) => t.fecha >= ws && t.fecha <= we);
  const wj = Object.keys(journals)
    .filter((d) => d >= ws && d <= we)
    .map((d) => journals[d]);
  const wf = frenoLog.filter((f) => f.fecha >= ws && f.fecha <= we);
  let pts = 0,
    max = 0,
    detail = [];
  const diasOp =
    wt.length > 0 ? [...new Set(wt.map((t) => t.fecha))].length : 0;
  const jCount = wj.length;
  const jPts = jCount * 20;
  pts += jPts;
  max += diasOp * 20;
  detail.push({
    lbl: "Journals completados",
    pts: jPts,
    max: diasOp * 20,
    n: `${jCount}/${diasOp} días`,
  });
  const planOkT = wt.filter((t) => t.plan === "Sí").length;
  const planPts = planOkT * 20;
  pts += planPts;
  max += wt.length * 20;
  detail.push({
    lbl: "Plan respetado",
    pts: planPts,
    max: wt.length * 20,
    n: `${planOkT}/${wt.length} trades`,
  });
  const frenoPts = Math.min(wf.length, 5) * 15;
  pts += frenoPts;
  max += 75;
  detail.push({
    lbl: "Frenos completados",
    pts: frenoPts,
    max: 75,
    n: `${wf.length} frenos`,
  });
  const un1T = [...new Set(wt.map((t) => t.fecha))].filter(
    (d) => wt.filter((tt) => tt.fecha === d).length === 1,
  ).length;
  const un1Pts = un1T * 15;
  pts += un1Pts;
  max += diasOp * 15;
  detail.push({
    lbl: "Un trade por día",
    pts: un1Pts,
    max: diasOp * 15,
    n: `${un1T}/${diasOp} días`,
  });
  const highScore = wj.filter((j) => j.score && j.score >= 7).length;
  const hsPts = highScore * 10;
  pts += hsPts;
  max += jCount * 10;
  detail.push({
    lbl: "Calificación ≥7",
    pts: hsPts,
    max: jCount * 10,
    n: `${highScore}/${jCount} días`,
  });
  const pct = max > 0 ? Math.round((pts / max) * 100) : 0;
  return { pct, pts, max, detail };
}

// [window] go('consistencia', ...) la dispara desde main.js
export function renderConsistencia() {
  const T = themeColors();
  const ws = weekStart(today());
  const r = calcConsistenciaWeek(ws);
  const color =
    r.pct >= 80 ? "var(--green)" : r.pct >= 60 ? "var(--yellow)" : "var(--red)";
  const grade =
    r.pct >= 80
      ? "Excelente disciplina"
      : r.pct >= 60
        ? "Disciplina correcta"
        : "Necesita mejorar";
  document.getElementById("cons-score").innerHTML =
    `<span style="color:${color}">${r.pct}%</span>`;
  document.getElementById("cons-grade").textContent = grade;
  document.getElementById("cons-detail").innerHTML = r.detail
    .map(
      (d) => `
    <div class="srow"><span class="slbl">${d.lbl}</span><div class="bw"><div class="bf" style="width:${d.max > 0 ? Math.round((d.pts / d.max) * 100) : 0}%;background:${d.max > 0 && d.pts / d.max >= 0.7 ? T.green : T.yellow}"></div></div><span class="sv">${d.n}</span></div>`,
    )
    .join("");
  const weeks = getWeeks().slice(0, 8).reverse();
  const wData = weeks.map((w) => calcConsistenciaWeek(w).pct);
  const wLabels = weeks.map((w) => fmtShort(w));
  if (consC) {
    consC.destroy();
    setChart("consC", null);
  }
  const ctx = document.getElementById("ch-cons");
  if (ctx)
    setChart(
      "consC",
      new Chart(ctx, {
        type: "line",
        data: {
          labels: wLabels,
          datasets: [
            {
              data: wData,
              borderColor: T.acc,
              borderWidth: 2,
              pointRadius: wData.map((v) => (v > 0 ? 4 : 0)),
              pointBackgroundColor: wData.map((v) =>
                v >= 80 ? T.green : v >= 60 ? T.yellow : T.red,
              ),
              pointBorderColor: "#fff",
              pointBorderWidth: 1.5,
              fill: true,
              backgroundColor: T.acc + "0f",
              tension: 0.3,
              spanGaps: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 10, right: 10 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (v) => {
                  const pct = v.raw;
                  const grade =
                    pct >= 80
                      ? "Excelente"
                      : pct >= 60
                        ? "Correcta"
                        : "Necesita mejorar";
                  return `Consistencia: ${pct}% — ${grade}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { color: "#555c72", font: { size: 9 } },
              grid: { display: false },
            },
            y: {
              min: 0,
              max: 200,
              suggestedMax: 200,
              ticks: {
                color: "#555c72",
                font: { size: 9 },
                callback: (v) => v + "%",
                stepSize: 20,
              },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );
}

/**
 * Detalle de un día del calendario (Fase 3 — Entrega 9): trades del día
 * con su PnL real, nota del journal si existe, y acceso a las capturas
 * de cada trade (reutiliza verImagenes(), ya construido — no se
 * reinventa el visor de imágenes).
 */
// [window] onclick="showDayDetail(fecha)" desde las celdas del calendario
export function showDayDetail(fecha) {
  const dt = trades.filter((t) => t.fecha === fecha);
  const j = journals[fecha];
  const el = document.getElementById("heatmap-day-detail");

  let html = `<div style="font-size:13px;font-weight:600;margin-bottom:10px">${fmtDate(fecha)}</div>`;

  if (dt.length) {
    const netRR = TradeEngine.netRR(dt);
    const usdVals = dt.map(tradePnlUSD).filter((v) => v !== null);
    const netUSD = usdVals.reduce((a, v) => a + v, 0);
    html += `<div style="display:flex;gap:14px;margin-bottom:10px;font-size:11px;font-family:var(--mono)">
      <span>RR neto: <strong style="color:${netRR >= 0 ? "var(--green)" : "var(--red)"}">${netRR >= 0 ? "+" : ""}${netRR.toFixed(1)}R</strong></span>
      ${usdVals.length ? `<span>PnL: <strong style="color:${netUSD >= 0 ? "var(--green)" : "var(--red)"}">${netUSD >= 0 ? "+" : ""}$${netUSD.toFixed(2)}</strong></span>` : ""}
    </div>`;
    html += dt
      .map((t) => {
        const pnl = tradePnlUSD(t);
        return `<div class="ti">
        <div class="th">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${escapeHTML(t.hora || "")}</span>
            <span style="font-size:13px;font-weight:600">${escapeHTML(t.par)}</span>
            <span style="font-size:11px;color:var(--text3)">${escapeHTML(t.dir || "")} · ${escapeHTML(t.tipo || "")}</span>
          </div>
          <div style="display:flex;gap:5px;align-items:center">
            <span class="badge b${escapeHTML(String(t.res).toLowerCase())}">${escapeHTML(t.res)}</span>
            ${t.rr ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">RR ${escapeHTML(t.rr)}</span>` : ""}
            ${pnl !== null ? `<span style="font-size:10px;font-family:var(--mono);font-weight:600;color:${pnl >= 0 ? "var(--green)" : "var(--red)"}">${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}</span>` : ""}
            ${t.imgHTF || t.imgLTF || t.img ? `<button class="btn btn-sm" style="padding:2px 8px;font-size:10px" onclick="verImagenes(${t.id})">Ver capturas</button>` : ""}
          </div>
        </div>
        ${t.notas ? `<div style="font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);font-family:var(--mono);margin-top:4px">${escapeHTML(t.notas)}</div>` : ""}
      </div>`;
      })
      .join("");
  } else {
    html += `<div class="empty" style="padding:10px 0;font-size:11px">Sin trades este día</div>`;
  }

  if (j) {
    html += `<div class="jf" style="margin-top:10px">
      <div class="jfl">Journal del día</div>
      <div class="jfv">
        ${j.sesgo ? `<strong>Sesgo:</strong> ${escapeHTML(j.sesgo)}<br>` : ""}
        ${j.setup ? `<strong>Setup:</strong> ${escapeHTML(j.setup)}<br>` : ""}
        ${j.apr ? `<strong>Aprendizaje:</strong> ${escapeHTML(j.apr)}` : ""}
      </div>
    </div>`;
  }

  el.innerHTML = html;
  document
    .getElementById("heatmap-detail-card")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// [window] go('correlacion', ...) la dispara desde main.js
export function renderCorrelacion() {
  const tradesConEstado = trades.filter((t) => {
    const j = journals[t.fecha];
    return j && j.estado && parseInt(j.estado) > 0;
  });
  if (tradesConEstado.length < 3) {
    document.getElementById("corr-matrix").innerHTML =
      `<div class="empty" style="padding:20px;font-size:11px">Necesitas al menos 3 trades con journal y estado emocional registrado.<br><br>Completa el campo "Estado emocional" en el journal pre-sesión.</div>`;
    document.getElementById("corr-insights").innerHTML =
      '<div style="font-size:11px;color:var(--text3);padding:10px">Sin datos suficientes todavía.</div>';
    return;
  }
  const resultados = ["TP", "SL", "BE"];
  const T = themeColors();
  const colors = { TP: T.green, SL: T.red, BE: T.yellow };
  let matrixHTML = "";
  resultados.forEach((res) => {
    matrixHTML += `<div style="display:flex;align-items:center;gap:2px;margin-bottom:2px">`;
    matrixHTML += `<span style="font-size:9px;color:var(--text3);font-family:var(--mono);min-width:24px">${res}</span>`;
    matrixHTML += `<div style="display:grid;grid-template-columns:repeat(10,1fr);gap:2px;flex:1">`;
    for (let e = 1; e <= 10; e++) {
      const group = tradesConEstado.filter((t) => {
        const j = journals[t.fecha];
        return parseInt(j.estado) === e && t.res === res;
      });
      const total = tradesConEstado.filter((t) => {
        const j = journals[t.fecha];
        return parseInt(j.estado) === e;
      });
      const intensity = total.length ? group.length / total.length : 0;
      const alpha = total.length ? Math.max(0.1, intensity).toFixed(2) : 0.04;
      const tip = total.length
        ? `Estado ${e}: ${group.length}/${total.length} (${Math.round(intensity * 100)}%)`
        : `Estado ${e}: sin datos`;
      matrixHTML += `<div class="corr-cell" style="background:${colors[res]};opacity:${alpha};border:1px solid ${colors[res]}33" data-tip="${tip}" title="${tip}"></div>`;
    }
    matrixHTML += `</div></div>`;
  });
  document.getElementById("corr-matrix").innerHTML = matrixHTML;
  const wrByEstado = Array.from({ length: 10 }, (_, i) => i + 1).map((e) => {
    const g = tradesConEstado.filter((t) => {
      const j = journals[t.fecha];
      return parseInt(j.estado) === e;
    });
    return g.length
      ? Math.round((g.filter((t) => t.res === "TP").length / g.length) * 100)
      : null;
  });
  if (corrC) {
    corrC.destroy();
    setChart("corrC", null);
  }
  const ctx = document.getElementById("ch-corr");
  if (ctx)
    setChart(
      "corrC",
      new Chart(ctx, {
        type: "bar",
        data: {
          labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
          datasets: [
            {
              data: wrByEstado,
              backgroundColor: wrByEstado.map((v) =>
                v === null
                  ? "rgba(255,255,255,0.04)"
                  : v >= 50
                    ? T.green
                    : T.red,
              ),
              borderRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (v) => `Estado emocional: ${v[0].label}`,
                label: (v) =>
                  v.raw === null ? "Sin datos" : v.raw + "% win rate",
              },
            },
          },
          scales: {
            x: {
              title: {
                display: true,
                text: "Estado emocional",
                color: "#555c72",
                font: { size: 9 },
              },
              ticks: { color: "#555c72", font: { size: 9 } },
              grid: { display: false },
            },
            y: {
              min: 0,
              max: 100,
              ticks: {
                color: "#555c72",
                font: { size: 9 },
                callback: (v) => v + "%",
              },
              grid: { color: "rgba(255,255,255,0.03)" },
            },
          },
        },
      }),
    );
  const validWR = wrByEstado
    .map((v, i) => (v !== null ? { e: i + 1, wr: v } : null))
    .filter(Boolean);
  if (validWR.length >= 2) {
    const best = validWR.reduce((a, b) => (a.wr > b.wr ? a : b));
    const worst = validWR.reduce((a, b) => (a.wr < b.wr ? a : b));
    const highStates = validWR.filter((v) => v.e >= 7);
    const lowStates = validWR.filter((v) => v.e <= 4);
    const wrHigh = highStates.length
      ? Math.round(highStates.reduce((a, b) => a + b.wr, 0) / highStates.length)
      : null;
    const wrLow = lowStates.length
      ? Math.round(lowStates.reduce((a, b) => a + b.wr, 0) / lowStates.length)
      : null;
    let insights = `<div class="srow"><span class="slbl">Mejor estado</span><span style="color:var(--green);font-family:var(--mono);font-size:11px">${best.e}/10 → ${best.wr}% WR</span></div>`;
    insights += `<div class="srow"><span class="slbl">Peor estado</span><span style="color:var(--red);font-family:var(--mono);font-size:11px">${worst.e}/10 → ${worst.wr}% WR</span></div>`;
    if (wrHigh !== null)
      insights += `<div class="srow"><span class="slbl">Estado ≥7 prom</span><span style="color:${wrHigh >= 50 ? "var(--green)" : "var(--red)"};font-family:var(--mono);font-size:11px">${wrHigh}% WR</span></div>`;
    if (wrLow !== null)
      insights += `<div class="srow"><span class="slbl">Estado ≤4 prom</span><span style="color:${wrLow >= 50 ? "var(--green)" : "var(--red)"};font-family:var(--mono);font-size:11px">${wrLow}% WR</span></div>`;
    if (wrHigh !== null && wrLow !== null) {
      const diff = wrHigh - wrLow;
      insights += `<div class="alert ${diff > 10 ? "ai" : "aw"}" style="margin-top:8px">`;
      if (diff > 20)
        insights += `Con estado emocional alto (≥7) tu win rate es ${diff} puntos mayor. Los datos dicen: si estás bajo de ánimo, no operes.`;
      else if (diff > 5)
        insights += `Hay una diferencia de ${diff} puntos entre estado alto y bajo. La emoción sí afecta tu resultado.`;
      else
        insights += `Tu rendimiento es bastante estable sin importar el estado emocional. Sigue monitoreando.`;
      insights += `</div>`;
    }
    document.getElementById("corr-insights").innerHTML = insights;
  } else {
    document.getElementById("corr-insights").innerHTML =
      '<div style="font-size:11px;color:var(--text3);padding:10px;font-family:var(--mono)">Necesitas más datos para generar insights automáticos. Sigue registrando el estado emocional en el journal.</div>';
  }
}

// [window] go('comparar', ...) la dispara desde main.js
export function renderComparar() {
  load();
  const T = themeColors();
  const weeks = getWeeks().slice(0, 8).reverse();
  if (weeks.length < 2) {
    document.getElementById("wk-tabla").innerHTML =
      '<div class="empty">Necesitas al menos 2 semanas de datos en el Journal v2.</div>';
    return;
  }
  const labels = weeks.map((w) => fmtShort(w));
  const wkData = weeks.map((ws) => {
    const we = weekEnd(ws);
    const wt = trades.filter((t) => t.fecha >= ws && t.fecha <= we);
    const wj = Object.keys(journals)
      .filter((d) => d >= ws && d <= we)
      .map((d) => journals[d]);
    const wins = wt.filter((t) => t.res === "TP").length,
      tot = wt.length;
    const decisivosW = wt.filter(
      (t) => t.res === "TP" || t.res === "SL",
    ).length;
    const wr = decisivosW ? Math.round((wins / decisivosW) * 100) : null;
    const netRR = wt.reduce((a, t) => a + TradeEngine.resolveRR(t), 0);
    const planOk = tot
      ? Math.round(
          (wt.filter((t) => t.plan === "Si" || t.plan === "Sí").length / tot) *
            100,
        )
      : null;
    const scoreAvg = wj.filter((j) => j.score).length
      ? Math.round(
          wj.filter((j) => j.score).reduce((a, j) => a + (j.score || 0), 0) /
            wj.filter((j) => j.score).length,
        )
      : null;
    return { ws, wr, netRR, planOk, scoreAvg, tot, wins };
  });

  if (wkWRC) {
    wkWRC.destroy();
    setChart("wkWRC", null);
  }
  if (wkRRC) {
    wkRRC.destroy();
    setChart("wkRRC", null);
  }
  if (wkPlanC) {
    wkPlanC.destroy();
    setChart("wkPlanC", null);
  }

  const mkLine = (id, data, color, isPercent = true) => {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    const opts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: { color: "#888", font: { size: 9 } },
          grid: { display: false },
        },
        y: {
          min: isPercent ? 0 : undefined,
          max: isPercent ? 100 : undefined,
          ticks: {
            color: "#888",
            font: { size: 9 },
            callback: (v) => (isPercent ? v + "%" : v + "R"),
          },
          grid: { color: "rgba(127,127,127,0.07)" },
        },
      },
    };
    return new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: color,
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: color,
            fill: false,
            tension: 0.3,
            spanGaps: true,
          },
        ],
      },
      options: opts,
    });
  };

  setChart(
    "wkWRC",
    mkLine(
      "ch-wk-wr",
      wkData.map((d) => d.wr),
      T.green,
      true,
    ),
  );
  setChart(
    "wkRRC",
    mkLine(
      "ch-wk-rr",
      wkData.map((d) => parseFloat(d.netRR.toFixed(2))),
      T.acc,
      false,
    ),
  );
  setChart(
    "wkPlanC",
    mkLine(
      "ch-wk-plan",
      wkData.map((d) => d.planOk),
      T.yellow,
      true,
    ),
  );

  document.getElementById("wk-tabla").innerHTML = `
    <div style="overflow-x:auto">
    <table class="data-table" style="width:100%;border-collapse:collapse;font-size:11px;font-family:var(--mono)">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="text-align:left;padding:6px 8px;color:var(--text3);font-weight:500">Semana</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">Trades</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">Win rate</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">RR neto</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">Plan OK</th>
        <th style="padding:6px 8px;color:var(--text3);font-weight:500;text-align:center">Score dia</th>
      </tr></thead>
      <tbody>${[...wkData]
        .reverse()
        .map(
          (d) => `
        <tr style="border-bottom:1px solid var(--border)">
          <td data-label="Semana" style="padding:6px 8px;color:var(--text2)">${fmtShort(d.ws)}</td>
          <td data-label="Trades" style="padding:6px 8px;text-align:center">${d.tot}</td>
          <td data-label="Win rate" style="padding:6px 8px;text-align:center;color:${(d.wr || 0) >= 50 ? "var(--green)" : "var(--red)"}">${d.wr !== null ? d.wr + "%" : "—"}</td>
          <td data-label="RR neto" style="padding:6px 8px;text-align:center;color:${d.netRR >= 0 ? "var(--green)" : "var(--red)"}">${d.netRR >= 0 ? "+" : ""}${d.netRR.toFixed(1)}R</td>
          <td data-label="Plan OK" style="padding:6px 8px;text-align:center;color:${(d.planOk || 0) >= 80 ? "var(--green)" : "var(--yellow)"}">${d.planOk !== null ? d.planOk + "%" : "—"}</td>
          <td data-label="Score dia" style="padding:6px 8px;text-align:center">${d.scoreAvg !== null ? d.scoreAvg + "/10" : "—"}</td>
        </tr>`,
        )
        .join("")}
      </tbody>
    </table></div>`;
}

// [window] go('toptrades', ...) la dispara desde main.js
export function renderTopTrades() {
  load();
  const T = themeColors();
  if (!trades.length) {
    ["top-wins", "top-losses", "patterns"].forEach((id) => {
      document.getElementById(id).innerHTML =
        '<div class="empty" style="font-size:11px">Sin datos en el Journal v2</div>';
    });
    return;
  }
  const tpTrades = [...trades]
    .filter((t) => t.res === "TP" && t.rr)
    .sort((a, b) => parseFloat(b.rr) - parseFloat(a.rr))
    .slice(0, 5);
  const slTrades = [...trades]
    .filter((t) => t.res === "SL")
    .slice(-5)
    .reverse();

  function tradeRow(t, i, color) {
    return `<div class="trade-rank">
      <div class="rank-n" style="background:${color}22;color:${color}">${i + 1}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600">${escapeHTML(t.par)} ${escapeHTML(t.dir || "")} &middot; ${escapeHTML(t.tipo || "")}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtShort(t.fecha)}${t.hora ? " " + escapeHTML(t.hora) : ""} &middot; ${escapeHTML(t.ses || t.sesion || "")} &middot; ${escapeHTML(t.emo || t.emocion || "")}</div>
        ${t.notas ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${escapeHTML(t.notas.slice(0, 70))}${t.notas.length > 70 ? "..." : ""}</div>` : ""}
      </div>
      ${t.rr ? `<span style="font-size:13px;font-weight:600;font-family:var(--mono);color:${color}">RR ${escapeHTML(t.rr)}</span>` : ""}
    </div>`;
  }

  document.getElementById("top-wins").innerHTML = tpTrades.length
    ? tpTrades.map((t, i) => tradeRow(t, i, T.green)).join("")
    : '<div class="empty" style="font-size:11px">Sin TPs con RR registrado</div>';
  document.getElementById("top-losses").innerHTML = slTrades.length
    ? slTrades.map((t, i) => tradeRow(t, i, T.red)).join("")
    : '<div class="empty" style="font-size:11px">Sin SLs registrados</div>';

  const patterns = [];
  instruments.map((i) => i.symbol).forEach((par) => {
    const pt = tpTrades.filter((t) => t.par === par);
    if (pt.length >= 2)
      patterns.push(
        `<div class="alert as">${pt.length} de tus mejores TP son en <strong>${par}</strong>. Es tu par mas rentable.</div>`,
      );
    const sl = slTrades.filter((t) => t.par === par);
    if (sl.length >= 3)
      patterns.push(
        `<div class="alert ae">${sl.length} de tus ultimas perdidas son en <strong>${par}</strong>. Revisa tu estrategia en este par.</div>`,
      );
  });
  if (tpTrades.length >= 3) {
    const tipoFreq = tpTrades.reduce((a, t) => {
      a[t.tipo] = (a[t.tipo] || 0) + 1;
      return a;
    }, {});
    const bestTipo = Object.entries(tipoFreq).sort((a, b) => b[1] - a[1])[0];
    if (bestTipo && bestTipo[1] >= 3)
      patterns.push(
        `<div class="alert ai">${bestTipo[1]} de tus top 5 TP son de tipo <strong>${bestTipo[0]}</strong>. Tu setup mas rentable.</div>`,
      );
  }
  const calmaTp = tpTrades.filter(
    (t) => t.emo === "Calma" || t.emocion === "Calma",
  ).length;
  if (calmaTp >= 3)
    patterns.push(
      `<div class="alert as">${calmaTp} de tus mejores trades los tomaste con <strong>Calma</strong>. Los datos confirman: la emocion importa.</div>`,
    );
  const noplanSl = slTrades.filter((t) => t.plan === "No").length;
  if (noplanSl >= 2)
    patterns.push(
      `<div class="alert ae">${noplanSl} de tus perdidas recientes fueron sin respetar el plan. El patron es claro.</div>`,
    );
  document.getElementById("patterns").innerHTML = patterns.length
    ? patterns.join("")
    : '<div style="font-size:11px;color:var(--text3)">Necesitas mas trades para detectar patrones automaticos. Sigue registrando.</div>';
}
