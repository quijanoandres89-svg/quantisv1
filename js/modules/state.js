/* ============================================================
   STATE — dueño único de los datos de QUANTIS y su persistencia
   ------------------------------------------------------------
   Ningún otro módulo debe leer/escribir localStorage directamente,
   ni reasignar estos arrays/objetos por completo (eso rompería el
   binding de ES modules). Para modificarlos desde otro módulo:
     - arrays: usa push/splice, o trades.length = 0 antes de rellenar
     - objetos: asigna propiedades (journals[fecha] = {...}), no
       reasignes "journals" entero
   Para recargar todo desde localStorage, usa load().
   ============================================================ */

// --- Claves de localStorage ---
export const TK = "tjp_trades_v4";
export const JK = "tjp_journals_v4";
export const FK = "tjp_frenos_v4";
export const CH_KEY = "tjp_challenges_v1";
export const PL_KEY = "tjp_plantillas_v1";
export const RS_KEY = "kame_rulesets_v1";
export const IK = "tjp_instruments_v1";
export const EK = "tjp_eod_v1";

// --- Sincronización con Supabase ---
import { getSupabase, getCurrentUser } from "./supabaseClient.js";

const SERVER_STATE_VERSION = 1;

// Colecciones que son arrays de objetos con "id" propio: se pueden
// fusionar por id en vez de reemplazarse enteras cuando dos PCs
// (con la misma cuenta) escriben casi al mismo tiempo.
const MERGEABLE_ID_COLLECTIONS = new Set([
  "trades",
  "challenges",
  "plantillas",
  "ruleSets",
  "instruments",
]);

// Último updatedAt del servidor que este navegador llegó a ver.
// Si al ir a guardar el servidor tiene uno distinto, es que otro
// PC escribió de por medio: en vez de pisarlo, se fusiona.
let lastKnownServerUpdatedAt = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- Estado mutable compartido ---
export let trades = [];
export let journals = {};
export let eodEntries = {};
export let frenoLog = [];
export let dayScore = 0;
export let preChecks = {};
export let challenges = [];
export let plantillas = [];
export let ruleSets = [];
export let instruments = [];

// setter explícito para dayScore, porque es un primitivo (number) y
// los primitivos exportados con "let" no se pueden reasignar desde
// otro módulo — solo state.js puede hacer "dayScore = n".
export function setDayScore(n) {
  dayScore = n;
}

// --- Timers e instancias de Chart.js (no son datos persistentes,
//     pero varios módulos necesitan leer/limpiar la misma instancia) ---
export let frenoTimer = null;
export let sessionFrenoTimer = null;
export function setFrenoTimer(id) {
  frenoTimer = id;
}
export function setSessionFrenoTimer(id) {
  sessionFrenoTimer = id;
}

export let eqC = null,
  diaC = null,
  horaC = null,
  eq2C = null,
  consC = null,
  corrC = null,
  wkWRC = null,
  wkRRC = null,
  wkPlanC = null,
  mesC = null,
  replayC = null,
  balanceC = null,
  ddC = null,
  winsDistC = null,
  lossesDistC = null,
  gaugeRentC = null,
  gaugeCortoC = null,
  gaugeLargoC = null;
export function setChart(name, instance) {
  switch (name) {
    case "eqC":
      eqC = instance;
      break;
    case "diaC":
      diaC = instance;
      break;
    case "horaC":
      horaC = instance;
      break;
    case "eq2C":
      eq2C = instance;
      break;
    case "consC":
      consC = instance;
      break;
    case "corrC":
      corrC = instance;
      break;
    case "wkWRC":
      wkWRC = instance;
      break;
    case "wkRRC":
      wkRRC = instance;
      break;
    case "wkPlanC":
      wkPlanC = instance;
      break;
    case "mesC":
      mesC = instance;
      break;
    case "replayC":
      replayC = instance;
      break;
    case "balanceC":
      balanceC = instance;
      break;
    case "ddC":
      ddC = instance;
      break;
    case "winsDistC":
      winsDistC = instance;
      break;
    case "lossesDistC":
      lossesDistC = instance;
      break;
    case "gaugeRentC":
      gaugeRentC = instance;
      break;
    case "gaugeCortoC":
      gaugeCortoC = instance;
      break;
    case "gaugeLargoC":
      gaugeLargoC = instance;
      break;
    default:
      throw new Error(`Chart desconocido: ${name}`);
  }
}

