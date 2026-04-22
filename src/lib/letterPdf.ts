/**
 * Gera a Carta ao Investidor em PDF — formato quadrado 210x210mm, 7 páginas,
 * fielmente baseada no modelo Falcon Hotéis:
 *   1. Capa: foto do hotel + título + período + logos
 *   2. Indicadores 1: gráfico Ocupação (barras) + ADR (linha)
 *   3. Indicadores 2: Receita Bruta (linha) + cards Fundo Reserva / RPS
 *   4. Comentários do mês (texto IA)
 *   5. Destaques (grid 2 colunas com fotos)
 *   6. Demonstrativo de Resultados (DRE)
 *   7. Encerramento: foto + Obrigado + contatos + logos
 *
 * Os gráficos são desenhados em <canvas> 2D nativo e embedados como PNG
 * (mais leve e preciso que html2canvas para o formato fixo 210x210mm).
 */
import jsPDF from "jspdf";
import type { InvestorLetter, LetterHighlight } from "@/hooks/useLetter";
import type { ClosingRow } from "@/hooks/useClosings";
import type { Hotel } from "@/lib/constants";
import { MONTHS_PT } from "@/lib/constants";
import type { IndicatorKey } from "@/lib/dreParser";
import type { LetterHistory, MonthDatum } from "@/lib/letterHistory";
import { fetchLetterHistory, fetchDreLines } from "@/lib/letterHistory";
import { getHighlightPhotoUrl } from "@/hooks/useLetter";

const SIZE = 210; // mm
const NAVY = "#0E2A47";
const GOLD = "#C9A04E";
const TEXT = "#1F1F1F";
const MUTED = "#6B7280";
const BORDER = "#D1D5DB";

export interface LetterPdfInput {
  letter: InvestorLetter;
  closing: ClosingRow;
  hotel: Hotel | null;
  hotelCoverUrl: string | null;
  brandLogoUrl: string | null;
  falconLogoUrl: string | null;
  highlights: LetterHighlight[];
  indicators: Partial<Record<IndicatorKey, number | null>>;
}

/* ───────────────── Utilidades de carregamento ───────────────── */

async function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Converte HTMLImageElement em DataURL.
 * `format = "png"` preserva canal alfa (logos PNG transparentes).
 * `format = "jpeg"` é menor — usado apenas para fotos opacas (capa/destaques).
 */
function imageToDataUrl(
  img: HTMLImageElement,
  maxWidth = 1600,
  format: "png" | "jpeg" = "jpeg",
): string {
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d")!;
  // Para PNG, NÃO pintar fundo branco/preto: deixar transparente.
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return format === "png"
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", 0.85);
}

function fmtBRL0(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return "R$ " + Math.round(v).toLocaleString("pt-BR");
}
function fmtBRL2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return "R$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const pct = v <= 1 ? v * 100 : v;
  return `${Math.round(pct)}%`;
}
function fmtIntK(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("pt-BR");
}

/* ───────────────── Helpers de página ───────────────── */

function addPage(doc: jsPDF) {
  doc.addPage([SIZE, SIZE], "portrait");
}

function drawPageHeader(
  doc: jsPDF,
  title: string,
  falconLogo: string | null,
  brandLogo: string | null,
) {
  // logos esquerda/direita — PNG preserva transparência
  if (falconLogo) doc.addImage(falconLogo, "PNG", 14, 10, 28, 14, undefined, "FAST");
  if (brandLogo) doc.addImage(brandLogo, "PNG", SIZE - 14 - 28, 10, 28, 14, undefined, "FAST");
  // título central
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(NAVY);
  const titleUpper = title.toUpperCase();
  doc.text(titleUpper, SIZE / 2, 18, { align: "center", charSpace: 1.2 });
  // sublinhado dourado — mesma largura do título (incluindo charSpace ≈ 1.2pt extra por char)
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1.2);
  const charSpaceMm = (1.2 / 2.83465) * Math.max(0, titleUpper.length - 1);
  const tw = doc.getTextWidth(titleUpper) + charSpaceMm;
  doc.line(SIZE / 2 - tw / 2, 22, SIZE / 2 + tw / 2, 22);
}

/* ───────────────── Gráficos via Canvas 2D ───────────────── */

interface ChartSize { w: number; h: number; }

function makeCanvas(widthMm: number, heightMm: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; px: number } {
  const px = 4; // px por mm
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(widthMm * px);
  canvas.height = Math.round(heightMm * px);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx, px };
}

