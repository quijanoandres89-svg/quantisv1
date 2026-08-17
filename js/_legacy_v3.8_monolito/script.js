const TK = "tjp_trades_v4",
  JK = "tjp_journals_v4",
  FK = "tjp_frenos_v4",
  CH_KEY = "tjp_challenges_v1",
  PL_KEY = "tjp_plantillas_v1";
let trades = [],
  journals = {},
  frenoLog = [],
  dayScore = 0,
  preChecks = {},
  challenges = [],
  plantillas = [];
let frenoTimer = null,
  sessionFrenoTimer = null;
let eqC = null,
  diaC = null,
  horaC = null,
  eq2C = null,
  consC = null,
  corrC = null,
  wkWRC = null,
  wkRRC = null,
  wkPlanC = null;

const CL = [
  {
    id: "c1",
    t: "Revisé el calendario económico",
    s: "Noticias mediano/alto impacto identificadas",
  },
  {
    id: "c2",
    t: "Analicé estructura Semanal y Diario",
    s: "¿Quién está en control?",
  },
  {
    id: "c3",
    t: "Sesgo del día definido en 4H",
    s: "Alcista / Bajista / Sin sesgo",
  },
  {
    id: "c4",
    t: "Marqué zonas clave 4H y 15M",
    s: "Demanda, oferta, CPBs, liquidez",
  },
  {
    id: "c5",
    t: "Identifiqué setup específico de hoy",
    s: "Par, dirección, POI objetivo",
  },
  {
    id: "c6",
    t: "Estado emocional verificado",
    s: "¿Estoy en calma y objetivo?",
  },
  {
    id: "c7",
    t: "Freno de 5 Minutos completado",
    s: "Me alejé y el setup sigue siendo válido",
  },
];

const PIPS = {
  EURUSD: { std: 10, micro: 0.1 },
  XAUUSD: { std: 10, micro: 0.1 },
  GBPUSD: { std: 10, micro: 0.1 },
};

function load() {
  try {
    const r = localStorage.getItem(TK);
    if (r) trades = JSON.parse(r);
  } catch (e) {
    trades = [];
  }
  try {
    const r = localStorage.getItem(JK);
    if (r) journals = JSON.parse(r);
  } catch (e) {
    journals = {};
  }
  try {
    const r = localStorage.getItem(FK);
    if (r) frenoLog = JSON.parse(r);
  } catch (e) {
    frenoLog = [];
  }
  try {
    const r = localStorage.getItem(CH_KEY);
    if (r) challenges = JSON.parse(r);
  } catch (e) {
    challenges = [];
  }
  try {
    const r = localStorage.getItem(PL_KEY);
    if (r) plantillas = JSON.parse(r);
  } catch (e) {
    plantillas = [];
  }
}
function previewZone(input, previewId, zoneId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => setZoneImg(e.target.result, previewId, zoneId);
  reader.readAsDataURL(file);
}

function setZoneImg(src, previewId, zoneId) {
  const preview = document.getElementById(previewId);
  const zone = document.getElementById(zoneId);
  const label = zone.querySelector(".img-zone-label");
  preview.src = src;
  preview.classList.add("visible");
  zone.classList.add("has-img");
  if (label) label.style.display = "none";
}

function clearZone(e, previewId, zoneId, inputId, labelId) {
  e.stopPropagation();
  clearZoneManual(previewId, zoneId, inputId, labelId);
}

function clearZoneManual(previewId, zoneId, inputId, labelId) {
  const preview = document.getElementById(previewId);
  const zone = document.getElementById(zoneId);
  const label = document.getElementById(labelId);
  if (preview) {
    preview.src = "";
    preview.classList.remove("visible");
  }
  if (zone) zone.classList.remove("has-img");
  if (label) label.style.display = "block";
  const input = document.getElementById(inputId);
  if (input) input.value = "";
}

function dragOver(e, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.add("drag");
}

function dragLeave(zoneId) {
  document.getElementById(zoneId).classList.remove("drag");
}

function dropImg(e, previewId, zoneId) {
  e.preventDefault();
  document.getElementById(zoneId).classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = (ev) => setZoneImg(ev.target.result, previewId, zoneId);
  reader.readAsDataURL(file);
}

