/* ============================================================
   REPLAY — reproduce la evolución de UN Challenge trade a trade
   (balance, equity, drawdown, stats hasta ese punto).
   ------------------------------------------------------------
   Decisión de arquitectura: el replay opera sobre un Challenge
   específico elegido por el usuario, no sobre "todos los trades"
   — mezclar capitales/riesgos distintos entre challenges en una
   sola curva de dólares no tendría sentido. El motor no necesita
   nada nuevo: TradeEngine.equitySeries() (Entrega 1) ya hace
   exactamente el cálculo que este scrubber necesita.

   Estado efímero de esta página (posición del scrubber, serie
   cargada, intervalo de reproducción) vive como variables locales
   de este módulo — no en state.js, porque ningún otro módulo
   necesita tocarlo ni persiste entre sesiones.
   ============================================================ */

import { trades, challenges, replayC, setChart } from "./state.js";
import { fmtDate, themeColors, lastValuePillPlugin, escapeHTML } from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { challengeRiskResolver } from "./tradeManager.js";

let currentSeries = [];
let currentIndex = 0;
let currentChallenge = null;
let playInterval = null;

// [window] go('replay', ...) la dispara desde main.js
export function renderReplay() {
  populateChallengeSelect();
  const sel = document.getElementById("replay-challenge");
  if (!sel.value) {
    document.getElementById("replay-empty").innerHTML =
      '<div class="empty">Crea un Challenge primero en la sección "Challenge".</div>';
    document.getElementById("replay-body").style.display = "none";
    return;
  }
  loadChallengeSeries(sel.value);
}

function populateChallengeSelect() {
  const sel = document.getElementById("replay-challenge");
  const prevValue = sel.value;
  if (!challenges.length) {
    sel.innerHTML = "";
    return;
  }
  sel.innerHTML = challenges
    .map(
      (c) =>
        `<option value="${c.id}">${escapeHTML(c.nombre)}${c.active ? " (activo)" : ""}</option>`,
    )
    .join("");
  const stillExists = challenges.some((c) => String(c.id) === prevValue);
  if (stillExists) {
    sel.value = prevValue;
  } else {
    const active = challenges.find((c) => c.active);
    sel.value = active ? active.id : challenges[0].id;
  }
}

// [window] onchange="changeReplayChallenge()" en el selector
export function changeReplayChallenge() {
  const sel = document.getElementById("replay-challenge");
  loadChallengeSeries(sel.value);
}

function loadChallengeSeries(challengeId) {
  stopPlay();
  const ch = challenges.find((c) => String(c.id) === String(challengeId));
  currentChallenge = ch;
  if (!ch) {
    document.getElementById("replay-empty").innerHTML =
      '<div class="empty">Selecciona un Challenge.</div>';
    document.getElementById("replay-body").style.display = "none";
    return;
  }
  const chTrades = trades.filter(
    (t) => t.challengeSnapshot?.challengeId === ch.id,
  );
  currentSeries = TradeEngine.equitySeries(
    chTrades,
    ch.size,
    challengeRiskResolver(ch),
  );

  if (!currentSeries.length) {
    document.getElementById("replay-empty").innerHTML =
      '<div class="empty">Este Challenge todavía no tiene trades registrados.</div>';
    document.getElementById("replay-body").style.display = "none";
    return;
  }
  document.getElementById("replay-empty").innerHTML = "";
  document.getElementById("replay-body").style.display = "block";

  const slider = document.getElementById("replay-slider");
  slider.min = 0;
  slider.max = currentSeries.length - 1;
  currentIndex = currentSeries.length - 1; // arranca mostrando el estado actual
  slider.value = currentIndex;

  renderReplayChart();
  renderFrame(currentIndex);
}

function renderReplayChart() {
  if (replayC) {
    replayC.destroy();
    setChart("replayC", null);
  }
  const ctx = document.getElementById("ch-replay");
  if (!ctx) return;
  const labels = currentSeries.map((_, i) => `#${i + 1}`);
  const data = currentSeries.map((p) =>
    parseFloat(p.balanceDespues.toFixed(2)),
  );
  const T = themeColors();
  setChart(
    "replayC",
    new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            data,
            borderColor: T.acc,
            borderWidth: 2,
            pointRadius: data.map((_, i) => (i === currentIndex ? 6 : 3)),
            pointBackgroundColor: data.map((_, i) =>
              i === currentIndex ? "#fff" : T.acc,
            ),
            pointBorderColor: T.acc,
            pointBorderWidth: 2,
            fill: true,
            backgroundColor: T.acc + "12",
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
              label: (item) => ` Balance: $${item.raw.toLocaleString()}`,
            },
          },
        },
        scales: {
          x: { ticks: { display: false }, grid: { display: false } },
          y: {
            ticks: { color: "#555c72", font: { size: 9 } },
            grid: { color: "rgba(255,255,255,0.03)" },
          },
        },
      },
    }),
  );
}

