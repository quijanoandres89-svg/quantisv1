/* ============================================================
   MAIN — punto de entrada de la app modularizada (ES modules).
   ------------------------------------------------------------
   Responsabilidades de este archivo, y SOLO de este archivo:
     1. Importar todos los módulos.
     2. Exponer en `window` las funciones que el HTML necesita
        para sus onclick/onchange/oninput (inline, tal como están
        hoy en kame.html — no se tocó el HTML para usar
        addEventListener, eso sería una entrega aparte).
     3. Definir go() (router de páginas) e init() (arranque).
   Ningún otro módulo debe tocar `window` ni conocer el listado
   de páginas — esa responsabilidad vive aquí, centralizada.
   ============================================================ */

import * as State from "./modules/state.js";
import * as Utils from "./modules/utils.js";
import * as IZ from "./modules/imageZones.js";
import * as TradeManager from "./modules/tradeManager.js";
import * as ChallengeManager from "./modules/challengeManager.js";
import * as Dashboard from "./modules/dashboard.js";
import * as JournalManager from "./modules/journalManager.js";
import * as Statistics from "./modules/statistics.js";
import * as Historial from "./modules/historial.js";
import * as Calculator from "./modules/calculator.js";
import * as Session from "./modules/session.js";
import * as PdfExport from "./modules/pdfExport.js";
import * as Backup from "./modules/backup.js";
import * as Plantillas from "./modules/plantillas.js";
import * as Simulator from "./modules/simulator.js";
import * as Theme from "./modules/theme.js";
import * as Replay from "./modules/replay.js";
import * as CalendarPro from "./modules/calendarPro.js";
import * as RuleEngine from "./modules/ruleEngine.js";
import { renderChallengeAlerts } from "./modules/alertSystem.js";
import * as PreventiveAlerts from "./modules/preventiveAlerts.js";
import * as Toast from "./modules/toast.js";
import { toggleSidebar, closeSidebar } from "./modules/mobile.js";
import * as SettingsPanel from "./modules/settingsPanel.js";
import * as Instruments from "./modules/instruments.js";
import * as Eod from "./modules/eod.js";
import * as Auth from "./modules/auth.js";

/**
 * Router de páginas: activa la página pedida en el HTML y dispara
 * el render correspondiente. Mismo comportamiento exacto que el
 * go() original de script.js, solo que ahora cada rama llama a la
 * función del módulo correcto en vez de una función global.
 */
/** Refresca todo lo que depende del estado de trades tras guardar uno. */
function refreshAfterTrade() {
  Dashboard.renderSidebar();
  ChallengeManager.renderChSidebar();
}

function go(page, el) {
  closeSidebar();
  document
    .querySelectorAll(".page")
    .forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".ni").forEach((n) => n.classList.remove("active"));
  document.getElementById("page-" + page).classList.add("active");
  if (el) el.classList.add("active");
  if (page === "dash") Dashboard.renderDash();
  if (page === "historial") Historial.renderHistorial();
  if (page === "journals") JournalManager.renderJournals();
  if (page === "eod") Eod.renderEod();
  if (page === "stats") Statistics.renderStats();
  if (page === "journal") JournalManager.initJournal();
  if (page === "reporte") Statistics.renderReporte();
  if (page === "consistencia") Statistics.renderConsistencia();
  if (page === "heatmap") CalendarPro.renderCalendarPro();
  if (page === "correlacion") Statistics.renderCorrelacion();
  if (page === "calc") Calculator.renderCalcTabla();
  if (page === "challenge") ChallengeManager.renderChallenges();
  if (page === "comparar") Statistics.renderComparar();
  if (page === "toptrades") Statistics.renderTopTrades();
  if (page === "plantillas") Plantillas.renderPlantillas();
  if (page === "replay") Replay.renderReplay();
  if (page === "reglas") RuleEngine.renderRuleSets();
  if (page === "registrar") renderChallengeAlerts("registrar-alerts");
  if (page === "heatmap") renderChallengeAlerts("heatmap-rule-alerts");
  if (page === "challenge") renderChallengeAlerts("challenge-rule-alerts");
}

async function init() {
  const user = await Auth.requireSession();
  Auth.renderSessionInfo(user);
  Auth.startInactivityWatcher();
  Toast.showQueuedToast();
  await State.load();
  Instruments.renderAllInstrumentSelects();
  document.getElementById("today-str").textContent =
    new Date().toLocaleDateString("es-CO", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    });
  document.getElementById("t-fecha").value = Utils.today();
  document.getElementById("ch-inicio").value = Utils.today();
  Dashboard.renderDash();
  Calculator.calcLote();
  Theme.applyThemeBtn();
  ChallengeManager.renderChallenges();
  Backup.startAutoBackup();
  JournalManager.renderSidebarStreak();
}