function drawBarChart(
  title: string,
  current: MonthDatum[],
  previous: MonthDatum[],
  field: keyof MonthDatum,
  formatter: (v: number) => string,
  size: ChartSize,
): string {
  const { canvas, ctx, px } = makeCanvas(size.w, size.h);
  // título
  ctx.fillStyle = TEXT;
  ctx.font = `bold ${5 * px}px Helvetica, Arial`;
  ctx.textAlign = "center";
  ctx.fillText(title, canvas.width / 2, 8 * px);

  // área do gráfico
  const padL = 6 * px, padR = 6 * px, padT = 14 * px, padB = 14 * px;
  const w = canvas.width - padL - padR;
  const h = canvas.height - padT - padB;
  const x0 = padL, y0 = padT;

  const all: number[] = [];
  current.forEach((d) => { const v = d[field] as number | null; if (v != null) all.push(field === "ocupacao" ? (v <= 1 ? v * 100 : v) : v); });
  previous.forEach((d) => { const v = d[field] as number | null; if (v != null) all.push(field === "ocupacao" ? (v <= 1 ? v * 100 : v) : v); });
  const max = all.length > 0 ? Math.max(...all) * 1.25 : 1;

  // baseline
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(x0 + w, y0 + h);
  ctx.stroke();

  const n = current.length;
  const groupW = w / n;
  const barW = groupW * 0.32;
  const gap = groupW * 0.06;

  ctx.font = `${3 * px}px Helvetica, Arial`;
  ctx.textAlign = "center";

  for (let i = 0; i < n; i++) {
    const cx = x0 + i * groupW + groupW / 2;
    const cv = current[i][field] as number | null;
    const pv = previous[i][field] as number | null;
    const cVal = cv != null ? (field === "ocupacao" ? (cv <= 1 ? cv * 100 : cv) : cv) : null;
    const pVal = pv != null ? (field === "ocupacao" ? (pv <= 1 ? pv * 100 : pv) : pv) : null;

    if (cVal != null) {
      const bh = (cVal / max) * h;
      ctx.fillStyle = NAVY;
      ctx.fillRect(cx - barW - gap / 2, y0 + h - bh, barW, bh);
      // label valor
      ctx.fillStyle = NAVY;
      ctx.font = `bold ${3.2 * px}px Helvetica, Arial`;
      ctx.fillText(formatter(cVal), cx - barW / 2 - gap / 2, y0 + h - bh - 1.5 * px);
    }
    if (pVal != null) {
      const bh = (pVal / max) * h;
      ctx.fillStyle = "#9CA3AF";
      ctx.fillRect(cx + gap / 2, y0 + h - bh, barW, bh);
      ctx.fillStyle = "#6B7280";
      ctx.font = `${3 * px}px Helvetica, Arial`;
      ctx.fillText(formatter(pVal), cx + barW / 2 + gap / 2, y0 + h - bh - 1.5 * px);
    }
    // mês
    ctx.fillStyle = TEXT;
    ctx.font = `${3 * px}px Helvetica, Arial`;
    ctx.fillText(MONTHS_PT[current[i].month - 1], cx, y0 + h + 4 * px);
  }

  // legenda
  const ly = canvas.height - 4 * px;
  ctx.fillStyle = NAVY;
  ctx.fillRect(canvas.width / 2 - 22 * px, ly - 2.5 * px, 3 * px, 3 * px);
  ctx.fillStyle = TEXT;
  ctx.textAlign = "left";
  ctx.font = `${3 * px}px Helvetica, Arial`;
  ctx.fillText("Realizado", canvas.width / 2 - 18 * px, ly);
  ctx.fillStyle = "#9CA3AF";
  ctx.fillRect(canvas.width / 2 + 2 * px, ly - 2.5 * px, 3 * px, 3 * px);
  ctx.fillStyle = TEXT;
  ctx.fillText("Ano anterior", canvas.width / 2 + 6 * px, ly);

  return canvas.toDataURL("image/png");
}