function highlightFrame(idx) {
  const chart = replayC;
  if (!chart) return;
  const T = themeColors();
  const ds = chart.data.datasets[0];
  ds.pointRadius = ds.data.map((_, i) => (i === idx ? 6 : 0));
  ds.pointBackgroundColor = ds.data.map((_, i) => (i === idx ? "#fff" : T.acc));
  chart.update();
}

function renderFrame(idx) {
  currentIndex = idx;
  const point = currentSeries[idx];
  const t = point.trade;
  const upTo = currentSeries.slice(0, idx + 1).map((p) => p.trade);

  document.getElementById("replay-pos").textContent =
    `Trade ${idx + 1} / ${currentSeries.length}`;

  const balEl = document.getElementById("replay-balance");
  balEl.textContent = `$${point.balanceDespues.toFixed(0)}`;
  balEl.style.color =
    point.balanceDespues >= currentChallenge.size
      ? "var(--green)"
      : "var(--red)";

  const netRR = TradeEngine.netRR(upTo);
  const rrEl = document.getElementById("replay-netrr");
  rrEl.textContent = `${netRR >= 0 ? "+" : ""}${netRR.toFixed(1)}R`;
  rrEl.style.color = netRR >= 0 ? "var(--green)" : "var(--red)";

  const dd = TradeEngine.drawdown(currentSeries.slice(0, idx + 1));
  document.getElementById("replay-dd").textContent =
    `-$${dd.currentDD.toFixed(0)} (${dd.currentDDPct.toFixed(1)}%)`;

  document.getElementById("replay-trade-detail").innerHTML = `
    <div class="srow"><span class="slbl">Fecha</span><span class="sv">${fmtDate(t.fecha)}${t.hora ? " " + escapeHTML(t.hora) : ""}</span></div>
    <div class="srow"><span class="slbl">Par / Dirección</span><span class="sv">${escapeHTML(t.par)} ${escapeHTML(t.dir || "")}</span></div>
    <div class="srow"><span class="slbl">Resultado</span><span class="badge b${t.res.toLowerCase()}">${t.res}</span></div>
    <div class="srow"><span class="slbl">RR</span><span class="sv">${escapeHTML(t.rr) || "—"}</span></div>
    <div class="srow"><span class="slbl">PnL de este trade</span><span class="sv" style="color:${point.pnlUSD >= 0 ? "var(--green)" : "var(--red)"}">${point.pnlUSD >= 0 ? "+" : ""}$${point.pnlUSD.toFixed(2)}</span></div>
    <div class="srow"><span class="slbl">Balance antes → después</span><span class="sv">$${point.balanceAntes.toFixed(0)} → $${point.balanceDespues.toFixed(0)}</span></div>
  `;

  const stats = TradeEngine.stats(upTo);
  document.getElementById("replay-stats-detail").innerHTML = `
    <div class="srow"><span class="slbl">Trades hasta aquí</span><span class="sv">${stats.total}</span></div>
    <div class="srow"><span class="slbl">Win rate</span><span class="sv" style="color:${stats.winrate >= 50 ? "var(--green)" : "var(--red)"}">${stats.winrate}%</span></div>
    <div class="srow"><span class="slbl">Profit Factor</span><span class="sv">${stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}</span></div>
    <div class="srow"><span class="slbl">Expectancy</span><span class="sv">${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}R</span></div>
  `;
}

// [window] oninput="scrubReplay(this.value)" en el slider
export function scrubReplay(value) {
  if (!currentSeries.length) return;
  const idx = parseInt(value);
  if (idx < 0 || idx >= currentSeries.length) return;
  renderFrame(idx);
  highlightFrame(idx);
}

function stopPlay() {
  if (playInterval) {
    clearInterval(playInterval);
    playInterval = null;
  }
  const btn = document.getElementById("replay-play-btn");
  if (btn) btn.textContent = "▶ Reproducir";
}

// [window] onclick="toggleReplayPlay()"
export function toggleReplayPlay() {
  if (playInterval) {
    stopPlay();
    return;
  }
  if (!currentSeries.length) return;
  if (currentIndex >= currentSeries.length - 1) currentIndex = -1;
  document.getElementById("replay-play-btn").textContent = "⏸ Pausar";
  playInterval = setInterval(() => {
    currentIndex++;
    if (currentIndex >= currentSeries.length) {
      stopPlay();
      return;
    }
    document.getElementById("replay-slider").value = currentIndex;
    renderFrame(currentIndex);
    highlightFrame(currentIndex);
  }, 700);
}