function verImagenes(id) {
  const t = trades.find((t) => t.id === id || t.id === parseInt(id));
  if (!t) return;
  const htf = t.imgHTF || t.img || "";
  const ltf = t.imgLTF || "";
  if (!htf && !ltf) return;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:flex;flex-direction:column;padding:20px;cursor:pointer";

  const header = `<div style="text-align:center;margin-bottom:14px;font-size:12px;color:#aaa;font-family:var(--mono)">${t.par} ${t.dir || ""} · ${t.res} · RR ${t.rr || "—"} · ${t.fecha} <span style="margin-left:12px;font-size:10px;color:#666">Click en imagen para ampliar · Click fuera para cerrar</span></div>`;

  const imgs = `<div style="display:flex;gap:14px;flex:1;align-items:center;justify-content:center;min-height:0">
    ${
      htf
        ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;max-height:100%">
      <div style="font-size:10px;color:#888;font-family:var(--mono);margin-bottom:6px;letter-spacing:1px">TEMPORALIDAD MAYOR</div>
      <img src="${htf}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;cursor:zoom-in;border:1px solid #333" onclick="expandImg(this,event)" alt="HTF">
    </div>`
        : ""
    }
    ${htf && ltf ? `<div style="width:1px;background:#333;align-self:stretch"></div>` : ""}
    ${
      ltf
        ? `<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:0;max-height:100%">
      <div style="font-size:10px;color:#888;font-family:var(--mono);margin-bottom:6px;letter-spacing:1px">TEMPORALIDAD MENOR</div>
      <img src="${ltf}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;cursor:zoom-in;border:1px solid #333" onclick="expandImg(this,event)" alt="LTF">
    </div>`
        : ""
    }
  </div>`;

  overlay.innerHTML = header + imgs;
  overlay.onclick = (e) => {
    if (e.target === overlay || e.target.tagName !== "IMG") {
      document.body.removeChild(overlay);
    }
  };
  document.body.appendChild(overlay);
}

function expandImg(img, e) {
  e.stopPropagation();
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.97);z-index:1001;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:16px";
  overlay.innerHTML = `<img src="${img.src}" style="max-width:100%;max-height:95vh;object-fit:contain;border-radius:8px">`;
  overlay.onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
}
function saveTrades() {
  localStorage.setItem(TK, JSON.stringify(trades));
}
function saveJournals() {
  localStorage.setItem(JK, JSON.stringify(journals));
}
function saveFrenoLog() {
  localStorage.setItem(FK, JSON.stringify(frenoLog));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtShort(d) {
  return new Date(d + "T12:00:00").toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
  });
}
function weekStart(d) {
  const dt = new Date(d + "T12:00:00"),
    dow = dt.getDay(),
    m = new Date(dt);
  m.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1));
  return m.toISOString().slice(0, 10);
}
function weekEnd(ws) {
  const d = new Date(ws + "T12:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function getSem() {
  if (trades.length < 3)
    return {
      l: "g",
      title: "Puedes operar",
      sub: "Menos de 3 trades. Empieza a registrar.",
    };
  const l10 = trades.slice(-10);
  const wins = l10.filter((t) => t.res === "TP").length;
  const decisivos = l10.filter((t) => t.res === "TP" || t.res === "SL").length;
  const wr = decisivos ? wins / decisivos : 1;
  const soloDecisivos = trades.filter((t) => t.res === "TP" || t.res === "SL");
  const consec =
    soloDecisivos.slice(-3).length === 3 &&
    soloDecisivos.slice(-3).every((t) => t.res === "SL");
  const rrA = l10
    .filter((t) => t.res === "TP" && t.rr)
    .map((t) => parseFloat(t.rr));
  const rr = rrA.length ? rrA.reduce((a, b) => a + b, 0) / rrA.length : 0;
  if (consec || wr < 0.35)
    return {
      l: "r",
      title: "No puedes operar",
      sub: `3 pérdidas seguidas o WR <35%. Cierra la plataforma.`,
    };
  if (wr < 0.5 || rr < 1.5)
    return {
      l: "y",
      title: "Ten precaución",
      sub: `WR ${Math.round(wr * 100)}% o RR ${rr.toFixed(1)}. Solo setups A+.`,
    };
  return {
    l: "g",
    title: "Puedes operar",
    sub: `WR ${Math.round(wr * 100)}% · RR ${rr.toFixed(1)} · Racha estable.`,
  };
}

function go(page, el) {
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".ni").forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  if (el) el.classList.add("active");
  if (page === "dash") renderDash();
  if (page === "historial") renderHistorial();
  if (page === "journals") renderJournals();
  if (page === "stats") renderStats();
  if (page === "journal") initJournal();
  if (page === "reporte") renderReporte();
  if (page === "consistencia") renderConsistencia();
  if (page === "heatmap") renderHeatmap();
  if (page === "correlacion") renderCorrelacion();
  if (page === "calc") renderCalcTabla();
  if (page === "challenge") renderChallenges();
  if (page === "comparar") renderComparar();
  if (page === "toptrades") renderTopTrades();
  if (page === "plantillas") renderPlantillas();
  if (page === "backup") renderBackupSummary();
  if (page === "instrucciones") renderInstrucciones();
}

function renderSidebar() {
  const s = getSem();
  document.getElementById("sem-sb-wrap").innerHTML =
    `<div class="sem-sb s${s.l}" onclick="activarSesion()"><span class="sdot sd${s.l}"></span>${s.title}</div>`;
}

function renderDash() {
  document.getElementById("dash-date").textContent =
    new Date().toLocaleDateString("es-CO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  const s = getSem();
  const cm = {
    g: ["var(--gbg)", "var(--gbr)", "var(--green)", "↑"],
    y: ["var(--ybg)", "var(--ybr)", "var(--yellow)", "-"],
    r: ["var(--rbg)", "var(--rbr)", "var(--red)", "↓"],
  };
  const c = cm[s.l];
  document.getElementById("dash-sem").innerHTML =
    `<div class="sem-card" style="background:${c[0]};border-color:${c[1]};color:${c[2]}"><div class="si" style="background:${c[1]}">${c[3]}</div><div><div class="st" style="color:${c[2]}">${s.title}</div><div class="ss" style="color:${c[2]}">${s.sub}</div></div></div>`;
  renderAlerts();
  const tot = trades.length,
    wins = trades.filter((t) => t.res === "TP").length;
  const decisivos = trades.filter(
    (t) => t.res === "TP" || t.res === "SL",
  ).length;
  const wr = decisivos ? Math.round((wins / decisivos) * 100) : 0;
  const plan = tot
    ? Math.round((trades.filter((t) => t.plan === "Sí").length / tot) * 100)
    : 0;
  const rrA = trades
    .filter((t) => t.res === "TP" && t.rr)
    .map((t) => parseFloat(t.rr));
  const rr = rrA.length
    ? (rrA.reduce((a, b) => a + b, 0) / rrA.length).toFixed(1)
    : "-";
  document.getElementById("dash-metrics").innerHTML = `
    <div class="metric"><div class="mv">${tot}</div><div class="ml">Total trades</div></div>
    <div class="metric"><div class="mv" style="color:${wr >= 50 ? "var(--green)" : "var(--red)"}">${wr}%</div><div class="ml">Win rate</div></div>
    <div class="metric"><div class="mv">${rr}</div><div class="ml">RR promedio</div></div>
    <div class="metric"><div class="mv" style="color:${plan >= 80 ? "var(--green)" : "var(--yellow)"}">${plan}%</div><div class="ml">Plan respetado</div></div>`;
  renderWeekCal();
  renderRecentMini();
  renderEquityChart();
  renderDashJournal();
  renderSidebar();
}

function renderAlerts() {
  const a = [];
  const soloSL = trades.filter((t) => t.res === "TP" || t.res === "SL");
  if (soloSL.length >= 3 && soloSL.slice(-3).every((t) => t.res === "SL"))
    a.push(
      `<div class="alert ae">⛔ 3 pérdidas consecutivas — semáforo ROJO. Cierra la plataforma.</div>`,
    );
  if (trades.filter((t) => t.fecha === today()).length >= 1)
    a.push(
      `<div class="alert ai">ℹ️ Ya tienes un trade hoy (${trades.filter((t) => t.fecha === today())[0].res}). Según el plan: sesión terminada.</div>`,
    );
  if (trades.slice(-5).filter((t) => t.res === "TP").length >= 4)
    a.push(
      `<div class="alert aw">⭐ Racha ganadora. Cuidado con la euforia — doble checklist en el próximo trade.</div>`,
    );
  document.getElementById("dash-alerts").innerHTML = a.join("");
}

function renderWeekCal() {
  const now = new Date(),
    dow = now.getDay(),
    mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
  let h = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const dt = trades.filter((t) => t.fecha === ds);
    let cls = "dc de",
      lbl = "—";
    if (dt.length) {
      const r = dt[dt.length - 1].res;
      cls = "dc " + (r === "TP" ? "dw" : r === "SL" ? "dl" : "dbe");
      lbl = r === "TP" ? "W" : r === "SL" ? "L" : "BE";
    }
    h += `<div class="${cls}" title="${ds}">${lbl}</div>`;
  }
  document.getElementById("week-cal").innerHTML = h;
}

function renderRecentMini() {
  const last = trades.slice(-8).reverse();
  if (!last.length) {
    document.getElementById("dash-recent").innerHTML =
      '<div class="empty">Sin trades aún</div>';
    return;
  }
  document.getElementById("dash-recent").innerHTML = last
    .map((t) => {
      const pnl = tradePnlUSD(t);
      return `
    <div style="display:grid;grid-template-columns:70px 1fr 48px 56px 64px;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtShort(t.fecha)}</span>
      <span style="font-size:12px;font-weight:600;text-align:center">${t.par}</span>
      <span class="badge b${t.res.toLowerCase()}" style="justify-self:center">${t.res}</span>
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono);text-align:right">RR ${t.rr || "—"}</span>
      <span style="font-size:10px;font-family:var(--mono);text-align:right;color:${pnl === null ? "var(--text3)" : pnl >= 0 ? "var(--green)" : "var(--red)"}">${pnl === null ? "—" : fmtUSD(pnl)}</span>
    </div>`;
    })
    .join("");
}

function renderEquityChart() {
  const ctx = document.getElementById("eq-chart");
  if (!ctx) return;
  if (eqC) {
    eqC.destroy();
    eqC = null;
  }
  if (!trades.length) {
    ctx.parentElement.innerHTML = '<div class="empty">Sin datos todavía</div>';
    return;
  }
  let cum = 0;
  const lb = [],
    dt = [];
  trades.forEach((t, i) => {
    cum += TradeEngine.resolveRR(t);
    lb.push(`#${i + 1}`);
    dt.push(parseFloat(cum.toFixed(2)));
  });
  eqC = new Chart(ctx, {
    type: "line",
    data: {
      labels: lb,
      datasets: [
        {
          data: dt,
          borderColor: "#6366f1",
          borderWidth: 2,
          pointRadius: 1,
          fill: true,
          backgroundColor: "rgba(99,102,241,0.07)",
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            color: "#555c72",
            font: { size: 9 },
            maxTicksLimit: 12,
          },
          grid: { display: false },
        },
        y: {
          ticks: { color: "#555c72", font: { size: 9 } },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

function renderDashJournal() {
  const j = journals[today()];
  if (!j) {
    document.getElementById("dash-journal").innerHTML =
      `<div style="display:flex;align-items:center;gap:8px;color:var(--text3);font-size:12px">Sin journal hoy.<button class="btn btn-sm btn-p" style="margin-left:6px" onclick="go('journal',null)">Ir al journal</button></div>`;
    return;
  }
  document.getElementById("dash-journal").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">
      <div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Sesgo</div><div style="font-size:13px;font-weight:600;margin-top:2px">${j.sesgo || "—"}</div></div>
      <div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Estado</div><div style="font-size:13px;font-weight:600;margin-top:2px">${j.estado || "—"}/10</div></div>
      <div><div style="font-size:9px;color:var(--text3);font-family:var(--mono);text-transform:uppercase">Calificación</div><div style="font-size:13px;font-weight:600;margin-top:2px">${j.score || "—"}/10</div></div>
    </div>
    ${j.setup ? `<div style="font-size:11px;color:var(--text3);padding:7px 9px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);font-family:var(--mono)"><strong style="color:var(--text2)">Setup:</strong> ${j.setup}</div>` : ""}
    ${j.apr ? `<div style="font-size:11px;color:var(--text3);padding:7px 9px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);margin-top:5px;font-family:var(--mono)"><strong style="color:var(--text2)">Aprendizaje:</strong> ${j.apr}</div>` : ""}`;
}

function initJournal() {
  document.getElementById("journal-date").textContent = fmtDate(today());
  document.getElementById("pre-cl").innerHTML = CL.map(
    (c) => `
    <div class="cli"><input class="cl-check" type="checkbox" id="${c.id}" onchange="updateCL()" ${preChecks[c.id] ? "checked" : ""}>
    <div><div class="clt">${c.t}</div><div class="cls">${c.s}</div></div></div>`,
  ).join("");
  updateCL();
  renderScoreRow();
  const j = journals[today()];
  if (j) {
    [
      "sesgo",
      "estado",
      "not",
      "niv",
      "setup",
      "setup-alt",
      "razon",
      "inv",
      "res",
      "plan",
      "emo",
      "fallo",
      "emofallo",
      "prev",
      "emergente-par",
      "emergente-accion",
      "emergente-desc",
      "sorp",
      "op",
      "apr",
      "dif",
    ].forEach((k) => {
      const el = document.getElementById("j-" + k);
      if (el && j[k] != null) el.value = j[k];
    });
    if (j.score) {
      dayScore = j.score;
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
}

function updateCL() {
  CL.forEach((c) => {
    preChecks[c.id] = document.getElementById(c.id)?.checked;
  });
  const n = Object.values(preChecks).filter(Boolean).length,
    tot = CL.length,
    pass = n === tot;
  document.getElementById("cl-res").innerHTML =
    `<div class="clr ${pass ? "clpass" : "clfail"}">${pass ? " " : " "} ${n}/${tot} — ${pass ? "Checklist completo. Puedes operar." : "Completa todo antes de operar."}</div>`;
  updateSessionCL();
}

function toggleEmergente() {
  const par = document.getElementById("j-emergente-par").value;
  document.getElementById("j-emergente-box").style.display = par
    ? "block"
    : "none";
}

function toggleFallo() {
  document.getElementById("fallo-sec").style.display =
    document.getElementById("j-plan").value === "No" ? "block" : "none";
}

function renderScoreRow() {
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
function setScore(n) {
  dayScore = n;
  renderScoreRow();
}

function saveJournal() {
  const fields = [
    "sesgo",
    "estado",
    "not",
    "niv",
    "setup",
    "setup-alt",
    "razon",
    "inv",
    "res",
    "plan",
    "emo",
    "fallo",
    "emofallo",
    "prev",
    "emergente-par",
    "emergente-accion",
    "emergente-desc",
    "sorp",
    "op",
    "apr",
    "dif",
  ];
  const j = { score: dayScore, savedAt: new Date().toISOString() };
  fields.forEach((k) => {
    const el = document.getElementById("j-" + k);
    if (el) j[k] = el.value;
  });
  journals[today()] = j;
  saveJournals();
  document.getElementById("j-msg").innerHTML =
    `<div class="alert as">✅ Journal guardado.</div>`;
  setTimeout(() => {
    document.getElementById("j-msg").innerHTML = "";
  }, 3000);
}

function calcDuracion(entrada, cierre) {
  const [eh, em] = entrada.split(":").map(Number);
  const [ch, cm] = cierre.split(":").map(Number);
  const mins = ch * 60 + cm - (eh * 60 + em);
  if (mins <= 0) return "";
  if (mins < 60) return `${mins}min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}min`;
}

/**
 * Vista previa en vivo del resultado (TP/SL/BE) mientras se escribe el
 * RR — ayuda a detectar si olvidaste el signo antes de guardar.
 */
function updateResPreview() {
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

function saveTrade() {
  const rrRaw = document.getElementById("t-rr").value;
  if (rrRaw === "") {
    document.getElementById("t-msg").innerHTML =
      `<div class="alert ae">Ingresa el RR obtenido (positivo si fue TP, negativo si fue SL, 0 si fue BE).</div>`;
    return;
  }
  const res = TradeEngine.interpretResult(rrRaw);
  const activeCh = challenges.find((c) => c.active);
  if (!activeCh) {
    document.getElementById("t-msg").innerHTML =
      `<div class="alert ae">⛔ No hay ningún Challenge activo. Activa uno en la sección "Challenge" antes de registrar un trade — así el sistema sabe qué capital y riesgo usar.</div>`;
    return;
  }
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
    imgHTF: document.getElementById("t-img-htf-preview").src || "",
    imgLTF: document.getElementById("t-img-ltf-preview").src || "",
    challengeSnapshot: buildChallengeSnapshot(activeCh),
  };
  trades.push(t);
  saveTrades();
  document.getElementById("t-msg").innerHTML =
    `<div class="alert as">✅ Trade registrado (${res}).</div>`;
  document.getElementById("t-rr").value = "";
  document.getElementById("t-res-preview").innerHTML = "";
  document.getElementById("t-notas").value = "";
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
  setTimeout(() => {
    document.getElementById("t-msg").innerHTML = "";
  }, 3000);
  renderSidebar();
}

// ═══ CALCULADORA ═══
function calcSlFromPrices() {
  const entry = parseFloat(document.getElementById("c-entry").value);
  const slp = parseFloat(document.getElementById("c-slprice").value);
  const par = document.getElementById("c-par").value;
  if (!isNaN(entry) && !isNaN(slp) && entry > 0 && slp > 0) {
    let pips = Math.abs(entry - slp);
    if (par === "XAUUSD") pips = pips * 10;
    else pips = pips * 10000;
    document.getElementById("c-sl").value = Math.round(pips * 10) / 10;
  }
  calcLote();
}

function calcLote() {
  const cuenta = parseFloat(document.getElementById("c-cuenta").value) || 5000;
  const riesgoPct = parseFloat(document.getElementById("c-riesgo").value) || 1;
  const sl = parseFloat(document.getElementById("c-sl").value);
  const par = document.getElementById("c-par").value;
  if (!sl || sl <= 0) {
    document.getElementById("calc-result-box").innerHTML =
      `<div class="card" style="text-align:center;padding:28px"><div style="font-size:12px;color:var(--text3)">Ingresa el Stop Loss en pips</div></div>`;
    return;
  }
  const riesgoUSD = cuenta * (riesgoPct / 100);
  let pipValue = 10;
  if (par === "XAUUSD") pipValue = 10;
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
      <div class="srow"><span class="slbl">Si TP a 1:2 (${tp2.toFixed(1)} pips)</span><span style="color:var(--green);font-family:var(--mono);font-size:12px">+$${Math.round(ganTP2)}</span></div>
      <div class="srow"><span class="slbl">Si TP a 1:3 (${tp3.toFixed(1)} pips)</span><span style="color:var(--green);font-family:var(--mono);font-size:12px">+$${Math.round(ganTP3)}</span></div>
      <div class="srow"><span class="slbl">Si SL (${sl} pips)</span><span style="color:var(--red);font-family:var(--mono);font-size:12px">-$${Math.round(riesgoUSD)}</span></div>
    </div>`;
}

function renderCalcTabla() {
  const cuenta = parseFloat(document.getElementById("c-cuenta")?.value) || 5000;
  const par = document.getElementById("c-par")?.value || "EURUSD";
  const pipValue = 10;
  const riesgoUSD = cuenta * 0.01;
  const sls = [5, 8, 10, 12, 15, 20, 25, 30];
  document.getElementById("calc-tabla").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px">
      <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">SL (pips)</span>
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

// ═══ HISTORIAL ═══
function renderHistorial() {
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
      return `
    <div class="ti">
      <div class="th">
        <div style="display:flex;align-items:center;gap:7px">
          <span style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtShort(t.fecha)}${t.hora ? " " + t.hora : ""}</span>
          <span style="font-size:13px;font-weight:600">${t.par}</span>
          <span style="font-size:11px;color:var(--text3)">${t.dir} · ${t.tipo}</span>
        </div>
        <div style="display:flex;gap:5px;align-items:center">
          <span class="badge b${t.res.toLowerCase()}">${t.res}</span>
          <span class="badge b${t.plan === "Sí" ? "yes" : "no"}">Plan: ${t.plan}</span>
          ${t.rr ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">RR ${t.rr}</span>` : ""}
          ${pnl !== null ? `<span style="font-size:10px;font-family:var(--mono);font-weight:600;color:${pnl >= 0 ? "var(--green)" : "var(--red)"}">${fmtUSD(pnl)}</span>` : ""}
          ${t.hora && t.horaCierre ? `<span style="font-size:10px;color:var(--text3);font-family:var(--mono)">⏱ ${calcDuracion(t.hora, t.horaCierre)}</span>` : ""}
          <span style="font-size:10px;color:var(--text3)">${t.emo || ""}</span>
          ${t.imgHTF || t.imgLTF || t.img ? `<button class="btn btn-sm" style="padding:2px 8px;font-size:10px;margin-left:4px" onclick="verImagenes(${t.id})">Ver imágenes</button>` : ""}
        </div>
      </div>
      ${t.notas ? `<div style="font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg3);border-radius:var(--rs);border:1px solid var(--border);font-family:var(--mono);margin-top:4px">${t.notas}</div>` : ""}
      </div>`;
    })
    .join("");
}

// ═══ JOURNALS PREVIOS ═══
function renderJournals() {
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
          ${j.sesgo ? `<span class="badge binf">${j.sesgo}</span>` : ""}
          ${j.res && j.res !== "Sin trade hoy" ? `<span class="badge b${j.res.toLowerCase()}">${j.res}</span>` : ""}
          ${j.score ? `<span class="badge" style="background:var(--bg3);color:var(--text2);border:1px solid var(--border)">${j.score}/10</span>` : ""}
          ${j.plan === "No" ? `<span class="badge bno">Fallo</span>` : ""}
        </div>
      </div>
      ${j.setup ? `<div class="jprev">Setup: ${j.setup.slice(0, 90)}${j.setup.length > 90 ? "..." : ""}</div>` : ""}
      <div class="jdet" id="jd-${d.replace(/-/g, "")}">
        ${j.niv ? `<div class="jf"><div class="jfl">Niveles</div><div class="jfv">${j.niv}</div></div>` : ""}
        ${j.razon ? `<div class="jf"><div class="jfl">Razón de entrada</div><div class="jfv">${j.razon}</div></div>` : ""}
        ${j["setup-alt"] ? `<div class="jf"><div class="jfl">Setup alternativo</div><div class="jfv">${j["setup-alt"]}</div></div>` : ""}
        ${j["emergente-par"] ? `<div class="jf"><div class="jfl">Setup emergente</div><div class="jfv"><strong>${j["emergente-par"]}</strong> — ${j["emergente-accion"] || ""}<br>${j["emergente-desc"] || ""}</div></div>` : ""}
        ${j.sorp ? `<div class="jf"><div class="jfl">¿Qué pasó?</div><div class="jfv">${j.sorp}</div></div>` : ""}
        ${j.img ? `<div class="jf"><div class="jfl">Screenshot</div><img src="${j.img}" class="img-thumb" onclick="toggleImgFull(this)" title="Click para expandir"></div>` : ""}
        ${j.op ? `<div class="jf"><div class="jfl">Oportunidades</div><div class="jfv">${j.op}</div></div>` : ""}
        ${j.apr ? `<div class="jf"><div class="jfl">Aprendizaje</div><div class="jfv">${j.apr}</div></div>` : ""}
        ${j.dif ? `<div class="jf"><div class="jfl">¿Qué haría diferente?</div><div class="jfv">${j.dif}</div></div>` : ""}
        ${j.plan === "No" && j.fallo ? `<div class="jf"><div class="jfl" style="color:var(--red)">Regla violada</div><div class="jfv" style="border-color:var(--rbr)">${j.fallo}</div></div>` : ""}
        ${j.plan === "No" && j.prev ? `<div class="jf"><div class="jfl" style="color:var(--yellow)">Acción preventiva</div><div class="jfv" style="border-color:var(--ybr)">${j.prev}</div></div>` : ""}
      </div>
    </div>`;
    })
    .join("");
}
function toggleJ(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("open");
}

// ═══ ESTADÍSTICAS ═══
function renderStats() {
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
      "st-racha",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el)
        el.innerHTML =
          '<div class="empty" style="padding:14px;font-size:11px">Sin datos</div>';
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
  const horas = ["8:00", "9:00", "10:00", "11:00"];
  const hWR = horas.map((h) => {
    const hi = parseInt(h);
    const ht = trades.filter(
      (t) => t.hora && parseInt(t.hora.split(":")[0]) === hi,
    );
    return ht.length
      ? Math.round((ht.filter((t) => t.res === "TP").length / ht.length) * 100)
      : null;
  });
  if (diaC) {
    diaC.destroy();
    diaC = null;
  }
  if (horaC) {
    horaC.destroy();
    horaC = null;
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
              v === null
                ? "rgba(255,255,255,0.05)"
                : v >= 50
                  ? "#22c55e"
                  : "#ef4444",
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
  diaC = mk("ch-dia", dias, dWR);
  horaC = mk("ch-hora", horas, hWR);
  function sbar(id, items) {
    document.getElementById(id).innerHTML = items
      .map(
        ([l, p, n]) =>
          `<div class="srow"><span class="slbl">${l}</span><div class="bw"><div class="bf" style="width:${p}%;background:${p >= 50 ? "#22c55e" : "#ef4444"}"></div></div><span class="sv" style="color:${p >= 50 ? "var(--green)" : "var(--red)"}">${p}%${n != null ? ` (${n})` : ""}</span></div>`,
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
    `<div class="srow"><span class="slbl">Con plan</span><div class="bw"><div class="bf" style="width:${cpW}%;background:#22c55e"></div></div><span class="sv" style="color:var(--green)">${cpW}% (${cp.length})</span></div><div class="srow"><span class="slbl">Sin plan</span><div class="bw"><div class="bf" style="width:${spW}%;background:#ef4444"></div></div><span class="sv" style="color:var(--red)">${spW}% (${sp.length})</span></div><div style="margin-top:6px;font-size:10px;color:var(--text3);font-family:var(--mono)">Diferencia: ${cpW - spW > 0 ? "+" : ""}${cpW - spW} pp</div>`;
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
    ["EURUSD", "XAUUSD", "GBPUSD"].map((p) => {
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
    ["Continuación", "Reversión"].map((tp) => {
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
    `<div class="srow" style="margin-bottom:6px"><span class="slbl">Racha actual</span><span class="badge b${dir === "TP" ? "tp" : dir === "SL" ? "sl" : "be"}">${racha} ${dir || "—"}</span></div>${dir === "SL" && racha >= 2 ? `<div class="alert ae">⛔ ${racha} pérdidas seguidas.</div>` : ""}${dir === "TP" && racha >= 3 ? `<div class="alert aw">⭐ Racha de ${racha} TP. Doble checklist.</div>` : ""}`;
  if (eq2C) {
    eq2C.destroy();
    eq2C = null;
  }
  const eq2ctx = document.getElementById("ch-eq2");
  if (eq2ctx && trades.length) {
    let c = 0;
    const lb = [],
      d = [];
    trades.forEach((t, i) => {
      c += TradeEngine.resolveRR(t);
      lb.push(`#${i + 1}`);
      d.push(parseFloat(c.toFixed(2)));
    });
    eq2C = new Chart(eq2ctx, {
      type: "line",
      data: {
        labels: lb,
        datasets: [
          {
            data: d,
            borderColor: "#6366f1",
            borderWidth: 2,
            pointRadius: d.length > 30 ? 0 : 2,
            fill: true,
            backgroundColor: "rgba(99,102,241,0.05)",
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
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
    });
  }
}

// ═══ REPORTE SEMANAL ═══
function getWeeks() {
  const all = [
    ...new Set(trades.map((t) => weekStart(t.fecha))),
    ...Object.keys(journals).map((d) => weekStart(d)),
  ].filter(Boolean);
  return [...new Set(all)].sort().reverse();
}

function renderReporte() {
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
      const netRR = wt.reduce(
        (a, t) =>
          a +
          TradeEngine.resolveRR(t),
        0,
      );
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

// ═══ CONSISTENCIA ═══
function calcConsistenciaWeek(ws) {
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

function renderConsistencia() {
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
    <div class="srow"><span class="slbl">${d.lbl}</span><div class="bw"><div class="bf" style="width:${d.max > 0 ? Math.round((d.pts / d.max) * 100) : 0}%;background:${d.max > 0 && d.pts / d.max >= 0.7 ? "#22c55e" : "#f59e0b"}"></div></div><span class="sv">${d.n}</span></div>`,
    )
    .join("");
  const weeks = getWeeks().slice(0, 8).reverse();
  const wData = weeks.map((w) => calcConsistenciaWeek(w).pct);
  const wLabels = weeks.map((w) => fmtShort(w));
  if (consC) {
    consC.destroy();
    consC = null;
  }
  const ctx = document.getElementById("ch-cons");
  if (ctx)
    consC = new Chart(ctx, {
      type: "line",
      data: {
        labels: wLabels,
        datasets: [
          {
            data: wData,
            borderColor: "#6366f1",
            borderWidth: 2,
            pointRadius: wData.map((v) => (v > 0 ? 4 : 0)),
            pointBackgroundColor: wData.map((v) =>
              v >= 80 ? "#22c55e" : v >= 60 ? "#f59e0b" : "#ef4444",
            ),
            pointBorderColor: "#fff",
            pointBorderWidth: 1.5,
            fill: true,
            backgroundColor: "rgba(99,102,241,0.06)",
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
    });
}

// ═══ MAPA DE CALOR ═══
function renderHeatmap() {
  const now = new Date();
  const year = now.getFullYear();
  const months = [];
  for (let m = 0; m < 12; m++) {
    const mn = new Date(year, m, 1);
    const days = [];
    const firstDow = (mn.getDay() || 7) - 1;
    for (let p = 0; p < firstDow; p++) days.push(null);
    const last = new Date(year, m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const ds = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push(ds);
    }
    months.push({
      name: mn.toLocaleDateString("es-CO", { month: "long" }),
      days,
    });
  }
  const tradeMap = {};
  trades.forEach((t) => {
    if (!tradeMap[t.fecha]) tradeMap[t.fecha] = [];
    tradeMap[t.fecha].push(t);
  });
  let html = "";
  months.forEach(({ name, days }) => {
    html += `<div class="month-lbl">${name.charAt(0).toUpperCase() + name.slice(1)}</div>`;
    html += `<div class="dlbl"><span class="dlb">L</span><span class="dlb">M</span><span class="dlb">X</span><span class="dlb">J</span><span class="dlb">V</span><span class="dlb">S</span><span class="dlb">D</span></div>`;
    html += `<div class="hmap">`;
    days.forEach((ds) => {
      if (!ds) {
        html += `<div class="hmap-cell" style="background:transparent;border-color:transparent"></div>`;
        return;
      }
      const dt = tradeMap[ds];
      const isFuture = ds > today();
      if (isFuture) {
        html += `<div class="hmap-cell hc-fut" title="${ds}">·</div>`;
        return;
      }
      if (!dt || !dt.length) {
        html += `<div class="hmap-cell hc-nop" title="${ds}">—</div>`;
        return;
      }
      const r = dt[dt.length - 1].res;
      const cls = r === "TP" ? "hc-tp" : r === "SL" ? "hc-sl" : "hc-be";
      const lbl = r === "TP" ? "W" : r === "SL" ? "L" : "B";
      html += `<div class="hmap-cell ${cls}" title="${ds}: ${r}">${lbl}</div>`;
    });
    html += `</div>`;
  });
  document.getElementById("heatmap-content").innerHTML = html;
}

// ═══ CORRELACIÓN EMOCIÓN → RESULTADO ═══
function renderCorrelacion() {
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
  const colors = { TP: "#22c55e", SL: "#ef4444", BE: "#f59e0b" };
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
    corrC = null;
  }
  const ctx = document.getElementById("ch-corr");
  if (ctx)
    corrC = new Chart(ctx, {
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
                  ? "#22c55e"
                  : "#ef4444",
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
    });
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

// ═══ MODO SESIÓN ═══
function activarSesion() {
  const overlay = document.getElementById("session-overlay");
  overlay.classList.add("active");
  const s = getSem();
  const cm = {
    g: ["var(--gbg)", "var(--gbr)", "var(--green)"],
    y: ["var(--ybg)", "var(--ybr)", "var(--yellow)"],
    r: ["var(--rbg)", "var(--rbr)", "var(--red)"],
  };
  const c = cm[s.l];
  document.getElementById("session-sem-card").innerHTML =
    `<div class="session-sem" style="background:${c[0]};border-color:${c[1]};color:${c[2]}">${s.title}<br><span style="font-size:12px;opacity:.8">${s.sub}</span></div>`;
  document.getElementById("session-cl-list").innerHTML = CL.map(
    (cl) => `
    <div class="cli"><input type="checkbox" class="cl-check" id="scl-${cl.id}" onchange="updateSessionCL()" ${preChecks[cl.id] ? "checked" : ""}>
    <div><div class="clt">${cl.t}</div></div></div>`,
  ).join("");
  updateSessionCL();
}

function cerrarSesion() {
  document.getElementById("session-overlay").classList.remove("active");
  if (sessionFrenoTimer) {
    clearInterval(sessionFrenoTimer);
    sessionFrenoTimer = null;
  }
  document.getElementById("session-timer").textContent = "5:00";
  document.getElementById("session-bar").style.width = "0%";
  document.getElementById("session-freno-btn").classList.remove("running");
  document.getElementById("session-freno-btn").textContent =
    "▶ Iniciar Freno de 5 Minutos";
  document.getElementById("session-freno-msg").innerHTML = "";
}

function updateSessionCL() {
  CL.forEach((c) => {
    const el = document.getElementById("scl-" + c.id);
    if (el) preChecks[c.id] = el.checked;
  });
  const n = Object.values(preChecks).filter(Boolean).length,
    tot = CL.length,
    pass = n === tot;
  const res = document.getElementById("session-cl-res");
  if (res)
    res.innerHTML = `<div class="clr ${pass ? "clpass" : "clfail"} mt-2">${pass ? " " : " "} ${n}/${tot} — ${pass ? "Listo para operar." : "Completa todo el checklist."}</div>`;
}

function toggleSessionFreno() {
  if (sessionFrenoTimer) {
    clearInterval(sessionFrenoTimer);
    sessionFrenoTimer = null;
    document.getElementById("session-freno-btn").classList.remove("running");
    document.getElementById("session-freno-btn").textContent =
      "▶ Iniciar Freno de 5 Minutos";
    document.getElementById("session-timer").textContent = "5:00";
    document.getElementById("session-bar").style.width = "0%";
    return;
  }
  const start = Date.now(),
    DUR = 300000;
  document.getElementById("session-freno-btn").classList.add("running");
  document.getElementById("session-freno-btn").textContent = "⏸ Cancelar";
  sessionFrenoTimer = setInterval(() => {
    const el = Date.now() - start,
      rem = Math.max(0, DUR - el);
    document.getElementById("session-bar").style.width =
      Math.min(100, (el / DUR) * 100) + "%";
    const m = Math.floor(rem / 60000),
      s = Math.floor((rem % 60000) / 1000);
    document.getElementById("session-timer").textContent =
      m + ":" + (s < 10 ? "0" : "") + s;
    if (rem <= 0) {
      clearInterval(sessionFrenoTimer);
      sessionFrenoTimer = null;
      document.getElementById("session-freno-btn").classList.remove("running");
      document.getElementById("session-freno-btn").textContent =
        "▶ Iniciar Freno de 5 Minutos";
      document.getElementById("session-bar").style.width = "100%";
      document.getElementById("session-timer").textContent = "0:00";
      const entry = {
        fecha: today(),
        hora: new Date().toLocaleTimeString("es-CO", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      frenoLog.push(entry);
      saveFrenoLog();
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.6);
      } catch (e) {}
      document.getElementById("session-freno-msg").innerHTML =
        `<div class="alert as">✅ Completado. ¿El setup sigue siendo válido?</div>`;
      preChecks["c7"] = true;
      const c7el = document.getElementById("scl-c7");
      if (c7el) c7el.checked = true;
      updateSessionCL();
      const c7main = document.getElementById("c7");
      if (c7main) {
        c7main.checked = true;
        updateCL();
      }
    }
  }, 1000);
}

// ═══ EXPORT ═══
function cleanPDF(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/→/g, "->")
    .replace(/★/g, "*")
    .replace(/[^\x00-\x7F]/g, "");
}
function logoToBase64(callback) {
  const svgData = `<svg version="1.1" width="306.68756" height="279.34164" xmlns="http://www.w3.org/2000/svg"><path d="m 260.99226,0.21076202 c 9.80327,2.29167448 24.26903,7.09494908 30.00781,15.70312498 0.375,2.5 0.375,2.5 0,5 -3.81026,3.678873 -7.53289,4.12663 -12.65332,4.217773 -1.7569,0.03608 -1.7569,0.03608 -3.5493,0.07289 -1.91837,0.03401 -1.91837,0.03401 -3.8755,0.06871 -2.75439,0.05838 -5.50866,0.12137 -8.26294,0.184326 -0.7205,0.01615 -1.441,0.03229 -2.18334,0.04893 -28.98897,0.657035 -57.58641,2.255248 -86.36293,6.003258 -3.39451,0.440705 -6.7901,0.872403 -10.18591,1.30304 -11.87026,1.508758 -23.73635,3.048294 -35.59473,4.647949 -0.98926,0.132094 -1.97853,0.264187 -2.99777,0.400284 -0.91105,0.124107 -1.82211,0.248215 -2.76077,0.376083 -0.7909,0.107053 -1.58179,0.214105 -2.39665,0.324402 -2.09959,0.339853 -4.12284,0.803913 -6.17684,1.352356 0.62907,0.533672 1.25813,1.067344 1.90625,1.617187 8.08995,7.042153 17.63225,15.425751 19.65625,26.445313 -0.5625,2.9375 -0.5625,2.9375 -3.16406,4.828125 -4.58802,3.654286 -6.78983,8.828045 -9.40393,13.967133 -1.60788,3.156631 -3.26305,6.288431 -4.91248,9.423492 -0.33698,0.642975 -0.67395,1.285951 -1.02114,1.94841 -8.81312,16.761112 -18.522489,33.039422 -29.060889,48.770332 1.0016,0.18176 2.00321,0.36352 3.03516,0.55079 1.34253,0.25348 2.68497,0.50741 4.02734,0.76171 0.65678,0.11795 1.31356,0.2359 1.99024,0.35743 0.6542,0.12568 1.3084,0.25136 1.98242,0.38086 0.59176,0.10997 1.183519,0.21994 1.793209,0.33325 2.17163,0.61596 2.17163,0.61596 5.38086,2.15674 4.16441,1.81922 7.91613,1.86485 12.40796,1.7561 0.82298,-0.0106 1.64595,-0.0213 2.49387,-0.0323 8.80078,-0.17559 17.5502,-0.90805 26.30838,-1.75384 2.65493,-0.25587 5.31083,-0.49774 7.96728,-0.73731 28.92471,-2.66397 57.54094,-6.71625 86.17578,-11.52344 5.27061,-0.88393 10.54196,-1.76297 15.81508,-2.63175 2.06587,-0.34259 4.13034,-0.69289 6.19483,-1.04372 18.3968,-3.04074 18.3968,-3.04074 26.42759,2.42547 14.81173,11.70679 14.81173,11.70679 16.6875,20.0625 -0.6875,2.9375 -0.6875,2.9375 -2.99218,5.8086 -3.75623,5.14781 -4.96684,11.02947 -6.50782,17.1289 -0.16403,0.63197 -0.32806,1.26393 -0.49707,1.91504 -3.10048,11.94545 -5.69367,24.00095 -8.19043,36.08496 -0.17762,0.85465 -0.35523,1.7093 -0.53824,2.58985 -0.50547,2.44771 -1.00128,4.89715 -1.49301,7.34765 -0.14958,0.72696 -0.29917,1.45391 -0.45329,2.20289 -0.78718,4.00202 -1.39004,7.78413 -1.01546,11.85961 1.6245,1.7078 3.2922,3.37551 5,5 1,2.625 1,2.625 1,5 -1.37088,2.02025 -2.42804,2.79941 -4.72363,3.6045 -2.94058,0.51091 -5.53826,0.24811 -8.51074,-0.0264 -8.01,-0.63833 -15.98521,-0.81896 -24.01563,-0.82813 -0.7917,-0.002 -1.58341,-0.003 -2.39911,-0.005 -18.00973,-0.002 -35.98934,0.80419 -53.97589,1.63006 -0.69777,0.0317 -1.39554,0.0635 -2.11445,0.0962 -16.61726,0.7568 -33.21765,1.6514 -49.80611,2.90025 -6.17361,0.45469 -12.26397,0.7229 -18.45444,0.62857 -0.0374,0.96422 -0.0748,1.92844 -0.11328,2.92188 -0.0657,1.26328 -0.13148,2.52656 -0.19922,3.82812 -0.058,1.25297 -0.11601,2.50594 -0.17578,3.79688 -0.52448,3.53927 -0.78346,5.14952 -3.51172,7.45312 -2.89453,0.57032 -2.89453,0.57032 -6,0 -2.44922,-2.19531 -2.44922,-2.19531 -4.6875,-5.125 -0.74636,-0.95132 -1.49273,-1.90265 -2.26172,-2.88281 -3.84318,-5.60739 -5.48879,-9.77833 -5.23828,-16.58203 0.0261,-1.50667 0.0518,-3.01334 0.0771,-4.52002 0.0187,-0.78699 0.0373,-1.57398 0.0565,-2.38482 1.36963,-48.76972 1.36963,-48.76972 -16.946169,-92.50532 -1.485,-0.99 -1.485,-0.99 -3,-2 -4.195,5.13271 -8.26295,10.32922 -12.19458,15.66504 -8.96052,12.13884 -18.87049,23.35731 -29.11401,34.4209 -1.86096,2.01491 -3.70725,4.03723 -5.53906,6.07813 -4.41861,4.90998 -8.83784,9.66257 -13.91016,13.91406 -3.66021,3.13732 -7.15696,6.45325 -10.67529,9.74805 -7.6400004,7.11063 -7.6400004,7.11063 -11.3169004,7.36132 -0.7425,-0.0619 -1.48500003,-0.12375 -2.25000002810047,-0.1875 C 1.2854706,235.13336 2.9939906,232.44008 6.4375006,228.91392 11.837331,223.1742 16.665341,217.12822 21.471191,210.88853 c 1.62621,-2.1004 3.26925,-4.18678 4.91553,-6.27148 13.84823,-17.57601 26.37632,-35.97555 38.61328,-54.70313 0.57396,-0.8764 1.14791,-1.7528 1.73926,-2.65576 C 96.033691,102.57472 96.033691,102.57472 107,51.913928 c -1.00962,-3.514817 -2.35198,-6.739323 -4,-10 -1.91682,0.290616 -3.833449,0.582569 -5.749999,0.875 -1.18722,0.176602 -2.37445,0.353203 -3.59765,0.535156 -2.2882,0.369538 -4.56975,0.786832 -6.83594,1.273438 -10.92197,2.286654 -18.26789,-0.753462 -27.64844,-6.457032 -7.89236,-5.547033 -15.07797,-11.992021 -20.16797,-20.226562 0.33,-0.66 0.66,-1.32 1,-2 4.09102,0.322975 7.06489,1.462874 10.625,3.375 16.77106,8.559194 35.03833,6.034241 53.105469,4.035156 0.77477,-0.08466 1.54955,-0.16932 2.3478,-0.256546 22.51851,-2.468054 44.98956,-5.340612 67.45884,-8.217087 6.16964,-0.789286 12.34084,-1.565574 18.51247,-2.339126 4.82761,-0.607385 9.65402,-1.223997 14.48015,-1.843094 2.27586,-0.290395 4.55215,-0.577462 6.82888,-0.8609009 13.98202,-1.7446528 34.93663,-11.340039 47.63365,-9.59656808 z M 259.74885,150.7049 c -1.11124,0.12726 -1.11124,0.12726 -2.24493,0.2571 -2.47676,0.28423 -4.9532,0.57108 -7.42963,0.85813 -1.75636,0.20258 -3.51274,0.4051 -5.26912,0.60756 -5.70624,0.65881 -11.41194,1.32234 -17.1176,1.98619 -1.44718,0.16811 -1.44718,0.16811 -2.9236,0.33962 -25.98285,3.01825 -51.95441,6.10916 -77.896,9.4651 -1.99118,0.25756 -3.98247,0.51429 -5.97376,0.77097 -3.65529,0.47255 -7.31001,0.94919 -10.96445,1.42822 -1.06258,0.1381 -2.12515,0.27619 -3.21992,0.41847 -0.96658,0.12818 -1.93315,0.25636 -2.92901,0.38842 -1.24972,0.1646 -1.24972,0.1646 -2.52468,0.33253 -2.1295,0.33666 -4.17504,0.79773 -6.25608,1.35667 1.62795,14.53063 3.59018,29.01272 5.5625,43.5 0.47633,3.50222 0.95219,7.0045 1.42675,10.50696 0.29277,2.16055 0.58654,4.32096 0.8815,6.4812 0.61761,4.5555 1.20027,9.10396 1.66416,13.67786 0.0383,3.61282 0.0383,3.61282 1.46509,4.83398 2.09435,0.0547 4.19067,0.0334 6.28516,-0.0156 0.99831,-0.0228 0.99831,-0.0228 2.01678,-0.0461 2.25379,-0.0553 4.50711,-0.12056 6.76056,-0.18824 0.79079,-0.023 1.58158,-0.046 2.39633,-0.0697 32.39857,-0.9727 64.70268,-3.39278 96.97867,-6.3053 1.22942,-0.11009 2.45883,-0.22018 3.7255,-0.33361 3.46577,-0.3126 6.93079,-0.63237 10.3956,-0.95545 1.04548,-0.0947 2.09096,-0.18939 3.16812,-0.28695 0.94797,-0.0904 1.89595,-0.1809 2.87265,-0.27408 0.83007,-0.0776 1.66014,-0.15511 2.51536,-0.23502 1.89345,-0.10091 1.89345,-0.10091 2.88527,-1.28989 0.25421,-1.59742 0.44792,-3.20453 0.6167,-4.81323 0.11037,-1.03005 0.22073,-2.06011 0.33444,-3.12138 0.11667,-1.12888 0.23334,-2.25776 0.35355,-3.42085 0.18697,-1.75079 0.18697,-1.75079 0.37772,-3.53695 0.40169,-3.7646 0.79766,-7.52977 1.19259,-11.29509 0.51431,-4.88974 1.0321,-9.77909 1.55469,-14.66796 0.12776,-1.19818 0.25552,-2.39635 0.38715,-3.63083 0.92694,-8.53894 2.01019,-17.04677 3.27542,-25.54232 0.68047,-4.68557 1.25958,-9.22469 0.90774,-13.97139 -2.18498,-2.53191 -2.18498,-2.53191 -5,-4 -3.45821,0 -6.82228,0.39224 -10.25122,0.79102 z" fill="#4f46e4"/></svg>`;
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 182;
  const ctx = canvas.getContext("2d");
  const img = new Image();
  const blob = new Blob([svgData], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    ctx.drawImage(img, 0, 0, 200, 182);
    URL.revokeObjectURL(url);
    callback(canvas.toDataURL("image/png"));
  };
  img.src = url;
}

function exportarReportePDF() {
  logoToBase64((logoImg) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const weeks = getWeeks();
    if (!weeks.length) {
      alert("Sin datos para exportar.");
      return;
    }

    let y = 22;

    // Fondo blanco
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 210, 297, "F");

    // Barra superior gris
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 22, "F");

    // Logo en la barra superior
    doc.addImage(logoImg, "PNG", 8, 3, 16, 15);

    // Título en la barra
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Trading Journal — Reporte Semanal", 28, 14);

    // Fecha a la derecha
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(
      new Date().toLocaleDateString("es-CO", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      160,
      14,
    );

    y = 32;

    // Línea divisora
    doc.setDrawColor(220, 220, 235);
    doc.setLineWidth(0.3);
    doc.line(15, y, 195, y);
    y += 8;

    // Resumen general
    const tot = trades.length;
    const wins = trades.filter((t) => t.res === "TP").length;
    const decisivos = trades.filter(
      (t) => t.res === "TP" || t.res === "SL",
    ).length;
    const wr = decisivos ? Math.round((wins / decisivos) * 100) : 0;
    const rrA = trades
      .filter((t) => t.res === "TP" && t.rr)
      .map((t) => parseFloat(t.rr));
    const rrAvg = rrA.length
      ? (rrA.reduce((a, b) => a + b, 0) / rrA.length).toFixed(2)
      : "—";
    const planOk = tot
      ? Math.round((trades.filter((t) => t.plan === "Sí").length / tot) * 100)
      : 0;
    const sls = trades.filter((t) => t.res === "SL").length;
    const bes = trades.filter((t) => t.res === "BE").length;

    // Caja resumen
    doc.setFillColor(245, 246, 252);
    doc.roundedRect(15, y - 4, 180, 26, 3, 3, "F");
    doc.setDrawColor(220, 220, 235);
    doc.roundedRect(15, y - 4, 180, 26, 3, 3, "S");

    doc.setTextColor(99, 102, 241);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("RESUMEN GENERAL", 20, y + 3);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 65, 90);
    doc.setFontSize(9);
    doc.text(`Total trades: ${tot}`, 20, y + 11);
    doc.text(`${wins} TP  /  ${sls} SL  /  ${bes} BE`, 20, y + 18);
    doc.text(`Win rate: ${wr}%`, 90, y + 11);
    doc.text(`RR promedio: ${rrAvg}`, 90, y + 18);
    doc.text(`Plan respetado: ${planOk}%`, 145, y + 11);
    doc.text(`Generado: ${today()}`, 145, y + 18);
    y += 34;

    // Encabezado de semanas
    doc.setTextColor(99, 102, 241);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("DETALLE POR SEMANA", 15, y);
    y += 6;

    weeks.slice(0, 8).forEach((ws, idx) => {
      if (y > 255) {
        doc.addPage();
        doc.setFillColor(255, 255, 255);
        doc.rect(0, 0, 210, 297, "F");
        doc.setFillColor(99, 102, 241);
        doc.rect(0, 0, 210, 10, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(8);
        doc.text("Trading Journal — Reporte Semanal (continuación)", 15, 7);
        y = 20;
      }

      const we = weekEnd(ws);
      const wt = trades.filter((t) => t.fecha >= ws && t.fecha <= we);
      const wj = Object.keys(journals)
        .filter((d) => d >= ws && d <= we)
        .map((d) => journals[d]);
      const wWins = wt.filter((t) => t.res === "TP").length;
      const wDec = wt.filter((t) => t.res === "TP" || t.res === "SL").length;
      const wWR = wDec ? Math.round((wWins / wDec) * 100) : 0;
      const wNetRR = wt.reduce(
        (a, t) =>
          a +
          TradeEngine.resolveRR(t),
        0,
      );
      const wSL = wt.filter((t) => t.res === "SL").length;
      const wBE = wt.filter((t) => t.res === "BE").length;
      const wPlan = wt.length
        ? Math.round(
            (wt.filter((t) => t.plan === "Sí").length / wt.length) * 100,
          )
        : 0;
      const wScore = wj.filter((j) => j.score).length
        ? Math.round(
            wj.filter((j) => j.score).reduce((a, j) => a + (j.score || 0), 0) /
              wj.filter((j) => j.score).length,
          )
        : null;
      const aprendizajes = wj.filter((j) => j.apr).map((j) => j.apr);
      const isCurrent = ws === weekStart(today());
      const isGood = wWR >= 60;
      const isOk = wWR >= 40;

      // Fondo de la tarjeta
      const cardColor = isGood
        ? [232, 250, 240]
        : isOk
          ? [254, 252, 232]
          : [254, 240, 240];
      doc.setFillColor(...cardColor);
      doc.roundedRect(15, y - 2, 180, 7, 1.5, 1.5, "F");

      // Encabezado semana
      const headerColor = isGood
        ? [22, 163, 74]
        : isOk
          ? [217, 119, 6]
          : [220, 38, 38];
      doc.setTextColor(...headerColor);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      function cleanText(str) {
        return str
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/→/g, "->")
          .replace(/★/g, "*");
      }
      doc.text(
        `${isCurrent ? "* " : ""}${cleanText(fmtShort(ws))} -> ${cleanText(fmtShort(we))}`,
        18,
        y + 3,
      );

      const badge = isGood
        ? "Buena semana"
        : isOk
          ? "Semana regular"
          : "Semana difícil";
      doc.setFontSize(7);
      doc.text(badge, 165, y + 3);
      y += 9;

      // Métricas de la semana en grid
      doc.setFillColor(250, 250, 255);
      doc.roundedRect(15, y - 2, 180, 14, 1.5, 1.5, "F");
      doc.setDrawColor(230, 230, 245);
      doc.roundedRect(15, y - 2, 180, 14, 1.5, 1.5, "S");

      doc.setFont("helvetica", "normal");
      doc.setTextColor(100, 105, 130);
      doc.setFontSize(7.5);
      doc.text("Trades", 20, y + 4);
      doc.text("Win rate", 55, y + 4);
      doc.text("RR neto", 90, y + 4);
      doc.text("Plan OK", 125, y + 4);
      doc.text("Score", 160, y + 4);

      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 35, 60);
      doc.setFontSize(9);
      doc.text(`${wt.length}`, 20, y + 11);
      doc.setTextColor(
        wWR >= 50 ? 22 : 220,
        wWR >= 50 ? 163 : 38,
        wWR >= 50 ? 74 : 38,
      );
      doc.text(`${wWR}%`, 55, y + 11);
      doc.setTextColor(
        wNetRR >= 0 ? 22 : 220,
        wNetRR >= 0 ? 163 : 38,
        wNetRR >= 0 ? 74 : 38,
      );
      doc.text(`${wNetRR >= 0 ? "+" : ""}${wNetRR.toFixed(1)}R`, 90, y + 11);
      doc.setTextColor(30, 35, 60);
      doc.text(`${wPlan}%`, 125, y + 11);
      doc.text(wScore !== null ? `${wScore}/10` : "—", 160, y + 11);
      y += 17;

      // Conteo TP/SL/BE
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(22, 163, 74);
      doc.text(`${wWins}W`, 20, y);
      doc.setTextColor(220, 38, 38);
      doc.text(`${wSL}L`, 35, y);
      doc.setTextColor(217, 119, 6);
      doc.text(`${wBE}BE`, 50, y);
      y += 6;

      // Aprendizajes
      if (aprendizajes.length) {
        doc.setTextColor(99, 102, 241);
        doc.setFontSize(7.5);
        doc.setFont("helvetica", "bold");
        doc.text("Aprendizajes:", 20, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 65, 90);
        aprendizajes.slice(0, 2).forEach((apr) => {
          const lines = doc.splitTextToSize(cleanPDF(`- ${apr}`), 168);
          lines.forEach((line) => {
            if (y > 270) {
              doc.addPage();
              doc.setFillColor(255, 255, 255);
              doc.rect(0, 0, 210, 297, "F");
              y = 20;
            }
            doc.text(line, 22, y);
            y += 4.5;
          });
        });
      }

      // Línea separadora entre semanas
      doc.setDrawColor(220, 220, 235);
      doc.setLineWidth(0.2);
      doc.line(15, y + 1, 195, y + 1);
      y += 7;
    });

    // Pie de página
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(0, 0, 0);
      doc.rect(0, 285, 210, 12, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.text("Trading Journal — Generado automáticamente", 15, 292);
      doc.text(`Página ${i} de ${pageCount}`, 170, 292);
    }

    doc.save(`reporte_trading_${today()}.pdf`);
  });
}
// Exporta los trades a un archivo CSV
function exportCSV() {
  if (!trades.length) {
    alert("No hay trades para exportar.");
    return;
  }
  const h = [
    "ID",
    "Fecha",
    "Hora",
    "Par",
    "Dirección",
    "Resultado",
    "RR",
    "Tipo",
    "Sesión",
    "Plan respetado",
    "Emoción",
    "Notas",
  ];
  const rows = trades.map((t) => [
    t.id,
    t.fecha,
    t.hora || "",
    t.par,
    t.dir,
    t.res,
    t.rr || "",
    t.tipo,
    t.ses,
    t.plan,
    t.emo,
    `"${(t.notas || "").replace(/"/g, "'")}"`,
  ]);
  const csv = [h.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trades_${today()}.csv`;
  a.click();
}
(function () {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "light") {
    document.body.classList.add("light");
  } else {
    document.body.classList.remove("light");
  }
})();
function toggleTheme() {
  const isLight = document.body.classList.toggle("light");
  document.getElementById("theme-toggle").textContent = isLight ? "☼" : "☽";
  localStorage.setItem("theme", isLight ? "light" : "dark");
}
function applyThemeBtn() {
  const btn = document.getElementById("theme-toggle");
  if (btn)
    btn.textContent = document.body.classList.contains("light") ? "☼" : "☽";
}
function toggleImgFull(img) {
  if (img.style.maxHeight === "none") {
    img.style.maxHeight = "300px";
  } else {
    img.style.maxHeight = "none";
  }
}
function verImagen(id) {
  const t = trades.find((t) => t.id === id || t.id === parseInt(id));
  if (!t || !t.img) return;
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:1000;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:20px";
  overlay.innerHTML = `
    <div style="position:relative;max-width:95vw;max-height:95vh">
      <img src="${t.img}" style="max-width:100%;max-height:90vh;border-radius:10px;object-fit:contain;display:block">
      <div style="text-align:center;margin-top:10px;font-size:11px;color:#888;font-family:var(--mono)">${t.par} ${t.dir} &middot; ${t.res} &middot; ${t.fecha} &middot; Click para cerrar</div>
    </div>`;
  overlay.onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
}
document.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    const reader = new FileReader();
    const page = document.querySelector(".page.active");
    if (!page) return;
    const isRegistrar = page.id === "page-registrar";
    if (!isRegistrar) return;
    reader.onload = (ev) => {
      const htfPreview = document.getElementById("t-img-htf-preview");
      const ltfPreview = document.getElementById("t-img-ltf-preview");
      if (!htfPreview.src || htfPreview.src === window.location.href) {
        setZoneImg(ev.target.result, "t-img-htf-preview", "zone-htf");
      } else if (!ltfPreview.src || ltfPreview.src === window.location.href) {
        setZoneImg(ev.target.result, "t-img-ltf-preview", "zone-ltf");
      } else {
        setZoneImg(ev.target.result, "t-img-htf-preview", "zone-htf");
      }
    };
    reader.readAsDataURL(file);
    break;
  }
});

/* ============================================
   MODULOS AVANZADOS (v3): Challenges, Simulador,
   Comparar semanas, Top trades, Plantillas, Backup
   ============================================ */

function saveChallenges() {
  localStorage.setItem(CH_KEY, JSON.stringify(challenges));
}
function savePlantillas() {
  localStorage.setItem(PL_KEY, JSON.stringify(plantillas));
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

/**
 * Devuelve el riskResolver de TradeEngine que corresponde al tipo de
 * riesgo configurado en el Challenge (Fijo o Dinámico). Único lugar
 * donde se decide esto — lo usan calcChProgress() y el snapshot de
 * cada trade nuevo, así nunca quedan desincronizados.
 */
function challengeRiskResolver(ch) {
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
function buildChallengeSnapshot(ch) {
  const inicio = ch.inicio || today();
  const chTradesSoFar = trades.filter((t) => t.fecha >= inicio);
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
function tradePnlUSD(t) {
  if (!t.challengeSnapshot) return null;
  return TradeEngine.pnlUSD(t, t.challengeSnapshot.riesgoUSD);
}

function fmtUSD(v) {
  const sign = v >= 0 ? "+" : "";
  return `${sign}$${v.toFixed(2)}`;
}

function calcChProgress(ch) {
  const inicio = ch.inicio || today();
  const chTrades = trades.filter((t) => t.fecha >= inicio);
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
  };
}

function renderChallenges() {
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
      <div class="ch-name">${ch.nombre}</div>
      <div class="ch-meta">${ch.firma || "Sin firma"} &middot; $${Number(ch.size).toLocaleString()} &middot; Riesgo: ${ch.riesgo || 1}% (${ch.tipoRiesgo || "Fijo"}) &middot; Fase: ${ch.fase || "Evaluacion"} &middot; Inicio: ${fmtShort(ch.inicio)} &middot; ${status}</div>
      ${dayAlert ? `<div class="alert ae" style="margin-bottom:10px">&#9940; Perdida diaria: ${p.dayLossPct.toFixed(1)}% / limite ${ch.maxDay}%</div>` : ""}
      ${totalAlert ? `<div class="alert ae" style="margin-bottom:10px">&#9940; Perdida total: ${p.totalLossPct.toFixed(1)}% / limite ${ch.maxTotal}%</div>` : ""}
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
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        ${!ch.active ? `<button class="btn btn-p btn-sm" onclick="setActive(${i})">Activar</button>` : ""}
        <button class="btn btn-sm" onclick="editChallenge(${i})">Editar</button>
        <button class="btn btn-d btn-sm" onclick="deleteChallenge(${i})">Eliminar</button>
      </div>
    </div>`;
    })
    .join("");
}

function renderChSidebar() {
  const ac = challenges.find((c) => c.active);
  const el = document.getElementById("ch-sb");
  if (!ac) {
    el.innerHTML = "";
    return;
  }
  const p = calcChProgress(ac);
  const color =
    p.pct >= 80 ? "var(--green)" : p.pct >= 40 ? "var(--yellow)" : "var(--acc)";
  el.innerHTML = `<div style="margin:8px;padding:9px 11px;background:var(--abg);border:1px solid #6366f133;border-radius:6px;font-size:10px;font-family:var(--mono);cursor:pointer" onclick="go('challenge',null)">
    <div style="color:var(--acc);font-weight:600;margin-bottom:4px">${ac.nombre}</div>
    <div style="color:var(--text3);margin-bottom:5px">${p.pct}% del objetivo</div>
    <div style="background:var(--bg3);border-radius:3px;height:4px;overflow:hidden"><div style="height:100%;border-radius:3px;background:${color};width:${p.pct}%"></div></div>
    <div style="color:var(--text3);margin-top:4px">PL: <span style="color:${p.netUSD >= 0 ? "var(--green)" : "var(--red)"}">${p.netUSD >= 0 ? "+" : ""}$${p.netUSD.toFixed(0)}</span></div>
  </div>`;
}

function openNewChallenge() {
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
  document.getElementById("modal-ch").dataset.editIdx = "";
  openModal("modal-ch");
}

function editChallenge(i) {
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
  document.getElementById("modal-ch").dataset.editIdx = i;
  openModal("modal-ch");
}

function saveChallenge() {
  const idx = document.getElementById("modal-ch").dataset.editIdx;
  const ch = {
    id: Date.now(),
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
    active: false,
  };
  if (idx !== "") {
    const old = challenges[parseInt(idx)];
    ch.active = old.active;
    challenges[parseInt(idx)] = ch;
  } else {
    if (!challenges.length) ch.active = true;
    challenges.push(ch);
  }
  saveChallenges();
  closeModal("modal-ch");
  renderChallenges();
}

function setActive(i) {
  challenges.forEach((c, j) => (c.active = j === i));
  saveChallenges();
  renderChallenges();
}

function deleteChallenge(i) {
  if (!confirm("Eliminar este challenge?")) return;
  challenges.splice(i, 1);
  saveChallenges();
  renderChallenges();
}

function simular() {
  load();
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
            `<div class="srow"><span class="slbl">${l}</span><div class="bw"><div class="bf" style="width:${v || 0}%;background:${(v || 0) >= 50 ? "#22c55e" : "#ef4444"}"></div></div><span class="sv" style="color:${(v || 0) >= 50 ? "var(--green)" : "var(--red)"}">${v !== null ? v + "% (" + n + ")" : "sin datos"}</span></div>`,
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

function renderComparar() {
  load();
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
    const netRR = wt.reduce(
      (a, t) =>
        a + TradeEngine.resolveRR(t),
      0,
    );
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
    wkWRC = null;
  }
  if (wkRRC) {
    wkRRC.destroy();
    wkRRC = null;
  }
  if (wkPlanC) {
    wkPlanC.destroy();
    wkPlanC = null;
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

  wkWRC = mkLine(
    "ch-wk-wr",
    wkData.map((d) => d.wr),
    "#22c55e",
    true,
  );
  wkRRC = mkLine(
    "ch-wk-rr",
    wkData.map((d) => parseFloat(d.netRR.toFixed(2))),
    "#6366f1",
    false,
  );
  wkPlanC = mkLine(
    "ch-wk-plan",
    wkData.map((d) => d.planOk),
    "#f59e0b",
    true,
  );

  document.getElementById("wk-tabla").innerHTML = `
    <div style="overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:11px;font-family:var(--mono)">
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
          <td style="padding:6px 8px;color:var(--text2)">${fmtShort(d.ws)}</td>
          <td style="padding:6px 8px;text-align:center">${d.tot}</td>
          <td style="padding:6px 8px;text-align:center;color:${(d.wr || 0) >= 50 ? "var(--green)" : "var(--red)"}">${d.wr !== null ? d.wr + "%" : "—"}</td>
          <td style="padding:6px 8px;text-align:center;color:${d.netRR >= 0 ? "var(--green)" : "var(--red)"}">${d.netRR >= 0 ? "+" : ""}${d.netRR.toFixed(1)}R</td>
          <td style="padding:6px 8px;text-align:center;color:${(d.planOk || 0) >= 80 ? "var(--green)" : "var(--yellow)"}">${d.planOk !== null ? d.planOk + "%" : "—"}</td>
          <td style="padding:6px 8px;text-align:center">${d.scoreAvg !== null ? d.scoreAvg + "/10" : "—"}</td>
        </tr>`,
        )
        .join("")}
      </tbody>
    </table></div>`;
}

function renderTopTrades() {
  load();
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
      <div class="rank-n" style="background:${color}22;color:${color}">#${i + 1}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:600">${t.par} ${t.dir || ""} &middot; ${t.tipo || ""}</div>
        <div style="font-size:10px;color:var(--text3);font-family:var(--mono)">${fmtShort(t.fecha)}${t.hora ? " " + t.hora : ""} &middot; ${t.ses || t.sesion || ""} &middot; ${t.emo || t.emocion || ""}</div>
        ${t.notas ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${t.notas.slice(0, 70)}${t.notas.length > 70 ? "..." : ""}</div>` : ""}
      </div>
      ${t.rr ? `<span style="font-size:13px;font-weight:600;font-family:var(--mono);color:${color}">RR ${t.rr}</span>` : ""}
    </div>`;
  }

  document.getElementById("top-wins").innerHTML = tpTrades.length
    ? tpTrades.map((t, i) => tradeRow(t, i, "#22c55e")).join("")
    : '<div class="empty" style="font-size:11px">Sin TPs con RR registrado</div>';
  document.getElementById("top-losses").innerHTML = slTrades.length
    ? slTrades.map((t, i) => tradeRow(t, i, "#ef4444")).join("")
    : '<div class="empty" style="font-size:11px">Sin SLs registrados</div>';

  const patterns = [];
  ["EURUSD", "XAUUSD", "GBPUSD"].forEach((par) => {
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

function renderPlantillas() {
  const el = document.getElementById("plantillas-list");
  if (!plantillas.length) {
    el.innerHTML =
      '<div class="empty">Sin plantillas. Crea la primera arriba.</div>';
    return;
  }
  el.innerHTML = plantillas
    .map(
      (p, i) => `
    <div class="tpl-card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:13px;font-weight:600">${p.nombre}</div>
        <button class="btn btn-d btn-sm" onclick="deletePlantilla(${i})">Eliminar</button>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        <span class="badge binf">${p.par}</span>
        <span class="badge ${p.dir === "Compra" ? "btp" : "bsl"}">${p.dir}</span>
        <span class="badge bbe">${p.tipo}</span>
        <span class="badge" style="background:var(--bg3);color:var(--text2);border:1px solid var(--border)">${p.ses}</span>
      </div>
      ${p.desc ? `<div style="font-size:11px;color:var(--text3);padding:6px 8px;background:var(--bg3);border-radius:6px;border:1px solid var(--border);font-family:var(--mono)">${p.desc}</div>` : ""}
    </div>`,
    )
    .join("");
}

function savePlantilla() {
  const p = {
    id: Date.now(),
    nombre: document.getElementById("tpl-nombre").value || "Sin nombre",
    par: document.getElementById("tpl-par").value,
    dir: document.getElementById("tpl-dir").value,
    tipo: document.getElementById("tpl-tipo").value,
    ses: document.getElementById("tpl-ses").value,
    desc: document.getElementById("tpl-desc").value,
  };
  plantillas.push(p);
  savePlantillas();
  closeModal("modal-tpl");
  renderPlantillas();
  document.getElementById("tpl-nombre").value = "";
  document.getElementById("tpl-desc").value = "";
}

function deletePlantilla(i) {
  if (!confirm("Eliminar plantilla?")) return;
  plantillas.splice(i, 1);
  savePlantillas();
  renderPlantillas();
}

function exportBackup() {
  load();
  const data = {
    version: "v3_modulos",
    exportDate: new Date().toISOString(),
    trades,
    journals,
    challenges,
    plantillas,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `trading_backup_${today()}.json`;
  a.click();
}

function importBackup(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const msg = `Backup contiene:\n- ${(data.trades || []).length} trades\n- ${Object.keys(data.journals || {}).length} journals\n- ${(data.challenges || []).length} challenges\n\nReemplazara todos los datos actuales. Continuar?`;
      if (!confirm(msg)) return;
      // Guardar en las claves conocidas de v2 para compatibilidad
      if (data.trades)
        localStorage.setItem("tjp_trades_v4", JSON.stringify(data.trades));
      if (data.journals)
        localStorage.setItem("tjp_journals_v4", JSON.stringify(data.journals));
      if (data.challenges) {
        challenges = data.challenges;
        saveChallenges();
      }
      if (data.plantillas) {
        plantillas = data.plantillas;
        savePlantillas();
      }
      load();
      renderBackupSummary();
      document.getElementById("backup-msg").innerHTML =
        `<div class="alert as">&#9989; Importado: ${(data.trades || []).length} trades, ${Object.keys(data.journals || {}).length} journals.</div>`;
      setTimeout(() => {
        document.getElementById("backup-msg").innerHTML = "";
      }, 5000);
    } catch (err) {
      document.getElementById("backup-msg").innerHTML =
        '<div class="alert ae">Error al importar: archivo invalido o corrupto.</div>';
    }
  };
  reader.readAsText(file);
}

function renderBackupSummary() {
  load();
  const el = document.getElementById("backup-summary");
  if (!el) return;
  const ac = challenges.find((c) => c.active);
  el.innerHTML = `
    <div class="srow"><span class="slbl">Trades registrados</span><span class="sv">${trades.length}</span></div>
    <div class="srow"><span class="slbl">Journals guardados</span><span class="sv">${Object.keys(journals).length}</span></div>
    <div class="srow"><span class="slbl">Challenges creados</span><span class="sv">${challenges.length}${ac ? " (" + ac.nombre + " activo)" : ""}</span></div>
    <div class="srow"><span class="slbl">Plantillas de setup</span><span class="sv">${plantillas.length}</span></div>`;
}

function renderInstrucciones() {
  load();
  const el = document.getElementById("inst-summary");
  if (!el) return;
  el.innerHTML = `
    <div class="srow"><span class="slbl">Trades encontrados</span><span class="sv" style="color:${trades.length > 0 ? "var(--green)" : "var(--red)"}">${trades.length} ${trades.length > 0 ? "&#9989;" : "&#9940; no detectados"}</span></div>
    <div class="srow"><span class="slbl">Journals encontrados</span><span class="sv" style="color:${Object.keys(journals).length > 0 ? "var(--green)" : "var(--yellow)"}">${Object.keys(journals).length}</span></div>
    <div class="srow"><span class="slbl">Challenges (v3)</span><span class="sv">${challenges.length}</span></div>
    <div class="srow"><span class="slbl">Plantillas (v3)</span><span class="sv">${plantillas.length}</span></div>
    ${trades.length === 0 ? '<div class="alert aw" style="margin-top:8px">No se detectaron trades. Asegurate de tener el Journal v2 abierto en este mismo navegador, o usa "Importar backup" para cargar tus datos.</div>' : ""}`;
}

function createAutoBackup() {
  const backup = {
    timestamp: new Date().toISOString(),

    trades: JSON.parse(localStorage.getItem("tjp_trades_v4") || "[]"),

    journals: JSON.parse(localStorage.getItem("tjp_journals_v4") || "{}"),

    challenges: JSON.parse(localStorage.getItem("v3_challenges") || "[]"),

    plantillas: JSON.parse(localStorage.getItem("v3_plantillas") || "[]"),
  };

  let backups = JSON.parse(localStorage.getItem("kame_backups") || "[]");

  backups.unshift(backup);

  if (backups.length > 5) {
    backups = backups.slice(0, 5);
  }

  localStorage.setItem("kame_backups", JSON.stringify(backups));

  renderBackups();
}

function renderBackups() {
  const backups = JSON.parse(localStorage.getItem("kame_backups") || "[]");

  const status = document.getElementById("backup-status");

  const list = document.getElementById("backup-list");

  if (!status || !list) return;

  if (backups.length === 0) {
    status.innerHTML = `
            <div style="color:var(--text3)">
                No existen backups.
            </div>
        `;

    list.innerHTML = "";

    return;
  }

  status.innerHTML = `
        <div style="color:var(--green); font-weight:600; font-size:13px">
            Último backup:
            ${new Date(backups[0].timestamp).toLocaleString()}
        </div>
    `;

  list.innerHTML = backups
    .map(
      (backup, index) => `

        <div class="srow">

            <div style="flex:1">

                <div style="font-size:12px;font-weight:600">
                    Backup ${backups.length - index}
                </div>

                <div style="
                    font-size:11px;
                    color:var(--text3);
                ">
                    ${new Date(backup.timestamp).toLocaleString()}
                </div>

            </div>

            <button
                class="btn btn-sm"
                onclick="restoreBackup(${index})">

                Restaurar

            </button>

        </div>

    `,
    )
    .join("");
}

function restoreBackup(index) {
  const backups = JSON.parse(localStorage.getItem("kame_backups") || "[]");

  const backup = backups[index];

  if (!backup) return;

  const ok = confirm("¿Deseas restaurar este backup?");

  if (!ok) return;

  localStorage.setItem("tjp_trades_v4", JSON.stringify(backup.trades));

  localStorage.setItem("tjp_journals_v4", JSON.stringify(backup.journals));

  localStorage.setItem("v3_challenges", JSON.stringify(backup.challenges));

  localStorage.setItem("v3_plantillas", JSON.stringify(backup.plantillas));

  location.reload();
}

function startAutoBackup() {
  const today = new Date().toISOString().slice(0, 10);

  const lastBackup = localStorage.getItem("last_backup_day");

  if (lastBackup !== today) {
    createAutoBackup();

    localStorage.setItem("last_backup_day", today);
  }
}

function init() {
  load();
  document.getElementById("today-str").textContent =
    new Date().toLocaleDateString("es-CO", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  document.getElementById("t-fecha").value = today();
  document.getElementById("ch-inicio").value = today();
  renderDash();
  calcLote();
  applyThemeBtn();
  renderChallenges();
  renderBackups();
  startAutoBackup();
}
init();
