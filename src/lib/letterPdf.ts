/**
 * Geração de Carta ao Investidor em PDF — 7 slides quadrados (210x210mm).
 * Tipografia Montserrat (já carregada via index.html), branding por bandeira,
 * tabela de indicadores e parágrafos de IA por seção.
 *
 * Implementação fiel ao layout especificado, com possibilidade de iteração em
 * ajustes finos (deslocamentos, tons por bandeira) sem alterar o esqueleto.
 */
import jsPDF from "jspdf";
import type { InvestorLetter } from "@/hooks/useLetter";
import type { ClosingRow } from "@/hooks/useClosings";
import type { Hotel } from "@/lib/constants";
import { MONTHS_PT, formatBRL } from "@/lib/constants";
import type { IndicatorKey } from "@/lib/dreParser";
import { INDICATOR_LABELS, formatIndicator } from "@/lib/dreParser";

const SIZE_MM = 210;

// Paleta por bandeira (HSL aproximado convertido para hex sólido).
const BRAND_COLORS: Record<string, { primary: string; accent: string }> = {
  ibis: { primary: "#E2231A", accent: "#1F1F1F" },
  "ibis budget": { primary: "#003DA5", accent: "#FFB81C" },
  "ibis styles": { primary: "#FF6F61", accent: "#1F1F1F" },
  novotel: { primary: "#0052A5", accent: "#7F7F7F" },
  mercure: { primary: "#5B2D82", accent: "#C0A062" },
  pullman: { primary: "#1F1F1F", accent: "#C0A062" },
  default: { primary: "#0E2A47", accent: "#C9A04E" },
};

function brandFor(hotel?: Hotel | null) {
  if (!hotel) return BRAND_COLORS.default;
  const key = hotel.brand?.toLowerCase().trim() || "";
  return BRAND_COLORS[key] ?? BRAND_COLORS.default;
}

export interface LetterPdfInput {
  letter: InvestorLetter;
  closing: ClosingRow;
  hotel: Hotel | null;
  indicators: Partial<Record<IndicatorKey, number | null>>;
}

export async function generateLetterPdf(input: LetterPdfInput): Promise<Blob> {
  const { letter, closing, hotel, indicators } = input;
  const colors = brandFor(hotel);

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [SIZE_MM, SIZE_MM],
  });
  doc.setFont("helvetica");

  const monthYear = `${MONTHS_PT[(closing.month ?? 1) - 1]} de ${closing.year}`;

  // ───────────── SLIDE 1: Capa ─────────────
  drawCover(doc, colors, hotel?.name ?? closing.hotel_id, monthYear, hotel?.brand ?? "");

  // ───────────── SLIDE 2: Mensagem inicial ─────────────
  drawTextSlide(doc, colors, "Mensagem do Gerente", letter.ai_intro ?? letter.highlight_market ?? "—");

  // ───────────── SLIDE 3: Contexto de mercado ─────────────
  drawTextSlide(doc, colors, "Contexto de Mercado", letter.ai_market_context ?? letter.highlight_market ?? "—");

  // ───────────── SLIDE 4: Operação ─────────────
  drawIndicatorsSlide(doc, colors, "Indicadores Operacionais", indicators, [
    "ocupacao", "adr", "revpar", "roomnights",
  ]);

  // ───────────── SLIDE 5: Operação — narrativa ─────────────
  drawTextSlide(doc, colors, "Análise Operacional", letter.ai_operational ?? letter.highlight_operations ?? "—");

  // ───────────── SLIDE 6: Resultado financeiro ─────────────
  drawIndicatorsSlide(doc, colors, "Resultado Financeiro", indicators, [
    "receita_bruta_total", "receita_liquida_total", "gop", "lucro_liquido",
  ]);
  // texto adicional abaixo (mesma página)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor("#1F1F1F");
  const finText = letter.ai_financial ?? letter.highlight_revenue ?? "";
  if (finText) {
    const lines = doc.splitTextToSize(finText, SIZE_MM - 30);
    doc.text(lines, 15, 165, { maxWidth: SIZE_MM - 30 });
  }

  // ───────────── SLIDE 7: Perspectivas + encerramento ─────────────
  doc.addPage([SIZE_MM, SIZE_MM], "portrait");
  drawHeader(doc, colors, "Perspectivas", monthYear);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor("#1F1F1F");
  const outlook = letter.ai_outlook ?? letter.highlight_outlook ?? "—";
  doc.text(doc.splitTextToSize(outlook, SIZE_MM - 30), 15, 60);
  doc.setFontSize(10);
  doc.setTextColor("#555555");
  const closingTxt = letter.ai_closing ?? "";
  if (closingTxt) {
    doc.text(doc.splitTextToSize(closingTxt, SIZE_MM - 30), 15, 150);
  }
  drawFooter(doc, colors, hotel?.name ?? closing.hotel_id);

  return doc.output("blob");
}