// --- Checklist pre-sesión (config estática) ---
export const CL = [
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

// --- Instrumentos por defecto (semilla) ---
// Mismos 3 pares que antes estaban hardcodeados en 6 <select> distintos
// del HTML — se siembran automáticamente la primera vez que se corre
// esta versión, para que un usuario existente no note ningún cambio
// hasta que decida agregar más desde Configuración > Pares e
// instrumentos. Reemplaza al viejo `PIPS` (que estaba marcado como
// "reservado, no usado activamente aún" — esto es esa idea, terminada).
function defaultInstruments() {
  return [
    { id: 1, symbol: "EURUSD", tipo: "forex", decimales: 4, pipSize: 0.0001, valorPip: 10, unidad: "pips" },
    { id: 2, symbol: "XAUUSD", tipo: "metal", decimales: 2, pipSize: 0.1, valorPip: 10, unidad: "pips" },
    { id: 3, symbol: "GBPUSD", tipo: "forex", decimales: 4, pipSize: 0.0001, valorPip: 10, unidad: "pips" },
  ];
}

/** Carga el respaldo local (localStorage) tal cual funcionaba antes.
 * Muta los arrays/objetos existentes (no los reasigna) para que las
 * referencias exportadas sigan siendo válidas en todos los módulos
 * que ya las importaron. */
function loadLocalState() {
  try {
    const r = localStorage.getItem(TK);
    trades.length = 0;
    if (r) trades.push(...JSON.parse(r));
  } catch (e) {
    trades.length = 0;
  }
  try {
    const r = localStorage.getItem(JK);
    Object.keys(journals).forEach((k) => delete journals[k]);
    if (r) Object.assign(journals, JSON.parse(r));
  } catch (e) {
    Object.keys(journals).forEach((k) => delete journals[k]);
  }
  try {
    const r = localStorage.getItem(FK);
    frenoLog.length = 0;
    if (r) frenoLog.push(...JSON.parse(r));
  } catch (e) {
    frenoLog.length = 0;
  }
  try {
    const r = localStorage.getItem(EK);
    Object.keys(eodEntries).forEach((k) => delete eodEntries[k]);
    if (r) Object.assign(eodEntries, JSON.parse(r));
  } catch (e) {
    Object.keys(eodEntries).forEach((k) => delete eodEntries[k]);
  }
  try {
    const r = localStorage.getItem(CH_KEY);
    challenges.length = 0;
    if (r) challenges.push(...JSON.parse(r));
  } catch (e) {
    challenges.length = 0;
  }
  try {
    const r = localStorage.getItem(PL_KEY);
    plantillas.length = 0;
    if (r) plantillas.push(...JSON.parse(r));
  } catch (e) {
    plantillas.length = 0;
  }
  try {
    const r = localStorage.getItem(RS_KEY);
    ruleSets.length = 0;
    if (r) ruleSets.push(...JSON.parse(r));
  } catch (e) {
    ruleSets.length = 0;
  }
  try {
    const r = localStorage.getItem(IK);
    instruments.length = 0;
    // r === null significa "la clave nunca existió" (instalación nueva
    // o actualizando desde una versión sin esta función) -> se siembran
    // los 3 pares que antes vivían hardcodeados. Si la clave SÍ existe
    // pero es un array vacío ("[]"), es porque el usuario los borró
    // todos a propósito desde Configuración — se respeta ese vacío, no
    // se le vuelve a sembrar nada.
    if (r === null) instruments.push(...defaultInstruments());
    else instruments.push(...JSON.parse(r));
  } catch (e) {
    instruments.push(...defaultInstruments());
  }
}

function saveLocalState() {
  safeSetItem(TK, JSON.stringify(trades));
  safeSetItem(JK, JSON.stringify(journals));
  safeSetItem(EK, JSON.stringify(eodEntries));
  safeSetItem(FK, JSON.stringify(frenoLog));
  safeSetItem(CH_KEY, JSON.stringify(challenges));
  safeSetItem(PL_KEY, JSON.stringify(plantillas));
  safeSetItem(RS_KEY, JSON.stringify(ruleSets));
  safeSetItem(IK, JSON.stringify(instruments));
}

function applyServerState(data) {
  if (Array.isArray(data.trades)) {
    trades.length = 0;
    trades.push(...data.trades);
  }
  if (data.journals && typeof data.journals === "object" && !Array.isArray(data.journals)) {
    Object.keys(journals).forEach((k) => delete journals[k]);
    Object.assign(journals, data.journals);
  }
  if (data.eodEntries && typeof data.eodEntries === "object" && !Array.isArray(data.eodEntries)) {
    Object.keys(eodEntries).forEach((k) => delete eodEntries[k]);
    Object.assign(eodEntries, data.eodEntries);
  }
  if (Array.isArray(data.frenoLog)) {
    frenoLog.length = 0;
    frenoLog.push(...data.frenoLog);
  }
  if (Array.isArray(data.challenges)) {
    challenges.length = 0;
    challenges.push(...data.challenges);
  }
  if (Array.isArray(data.plantillas)) {
    plantillas.length = 0;
    plantillas.push(...data.plantillas);
  }
  if (Array.isArray(data.ruleSets)) {
    ruleSets.length = 0;
    ruleSets.push(...data.ruleSets);
  }
  if (Array.isArray(data.instruments) && data.instruments.length > 0) {
    instruments.length = 0;
    instruments.push(...data.instruments);
  }
}

function emptyServerShape() {
  return {
    version: SERVER_STATE_VERSION,
    updatedAt: null,
    trades: [],
    journals: {},
    eodEntries: {},
    frenoLog: [],
    challenges: [],
    plantillas: [],
    ruleSets: [],
    instruments: [],
  };
}

async function fetchServerState() {
  const user = await getCurrentUser();
  if (!user) throw new Error("No hay sesión activa de Supabase.");

  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from("quantis_state")
    .select("data, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw new Error(`Supabase select falló: ${error.message}`);
  if (!data) return emptyServerShape(); // primer login, aún sin fila

  return { ...data.data, updatedAt: data.updated_at };
}

async function postServerState(data) {
  const user = await getCurrentUser();
  if (!user) throw new Error("No hay sesión activa de Supabase.");

  const supabase = await getSupabase();
  const nowIso = new Date().toISOString();
  const payload = { ...data, updatedAt: nowIso };

  const { error } = await supabase.from("quantis_state").upsert(
    { user_id: user.id, data: payload, updated_at: nowIso },
    { onConflict: "user_id" },
  );

  if (error) throw new Error(`Supabase upsert falló: ${error.message}`);

  lastKnownServerUpdatedAt = nowIso;
  return { success: true };
}

/** Borra por completo la fila de este usuario en Supabase. Usado
 * por "Restablecer QUANTIS" — sin esto, el reset solo limpiaba lo
 * local y la próxima carga volvía a bajar los datos "viejos" desde
 * el servidor, deshaciendo el reset sin avisar. */
export async function resetServerState() {
  const user = await getCurrentUser();
  if (!user) throw new Error("No hay sesión activa de Supabase.");

  const supabase = await getSupabase();
  const { error } = await supabase
    .from("quantis_state")
    .delete()
    .eq("user_id", user.id);

  if (error) throw new Error(`Supabase delete falló: ${error.message}`);

  lastKnownServerUpdatedAt = null;
}

function serverHasRealData(data) {
  if (!data || typeof data !== "object") return false;
  return (
    (Array.isArray(data.trades) && data.trades.length > 0) ||
    (data.journals && Object.keys(data.journals).length > 0) ||
    (data.eodEntries && Object.keys(data.eodEntries).length > 0) ||
    (Array.isArray(data.frenoLog) && data.frenoLog.length > 0) ||
    (Array.isArray(data.challenges) && data.challenges.length > 0) ||
    (Array.isArray(data.plantillas) && data.plantillas.length > 0) ||
    (Array.isArray(data.ruleSets) && data.ruleSets.length > 0) ||
    (Array.isArray(data.instruments) && data.instruments.length > 0)
  );
}

/**
 * Primera vez que este usuario inicia sesión: si Supabase ya tiene
 * datos reales, esos mandan (nunca se pisan con un localStorage
 * viejo de este navegador). Si Supabase está vacío, se sube lo que
 * ya había en este navegador para no perder nada.
 */
async function migrateLocalStateToServer(data) {
  if (serverHasRealData(data)) return data;

  console.log("QUANTIS: subiendo estado local a Supabase (primera sincronización).");

  const migrated = {
    ...data,
    version: data.version || SERVER_STATE_VERSION,
    trades: trades.length ? clone(trades) : data.trades || [],
    journals: Object.keys(journals).length ? clone(journals) : data.journals || {},
    eodEntries: Object.keys(eodEntries).length ? clone(eodEntries) : data.eodEntries || {},
    frenoLog: frenoLog.length ? clone(frenoLog) : data.frenoLog || [],
    challenges: challenges.length ? clone(challenges) : data.challenges || [],
    plantillas: plantillas.length ? clone(plantillas) : data.plantillas || [],
    ruleSets: ruleSets.length ? clone(ruleSets) : data.ruleSets || [],
    instruments: instruments.length ? clone(instruments) : defaultInstruments(),
  };

  await postServerState(migrated);
  return migrated;
}

function mergeCollection(key, serverValue, localValue) {
  if (key === "journals" || key === "eodEntries") {
    return { ...(serverValue || {}), ...(localValue || {}) };
  }

  if (MERGEABLE_ID_COLLECTIONS.has(key)) {
    const byId = new Map();
    for (const item of Array.isArray(serverValue) ? serverValue : []) {
      if (item && item.id !== undefined && item.id !== null) byId.set(item.id, item);
    }
    // Los locales (lo que este PC acaba de tocar) ganan en caso de choque.
    for (const item of Array.isArray(localValue) ? localValue : []) {
      if (item && item.id !== undefined && item.id !== null) byId.set(item.id, item);
    }
    return Array.from(byId.values());
  }

  // frenoLog u otros arrays sin id fiable: unir y quitar duplicados exactos.
  const server = Array.isArray(serverValue) ? serverValue : [];
  const local = Array.isArray(localValue) ? localValue : [];
  const seen = new Set();
  const merged = [];
  for (const item of [...server, ...local]) {
    const sig = JSON.stringify(item);
    if (!seen.has(sig)) {
      seen.add(sig);
      merged.push(item);
    }
  }
  return merged;
}

const COLLECTION_REF = {
  trades: () => trades,
  journals: () => journals,
  eodEntries: () => eodEntries,
  frenoLog: () => frenoLog,
  challenges: () => challenges,
  plantillas: () => plantillas,
  ruleSets: () => ruleSets,
  instruments: () => instruments,
};

/** Sube solo la colección que cambió, fusionando con el servidor si
 * otro PC (misma cuenta) escribió de por medio en vez de pisarlo. */
async function syncStateToServer(changedKey) {
  try {
    const server = await fetchServerState();

    const conflict =
      lastKnownServerUpdatedAt !== null &&
      server.updatedAt &&
      server.updatedAt !== lastKnownServerUpdatedAt;

    const localValue = clone(COLLECTION_REF[changedKey]());

    server[changedKey] = conflict
      ? mergeCollection(changedKey, server[changedKey], localValue)
      : localValue;

    if (conflict) {
      console.warn(
        `QUANTIS: se detectaron cambios de otro equipo en "${changedKey}". Se fusionaron automáticamente.`,
      );
    }

    server.version = server.version || SERVER_STATE_VERSION;
    await postServerState(server);

    // Si hubo fusión, la colección local también se actualiza con
    // el resultado combinado (no solo lo que había en este PC).
    if (conflict) {
      applyServerState({ [changedKey]: server[changedKey] });
      saveLocalState();
    }
  } catch (error) {
    console.error(`QUANTIS: no se pudo sincronizar "${changedKey}" con Supabase:`, error);
  }
}

/** Carga principal: primero localStorage (respaldo inmediato, sin
 * esperar red), luego Supabase como fuente de verdad entre equipos. */
export async function load() {
  loadLocalState();

  let data;
  try {
    data = await fetchServerState();
  } catch (error) {
    console.warn("QUANTIS: no se pudo contactar Supabase, se mantiene el localStorage.", error);
    return;
  }

  try {
    data = await migrateLocalStateToServer(data);
  } catch (error) {
    console.error("QUANTIS: error en la sincronización inicial con Supabase:", error);
    return;
  }

  applyServerState(data);
  lastKnownServerUpdatedAt = data.updatedAt || null;

  if (instruments.length === 0) {
    instruments.push(...defaultInstruments());
    syncStateToServer("instruments");
  }

  saveLocalState();
}

/**
 * Escribe en localStorage protegido con try/catch. Devuelve true/false
 * en vez de dejar que la excepción se propague sin control.
 * ------------------------------------------------------------
 * Hallazgo de la auditoría (sección 2/3, 🔴 Crítico relacionado):
 * localStorage.setItem() puede lanzar QuotaExceededError (cuota
 * llena — más probable en este proyecto por las capturas de pantalla
 * guardadas en Base64 dentro de los trades) o fallar por otros
 * motivos (modo incógnito con storage deshabilitado, etc). Antes de
 * esta función, ningún save*() capturaba ese error: el trade/journal/
 * challenge que se intentaba guardar se perdía en silencio, sin
 * ningún aviso al usuario. Ahora cada save*() devuelve true (se
 * guardó) o false (falló, no se guardó nada nuevo) — el módulo que
 * llama decide cómo avisar (normalmente con un toast, mismo patrón ya
 * usado en el resto de la app desde la Entrega 31).
 * No se importa toast.js aquí a propósito: mantiene state.js sin
 * dependencias de UI, igual que ya se hace con "saveTrade() ya no
 * llama a renderSidebar() directamente" — la capa de datos no decide
 * cómo se muestra el aviso, solo informa si tuvo éxito.
 */
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.error(`No se pudo guardar en localStorage (clave: ${key}):`, e);
    return false;
  }
}

