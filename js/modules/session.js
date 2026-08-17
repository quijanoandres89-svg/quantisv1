/* ============================================================
   SESSION — Modo Sesión de pantalla completa: semáforo, checklist
   y el "Freno de 5 Minutos" antes de operar.
   ============================================================ */

import {
  preChecks,
  frenoLog,
  saveFrenoLog,
  sessionFrenoTimer,
  setSessionFrenoTimer,
  CL,
} from "./state.js";
import { today } from "./utils.js";
import { getSem } from "./dashboard.js";
import { updateCL } from "./journalManager.js";

// [window] onclick="activarSesion()" (desde el badge de semáforo del sidebar)
export function activarSesion() {
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
    <label class="cli"><input type="checkbox" class="cl-check" id="scl-${cl.id}" onchange="updateSessionCL()" ${preChecks[cl.id] ? "checked" : ""}>
    <div><div class="clt">${cl.t}</div></div></label>`,
  ).join("");
  updateSessionCL();
}

// [window] onclick="cerrarSesion()"
export function cerrarSesion() {
  document.getElementById("session-overlay").classList.remove("active");
  if (sessionFrenoTimer) {
    clearInterval(sessionFrenoTimer);
    setSessionFrenoTimer(null);
  }
  document.getElementById("session-timer").textContent = "5:00";
  document.getElementById("session-bar").style.width = "0%";
  document.getElementById("session-freno-btn").classList.remove("running");
  document.getElementById("session-freno-btn").textContent =
    "▶ Iniciar Freno de 5 Minutos";
  document.getElementById("session-freno-msg").innerHTML = "";
}

// [window] onchange="updateSessionCL()" en cada checkbox del Modo Sesión
export function updateSessionCL() {
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

// [window] onclick="toggleSessionFreno()"
export function toggleSessionFreno() {
  if (sessionFrenoTimer) {
    clearInterval(sessionFrenoTimer);
    setSessionFrenoTimer(null);
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
  setSessionFrenoTimer(
    setInterval(() => {
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
        setSessionFrenoTimer(null);
        document
          .getElementById("session-freno-btn")
          .classList.remove("running");
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
    }, 1000),
  );
}
