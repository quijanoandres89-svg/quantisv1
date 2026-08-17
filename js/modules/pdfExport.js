/* ============================================================
   PDF EXPORT — genera el reporte semanal en PDF (jsPDF), con
   logo, resumen general y detalle por semana.
   ------------------------------------------------------------
   Rediseño (Entrega C): la plantilla vieja usaba el índigo
   pre-Quantis (#6366f1 / RGB 99,102,241) y barras negras sólidas
   de cabecera/pie — quedaba desalineada de la identidad visual
   actual de la app (paleta Quantis, Entrega 21) y se veía genérica.

   Los colores de acá NO son elegidos a mano — son la traducción a
   RGB de las variables CSS reales del modo claro de style.css
   (--acc, --text, --border, --gbg, etc.), incluyendo el cálculo de
   mezcla correcto para las que son rgba() semi-transparentes sobre
   fondo blanco (jsPDF no compone alpha con el mismo resultado
   visual, así que se precalculó el color sólido equivalente). Así
   el PDF se ve como una extensión real de la app, no como una
   plantilla aparte con su propia paleta.
   ============================================================ */

import { trades, journals } from "./state.js";
import { today, fmtShort, weekStart, weekEnd, getWeeks } from "./utils.js";
import * as TradeEngine from "./tradeEngine.js";
import { showToast } from "./toast.js";

// Paleta Quantis (modo claro), traducida de css/style.css a RGB para jsPDF.
// Un solo lugar con los valores — si la paleta cambia algún día, se
// actualiza acá y no hay que perseguir arrays de 3 números sueltos
// por todo el archivo.
const PDF_COLORS = {
  pageBg: [255, 255, 255], // --bg2
  headerBg: [2, 44, 34], // --text (usado como barra oscura elegante, no negro genérico)
  cardBg: [241, 246, 244], // --bg3
  cardBgAccent: [225, 242, 237], // --abg mezclado sobre blanco
  border: [230, 234, 233], // --border mezclado sobre blanco
  borderStrong: [209, 217, 215], // --border2 mezclado sobre blanco
  textPrimary: [2, 44, 34], // --text
  textSecondary: [91, 118, 111], // --text2 mezclado sobre blanco
  textMuted: [141, 160, 156], // --text3 mezclado sobre blanco
  accent: [5, 150, 105], // --acc
  green: [4, 120, 87], // --green
  greenBg: [230, 242, 238], // --gbg mezclado sobre blanco
  red: [220, 38, 38], // --red
  redBg: [254, 226, 226], // --rbg
  yellow: [202, 138, 4], // --yellow
  yellowBg: [254, 249, 195], // --ybg
  white: [255, 255, 255],
};

export function cleanPDF(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/→/g, "->")
    .replace(/★/g, "*")
    .replace(/[^\x00-\x7F]/g, "");
}