export function saveTrades() {
  const ok = safeSetItem(TK, JSON.stringify(trades));
  syncStateToServer("trades");
  return ok;
}
export function saveJournals() {
  const ok = safeSetItem(JK, JSON.stringify(journals));
  syncStateToServer("journals");
  return ok;
}
export function saveEodEntries() {
  const ok = safeSetItem(EK, JSON.stringify(eodEntries));
  syncStateToServer("eodEntries");
  return ok;
}
export function saveFrenoLog() {
  const ok = safeSetItem(FK, JSON.stringify(frenoLog));
  syncStateToServer("frenoLog");
  return ok;
}
export function saveChallenges() {
  const ok = safeSetItem(CH_KEY, JSON.stringify(challenges));
  syncStateToServer("challenges");
  return ok;
}
export function savePlantillas() {
  const ok = safeSetItem(PL_KEY, JSON.stringify(plantillas));
  syncStateToServer("plantillas");
  return ok;
}
export function saveRuleSets() {
  const ok = safeSetItem(RS_KEY, JSON.stringify(ruleSets));
  syncStateToServer("ruleSets");
  return ok;
}
export function saveInstruments() {
  const ok = safeSetItem(IK, JSON.stringify(instruments));
  syncStateToServer("instruments");
  return ok;
}