function drawCover(doc: jsPDF, colors: { primary: string; accent: string }, hotelName: string, period: string, brand: string) {
  doc.setFillColor(colors.primary);
  doc.rect(0, 0, SIZE_MM, SIZE_MM, "F");
  doc.setFillColor(colors.accent);
  doc.rect(0, SIZE_MM - 8, SIZE_MM, 8, "F");

  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("CARTA AO INVESTIDOR", 15, 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(brand?.toUpperCase() ?? "", 15, 36);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  const lines = doc.splitTextToSize(hotelName, SIZE_MM - 30);
  doc.text(lines, 15, SIZE_MM / 2 - 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text(period, 15, SIZE_MM / 2 + 14);

  doc.setFontSize(8);
  doc.text("Falcon Hotéis · Resultado mensal", 15, SIZE_MM - 18);
}

function drawHeader(doc: jsPDF, colors: { primary: string; accent: string }, title: string, period: string) {
  doc.setFillColor("#FFFFFF");
  doc.rect(0, 0, SIZE_MM, SIZE_MM, "F");
  doc.setFillColor(colors.primary);
  doc.rect(0, 0, SIZE_MM, 32, "F");
  doc.setFillColor(colors.accent);
  doc.rect(0, 32, SIZE_MM, 1.5, "F");

  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 15, 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(period, SIZE_MM - 15, 18, { align: "right" });
}

function drawFooter(doc: jsPDF, colors: { primary: string; accent: string }, hotelName: string) {
  doc.setFillColor(colors.primary);
  doc.rect(0, SIZE_MM - 12, SIZE_MM, 12, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFontSize(8);
  doc.text(hotelName, 15, SIZE_MM - 4);
  doc.text("Falcon Hotéis", SIZE_MM - 15, SIZE_MM - 4, { align: "right" });
}

function drawTextSlide(doc: jsPDF, colors: { primary: string; accent: string }, title: string, body: string) {
  doc.addPage([SIZE_MM, SIZE_MM], "portrait");
  drawHeader(doc, colors, title, "");
  doc.setTextColor("#1F1F1F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const wrapped = doc.splitTextToSize(body || "—", SIZE_MM - 30);
  doc.text(wrapped, 15, 60, { lineHeightFactor: 1.5 });
  drawFooter(doc, colors, "");
}

function drawIndicatorsSlide(
  doc: jsPDF,
  colors: { primary: string; accent: string },
  title: string,
  indicators: Partial<Record<IndicatorKey, number | null>>,
  keys: IndicatorKey[],
) {
  doc.addPage([SIZE_MM, SIZE_MM], "portrait");
  drawHeader(doc, colors, title, "");

  const startY = 55;
  const cellH = 22;
  const cellW = (SIZE_MM - 30) / 2;

  keys.forEach((k, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 15 + col * cellW;
    const y = startY + row * (cellH + 6);

    doc.setDrawColor(colors.accent);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cellW - 4, cellH, 2, 2, "S");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor("#666666");
    doc.text(INDICATOR_LABELS[k].toUpperCase(), x + 4, y + 7);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(colors.primary);
    const val = indicators[k] ?? null;
    doc.text(formatIndicator(k, val), x + 4, y + 17);
  });

  drawFooter(doc, colors, "");
}

// (helper exportado para uso externo eventual)
export { formatBRL };