export function logoToBase64(callback) {
  // Mismo trazo del logo de siempre, recoloreado a blanco: va montado
  // sobre la barra de cabecera oscura (--text / verde profundo), así
  // que blanco da el contraste más limpio — el mismo criterio que ya
  // usa el resto de la app para texto sobre fondos oscuros.
  const svgData = `<svg version="1.1" width="306.68756" height="279.34164" xmlns="http://www.w3.org/2000/svg"><path d="m 260.99226,0.21076202 c 9.80327,2.29167448 24.26903,7.09494908 30.00781,15.70312498 0.375,2.5 0.375,2.5 0,5 -3.81026,3.678873 -7.53289,4.12663 -12.65332,4.217773 -1.7569,0.03608 -1.7569,0.03608 -3.5493,0.07289 -1.91837,0.03401 -1.91837,0.03401 -3.8755,0.06871 -2.75439,0.05838 -5.50866,0.12137 -8.26294,0.184326 -0.7205,0.01615 -1.441,0.03229 -2.18334,0.04893 -28.98897,0.657035 -57.58641,2.255248 -86.36293,6.003258 -3.39451,0.440705 -6.7901,0.872403 -10.18591,1.30304 -11.87026,1.508758 -23.73635,3.048294 -35.59473,4.647949 -0.98926,0.132094 -1.97853,0.264187 -2.99777,0.400284 -0.91105,0.124107 -1.82211,0.248215 -2.76077,0.376083 -0.7909,0.107053 -1.58179,0.214105 -2.39665,0.324402 -2.09959,0.339853 -4.12284,0.803913 -6.17684,1.352356 0.62907,0.533672 1.25813,1.067344 1.90625,1.617187 8.08995,7.042153 17.63225,15.425751 19.65625,26.445313 -0.5625,2.9375 -0.5625,2.9375 -3.16406,4.828125 -4.58802,3.654286 -6.78983,8.828045 -9.40393,13.967133 -1.60788,3.156631 -3.26305,6.288431 -4.91248,9.423492 -0.33698,0.642975 -0.67395,1.285951 -1.02114,1.94841 -8.81312,16.761112 -18.522489,33.039422 -29.060889,48.770332 1.0016,0.18176 2.00321,0.36352 3.03516,0.55079 1.34253,0.25348 2.68497,0.50741 4.02734,0.76171 0.65678,0.11795 1.31356,0.2359 1.99024,0.35743 0.6542,0.12568 1.3084,0.25136 1.98242,0.38086 0.59176,0.10997 1.183519,0.21994 1.793209,0.33325 2.17163,0.61596 2.17163,0.61596 5.38086,2.15674 4.16441,1.81922 7.91613,1.86485 12.40796,1.7561 0.82298,-0.0106 1.64595,-0.0213 2.49387,-0.0323 8.80078,-0.17559 17.5502,-0.90805 26.30838,-1.75384 2.65493,-0.25587 5.31083,-0.49774 7.96728,-0.73731 28.92471,-2.66397 57.54094,-6.71625 86.17578,-11.52344 5.27061,-0.88393 10.54196,-1.76297 15.81508,-2.63175 2.06587,-0.34259 4.13034,-0.69289 6.19483,-1.04372 18.3968,-3.04074 18.3968,-3.04074 26.42759,2.42547 14.81173,11.70679 14.81173,11.70679 16.6875,20.0625 -0.6875,2.9375 -0.6875,2.9375 -2.99218,5.8086 -3.75623,5.14781 -4.96684,11.02947 -6.50782,17.1289 -0.16403,0.63197 -0.32806,1.26393 -0.49707,1.91504 -3.10048,11.94545 -5.69367,24.00095 -8.19043,36.08496 -0.17762,0.85465 -0.35523,1.7093 -0.53824,2.58985 -0.50547,2.44771 -1.00128,4.89715 -1.49301,7.34765 -0.14958,0.72696 -0.29917,1.45391 -0.45329,2.20289 -0.78718,4.00202 -1.39004,7.78413 -1.01546,11.85961 1.6245,1.7078 3.2922,3.37551 5,5 1,2.625 1,2.625 1,5 -1.37088,2.02025 -2.42804,2.79941 -4.72363,3.6045 -2.94058,0.51091 -5.53826,0.24811 -8.51074,-0.0264 -8.01,-0.63833 -15.98521,-0.81896 -24.01563,-0.82813 -0.7917,-0.002 -1.58341,-0.003 -2.39911,-0.005 -18.00973,-0.002 -35.98934,0.80419 -53.97589,1.63006 -0.69777,0.0317 -1.39554,0.0635 -2.11445,0.0962 -16.61726,0.7568 -33.21765,1.6514 -49.80611,2.90025 -6.17361,0.45469 -12.26397,0.7229 -18.45444,0.62857 -0.0374,0.96422 -0.0748,1.92844 -0.11328,2.92188 -0.0657,1.26328 -0.13148,2.52656 -0.19922,3.82812 -0.058,1.25297 -0.11601,2.50594 -0.17578,3.79688 -0.52448,3.53927 -0.78346,5.14952 -3.51172,7.45312 -2.89453,0.57032 -2.89453,0.57032 -6,0 -2.44922,-2.19531 -2.44922,-2.19531 -4.6875,-5.125 -0.74636,-0.95132 -1.49273,-1.90265 -2.26172,-2.88281 -3.84318,-5.60739 -5.48879,-9.77833 -5.23828,-16.58203 0.0261,-1.50667 0.0518,-3.01334 0.0771,-4.52002 0.0187,-0.78699 0.0373,-1.57398 0.0565,-2.38482 1.36963,-48.76972 1.36963,-48.76972 -16.946169,-92.50532 -1.485,-0.99 -1.485,-0.99 -3,-2 -4.195,5.13271 -8.26295,10.32922 -12.19458,15.66504 -8.96052,12.13884 -18.87049,23.35731 -29.11401,34.4209 -1.86096,2.01491 -3.70725,4.03723 -5.53906,6.07813 -4.41861,4.90998 -8.83784,9.66257 -13.91016,13.91406 -3.66021,3.13732 -7.15696,6.45325 -10.67529,9.74805 -7.6400004,7.11063 -7.6400004,7.11063 -11.3169004,7.36132 -0.7425,-0.0619 -1.48500003,-0.12375 -2.25000002810047,-0.1875 C 1.2854706,235.13336 2.9939906,232.44008 6.4375006,228.91392 11.837331,223.1742 16.665341,217.12822 21.471191,210.88853 c 1.62621,-2.1004 3.26925,-4.18678 4.91553,-6.27148 13.84823,-17.57601 26.37632,-35.97555 38.61328,-54.70313 0.57396,-0.8764 1.14791,-1.7528 1.73926,-2.65576 C 96.033691,102.57472 96.033691,102.57472 107,51.913928 c -1.00962,-3.514817 -2.35198,-6.739323 -4,-10 -1.91682,0.290616 -3.833449,0.582569 -5.749999,0.875 -1.18722,0.176602 -2.37445,0.353203 -3.59765,0.535156 -2.2882,0.369538 -4.56975,0.786832 -6.83594,1.273438 -10.92197,2.286654 -18.26789,-0.753462 -27.64844,-6.457032 -7.89236,-5.547033 -15.07797,-11.992021 -20.16797,-20.226562 0.33,-0.66 0.66,-1.32 1,-2 4.09102,0.322975 7.06489,1.462874 10.625,3.375 16.77106,8.559194 35.03833,6.034241 53.105469,4.035156 0.77477,-0.08466 1.54955,-0.16932 2.3478,-0.256546 22.51851,-2.468054 44.98956,-5.340612 67.45884,-8.217087 6.16964,-0.789286 12.34084,-1.565574 18.51247,-2.339126 4.82761,-0.607385 9.65402,-1.223997 14.48015,-1.843094 2.27586,-0.290395 4.55215,-0.577462 6.82888,-0.8609009 13.98202,-1.7446528 34.93663,-11.340039 47.63365,-9.59656808 z M 259.74885,150.7049 c -1.11124,0.12726 -1.11124,0.12726 -2.24493,0.2571 -2.47676,0.28423 -4.9532,0.57108 -7.42963,0.85813 -1.75636,0.20258 -3.51274,0.4051 -5.26912,0.60756 -5.70624,0.65881 -11.41194,1.32234 -17.1176,1.98619 -1.44718,0.16811 -1.44718,0.16811 -2.9236,0.33962 -25.98285,3.01825 -51.95441,6.10916 -77.896,9.4651 -1.99118,0.25756 -3.98247,0.51429 -5.97376,0.77097 -3.65529,0.47255 -7.31001,0.94919 -10.96445,1.42822 -1.06258,0.1381 -2.12515,0.27619 -3.21992,0.41847 -0.96658,0.12818 -1.93315,0.25636 -2.92901,0.38842 -1.24972,0.1646 -1.24972,0.1646 -2.52468,0.33253 -2.1295,0.33666 -4.17504,0.79773 -6.25608,1.35667 1.62795,14.53063 3.59018,29.01272 5.5625,43.5 0.47633,3.50222 0.95219,7.0045 1.42675,10.50696 0.29277,2.16055 0.58654,4.32096 0.8815,6.4812 0.61761,4.5555 1.20027,9.10396 1.66416,13.67786 0.0383,3.61282 0.0383,3.61282 1.46509,4.83398 2.09435,0.0547 4.19067,0.0334 6.28516,-0.0156 0.99831,-0.0228 0.99831,-0.0228 2.01678,-0.0461 2.25379,-0.0553 4.50711,-0.12056 6.76056,-0.18824 0.79079,-0.023 1.58158,-0.046 2.39633,-0.0697 32.39857,-0.9727 64.70268,-3.39278 96.97867,-6.3053 1.22942,-0.11009 2.45883,-0.22018 3.7255,-0.33361 3.46577,-0.3126 6.93079,-0.63237 10.3956,-0.95545 1.04548,-0.0947 2.09096,-0.18939 3.16812,-0.28695 0.94797,-0.0904 1.89595,-0.1809 2.87265,-0.27408 0.83007,-0.0776 1.66014,-0.15511 2.51536,-0.23502 1.89345,-0.10091 1.89345,-0.10091 2.88527,-1.28989 0.25421,-1.59742 0.44792,-3.20453 0.6167,-4.81323 0.11037,-1.03005 0.22073,-2.06011 0.33444,-3.12138 0.11667,-1.12888 0.23334,-2.25776 0.35355,-3.42085 0.18697,-1.75079 0.18697,-1.75079 0.37772,-3.53695 0.40169,-3.7646 0.79766,-7.52977 1.19259,-11.29509 0.51431,-4.88974 1.0321,-9.77909 1.55469,-14.66796 0.12776,-1.19818 0.25552,-2.39635 0.38715,-3.63083 0.92694,-8.53894 2.01019,-17.04677 3.27542,-25.54232 0.68047,-4.68557 1.25958,-9.22469 0.90774,-13.97139 -2.18498,-2.53191 -2.18498,-2.53191 -5,-4 -3.45821,0 -6.82228,0.39224 -10.25122,0.79102 z" fill="#ffffff"/></svg>`;
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

/** Dibuja la barra de cabecera (deep green, no negro genérico) con el
 * logo y el título. Reutilizada en la portada y en cada página de
 * continuación — un solo lugar para el look de la cabecera. */
function drawHeader(doc, logoImg, subtitle) {
  doc.setFillColor(...PDF_COLORS.pageBg);
  doc.rect(0, 0, 210, 297, "F");

  doc.setFillColor(...PDF_COLORS.headerBg);
  doc.rect(0, 0, 210, 24, "F");

  if (logoImg) doc.addImage(logoImg, "PNG", 10, 4, 15, 14);

  doc.setTextColor(...PDF_COLORS.white);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("QUANTIS", 30, 12);

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(210, 230, 223);
  doc.text(subtitle, 30, 18);

  doc.setFontSize(8);
  doc.setTextColor(...PDF_COLORS.white);
  doc.text(
    new Date().toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    195,
    12,
    { align: "right" },
  );
}

/** Pill de estado (Buena/Regular/Dificil semana) — reemplaza el texto
 * plano viejo por un badge real, mismo espíritu que los badges de la
 * app (.badge b-tp/bsl/bbe). */
function drawStatusPill(doc, text, x, yTop, bg, fg) {
  const w = doc.getTextWidth(text) + 6;
  doc.setFillColor(...bg);
  doc.roundedRect(x - w, yTop, w, 5.5, 2.75, 2.75, "F");
  doc.setTextColor(...fg);
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text(text, x - w / 2, yTop + 3.8, { align: "center" });
}

// [window] onclick="exportarReportePDF()"
export function exportarReportePDF() {
  const weeks = getWeeks();
  if (!weeks.length) {
    showToast(
      "error",
      "Sin datos para exportar",
      "Registra al menos un trade antes de generar el reporte.",
    );
    return;
  }

  logoToBase64((logoImg) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let y = 24;
    drawHeader(doc, logoImg, "Reporte semanal de trading");
    y = 34;

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

    // --- Tarjeta de resumen general: 4 columnas, label arriba /
    // valor grande abajo — más legible de un vistazo que el viejo
    // formato "Etiqueta: valor" en línea corrida.
    doc.setFillColor(...PDF_COLORS.cardBg);
    doc.roundedRect(15, y, 180, 30, 3, 3, "F");
    doc.setDrawColor(...PDF_COLORS.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(15, y, 180, 30, 3, 3, "S");

    doc.setTextColor(...PDF_COLORS.accent);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("RESUMEN GENERAL", 20, y + 8);

    const kpis = [
      ["Total trades", `${tot}`],
      ["Win rate", `${wr}%`],
      ["RR promedio", `${rrAvg}`],
      ["Plan respetado", `${planOk}%`],
    ];
    const kpiX = [20, 68, 116, 154];
    kpis.forEach(([label, value], i) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.textMuted);
      doc.text(label.toUpperCase(), kpiX[i], y + 17);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...PDF_COLORS.textPrimary);
      doc.text(value, kpiX[i], y + 25);
    });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...PDF_COLORS.green);
    doc.text(`${wins} TP`, 20, y + 29.5);
    doc.setTextColor(...PDF_COLORS.red);
    doc.text(`${sls} SL`, 40, y + 29.5);
    doc.setTextColor(...PDF_COLORS.yellow);
    doc.text(`${bes} BE`, 58, y + 29.5);

    y += 40;

    doc.setTextColor(...PDF_COLORS.accent);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("DETALLE POR SEMANA", 15, y);
    doc.setDrawColor(...PDF_COLORS.borderStrong);
    doc.setLineWidth(0.3);
    doc.line(15, y + 2, 195, y + 2);
    y += 9;

    weeks.slice(0, 8).forEach((ws) => {
      if (y > 250) {
        doc.addPage();
        drawHeader(doc, logoImg, "Reporte semanal de trading (continuacion)");
        y = 34;
      }

      const we = weekEnd(ws);
      const wt = trades.filter((t) => t.fecha >= ws && t.fecha <= we);
      const wj = Object.keys(journals)
        .filter((d) => d >= ws && d <= we)
        .map((d) => journals[d]);
      const wWins = wt.filter((t) => t.res === "TP").length;
      const wDec = wt.filter((t) => t.res === "TP" || t.res === "SL").length;
      const wWR = wDec ? Math.round((wWins / wDec) * 100) : 0;
      const wNetRR = wt.reduce((a, t) => a + TradeEngine.resolveRR(t), 0);
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

      const statusColor = isGood
        ? PDF_COLORS.green
        : isOk
          ? PDF_COLORS.yellow
          : PDF_COLORS.red;
      const statusBg = isGood
        ? PDF_COLORS.greenBg
        : isOk
          ? PDF_COLORS.yellowBg
          : PDF_COLORS.redBg;
      const statusLabel = isGood
        ? "Buena semana"
        : isOk
          ? "Semana regular"
          : "Semana dificil";

      const cardH = 36 + (aprendizajes.length ? 6 : 0);

      // Tarjeta base: blanco/gris muy suave, borde sutil, esquinas
      // redondeadas — nada de fondos pasteles llenando toda la
      // tarjeta (eso quedaba "ruidoso"); el estado se comunica con
      // la franja lateral + el pill, no con la tarjeta entera teñida.
      doc.setFillColor(...PDF_COLORS.cardBg);
      doc.roundedRect(15, y, 180, cardH, 2.5, 2.5, "F");
      doc.setDrawColor(...PDF_COLORS.border);
      doc.setLineWidth(0.25);
      doc.roundedRect(15, y, 180, cardH, 2.5, 2.5, "S");

      // Franja de acento a la izquierda (estado de la semana).
      doc.setFillColor(...statusColor);
      doc.roundedRect(15, y, 2.2, cardH, 1.1, 1.1, "F");

      doc.setTextColor(...PDF_COLORS.textPrimary);
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "bold");
      doc.text(
        `${isCurrent ? "* " : ""}${cleanPDF(fmtShort(ws))} -> ${cleanPDF(fmtShort(we))}`,
        21,
        y + 7,
      );

      drawStatusPill(doc, statusLabel, 193, y + 3.5, statusBg, statusColor);

      // Fila de métricas: label arriba (muted, uppercase) / valor
      // abajo (bold) — mismo patrón visual que la tarjeta de resumen
      // general, consistencia dentro del propio reporte.
      const metrics = [
        ["Trades", `${wt.length}`, PDF_COLORS.textPrimary],
        [
          "Win rate",
          `${wWR}%`,
          wWR >= 50 ? PDF_COLORS.green : PDF_COLORS.red,
        ],
        [
          "RR neto",
          `${wNetRR >= 0 ? "+" : ""}${wNetRR.toFixed(1)}R`,
          wNetRR >= 0 ? PDF_COLORS.green : PDF_COLORS.red,
        ],
        ["Plan OK", `${wPlan}%`, PDF_COLORS.textPrimary],
        ["Score", wScore !== null ? `${wScore}/10` : "—", PDF_COLORS.textPrimary],
      ];
      const metricX = [21, 60, 95, 133, 165];
      metrics.forEach(([label, value, color], i) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(...PDF_COLORS.textMuted);
        doc.text(label.toUpperCase(), metricX[i], y + 15);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(...color);
        doc.text(value, metricX[i], y + 21);
      });

      // Chips W/L/BE, alineados con el resto de la fila de métricas.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.green);
      doc.text(`${wWins}W`, 21, y + 27);
      doc.setTextColor(...PDF_COLORS.red);
      doc.text(`${wSL}L`, 33, y + 27);
      doc.setTextColor(...PDF_COLORS.yellow);
      doc.text(`${wBE}BE`, 45, y + 27);

      let innerY = y + 33;

      if (aprendizajes.length) {
        doc.setDrawColor(...PDF_COLORS.border);
        doc.setLineWidth(0.2);
        doc.line(21, innerY - 3, 189, innerY - 3);

        doc.setTextColor(...PDF_COLORS.accent);
        doc.setFontSize(7);
        doc.setFont("helvetica", "bold");
        doc.text("APRENDIZAJES", 21, innerY);
        innerY += 4.5;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF_COLORS.textSecondary);
        aprendizajes.slice(0, 2).forEach((apr) => {
          const lines = doc.splitTextToSize(cleanPDF(`- ${apr}`), 164);
          lines.forEach((line) => {
            if (innerY > 275) {
              doc.addPage();
              drawHeader(
                doc,
                logoImg,
                "Reporte semanal de trading (continuacion)",
              );
              innerY = 34;
            }
            doc.text(line, 23, innerY);
            innerY += 4.2;
          });
        });
      }

      y += cardH + 6;
    });

    // --- Pie de página: misma barra oscura de la cabecera, en todas
    // las páginas — consistencia visual de principio a fin.
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFillColor(...PDF_COLORS.headerBg);
      doc.rect(0, 285, 210, 12, "F");
      doc.setTextColor(...PDF_COLORS.white);
      doc.setFontSize(7.5);
      doc.setFont("helvetica", "normal");
      doc.text("QUANTIS - Generado automaticamente", 15, 292);
      doc.text(`Pagina ${i} de ${pageCount}`, 195, 292, { align: "right" });
    }

    doc.save(`quantis_reporte_${today()}.pdf`);
    showToast("success", "Reporte PDF generado", "");
  });
}
