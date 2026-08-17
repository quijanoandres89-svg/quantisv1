/* ============================================================
   INSTRUMENTS — pares/instrumentos configurables (forex, metales,
   cripto, índices, otro).
   ------------------------------------------------------------
   Reemplaza 3 cosas que existían dispersas y hardcodeadas antes de
   este módulo:
   1. Los mismos 3 pares (EURUSD/XAUUSD/GBPUSD) repetidos como
      <option> fijos en 6 <select> distintos del HTML.
   2. calculator.js decidía la matemática de pips con
      `if (par === "XAUUSD") ... else ...` — solo cubría 2 casos.
      Agregar un instrumento nuevo (ej. cripto) sin esto habría dado
      un tamaño de lote CALCULADO MAL, no solo "sin la opción".
   3. statistics.js tenía la lista de pares hardcodeada 2 veces más
      para "Rendimiento por par" — un pair nuevo agregado a mano
      habría quedado invisible en esas 2 estadísticas.

   Cada instrumento no es solo un símbolo — trae su propia
   configuración de cálculo (pipSize/valorPip/unidad), porque distintos
   tipos de activo NO comparten la misma matemática de riesgo:
   forex mide en "pips" con un tamaño estándar; cripto/índices no
   tienen una convención universal de "pip" y varían según el
   bróker/exchange, así que se habla de "puntos" y el valor se deja
   explícito para que el usuario lo verifique con su bróker en vez de
   fingir una precisión que esta app no puede garantizar sin conectarse
   a ese bróker.
   ============================================================ */

import { instruments, saveInstruments } from "./state.js";
import { showToast } from "./toast.js";
import { escapeHTML } from "./utils.js";

/**
 * Tipos de instrumento soportados, con defaults sensatos por tipo —
 * al elegir un tipo en el formulario de "Agregar instrumento", estos
 * valores prellenan pipSize/valorPip/unidad (el usuario los puede
 * editar después; son un punto de partida razonable, no una promesa
 * de precisión universal, sobre todo en cripto/índices).
 */
export const INSTRUMENT_TYPES = {
  forex: {
    label: "Forex",
    decimales: 4,
    pipSize: 0.0001,
    valorPip: 10,
    unidad: "pips",
    hint: "Pares estándar (EURUSD, GBPUSD, AUDUSD...). 1 pip = 0.0001, ~$10 por lote estándar.",
  },
  forex_jpy: {
    label: "Forex (JPY)",
    decimales: 2,
    pipSize: 0.01,
    valorPip: 10,
    unidad: "pips",
    hint: "Pares con Yen (USDJPY, EURJPY...). 1 pip = 0.01, ~$10 por lote estándar.",
  },
  metal: {
    label: "Metales",
    decimales: 2,
    pipSize: 0.1,
    valorPip: 10,
    unidad: "pips",
    hint: "Oro/Plata. Verifica el tamaño de contrato de tu bróker — el default asume XAUUSD estándar.",
  },
  cripto: {
    label: "Cripto",
    decimales: 2,
    pipSize: 1,
    valorPip: 1,
    unidad: "puntos",
    hint: "No hay convención universal de \"pip\" en cripto — ajusta el valor por punto según tu exchange/bróker.",
  },
  indice: {
    label: "Índices",
    decimales: 1,
    pipSize: 1,
    valorPip: 1,
    unidad: "puntos",
    hint: "US30, NAS100, GER40... el valor por punto depende del contrato de tu bróker — verifícalo antes de operar.",
  },
  otro: {
    label: "Otro",
    decimales: 4,
    pipSize: 0.0001,
    valorPip: 10,
    unidad: "pips",
    hint: "Configura manualmente el tamaño y valor del pip/punto.",
  },
};

/** Todos los <select> que deben listar instrumentos llevan esta clase
 * — un solo lugar decide qué selects repoblar, en vez de tener que
 * acordarse de actualizar 6 IDs distintos a mano cada vez. */
const SELECT_CLASS = "instrument-select";

export function getInstrument(symbol) {
  return instruments.find((i) => i.symbol === symbol) || null;
}