function drawLineChart(
  title: string,
  current: MonthDatum[],
  previous: MonthDatum[],
  field: keyof MonthDatum,
  formatter: (v: number) => string,
  size: ChartSize,
): string {
  const { canvas, ctx, px } = makeCanvas(size.w, size.h);
  ctx.fillStyle = TEXT;
  ctx.font = `bold ${5 * px}px Helvetica, Arial`;
  ctx.textAlign = "center";
  ctx.fillText(title, canvas.width / 2, 8 * px);

  const padL = 8 * px, padR = 8 * px, padT = 16 * px, padB = 14 * px;
  const w = canvas.width - padL - padR;
  const h = canvas.height - padT - padB;
  const x0 = padL, y0 = padT;

  const all: number[] = [];
  current.forEach((d) => { const v = d[field] as number | null; if (v != null) all.push(v); });
  previous.forEach((d) => { const v = d[field] as number | null; if (v != null) all.push(v); });
  const max = all.length > 0 ? Math.max(...all) * 1.15 : 1;
  const min = all.length > 0 ? Math.min(...all) * 0.85 : 0;
  const span = Math.max(1, max - min);

  const n = current.length;
  const stepX = w / (n - 1);
  const yFor = (v: number) => y0 + h - ((v - min) / span) * h;

  // baseline X
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0 + h); ctx.lineTo(x0 + w, y0 + h); ctx.stroke();

  // série anterior (cinza)
  ctx.strokeStyle = "#9CA3AF";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  let started = false;
  previous.forEach((d, i) => {
    const v = d[field] as number | null;
    if (v == null) return;
    const x = x0 + i * stepX;
    const y = yFor(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // série atual (navy mais grossa)
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  started = false;
  current.forEach((d, i) => {
    const v = d[field] as number | null;
    if (v == null) return;
    const x = x0 + i * stepX;
    const y = yFor(v);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // pontos + valores
  ctx.font = `bold ${3.2 * px}px Helvetica, Arial`;
  ctx.textAlign = "center";
  current.forEach((d, i) => {
    const v = d[field] as number | null;
    if (v == null) return;
    const x = x0 + i * stepX, y = yFor(v);
    ctx.fillStyle = NAVY;
    ctx.beginPath(); ctx.arc(x, y, 1.6 * px, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = NAVY;
    ctx.fillText(formatter(v), x, y - 3 * px);
  });
  ctx.font = `${3 * px}px Helvetica, Arial`;
  previous.forEach((d, i) => {
    const v = d[field] as number | null;
    if (v == null) return;
    const x = x0 + i * stepX, y = yFor(v);
    ctx.fillStyle = "#6B7280";
    ctx.fillText(formatter(v), x, y + 5 * px);
  });

  // labels mês
  ctx.fillStyle = TEXT;
  ctx.font = `${3 * px}px Helvetica, Arial`;
  current.forEach((d, i) => {
    const x = x0 + i * stepX;
    ctx.fillText(MONTHS_PT[d.month - 1], x, y0 + h + 4 * px);
  });

  // legenda
  const ly = canvas.height - 4 * px;
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(canvas.width / 2 - 22 * px, ly - 1.2 * px); ctx.lineTo(canvas.width / 2 - 17 * px, ly - 1.2 * px); ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.font = `${3 * px}px Helvetica, Arial`;
  ctx.textAlign = "left";
  ctx.fillText("Realizado", canvas.width / 2 - 16 * px, ly);
  ctx.strokeStyle = "#9CA3AF";
  ctx.beginPath(); ctx.moveTo(canvas.width / 2 + 2 * px, ly - 1.2 * px); ctx.lineTo(canvas.width / 2 + 7 * px, ly - 1.2 * px); ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.fillText("Ano anterior", canvas.width / 2 + 8 * px, ly);

  return canvas.toDataURL("image/png");
}

/* ───────────────── Gerador principal ───────────────── */

export async function generateLetterPdf(input: LetterPdfInput): Promise<Blob> {
  const {
    letter, closing, hotel, hotelCoverUrl, brandLogoUrl, falconLogoUrl, highlights,
  } = input;

  // resolve URLs assinadas das fotos dos destaques (se vierem como path)
  const highlightPhotoUrls = await Promise.all(
    highlights.map(async (h) => h.photo_url ? (await getHighlightPhotoUrl(h.photo_url)) : null),
  );

  // Carrega imagens
  const [coverImg, brandLogoImg, falconLogoImg, ...highlightImgs] = await Promise.all([
    loadImage(hotelCoverUrl),
    loadImage(brandLogoUrl),
    loadImage(falconLogoUrl),
    ...highlightPhotoUrls.map((u) => loadImage(u)),
  ]);

  const coverData = coverImg ? imageToDataUrl(coverImg, 1800, "jpeg") : null;
  // Logos como PNG (preserva transparência — sem fundo preto/branco)
  const brandData = brandLogoImg ? imageToDataUrl(brandLogoImg, 800, "png") : null;
  const falconData = falconLogoImg ? imageToDataUrl(falconLogoImg, 800, "png") : null;
  const hlData = highlightImgs.map((img) => img ? imageToDataUrl(img, 1200, "jpeg") : null);

  // Histórico de 6 meses para os gráficos
  const history: LetterHistory = await fetchLetterHistory(closing.hotel_id, closing.year, closing.month);

  // Linhas DRE para a tabela
  const dreLines = await fetchDreLines(closing.id);

  const monthYear = `${MONTHS_PT[closing.month - 1]} ${closing.year}`;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [SIZE, SIZE] });

  /* ───── 1. CAPA ───── */
  if (coverData) {
    doc.addImage(coverData, "JPEG", 0, 0, SIZE, 138, undefined, "FAST");
  } else {
    doc.setFillColor(NAVY); doc.rect(0, 0, SIZE, 138, "F");
  }
  // bloco branco inferior
  doc.setFillColor("#FFFFFF"); doc.rect(0, 138, SIZE, SIZE - 138, "F");
  // Faixa decorativa (tracinhos azul/cinza alternados) entre foto e título
  drawDecorativeStripe(doc, 16, 144, SIZE - 32);
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Carta ao investidor", 16, 160);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(MUTED);
  doc.text(monthYear, 16, 168);
  // logos rodapé direita — PNG (transparente)
  if (brandData) doc.addImage(brandData, "PNG", SIZE - 78, 178, 28, 22, undefined, "FAST");
  if (falconData) doc.addImage(falconData, "PNG", SIZE - 44, 178, 30, 22, undefined, "FAST");

  /* ───── 2. INDICADORES — Ocupação + ADR ───── */
  addPage(doc);
  drawPageHeader(doc, "Indicadores do mês", falconData, brandData);

  const card1Y = 30, cardH = 78, cardW = SIZE - 24;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.roundedRect(12, card1Y, cardW, cardH, 2, 2, "S");
  const occChart = drawBarChart("Taxa de Ocupação", history.current, history.previous, "ocupacao", (v) => `${Math.round(v)}%`, { w: cardW - 6, h: cardH - 6 });
  doc.addImage(occChart, "PNG", 15, card1Y + 3, cardW - 6, cardH - 6);

  const card2Y = card1Y + cardH + 6;
  doc.roundedRect(12, card2Y, cardW, cardH, 2, 2, "S");
  const adrChart = drawLineChart("Diária Média", history.current, history.previous, "adr", (v) => `R$ ${Math.round(v)}`, { w: cardW - 6, h: cardH - 6 });
  doc.addImage(adrChart, "PNG", 15, card2Y + 3, cardW - 6, cardH - 6);

  /* ───── 3. INDICADORES — Receita Bruta + Cards ───── */
  addPage(doc);
  drawPageHeader(doc, "Indicadores do mês", falconData, brandData);

  const recH = 88;
  doc.roundedRect(12, 30, cardW, recH, 2, 2, "S");
  const recChart = drawLineChart("Receita Total Bruta", history.current, history.previous, "receita_bruta_total", (v) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`, { w: cardW - 6, h: recH - 6 });
  doc.addImage(recChart, "PNG", 15, 33, cardW - 6, recH - 6);

  // dois cards lado a lado
  const cw = (SIZE - 30) / 2, ch = 64, cy = 30 + recH + 8;
  // Fundo de Reserva
  doc.roundedRect(12, cy, cw, ch, 2, 2, "S");
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(13);
  doc.text("Fundo de Reserva", 12 + cw / 2, cy + 14, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(fmtBRL0(letter.reserve_fund), 12 + cw / 2, cy + 32, { align: "center" });
  // ícone $ em círculo
  doc.setFillColor(NAVY);
  doc.circle(12 + cw / 2, cy + 50, 5, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFontSize(9);
  doc.text("$", 12 + cw / 2, cy + 51.5, { align: "center" });

  // RPS
  const rx = 12 + cw + 6;
  doc.roundedRect(rx, cy, cw, ch, 2, 2, "S");
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(13);
  doc.text("RPS", rx + cw / 2, cy + 14, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  const rpsTxt = letter.rps_score != null ? `${letter.rps_score}%` : "—";
  doc.text(rpsTxt, rx + cw / 2, cy + 32, { align: "center" });
  // estrela dourada (simples)
  doc.setFillColor(GOLD);
  drawStar(doc, rx + cw / 2, cy + 50, 4);

  /* ───── 4. COMENTÁRIOS DO MÊS ───── */
  addPage(doc);
  drawPageHeader(doc, "Comentários do mês", falconData, brandData);
  doc.setTextColor(TEXT);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const blocks: string[] = [];
  const push = (s?: string | null) => { if (s && s.trim()) blocks.push(s.trim()); };
  push(letter.ai_intro);
  push(letter.ai_operational);
  push(letter.ai_financial);
  push(letter.ai_outlook);
  const body = blocks.join("\n\n") || "—";
  const lines = doc.splitTextToSize(body, SIZE - 32);
  doc.text(lines, 16, 38, { lineHeightFactor: 1.55, align: "justify", maxWidth: SIZE - 32 });

  /* ───── 5. DESTAQUES ───── */
  addPage(doc);
  drawPageHeader(doc, "Destaques do mês", falconData, brandData);
  const colW = (SIZE - 30) / 2;
  const rowH = 78;
  const startY = 32;
  highlights.slice(0, 6).forEach((h, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 12 + col * (colW + 6);
    const y = startY + row * (rowH + 6);
    // título
    doc.setDrawColor(BORDER);
    doc.setLineWidth(0.4);
    doc.roundedRect(x, y, colW, 9, 1.5, 1.5, "S");
    doc.setTextColor(TEXT);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(h.title, x + colW / 2, y + 6, { align: "center" });
    // foto
    const img = hlData[i];
    if (img) {
      doc.addImage(img, "JPEG", x, y + 11, colW, rowH - 13, undefined, "FAST");
    } else {
      doc.setFillColor("#F3F4F6");
      doc.rect(x, y + 11, colW, rowH - 13, "F");
      doc.setTextColor(MUTED);
      doc.setFontSize(8);
      doc.text("(sem foto)", x + colW / 2, y + 11 + (rowH - 13) / 2, { align: "center" });
    }
  });

  /* ───── 6. DEMONSTRATIVO DE RESULTADOS ───── */
  addPage(doc);
  drawPageHeader(doc, "Demonstrativo de Resultados", falconData, brandData);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  doc.text("RESUMO", SIZE / 2, 28, { align: "center" });

  drawDreTable(doc, dreLines, MONTHS_PT[closing.month - 1]);

  /* ───── 7. ENCERRAMENTO ───── */
  addPage(doc);
  if (coverData) {
    doc.addImage(coverData, "JPEG", 0, 0, SIZE, 138, undefined, "FAST");
  } else {
    doc.setFillColor(NAVY); doc.rect(0, 0, SIZE, 138, "F");
  }
  doc.setFillColor("#FFFFFF"); doc.rect(0, 138, SIZE, SIZE - 138, "F");
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Obrigado!", 16, 156);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(TEXT);
  doc.text("www.falconhoteis.com.br", 16, 168);
  doc.text("(31) 3500-5431", 16, 174);
  doc.text("R. Bernardo Guimarães, 245, B.", 16, 180);
  doc.text("Funcionários, Belo Horizonte - MG", 16, 186);
  if (brandData) doc.addImage(brandData, "PNG", SIZE - 78, 178, 28, 22, undefined, "FAST");
  if (falconData) doc.addImage(falconData, "PNG", SIZE - 44, 178, 30, 22, undefined, "FAST");
  doc.setFontSize(7);
  doc.setTextColor(MUTED);
  doc.text(`v${(letter.pdf_version ?? 0) + 1}`, SIZE - 10, SIZE - 4, { align: "right" });

  return doc.output("blob");
}

/* ───────────────── DRE Table ───────────────── */

/**
 * DRE resumida: mostra somente os totais por categoria (Receita Bruta,
 * Deduções, Receita Líquida, Despesas Fixas, Despesas Variáveis, GOP/Resultado,
 * EBITDA, Lucro Líquido) e a Distribuição por UH em destaque.
 * Os matchers buscam dentro das linhas extraídas da DRE pelo parser; se o
 * rótulo equivalente não existir naquele template, a linha é omitida.
 */
function drawDreTable(
  doc: jsPDF,
  lines: { label: string; value: number | null }[],
  monthLabel: string,
) {
  type Group = { label: string; rx: RegExp[]; emphasis?: boolean };
  const groups: Group[] = [
    { label: "Receita Bruta Total", rx: [/^receita\s+bruta\s+total/i, /^total\s+das?\s+receitas?\s+brutas?/i] },
    { label: "(–) Deduções", rx: [/^\(?\-?\)?\s*dedu[çc][õo]es/i, /^total\s+de\s+dedu/i] },
    { label: "(=) Receita Líquida", rx: [/^\(?=\)?\s*receita\s+l[íi]quida/i, /^receita\s+l[íi]quida\s+total/i] },
    { label: "(–) Despesas Fixas", rx: [/^\(?\-?\)?\s*despesas?\s+fixas?\s+(totais?|do\s+m[êe]s|operacionais)?/i, /^total\s+de\s+despesas?\s+fixas?/i] },
    { label: "(–) Despesas Variáveis", rx: [/^\(?\-?\)?\s*despesas?\s+vari[áa]veis?\s+(totais?|do\s+m[êe]s|operacionais)?/i, /^total\s+de\s+despesas?\s+vari[áa]veis?/i] },
    { label: "(=) GOP / Resultado Operacional", rx: [/^\(?=\)?\s*resultado\s+operacional\s+bruto/i, /\bgop\b/i], emphasis: true },
    { label: "EBITDA", rx: [/ebitda/i] },
    { label: "(=) Lucro Líquido", rx: [/^\(?=\)?\s*lucro\s+l[íi]quido/i, /^resultado\s+l[íi]quido/i], emphasis: true },
    { label: "Distribuição por UH", rx: [/distribui[çc][ãa]o\s+por\s+uh/i, /distribui[çc][ãa]o\s+\/\s*uh/i, /resultado\s+por\s+uh/i], emphasis: true },
  ];

  const findValue = (rxs: RegExp[]): number | null => {
    for (const l of lines) {
      const lbl = l.label.replace(/^\[\w+\]\s*/, "").trim();
      if (rxs.some((rx) => rx.test(lbl))) return l.value;
    }
    return null;
  };

  const x0 = 12, x1 = SIZE - 12;
  let y = 38;
  // header navy
  doc.setFillColor(NAVY);
  doc.rect(x0, y, x1 - x0, 8, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("DRE — RESUMO", x0 + 4, y + 5.3);
  doc.text(monthLabel, x1 - 4, y + 5.3, { align: "right" });
  y += 8;

  doc.setTextColor(TEXT);
  for (const g of groups) {
    const v = findValue(g.rx);
    const rowH = g.emphasis ? 9 : 7.5;
    if (g.emphasis) {
      doc.setFillColor("#F4F1EA"); // bege suave para destaque
      doc.rect(x0, y, x1 - x0, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(NAVY);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(TEXT);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.2);
      doc.line(x0, y + rowH, x1, y + rowH);
    }
    doc.text(g.label, x0 + 4, y + rowH - 2.5);
    const valStr =
      v == null
        ? "—"
        : v < 0
          ? `(${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })})`
          : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    doc.text(valStr, x1 - 4, y + rowH - 2.5, { align: "right" });
    y += rowH;
  }
}

function drawStar(doc: jsPDF, cx: number, cy: number, r: number) {
  const points: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (-Math.PI / 2) + i * (Math.PI / 5);
    const rad = i % 2 === 0 ? r : r / 2.4;
    points.push([cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]);
  }
  // jsPDF não tem polygon convexo simples — usa lines
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyDoc = doc as any;
  if (anyDoc.lines) {
    const linesArr = points.slice(1).concat([points[0]]).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    anyDoc.lines(linesArr, points[0][0], points[0][1], [1, 1], "F", true);
  }
}

/**
 * Faixa decorativa de tracinhos curtos alternando azul-marinho e cinza,
 * usada na capa entre a foto do hotel e o título "Carta ao investidor".
 */
function drawDecorativeStripe(doc: jsPDF, x: number, y: number, width: number) {
  const dashLen = 4;
  const gap = 2;
  const total = dashLen + gap;
  const count = Math.floor(width / total);
  doc.setLineWidth(1.4);
  for (let i = 0; i < count; i++) {
    const sx = x + i * total;
    doc.setDrawColor(i % 2 === 0 ? NAVY : "#9CA3AF");
    doc.line(sx, y, sx + dashLen, y);
  }
}

// utilitários auxiliares mantidos para compatibilidade com chamadores antigos
export { fmtBRL0, fmtBRL2, fmtPct, fmtIntK };