// --- Exposición en window: API pública que el HTML llama por onclick/onchange/oninput ---
Object.assign(window, {
  go,
  logout: Auth.logout,
  // imageZones
  previewZone: IZ.previewZone,
  clearZone: IZ.clearZone,
  dragOver: IZ.dragOver,
  dragLeave: IZ.dragLeave,
  dropImg: IZ.dropImg,
  verImagenes: IZ.verImagenes,
  expandImg: IZ.expandImg,
  toggleImgFull: IZ.toggleImgFull,
  verImagen: IZ.verImagen,
  // tradeManager
  updateResPreview: TradeManager.updateResPreview,
  saveTrade: async () => {
    const result = await TradeManager.saveTrade();
    if (result && result.pending) {
      PreventiveAlerts.renderPreventiveModal(result.violations);
      return "pending";
    }
    if (result === true) refreshAfterTrade();
    return result;
  },
  confirmSaveTradeAnyway: async () => {
    const ok = await TradeManager.saveTrade(true);
    document.getElementById("modal-preventive").classList.remove("open");
    if (ok) refreshAfterTrade();
    return ok;
  },
  cancelPreventiveTrade: PreventiveAlerts.cancelPreventiveTrade,
  editPreventiveTrade: PreventiveAlerts.editPreventiveTrade,
  // challengeManager
  openModal: ChallengeManager.openModal,
  closeModal: ChallengeManager.closeModal,
  openNewChallenge: ChallengeManager.openNewChallenge,
  editChallenge: ChallengeManager.editChallenge,
  saveChallenge: ChallengeManager.saveChallenge,
  setActive: ChallengeManager.setActive,
  deleteChallenge: ChallengeManager.deleteChallenge,
  // journalManager
  updateCL: JournalManager.updateCL,
  setScore: JournalManager.setScore,
  saveJournal: JournalManager.saveJournal,
  toggleJ: JournalManager.toggleJ,
  toggleFallo: JournalManager.toggleFallo,
  toggleEmergente: JournalManager.toggleEmergente,
  toggleJPhase: JournalManager.toggleJPhase,
  // historial
  renderHistorial: Historial.renderHistorial,
  // calculator
  calcSlFromPrices: Calculator.calcSlFromPrices,
  calcLote: Calculator.calcLote,
  // session
  activarSesion: Session.activarSesion,
  cerrarSesion: Session.cerrarSesion,
  updateSessionCL: Session.updateSessionCL,
  toggleSessionFreno: Session.toggleSessionFreno,
  // pdfExport
  exportarReportePDF: PdfExport.exportarReportePDF,
  // backup
  exportCSV: Backup.exportCSV,
  exportBackup: Backup.exportBackup,
  importBackup: Backup.importBackup,
  restoreBackup: Backup.restoreBackup,
  toggleBackupHistory: Backup.toggleBackupHistory,
  toggleBackupMenu: Backup.toggleBackupMenu,
  downloadSingleBackup: Backup.downloadSingleBackup,
  // plantillas
  savePlantilla: Plantillas.savePlantilla,
  deletePlantilla: Plantillas.deletePlantilla,
  // simulator
  simular: Simulator.simular,
  // theme
  toggleTheme: Theme.toggleTheme,
  // replay
  changeReplayChallenge: Replay.changeReplayChallenge,
  scrubReplay: Replay.scrubReplay,
  toggleReplayPlay: Replay.toggleReplayPlay,
  // heatmap / calendario
  showDayDetail: Statistics.showDayDetail,
  prevMonth: CalendarPro.prevMonth,
  nextMonth: CalendarPro.nextMonth,
  goToday: CalendarPro.goToday,
  // rule engine
  openNewRuleSet: RuleEngine.openNewRuleSet,
  editRuleSetForm: RuleEngine.editRuleSetForm,
  submitRuleSetForm: RuleEngine.submitRuleSetForm,
  deleteRuleSetConfirm: RuleEngine.deleteRuleSetConfirm,
  applyRuleSetToChallenge: RuleEngine.applyRuleSetToChallenge,
  // toast
  dismissToast: Toast.dismissToast,
  // mobile (Entrega 17)
  toggleSidebar,
  // settings panel (Entrega A/D)
  openSettings: SettingsPanel.openSettings,
  closeSettings: SettingsPanel.closeSettings,
  selectSettingsSection: SettingsPanel.selectSettingsSection,
  toggleResetButton: SettingsPanel.toggleResetButton,
  confirmResetQuantis: SettingsPanel.confirmResetQuantis,
  // instruments (pares configurables)
  openInstrumentForm: Instruments.openInstrumentForm,
  closeInstrumentForm: Instruments.closeInstrumentForm,
  saveInstrumentForm: Instruments.saveInstrumentForm,
  deleteInstrument: Instruments.deleteInstrument,
  onInstrumentTypeChange: Instruments.onInstrumentTypeChange,
  // eod
  saveEod: Eod.saveEod,
  verImagenesEod: Eod.verImagenesEod,
  toggleEod: Eod.toggleEod,
});

// --- Arranque ---
Theme.applySavedTheme(); // antes: IIFE de tema al cargar script.js
IZ.initPasteHandler(); // listener de pegar (Ctrl+V) en el formulario de registro
Backup.initBackupMenuAutoClose(); // cierra el menú de 3 puntos del panel de backups al hacer click afuera
init();