/** Repuebla TODOS los <select class="instrument-select"> del
 * documento con la lista actual de instrumentos, conservando el
 * valor previamente seleccionado si sigue existiendo. Los que
 * necesitan una opción vacía al inicio (ej. "Todos" en el filtro de
 * Historial, "No apareció ninguno" en el setup emergente del
 * journal) la declaran con data-empty-label="..." en el HTML, no
 * hardcodeada acá — así cada select puede tener su propio texto sin
 * que este módulo tenga que conocerlos a todos. */
export function renderAllInstrumentSelects() {
  document.querySelectorAll(`.${SELECT_CLASS}`).forEach((sel) => {
    const prev = sel.value;
    const emptyLabel = sel.dataset.emptyLabel;
    const emptyOption = emptyLabel
      ? `<option value="">${escapeHTML(emptyLabel)}</option>`
      : "";
    sel.innerHTML =
      emptyOption +
      instruments
        .map((i) => `<option value="${escapeHTML(i.symbol)}">${escapeHTML(i.symbol)}</option>`)
        .join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  });
}

/* ------------------------------------------------------------
   SECCIÓN de Configuración: "Pares e instrumentos"
   ------------------------------------------------------------ */
export function renderInstrumentsSection(container) {
  container.innerHTML = `
    <div class="settings-section-title">Pares e instrumentos</div>
    <div class="settings-section-sub">Los instrumentos que operás — se usan en el registro de trades, la calculadora de lotes y las estadísticas por par.</div>
    <div id="instruments-list"></div>
    <button class="btn btn-p" style="margin-top:10px" onclick="openInstrumentForm()">+ Agregar instrumento</button>
    <div id="instrument-form-box"></div>`;
  renderInstrumentsList();
}

function typeBadge(tipo) {
  const t = INSTRUMENT_TYPES[tipo] || INSTRUMENT_TYPES.otro;
  return `<span class="badge binf">${escapeHTML(t.label)}</span>`;
}

function renderInstrumentsList() {
  const el = document.getElementById("instruments-list");
  if (!el) return;
  if (!instruments.length) {
    el.innerHTML = `<div class="empty">Sin instrumentos configurados — agrega al menos uno para poder registrar trades.</div>`;
    return;
  }
  el.innerHTML = instruments
    .map(
      (i, idx) => `
    <div class="ch-card" style="padding:11px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:8px">
          <strong style="font-size:13px">${escapeHTML(i.symbol)}</strong>
          ${typeBadge(i.tipo)}
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm" onclick="openInstrumentForm(${idx})">Editar</button>
          <button class="btn btn-d btn-sm" onclick="deleteInstrument(${idx})">Eliminar</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-top:6px">
        1 ${escapeHTML(i.unidad)} = ${i.pipSize} &middot; valor por ${i.unidad === "pips" ? "pip" : "punto"}: $${i.valorPip} (lote estándar)
      </div>
    </div>`,
    )
    .join("");
}

// [window] onclick="openInstrumentForm(idx)" — idx opcional (editar) o vacío (nuevo)
export function openInstrumentForm(idx) {
  const editing = idx !== undefined && instruments[idx];
  const i = editing || { symbol: "", tipo: "forex", ...INSTRUMENT_TYPES.forex };
  const box = document.getElementById("instrument-form-box");
  if (!box) return;
  box.innerHTML = `
    <div class="card" style="margin-top:12px">
      <div class="ct">${editing ? "Editar instrumento" : "Nuevo instrumento"}</div>
      <div class="fr">
        <div class="fg">
          <label>Símbolo</label>
          <input type="text" id="inst-symbol" value="${escapeHTML(i.symbol)}" placeholder="BTCUSD" style="text-transform:uppercase" />
        </div>
        <div class="fg">
          <label>Tipo</label>
          <select id="inst-tipo" onchange="onInstrumentTypeChange()">
            ${Object.entries(INSTRUMENT_TYPES)
              .map(([k, t]) => `<option value="${k}" ${k === i.tipo ? "selected" : ""}>${escapeHTML(t.label)}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="alert ai" id="inst-hint" style="margin-bottom:10px">${escapeHTML(INSTRUMENT_TYPES[i.tipo]?.hint || "")}</div>
      <div class="fr3">
        <div class="fg">
          <label>Tamaño del pip/punto</label>
          <input type="number" id="inst-pipsize" value="${i.pipSize}" step="any" />
        </div>
        <div class="fg">
          <label>Valor por pip/punto (USD, lote estándar)</label>
          <input type="number" id="inst-valorpip" value="${i.valorPip}" step="any" />
        </div>
        <div class="fg">
          <label>Etiqueta</label>
          <select id="inst-unidad">
            <option value="pips" ${i.unidad === "pips" ? "selected" : ""}>pips</option>
            <option value="puntos" ${i.unidad === "puntos" ? "selected" : ""}>puntos</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-p" onclick="saveInstrumentForm(${editing ? idx : "null"})">Guardar</button>
        <button class="btn" onclick="closeInstrumentForm()">Cancelar</button>
      </div>
    </div>`;
}

// [window] onchange="onInstrumentTypeChange()" — prellena defaults al elegir el tipo
export function onInstrumentTypeChange() {
  const tipo = document.getElementById("inst-tipo").value;
  const t = INSTRUMENT_TYPES[tipo] || INSTRUMENT_TYPES.otro;
  document.getElementById("inst-pipsize").value = t.pipSize;
  document.getElementById("inst-valorpip").value = t.valorPip;
  document.getElementById("inst-unidad").value = t.unidad;
  document.getElementById("inst-hint").textContent = t.hint;
}

// [window] onclick="closeInstrumentForm()"
export function closeInstrumentForm() {
  const box = document.getElementById("instrument-form-box");
  if (box) box.innerHTML = "";
}

// [window] onclick="saveInstrumentForm(idx)" — idx null si es nuevo
export function saveInstrumentForm(idx) {
  const symbol = document.getElementById("inst-symbol").value.trim().toUpperCase();
  if (!symbol) {
    showToast("error", "Falta el símbolo", "Escribe el símbolo del instrumento (ej. BTCUSD).");
    return;
  }
  const dup = instruments.findIndex(
    (i, i2) => i.symbol === symbol && i2 !== idx,
  );
  if (dup !== -1) {
    showToast("error", "Ya existe", `${symbol} ya está en tu lista de instrumentos.`);
    return;
  }
  const entry = {
    id: idx !== null && instruments[idx] ? instruments[idx].id : Date.now(),
    symbol,
    tipo: document.getElementById("inst-tipo").value,
    pipSize: parseFloat(document.getElementById("inst-pipsize").value) || 0.0001,
    valorPip: parseFloat(document.getElementById("inst-valorpip").value) || 10,
    unidad: document.getElementById("inst-unidad").value,
  };
  entry.decimales = INSTRUMENT_TYPES[entry.tipo]?.decimales ?? 4;

  const prevList = [...instruments];
  if (idx !== null && instruments[idx]) instruments[idx] = entry;
  else instruments.push(entry);

  if (!saveInstruments()) {
    instruments.length = 0;
    instruments.push(...prevList);
    showToast("error", "No se pudo guardar", "Almacenamiento local lleno.");
    return;
  }
  closeInstrumentForm();
  renderInstrumentsList();
  renderAllInstrumentSelects();
  showToast("success", idx !== null ? "Instrumento actualizado" : "Instrumento agregado", symbol);
}

// [window] onclick="deleteInstrument(idx)"
export function deleteInstrument(idx) {
  const i = instruments[idx];
  if (!i) return;
  if (!confirm(`¿Eliminar ${i.symbol}? Los trades ya registrados con este símbolo no se borran, solo dejará de aparecer como opción al registrar trades nuevos.`))
    return;
  const removed = instruments.splice(idx, 1);
  if (!saveInstruments()) {
    instruments.splice(idx, 0, ...removed);
    showToast("error", "No se pudo eliminar", "Almacenamiento local lleno.");
    return;
  }
  renderInstrumentsList();
  renderAllInstrumentSelects();
  showToast("success", "Instrumento eliminado", removed[0].symbol);
}
