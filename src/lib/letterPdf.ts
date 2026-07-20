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
import { getHighlightPhotoDataUrl } from "@/hooks/useLetter";

const SIZE = 210; // mm
const NAVY = "#0E2A47";
const GOLD = "#C9A04E";
const TEXT = "#1F1F1F";
const MUTED = "#6B7280";
const BORDER = "#D1D5DB";

/**
 * Extrai o nome da cidade a partir do nome do hotel, removendo a marca conhecida
 * do prefixo. Ex.: "Ibis budget Itaperuna" → "Itaperuna",
 * "Mercure Macaé" → "Macaé", "Manhattan Porto Alegre" → "Porto Alegre".
 */
function extractCityFromHotel(hotel: Hotel | null): string {
  if (!hotel?.name) return "";
  const name = hotel.name.trim();
  const brandPrefixes = [
    "ibis budget", "ibis styles", "ibis",
    "mercure", "manhattan", "pousada",
    "novotel", "pullman", "sofitel", "swissôtel", "swissotel",
  ];
  const lower = name.toLowerCase();
  for (const p of brandPrefixes) {
    if (lower.startsWith(p + " ")) {
      return name.slice(p.length).trim();
    }
  }
  // Fallback: assume primeira palavra é marca
  const parts = name.split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

export interface LetterPdfInput {
  letter: InvestorLetter;
  closing: ClosingRow;
  hotel: Hotel | null;
  hotelCoverUrl: string | null;
  brandLogoUrl: string | null;
  falconLogoUrl: string | null;
  highlights: LetterHighlight[];
  indicators: Partial<Record<IndicatorKey, number | null>>;
  /** Indicadores do mesmo mês do ano anterior (lidos da aba "ANO ANTERIOR"). */
  previousIndicators?: Partial<Record<IndicatorKey, number | null>>;
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
 * Carrega imagem a partir de uma DataURL (sem CORS).
 * Usado para fotos baixadas via Supabase SDK como blob.
 */
async function loadImageFromDataUrl(dataUrl: string | null): Promise<HTMLImageElement | null> {
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
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

/**
 * Logo com dimensões intrínsecas (px) — usado para preservar a proporção
 * ao desenhar dentro de uma "caixa" no PDF (object-fit: contain).
 */
interface LogoAsset {
  data: string;
  /** Largura intrínseca em pixels (após reescala em `imageToDataUrl`). */
  w: number;
  /** Altura intrínseca em pixels. */
  h: number;
}

function logoFromImage(img: HTMLImageElement | null): LogoAsset | null {
  if (!img) return null;
  const data = imageToDataUrl(img, 800, "png");
  return { data, w: img.naturalWidth, h: img.naturalHeight };
}

/** Desenha foto sem distorcer nem cortar: object-fit contain, centralizada. */
function drawContainedPhoto(doc: jsPDF, img: HTMLImageElement, boxX: number, boxY: number, boxW: number, boxH: number) {
  const ratio = img.naturalWidth / img.naturalHeight;
  const boxRatio = boxW / boxH;
  const drawW = ratio >= boxRatio ? boxW : boxH * ratio;
  const drawH = ratio >= boxRatio ? boxW / ratio : boxH;
  const x = boxX + (boxW - drawW) / 2;
  const y = boxY + (boxH - drawH) / 2;

  doc.setFillColor("#FFFFFF");
  doc.rect(boxX, boxY, boxW, boxH, "F");
  doc.addImage(imageToDataUrl(img, 1200, "jpeg"), "JPEG", x, y, drawW, drawH, undefined, "FAST");
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.25);
  doc.rect(boxX, boxY, boxW, boxH, "S");
}

/**
 * Extrai apenas o ÍCONE DO PÁSSARO da logo Falcon institucional.
 *
 * A logo padrão tem o pássaro na parte superior e o wordmark "FALCON HOTÉIS"
 * na metade inferior, sempre com fundo transparente ou branco. Para isolar o
 * pássaro, varremos os pixels não-transparentes APENAS no topo da imagem
 * (até ~45% da altura) e calculamos a bounding box. Em seguida recortamos.
 *
 * Retorna um PNG com o pássaro normalizado para tom cinza muito claro
 * (cinza neutro), pronto para ser usado como marca d'água.
 */
function extractBirdWatermark(img: HTMLImageElement | null): LogoAsset | null {
  if (!img) return null;
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  if (!W || !H) return null;

  // Renderiza em canvas para poder ler pixels.
  const src = document.createElement("canvas");
  src.width = W;
  src.height = H;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0);

  let data: ImageData;
  try {
    data = sctx.getImageData(0, 0, W, H);
  } catch {
    // Cross-origin sem CORS — devolve a logo inteira como fallback (melhor que nada).
    return logoFromImage(img);
  }

  // Considera "tinta" (parte do desenho) qualquer pixel com alfa > 32 que
  // não seja praticamente branco. Funciona para PNG transparente ou JPEG/PNG
  // com fundo branco.
  const isInk = (r: number, g: number, b: number, a: number): boolean => {
    if (a < 32) return false;
    const lum = (r + g + b) / 3;
    return lum < 230;
  };

  // 1) Encontra a bbox do pássaro varrendo apenas o topo (até 50% da altura).
  const scanH = Math.floor(H * 0.5);
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (isInk(data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Se não achou nada (logo só com texto?), devolve a logo inteira.
  if (maxX < 0 || maxY < 0) return logoFromImage(img);

  // pequena margem (2% de cada lado) para não cortar
  const pad = Math.round(Math.max(W, H) * 0.02);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  // 2) Renderiza o recorte e neutraliza a cor para um cinza médio
  //    (a opacidade final é controlada pelo GState ao desenhar no PDF).
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.drawImage(img, minX, minY, cw, ch, 0, 0, cw, ch);

  const cropped = octx.getImageData(0, 0, cw, ch);
  for (let i = 0; i < cropped.data.length; i += 4) {
    const a = cropped.data[i + 3];
    if (a < 32) {
      // pixel praticamente vazio — força transparente
      cropped.data[i + 3] = 0;
      continue;
    }
    const r = cropped.data[i];
    const g = cropped.data[i + 1];
    const b = cropped.data[i + 2];
    const lum = (r + g + b) / 3;
    if (lum > 230) {
      // fundo branco/quase-branco — torna transparente
      cropped.data[i + 3] = 0;
    } else {
      // tinta do pássaro — pinta de cinza neutro escuro,
      // a opacidade visual final virá do GState no PDF.
      cropped.data[i] = 80;
      cropped.data[i + 1] = 80;
      cropped.data[i + 2] = 80;
      cropped.data[i + 3] = 255;
    }
  }
  octx.putImageData(cropped, 0, 0);

  return { data: out.toDataURL("image/png"), w: cw, h: ch };
}

/**
 * Desenha a marca d'água do pássaro Falcon centralizada em uma área
 * da página, atrás do conteúdo, em opacidade muito baixa (8%).
 *
 * IMPORTANTE: chamar ANTES de desenhar qualquer conteúdo da página
 * (logo após `addPage` + `drawPageHeader`) para que fique no fundo.
 */
function drawBirdWatermark(
  doc: jsPDF,
  bird: LogoAsset | null,
  area: { x: number; y: number; w: number; h: number },
  heightFraction = 0.55,
) {
  if (!bird) return;
  // Altura alvo = fração da altura da área disponível
  const targetH = area.h * heightFraction;
  const ratio = bird.w / bird.h;
  const targetW = targetH * ratio;
  // Se ficar mais largo que a área, limita pela largura (mantém aspecto)
  const w = Math.min(targetW, area.w * 0.85);
  const h = w / ratio;
  const x = area.x + (area.w - w) / 2;
  const y = area.y + (area.h - h) / 2;

  const docAny = doc as unknown as { GState: (p: { opacity: number }) => unknown };
  doc.setGState(docAny.GState({ opacity: 0.08 }));
  doc.addImage(bird.data, "PNG", x, y, w, h, undefined, "FAST");
  // Restaura opacidade total para o conteúdo subsequente.
  doc.setGState(docAny.GState({ opacity: 1 }));
}

/**
 * Desenha uma imagem PNG dentro de uma caixa (boxX, boxY, boxW, boxH)
 * preservando a proporção original (object-fit: contain) e centralizando.
 * `align` controla o alinhamento horizontal quando há sobra de espaço.
 */
function drawContainedLogo(
  doc: jsPDF,
  logo: LogoAsset | null,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
  align: "left" | "right" | "center" = "center",
) {
  if (!logo) return;
  const ratio = logo.w / logo.h;
  const boxRatio = boxW / boxH;
  let drawW: number;
  let drawH: number;
  if (ratio >= boxRatio) {
    // mais larga que a caixa — limita pela largura
    drawW = boxW;
    drawH = boxW / ratio;
  } else {
    // mais alta — limita pela altura
    drawH = boxH;
    drawW = boxH * ratio;
  }
  const offY = boxY + (boxH - drawH) / 2;
  let offX: number;
  if (align === "left") offX = boxX;
  else if (align === "right") offX = boxX + boxW - drawW;
  else offX = boxX + (boxW - drawW) / 2;
  doc.addImage(logo.data, "PNG", offX, offY, drawW, drawH, undefined, "FAST");
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

function fmtChartValue(field: keyof MonthDatum, value: number): string {
  if (field === "receita_bruta_total") {
    if (Math.abs(value) >= 1_000_000) return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
    if (Math.abs(value) >= 1_000) return `R$ ${Math.round(value / 1_000).toLocaleString("pt-BR")} mil`;
  }
  return field === "adr" ? `R$ ${Math.round(value).toLocaleString("pt-BR")}` : String(value);
}

/* ───────────────── Helpers de página ───────────────── */

function addPage(doc: jsPDF) {
  doc.addPage([SIZE, SIZE], "portrait");
}

function drawPageHeader(
  doc: jsPDF,
  title: string,
  falconLogo: LogoAsset | null,
  brandLogo: LogoAsset | null,
) {
  // Cabeçalho ampliado (28mm) para acomodar logos sem distorção.
  // Caixas das logos: 34mm × 20mm — preservam aspect-ratio (contain).
  const boxW = 34;
  const boxH = 20;
  const boxY = 6;
  drawContainedLogo(doc, falconLogo, 12, boxY, boxW, boxH, "left");
  drawContainedLogo(doc, brandLogo, SIZE - 12 - boxW, boxY, boxW, boxH, "right");

  // título central — abaixado para 22mm (dentro da nova faixa de 28mm)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(NAVY);
  const titleUpper = title.toUpperCase();
  doc.text(titleUpper, SIZE / 2, 22, { align: "center" });
  // sublinhado dourado centralizado, exatamente da largura do título
  doc.setDrawColor(GOLD);
  doc.setLineWidth(1.2);
  const tw = doc.getTextWidth(titleUpper);
  doc.line(SIZE / 2 - tw / 2, 25.4, SIZE / 2 + tw / 2, 25.4);
}

/** Y inicial do conteúdo das páginas com cabeçalho (logos + título). */
const HEADER_CONTENT_Y = 34;

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

  // Fontes maiores para legibilidade
  ctx.font = `${3.4 * px}px Helvetica, Arial`;
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
      ctx.fillText(formatter(cVal), cx - barW / 2 - gap / 2, y0 + h - bh - 1.8 * px);
    }
    if (pVal != null) {
      const bh = (pVal / max) * h;
      ctx.fillStyle = "#9CA3AF";
      ctx.fillRect(cx + gap / 2, y0 + h - bh, barW, bh);
      ctx.fillStyle = "#6B7280";
      ctx.font = `${3 * px}px Helvetica, Arial`;
      ctx.fillText(formatter(pVal), cx + barW / 2 + gap / 2, y0 + h - bh - 1.8 * px);
    }
    // mês (3 letras para caber 12 colunas)
    ctx.fillStyle = TEXT;
    ctx.font = `bold ${3.4 * px}px Helvetica, Arial`;
    ctx.fillText(MONTHS_PT[current[i].month - 1].slice(0, 3), cx, y0 + h + 5 * px);
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

  // Sem eixo Y — padding lateral pequeno como no formato original.
  const padL = 6 * px, padR = 6 * px, padT = 19 * px, padB = 20 * px;
  const w = canvas.width - padL - padR;
  const h = canvas.height - padT - padB;
  const x0 = padL, y0 = padT;

  const all: number[] = [];
  current.forEach((d) => { const v = d[field] as number | null; if (v != null) all.push(v); });
  previous.forEach((d) => { const v = d[field] as number | null; if (v != null) all.push(v); });

  const rawMax = all.length ? Math.max(...all) : 1;
  const max = Math.max(1, rawMax) * 1.25;
  const min = 0;
  const span = Math.max(1, max - min);

  const n = current.length;
  const stepX = n > 1 ? w / (n - 1) : 0;
  const yFor = (v: number) => {
    const clamped = Math.min(Math.max(v, min), max);
    return y0 + h - ((clamped - min) / span) * h;
  };

  const labelFor = (v: number) => field === "receita_bruta_total" ? fmtChartValue(field, v) : formatter(v);

  // baseline simples — sem eixo Y nem gridlines (formato original).
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h);
  ctx.lineTo(x0 + w, y0 + h);
  ctx.stroke();

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

  // pontos
  current.forEach((d, i) => {
    const v = d[field] as number | null;
    if (v == null) return;
    const x = x0 + i * stepX, y = yFor(v);
    ctx.fillStyle = NAVY;
    ctx.beginPath(); ctx.arc(x, y, 1.6 * px, 0, Math.PI * 2); ctx.fill();
  });
  previous.forEach((d, i) => {
    const v = d[field] as number | null;
    if (v == null) return;
    const x = x0 + i * stepX, y = yFor(v);
    ctx.fillStyle = "#9CA3AF";
    ctx.beginPath(); ctx.arc(x, y, 1.25 * px, 0, Math.PI * 2); ctx.fill();
  });

  // Rótulo nos pontos, com anti-colisão. Quando Realizado e Ano anterior são
  // iguais ou visualmente muito próximos no mesmo mês, mostramos apenas um
  // rótulo (priorizando o Realizado) para evitar sobreposição ilegível.
  type Candidate = { value: number; x: number; y: number; color: string; bold: boolean; priority: number; preferAbove: boolean };
  const candidates: Candidate[] = [];
  const valueAt = (series: MonthDatum[], index: number) => {
    const v = series[index]?.[field] as number | null | undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  for (let i = 0; i < n; i++) {
    const cv = valueAt(current, i);
    const pv = valueAt(previous, i);
    const x = x0 + i * stepX;
    if (cv != null && pv != null) {
      const relativeDiff = Math.abs(cv - pv) / Math.max(Math.abs(cv), Math.abs(pv), 1);
      const visuallyClose = Math.abs(yFor(cv) - yFor(pv)) <= 5.5 * px;
      const sameDisplayedLabel = labelFor(cv) === labelFor(pv);
      if (sameDisplayedLabel || (visuallyClose && relativeDiff <= 0.03)) {
        candidates.push({ value: cv, x, y: yFor(cv), color: NAVY, bold: true, priority: 120, preferAbove: true });
        continue;
      }
      // Regra: maior valor SEMPRE acima do ponto, menor SEMPRE abaixo.
      const currentAbove = cv >= pv;
      if (cv != null) candidates.push({ value: cv, x, y: yFor(cv), color: NAVY, bold: true, priority: 100, preferAbove: currentAbove });
      if (pv != null) candidates.push({ value: pv, x, y: yFor(pv), color: "#6B7280", bold: false, priority: 50, preferAbove: !currentAbove });
      continue;
    }
    if (cv != null) candidates.push({ value: cv, x, y: yFor(cv), color: NAVY, bold: true, priority: 100, preferAbove: true });
    if (pv != null) candidates.push({ value: pv, x, y: yFor(pv), color: "#6B7280", bold: false, priority: 50, preferAbove: true });
  }
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const overlaps = (a: { x: number; y: number; w: number; h: number }) =>
    placed.some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  candidates
    .sort((a, b) => b.priority - a.priority)
    .forEach((c) => {
      const text = labelFor(c.value);
      ctx.font = `${c.bold ? "bold " : ""}${2.8 * px}px Helvetica, Arial`;
      const tw = ctx.measureText(text).width;
      const th = 4 * px;
      // Clampa o X para que rótulos das extremidades (Jan/Jun/Dez) caibam dentro
      // da área útil do gráfico, em vez de serem descartados pelo guard de borda.
      const halfW = tw / 2 + 1.2 * px;
      const minX = x0 + halfW;
      const maxX = x0 + w - halfW;
      const minY = y0 + th / 2;
      const maxY = y0 + h - th / 2;
      const clampX = (x: number) => minX <= maxX ? Math.min(Math.max(x, minX), maxX) : x0 + w / 2;
      const clampY = (y: number) => minY <= maxY ? Math.min(Math.max(y, minY), maxY) : y0 + h / 2;
      // Posições preferidas respeitam a regra: maior acima, menor abaixo.
      // Apenas se nenhuma posição no lado preferido couber, tentamos o lado oposto.
      const dir = c.preferAbove ? -1 : 1;
      const tries = [
        { x: clampX(c.x),           y: c.y + dir * 5.2 * px },
        { x: clampX(c.x),           y: c.y + dir * 8.5 * px },
        { x: clampX(c.x),           y: c.y + dir * 11 * px },
        { x: clampX(c.x - 7 * px),  y: c.y + dir * 4 * px  },
        { x: clampX(c.x + 7 * px),  y: c.y + dir * 4 * px  },
        // Fallback lado oposto (último recurso).
        { x: clampX(c.x),           y: c.y - dir * 5.2 * px },
        { x: clampX(c.x),           y: c.y - dir * 8.5 * px },
        { x: clampX(c.x),           y: c.y - dir * 11 * px },
      ];
      const inBoundsBox = (t: { x: number; y: number }) => {
        const box = { x: t.x - tw / 2 - 1.2 * px, y: t.y - th / 2, w: tw + 2.4 * px, h: th };
        const inB = box.x >= x0 && box.x + box.w <= x0 + w && box.y >= y0 && box.y + box.h <= y0 + h;
        return inB ? box : null;
      };
      let chosen: { t: { x: number; y: number }; box: { x: number; y: number; w: number; h: number } } | null = null;
      // 1ª passada: posição sem sobreposição
      for (const t of tries) {
        const box = inBoundsBox(t);
        if (!box || overlaps(box)) continue;
        chosen = { t, box };
        break;
      }
      // 2ª passada (fallback): garantir que TODOS os rótulos apareçam,
      // aceitando alguma sobreposição. Sem isso, pontos das extremidades
      // (ex.: Jan e Jun) ficam sem label.
      if (!chosen) {
        for (const t of tries) {
          const box = inBoundsBox(t);
          if (!box) continue;
          chosen = { t, box };
          break;
        }
      }
      // 3ª passada definitiva: se por algum motivo todas as tentativas ficaram
      // fora da área útil (ponto no topo/rodapé), clampa também o Y. Assim todo
      // mês com dado tem pelo menos um rótulo visível no gráfico.
      if (!chosen) {
        const t = { x: clampX(c.x), y: clampY(c.y + (c.preferAbove ? -1 : 1) * 5.2 * px) };
        chosen = { t, box: { x: t.x - tw / 2 - 1.2 * px, y: t.y - th / 2, w: tw + 2.4 * px, h: th } };
      }
      if (chosen) {
        ctx.fillStyle = c.color;
        ctx.fillText(text, chosen.t.x, chosen.t.y);
        placed.push(chosen.box);
      }
    });
  ctx.textBaseline = "alphabetic";

  // labels mês (3 letras p/ Jan-Dez) — bem abaixo da baseline,
  // dentro do padB ampliado, para não colidir com rótulos de valor.
  ctx.fillStyle = TEXT;
  ctx.font = `bold ${3.4 * px}px Helvetica, Arial`;
  current.forEach((d, i) => {
    const x = x0 + i * stepX;
    ctx.fillText(MONTHS_PT[d.month - 1].slice(0, 3), x, y0 + h + 8 * px);
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
    previousIndicators = {},
  } = input;

  // Baixa as fotos dos destaques como DataURL via SDK do Supabase.
  // Evita falhas intermitentes de CORS ao carregar a signed URL em <img>.
  const highlightDataUrls = await Promise.all(
    highlights.map((h) => h.photo_url ? getHighlightPhotoDataUrl(h.photo_url) : Promise.resolve(null)),
  );

  // Carrega imagens
  const [coverImg, brandLogoImg, falconLogoImg, ...highlightImgs] = await Promise.all([
    loadImage(hotelCoverUrl),
    loadImage(brandLogoUrl),
    loadImage(falconLogoUrl),
    ...highlightDataUrls.map((d) => loadImageFromDataUrl(d)),
  ]);

  const coverData = coverImg ? imageToDataUrl(coverImg, 1800, "jpeg") : null;
  // Logos como PNG (preserva transparência — sem fundo preto/branco)
  // e capturando dimensões intrínsecas para evitar distorção (contain).
  const brandData = logoFromImage(brandLogoImg);
  const falconData = logoFromImage(falconLogoImg);
  // Marca d'água: extrai apenas o pássaro da logo Falcon (sem o wordmark).
  const birdWatermark = extractBirdWatermark(falconLogoImg);
  // Mantemos o HTMLImageElement original para gerar o crop com a proporção
  // exata da célula no momento do desenho (object-fit: cover). Isso evita
  // tanto o "esticado" (sem preservar proporção) quanto as grandes faixas
  // vazias do "contain" quando a célula tem proporção diferente da foto.
  const hlImgs = highlightImgs;

  // Histórico de 6 meses para os gráficos
  const history: LetterHistory = await fetchLetterHistory(closing.hotel_id, closing.year, closing.month);

  // Lógica de exibição dos meses:
  //  - Mostrar pelo menos Jan..Jun (6 meses) e até o mês corrente quando passar de Jun.
  //  - Série Realizado é truncada após o mês corrente (linha/barra para no último valor).
  //  - Série Ano Anterior mantém todos os meses no intervalo visível.
  const visibleMonths = Math.max(6, closing.month);
  // Hotéis sem ano anterior comparável (ex.: Arcoverde abriu em ago/2025) —
  // remove junho dos gráficos para não exibir uma coluna/ponto solitário sem
  // comparativo do ano anterior, preservando maio quando há dados.
  const hotelNameLower = (hotel?.name ?? "").toLowerCase();
  const arcoverdeChartMonthToHide = null; // ajuste temporário: não esconder mais o mês corrente do gráfico;
  const baseCurrent = history.current.slice(0, visibleMonths);
  const baseCurrentFiltered = arcoverdeChartMonthToHide
    ? baseCurrent.filter((d) => d.month !== arcoverdeChartMonthToHide)
    : baseCurrent;
  const trimmedCurrent = baseCurrentFiltered.map((d) => ({
    ...d,
    ocupacao: d.month <= closing.month ? d.ocupacao : null,
    adr: d.month <= closing.month ? d.adr : null,
    receita_bruta_total: d.month <= closing.month ? d.receita_bruta_total : null,
  }));
  const basePrevious = history.previous.slice(0, visibleMonths);
  const trimmedPrevious = arcoverdeChartMonthToHide
    ? basePrevious.filter((d) => d.month !== arcoverdeChartMonthToHide)
    : basePrevious;

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
  // logos rodapé direita — PNG (transparente), preservando proporção
  drawContainedLogo(doc, brandData, SIZE - 78, 178, 28, 22, "center");
  drawContainedLogo(doc, falconData, SIZE - 44, 178, 30, 22, "center");
  // Cidade do hotel — abaixo da logo da bandeira
  const city = extractCityFromHotel(hotel);
  if (city) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(NAVY);
    doc.text(city, SIZE - 78 + 14, 204, { align: "center" });
  }

  /* ───── 2. INDICADORES — Ocupação + ADR ───── */
  addPage(doc);
  drawPageHeader(doc, "Indicadores do mês", falconData, brandData);

  // Cabeçalho ampliado para 28mm — conteúdo começa em y=34mm.
  // Cards reduzidos de 78 → 75mm para manter o conjunto dentro da página.
  const card1Y = HEADER_CONTENT_Y, cardH = 75, cardW = SIZE - 24;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.roundedRect(12, card1Y, cardW, cardH, 2, 2, "S");
  const occChart = drawBarChart("Taxa de Ocupação", trimmedCurrent, trimmedPrevious, "ocupacao", (v) => `${Math.round(v)}%`, { w: cardW - 6, h: cardH - 6 });
  doc.addImage(occChart, "PNG", 15, card1Y + 3, cardW - 6, cardH - 6);

  const card2Y = card1Y + cardH + 6;
  doc.roundedRect(12, card2Y, cardW, cardH, 2, 2, "S");
  const adrChart = drawLineChart("Diária Média", trimmedCurrent, trimmedPrevious, "adr", (v) => `R$ ${Math.round(v)}`, { w: cardW - 6, h: cardH - 6 });
  doc.addImage(adrChart, "PNG", 15, card2Y + 3, cardW - 6, cardH - 6);

  /* ───── 3. INDICADORES — Receita Bruta + Cards ───── */
  addPage(doc);
  drawPageHeader(doc, "Indicadores do mês", falconData, brandData);

  // Página 3 — Receita + Cards (Fundo de Reserva / RPS)
  const recH = 84;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.roundedRect(12, HEADER_CONTENT_Y, cardW, recH, 2, 2, "S");
  const recChart = drawLineChart("Receita Total Bruta", trimmedCurrent, trimmedPrevious, "receita_bruta_total", (v) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`, { w: cardW - 6, h: recH - 6 });
  doc.addImage(recChart, "PNG", 15, HEADER_CONTENT_Y + 3, cardW - 6, recH - 6);

  // dois cards lado a lado — borda na MESMA cor do gráfico (BORDER cinza claro)
  const cw = (SIZE - 30) / 2, ch = 64, cy = HEADER_CONTENT_Y + recH + 6;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  // Fundo de Reserva
  doc.roundedRect(12, cy, cw, ch, 2, 2, "S");
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Fundo de Reserva", 12 + cw / 2, cy + 12, { align: "center" });
  drawGoldDollarIcon(doc, 12 + cw / 2, cy + 30);
  // valor (maior)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(NAVY);
  doc.text(fmtBRL0(letter.reserve_fund), 12 + cw / 2, cy + 50, { align: "center" });

  // RPS
  const rx = 12 + cw + 6;
  doc.setDrawColor(BORDER);
  doc.setLineWidth(0.4);
  doc.roundedRect(rx, cy, cw, ch, 2, 2, "S");
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("RPS", rx + cw / 2, cy + 12, { align: "center" });
  // estrela dourada/amarela
  doc.setFillColor(GOLD);
  doc.setDrawColor(GOLD);
  drawStar(doc, rx + cw / 2, cy + 26, 7);
  // restaura cor de borda padrão
  doc.setDrawColor(BORDER);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(NAVY);
  const rpsTxt = letter.rps_score != null ? `${letter.rps_score}%` : "—";
  doc.text(rpsTxt, rx + cw / 2, cy + 50, { align: "center" });

  /* ───── 4. COMENTÁRIOS DO MÊS ───── */
  addPage(doc);
  drawBirdWatermark(doc, birdWatermark, { x: 0, y: 0, w: SIZE, h: SIZE });
  drawPageHeader(doc, "Comentários do mês", falconData, brandData);
  doc.setTextColor(TEXT);
  const blocks: string[] = [];
  // Dedup: a IA às vezes repete o mesmo parágrafo em mais de um campo
  // (intro/operational/outlook + market_context/financial/closing) e o PDF
  // acabava mostrando os dois primeiros parágrafos novamente no fim da
  // carta. Comparamos por uma chave normalizada (minúsculo, sem acento,
  // sem espaços/pontuação extra) para descartar repetições.
  const seen = new Set<string>();
  const push = (s?: string | null) => {
    if (!s) return;
    const trimmed = s.trim();
    if (!trimmed) return;
    const key = trimmed
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    blocks.push(trimmed);
  };
  push(letter.ai_intro);
  push(letter.ai_market_context);
  push(letter.ai_operational);
  push(letter.ai_financial);
  push(letter.ai_outlook);
  push(letter.ai_closing);
 const body = blocks.join("\n\n") || "—";

  // Cartas com texto muito longo ficavam com fonte minúscula pra caber tudo
  // numa página só. Acima desse limite de caracteres, divide em 2 páginas
  // em vez de espremer a fonte. Cartas normais (abaixo do limite) continuam
  // exatamente como sempre foram — só 1 página, sem nenhuma mudança.
  const SPLIT_THRESHOLD_CHARS = 2400;
  const totalChars = blocks.reduce((n, b) => n + b.length, 0);

  const textBlockOpts = {
    x: 16,
    width: SIZE - 32,
    minSize: 4.8,
    maxSize: 22,
    lineHeightFactor: 1.45,
    minFillRatio: 0.92,
  };
  const pageY = HEADER_CONTENT_Y + 2;
  const pageH = SIZE - (HEADER_CONTENT_Y + 2) - 10;

  if (totalChars <= SPLIT_THRESHOLD_CHARS || blocks.length <= 1) {
    // Comportamento de sempre: tudo numa página só.
    drawDynamicTextBlock(doc, body, { ...textBlockOpts, y: pageY, height: pageH });
  } else {
    // Mede quanto espaço (mm) um conjunto de parágrafos ocupa, num tamanho
    // de fonte específico — usa a mesma lógica de quebra de linha do
    // drawDynamicTextBlock (doc.splitTextToSize), só que sem desenhar nada.
    const measureBlocksHeight = (paras: string[], size: number, lhf: number): number => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(size);
      const lineH = (size * lhf) / doc.internal.scaleFactor;
      let total = 0;
      for (let p = 0; p < paras.length; p++) {
        const para = paras[p].replace(/\n/g, " ").trim();
        if (!para) { total += lineH * 0.55; continue; }
        const lines = doc.splitTextToSize(para, textBlockOpts.width) as string[];
        total += lines.length * lineH;
        if (p < paras.length - 1) total += lineH * 0.55;
      }
      return total + (size / doc.internal.scaleFactor) * 0.35;
    };

    // Acha o MAIOR tamanho de fonte em que o texto inteiro cabe somando as
    // duas páginas — esse tamanho vale igual pras duas, garantindo
    // consistência visual entre elas.
    let splitSize = textBlockOpts.minSize;
    for (let size = textBlockOpts.maxSize; size >= textBlockOpts.minSize; size -= 0.1) {
      if (measureBlocksHeight(blocks, size, textBlockOpts.lineHeightFactor) <= pageH * 2) {
        splitSize = size;
        break;
      }
    }

    // Acha em qual parágrafo cortar: o último que ainda cabe na página 1
    // nesse tamanho de fonte já decidido.
    let splitIndex = blocks.length - 1;
    for (let i = 0; i < blocks.length; i++) {
      const h = measureBlocksHeight(blocks.slice(0, i + 1), splitSize, textBlockOpts.lineHeightFactor);
      if (h > pageH) { splitIndex = Math.max(0, i - 1); break; }
      splitIndex = i;
    }

    const firstHalf = blocks.slice(0, splitIndex + 1).join("\n\n");
    const secondHalf = blocks.slice(splitIndex + 1).join("\n\n");

    // minSize = maxSize = splitSize força as DUAS páginas a usarem
    // exatamente o mesmo tamanho de fonte, em vez de cada uma escolher
    // sozinha tentando preencher a própria altura.
    drawDynamicTextBlock(doc, firstHalf, {
      ...textBlockOpts, y: pageY, height: pageH, minSize: splitSize, maxSize: splitSize,
    });

    addPage(doc);
    drawBirdWatermark(doc, birdWatermark, { x: 0, y: 0, w: SIZE, h: SIZE });
    drawPageHeader(doc, "Comentários do mês (continuação)", falconData, brandData);
    doc.setTextColor(TEXT);
    drawDynamicTextBlock(doc, secondHalf || "—", {
      ...textBlockOpts, y: pageY, height: pageH, minSize: splitSize, maxSize: splitSize,
    });
  }
    addPage(doc);
    drawBirdWatermark(doc, birdWatermark, { x: 0, y: 0, w: SIZE, h: SIZE });
    drawPageHeader(doc, "Comentários do mês (continuação)", falconData, brandData);
    doc.setTextColor(TEXT);
    drawDynamicTextBlock(doc, secondHalf || "—", {
      ...textBlockOpts,
      y: HEADER_CONTENT_Y + 2,
      height: SIZE - (HEADER_CONTENT_Y + 2) - 10,
    });
  }

  /* ───── 5. DESTAQUES ───── */
  addPage(doc);
  drawBirdWatermark(doc, birdWatermark, { x: 0, y: 0, w: SIZE, h: SIZE });
  drawPageHeader(doc, "Destaques do mês", falconData, brandData);
  {
    const n = Math.min(highlights.length, 8);
    if (n > 0) {
      // Layout: 1 col p/ 1 item; 2 cols p/ 2-4 itens (2x2); 3 cols p/ 5-8 (3x3).
      // Proporções de célula mais próximas de 4:3 para evitar fotos
      // "panorâmicas" e crop excessivo.
      const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
      const rows = Math.ceil(n / cols);
      const gap = 5;
      const marginX = 14;
      const availW = SIZE - marginX * 2;
      const availH = SIZE - HEADER_CONTENT_Y - 8;
      const colW = (availW - (cols - 1) * gap) / cols;
      const rowH = (availH - (rows - 1) * gap) / rows;
      const startY = HEADER_CONTENT_Y + 2;
      const titleGap = 1.5;
      const titleFontSize = cols === 3 ? 7.2 : rows >= 3 ? 8 : 9;
      const emptyFontSize = rows >= 3 ? 7 : 8;
      // Pré-calcula o nº máximo de linhas do título para evitar que o texto
      // ultrapasse o balãozinho. Define titleH proporcional ao maior título.
      doc.setFont("helvetica", "normal");
      doc.setFontSize(titleFontSize);
      const titleLineH = (titleFontSize * 1.22) / doc.internal.scaleFactor;
      let maxTitleLines = 1;
      const wrappedTitles: string[][] = [];
      for (let i = 0; i < n; i++) {
        const lines = doc.splitTextToSize(highlights[i].title || "", colW - 4) as string[];
        wrappedTitles.push(lines);
        if (lines.length > maxTitleLines) maxTitleLines = lines.length;
      }
      const titleH = Math.max(8.5, Math.min(rowH * 0.32, maxTitleLines * titleLineH + 5));
      for (let i = 0; i < n; i++) {
        const h = highlights[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = marginX + col * (colW + gap);
        const y = startY + row * (rowH + gap);
        // título
        doc.setDrawColor(BORDER);
        doc.setLineWidth(0.4);
        doc.roundedRect(x, y, colW, titleH, 1.5, 1.5, "S");
        doc.setTextColor(TEXT);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(titleFontSize);
        const lines = wrappedTitles[i];
        const blockH = lines.length * titleLineH;
        const firstBaseline = y + (titleH - blockH) / 2 + titleLineH * 0.72;
        for (let li = 0; li < lines.length; li++) {
          doc.text(lines[li], x + colW / 2, firstBaseline + li * titleLineH, {
            align: "center",
          });
        }
        // foto
        const photoY = y + titleH + titleGap;
        const photoH = rowH - titleH - titleGap;
        const img = hlImgs[i];
        if (img) {
          drawContainedPhoto(doc, img, x, photoY, colW, photoH);
        } else {
          doc.setFillColor("#F3F4F6");
          doc.rect(x, photoY, colW, photoH, "F");
          doc.setTextColor(MUTED);
          doc.setFontSize(emptyFontSize);
          doc.text("(sem foto)", x + colW / 2, photoY + photoH / 2, { align: "center" });
        }
      }
    }
  }

  /* ───── 6. DEMONSTRATIVO DE RESULTADOS ───── */
  addPage(doc);
  drawBirdWatermark(doc, birdWatermark, { x: 0, y: 0, w: SIZE, h: SIZE });
  drawPageHeader(doc, "Demonstrativo de Resultados", falconData, brandData);
  drawDreTable(doc, dreLines, `${MONTHS_PT[closing.month - 1]} ${closing.year}`);

  /* ───── 7. ENCERRAMENTO ───── */
  addPage(doc);
  if (coverData) {
    doc.addImage(coverData, "JPEG", 0, 0, SIZE, 138, undefined, "FAST");
  } else {
    doc.setFillColor(NAVY); doc.rect(0, 0, SIZE, 138, "F");
  }
  doc.setFillColor("#FFFFFF"); doc.rect(0, 138, SIZE, SIZE - 138, "F");
  // Marca d'água apenas na metade branca da página (abaixo da foto).
  drawBirdWatermark(doc, birdWatermark, { x: 0, y: 138, w: SIZE, h: SIZE - 138 }, 0.7);
  // Faixa decorativa entre foto e bloco de texto (igual à capa)
  drawDecorativeStripe(doc, 16, 144, SIZE - 32);
  doc.setTextColor(NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Obrigado!", 16, 160);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(TEXT);
  doc.text("www.falconhoteis.com.br", 16, 170);
  doc.text("(31) 3500-5431", 16, 176);
  doc.text("R. Bernardo Guimarães, 245, B.", 16, 182);
  doc.text("Funcionários, Belo Horizonte - MG", 16, 188);
  drawContainedLogo(doc, brandData, SIZE - 78, 178, 28, 22, "center");
  drawContainedLogo(doc, falconData, SIZE - 44, 178, 30, 22, "center");
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
  type Row =
    | { kind: "section"; label: string }
    | { kind: "item"; label: string; rx: RegExp[] }
    | { kind: "total"; label: string; rx: RegExp[] }
    | { kind: "highlight"; label: string; rx: RegExp[] };

  const rows: Row[] = [
    { kind: "section", label: "RECEITAS" },
    { kind: "item", label: "Receita Bruta de Serviços", rx: [/receita\s+bruta\s+(de\s+)?servi[çc]os/i, /^receita\s+(de\s+)?hospedagem/i] },
    { kind: "item", label: "Receita Bruta A&B", rx: [/^receita\s+bruta\s+a&b/i, /^receita\s+(de\s+)?a&b/i, /alimentos?\s+e\s+bebidas?/i] },
    { kind: "item", label: "Receita Financeira Líquida", rx: [/receita\s+financeira/i] },
    { kind: "item", label: "Outras Receitas", rx: [/^outras\s+receitas/i] },
    { kind: "total", label: "RECEITA BRUTA TOTAL", rx: [/^receita\s+bruta\s+total/i, /^total\s+das?\s+receitas?\s+brutas?/i, /^receita\s+total\s+bruta/i, /^\(\+\)\s*receitas?\s+brutas?/i] },
    { kind: "item", label: "(–) Impostos s/ vendas e serviços", rx: [/impostos?\s+s\/?\s*vendas/i, /impostos?\s+sobre\s+(vendas|servi)/i, /^total\s+das?\s+dedu[çc][õo]es(\s+e\s+cancelamentos)?/i, /^\(-\)\s*dedu[çc][õo]es\s+impostos/i] },
    { kind: "total", label: "DEDUÇÕES DA RECEITA TOTAL", rx: [/^\(?-?\)?\s*dedu[çc][õo]es\s+(da\s+)?receita/i, /^total\s+de\s+dedu/i, /^total\s+das?\s+dedu[çc][õo]es(\s+e\s+cancelamentos)?/i, /^dedu[çc][õo]es/i] },
    { kind: "total", label: "RECEITA LÍQUIDA TOTAL", rx: [/^receita\s+l[íi]quida\s+total/i, /^receita\s+total\s+l[íi]quida/i, /^\(?=\)?\s*receita\s+l[íi]quida/i, /^receita\s+l[íi]quida$/i] },

    { kind: "section", label: "DESPESAS FIXAS" },
    { kind: "item", label: "Despesas com Pessoal", rx: [/^despesas?\s+com\s+pessoal$/i, /^folha\s+de\s+pagamento$/i, /^pessoal$/i] },
    { kind: "item", label: "(–) Custo das Mercadorias Vendidas", rx: [/^\(?-?\)?\s*custo\s+das?\s+mercadorias/i, /^cmv$/i, /^custo\s+com\s+a&b/i] },
    { kind: "item", label: "Despesas Operacionais", rx: [/^despesas?\s+operacionais$/i, /^despesas?\s+fixas$/i, /^gastos?\s+gerais\s+e\s+administrativos/i] },
    { kind: "item", label: "Despesas com Prestadores de Serviços", rx: [/^despesas?\s+com\s+prestadores?\s+de\s+servi[çc]os$/i, /^prestadores?\s+de\s+servi[çc]os$/i, /^servi[çc]os\s+terceirizados/i] },
    { kind: "total", label: "DESPESAS FIXAS TOTAIS", rx: [/^despesas?\s+fixas?\s+totais?/i, /^total\s+de\s+despesas?\s+fixas?/i, /^total\s+despesas?\s+fixas?/i, /^\(-\)\s*despesas?\s+fixas?$/i] },

    { kind: "section", label: "DESPESAS VARIÁVEIS" },
    { kind: "item", label: "Custos de Hospedagem", rx: [/^custos?\s+de\s+hospedagem$/i, /^despesas?\s+de\s+hospedagem$/i] },
    { kind: "item", label: "Despesas de Utilidades", rx: [/^despesas?\s+de\s+utilidades$/i, /^utilidades$/i, /^servi[çc]os\s+p[úu]blicos$/i] },
    { kind: "item", label: "Despesas com Manutenção", rx: [/^despesas?\s+com\s+manuten[çc][ãa]o$/i, /^custos?\s+com\s+manuten[çc][ãa]o$/i] },
    { kind: "item", label: "Despesas com Vendas", rx: [/^despesas?\s+com\s+vendas$/i, /^custos?\s+gerais\s+com\s+vendas$/i] },
    { kind: "item", label: "Taxas Accor", rx: [/^taxas?\s+accor/i, /^fees?\s+accor/i, /^gastos?\s+gerais\s+com\s+taxa\s+de\s+marketing/i] },
    { kind: "item", label: "Taxas de Administração", rx: [/^taxas?\s+de\s+administra[çc][ãa]o$/i, /^taxas?\s+de\s+administra[çc][ãa]o\s+falcon/i, /^fees?\s+falcon/i, /^total\s+da\s+taxa\s+de\s+administra[çc][ãa]o/i] },
    { kind: "item", label: "Despesas Financeiras", rx: [/^despesas?\s+financeiras$/i] },
    { kind: "total", label: "DESPESAS VARIÁVEIS TOTAL", rx: [/^despesas?\s+vari[áa]veis?\s+(totais?|total)/i, /^total\s+de?\s*despesas?\s+vari[áa]veis?/i, /^total\s+de\s+despesas?\s+operacionais?\s+vari[áa]veis?/i, /^\(-\)\s*despesas?\s+vari[áa]veis?\s+operacionais?/i] },
    { kind: "total", label: "DESPESAS TOTAIS", rx: [/^despesas?\s+totais$/i, /^total\s+(geral\s+)?(de\s+)?despesas(\s+\(fixas?\s*\+\s*vari[áa]veis?\))?/i, /^total\s+das?\s+despesas/i] },

    { kind: "section", label: "RESULTADO" },
    { kind: "total", label: "Resultado Operacional Bruto (GOP)", rx: [/^resultado\s+operacional\s+bruto/i, /^gop$/i, /^lucro\s+operacional\s+bruto/i] },
    { kind: "total", label: "Lucro / Prejuízo a Distribuir no Período", rx: [/^lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir/i, /^lucro\s+a\s+distribuir(\s+do\s+per[íi]odo)?$/i, /^lucro\s+l[íi]quido\s*\/?\s*preju[íi]zo\s+do\s+exerc/i, /^lucro\s+l[íi]quido$/i, /^resultado\s+l[íi]quido(\s+do\s+exerc[íi]cio)?$/i] },
    { kind: "highlight", label: "Distribuição por UH", rx: [/^por\s+uh$/i, /^distribui[çc][ãa]o\s+por\s+uh$/i, /^distribui[çc][ãa]o\s+\/\s*uh$/i, /^resultado\s+por\s+uh$/i, /^dividendo\s+efetivamente\s+distribu[íi]do/i, /^distribui[çc][ãa]o\s+linear/i] },
  ];

  const findValue = (rxs: RegExp[]): number | null => {
    for (const l of lines) {
      const lbl = l.label.replace(/^\[\w+\]\s*/, "").trim();
      if (rxs.some((rx) => rx.test(lbl))) return l.value;
    }
    return null;
  };

  const fmtVal = (v: number | null) =>
    v == null
      ? "—"
      : v < 0
        ? `(${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })})`
        : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

  const x0 = 12, x1 = SIZE - 12;
  let y = HEADER_CONTENT_Y;
  // header navy
  doc.setFillColor(NAVY);
  doc.rect(x0, y, x1 - x0, 7, "F");
  doc.setTextColor("#FFFFFF");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("DEMONSTRATIVO DE RESULTADOS", x0 + 3, y + 4.6);
  doc.text(monthLabel.toUpperCase(), x1 - 3, y + 4.6, { align: "right" });
  y += 7;

  for (const r of rows) {
    if (r.kind === "section") {
      const rowH = 5.6;
      doc.setFillColor("#E5E7EB");
      doc.rect(x0, y, x1 - x0, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.6);
      doc.setTextColor(NAVY);
      doc.text(r.label, x0 + 3, y + rowH - 1.6);
      y += rowH;
      continue;
    }
    let v = findValue(r.rx);
    // Fallback: se "DESPESAS TOTAIS" não vier explícito da DRE, soma Fixas + Variáveis
    if (v == null && r.kind === "total" && /despesas\s+totais/i.test(r.label)) {
      const fixas = findValue([/^despesas?\s+fixas?\s+totais?/i, /^total\s+de?\s*despesas?\s+fixas?/i]);
      const variaveis = findValue([/^despesas?\s+vari[áa]veis?\s+(totais?|total)/i, /^total\s+de?\s*despesas?\s+vari[áa]veis?/i]);
      if (fixas != null || variaveis != null) v = (fixas ?? 0) + (variaveis ?? 0);
    }
    const rowH = r.kind === "highlight" ? 6.4 : 5.4;
    if (r.kind === "highlight") {
      doc.setFillColor("#FEF3C7"); // amarelo destaque
      doc.rect(x0, y, x1 - x0, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.4);
      doc.setTextColor(NAVY);
    } else if (r.kind === "total") {
      doc.setFillColor("#F3F4F6");
      doc.rect(x0, y, x1 - x0, rowH, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.8);
      doc.setTextColor(NAVY);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.6);
      doc.setTextColor(TEXT);
      doc.setDrawColor(BORDER);
      doc.setLineWidth(0.15);
      doc.line(x0, y + rowH, x1, y + rowH);
    }
    doc.text(r.label, x0 + (r.kind === "item" ? 6 : 3), y + rowH - 1.6);
    doc.text(fmtVal(v), x1 - 3, y + rowH - 1.6, { align: "right" });
    y += rowH;
    if (y > SIZE - 12) break; // proteção contra overflow
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
  const jspdfInternal = doc as unknown as { lines?: (...args: unknown[]) => void };
  if (jspdfInternal.lines) {
    const linesArr = points.slice(1).concat([points[0]]).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    jspdfInternal.lines(linesArr, points[0][0], points[0][1], [1, 1], "F", true);
  }
}

/**
 * Ícone visual: cifrão dourado simples para Fundo de Reserva.
 */
function drawGoldDollarIcon(doc: jsPDF, cx: number, cy: number) {
  doc.setTextColor(GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.text("$", cx, cy, { align: "center" });
}

/**
 * Desenha um bloco de texto ajustando dinamicamente o tamanho da fonte
 * para que ocupe pelo menos `minFillRatio` da altura disponível, sem
 * ultrapassar a área. Texto justificado.
 */
function drawJustifiedTextLine(doc: jsPDF, line: string, x: number, y: number, width: number) {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    doc.text(line, x, y);
    return;
  }

  const wordsWidth = words.reduce((sum, word) => sum + doc.getTextWidth(word), 0);
  const extraSpace = (width - wordsWidth) / (words.length - 1);
  if (!Number.isFinite(extraSpace) || extraSpace <= 0) {
    doc.text(line, x, y);
    return;
  }

  let cursorX = x;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (i === words.length - 1) {
      doc.text(word, x + width - doc.getTextWidth(word), y);
    } else {
      doc.text(word, cursorX, y);
      cursorX += doc.getTextWidth(word) + extraSpace;
    }
  }
}

function drawDynamicTextBlock(
  doc: jsPDF,
  text: string,
  opts: {
    x: number;
    y: number;
    width: number;
    height: number;
    minSize: number;
    maxSize: number;
    lineHeightFactor: number;
    minFillRatio: number;
  },
) {
  const { x, y, width, height, minSize, maxSize, lineHeightFactor, minFillRatio } = opts;
  const paragraphs = String(text ?? "").split(/\n{2,}/);
  doc.setFont("helvetica", "normal");

  const measureLayout = (size: number, lhf: number) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lineH = (size * lhf) / doc.internal.scaleFactor;
    const firstBaseline = size / doc.internal.scaleFactor;
    let cursorOffset = firstBaseline;
    let linesCount = 0;
    const lines: Array<{ text: string; y: number; isLast: boolean }> = [];

    for (let p = 0; p < paragraphs.length; p++) {
      const para = paragraphs[p].replace(/\n/g, " ").trim();
      if (!para) {
        cursorOffset += lineH * 0.55;
        continue;
      }
      const paraLines = doc.splitTextToSize(para, width) as string[];
      for (let i = 0; i < paraLines.length; i++) {
        lines.push({
          text: paraLines[i],
          y: y + cursorOffset,
          isLast: i === paraLines.length - 1,
        });
        cursorOffset += lineH;
        linesCount += 1;
      }
      if (p < paragraphs.length - 1) cursorOffset += lineH * 0.55;
    }

    const bottomPadding = (size / doc.internal.scaleFactor) * 0.35;
    const totalH = linesCount > 0 ? cursorOffset + bottomPadding : 0;
    return { lines, totalH, lineH, filledRatio: height > 0 ? totalH / height : 1 };
  };

  const renderLayout = (size: number, lhf: number) => {
    const layout = measureLayout(size, lhf);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    for (const item of layout.lines) {
      // Justificação estilo Word: NUNCA justifica a última linha do
      // parágrafo (ficaria com espaços gigantes entre palavras curtas).
      // Também evita justificar linhas cujo texto já ocupa quase toda a
      // largura disponível — nesse caso o espaçamento nativo basta.
      const line = item.text;
      if (item.isLast) {
        doc.text(line, x, item.y);
        continue;
      }
      const lineWidth = doc.getTextWidth(line);
      // Só justifica se sobrar espaço significativo (>0.5mm), evitando
      // "esticar" linhas que já estão praticamente cheias.
      if (width - lineWidth > 0.5) {
        drawJustifiedTextLine(doc, line, x, item.y, width);
      } else {
        doc.text(line, x, item.y);
      }
    }
  };

  let bestSize = minSize;
  let bestLhf = lineHeightFactor;
  let bestLayout = measureLayout(bestSize, bestLhf);

  // Procura o maior tamanho que cabe usando exatamente a mesma medição usada
  // na renderização. Isso evita que o PDF "perca" o último parágrafo por
  // diferença entre cálculo e desenho.
  for (let size = maxSize; size >= minSize; size -= 0.1) {
    const layout = measureLayout(size, lineHeightFactor);
    if (layout.totalH <= height) {
      bestSize = size;
      bestLhf = lineHeightFactor;
      bestLayout = layout;
      break;
    }
  }

  // Se ainda não couber, reduz mais a fonte e aperta levemente o entrelinhas,
  // priorizando mostrar todo o texto em vez de manter tamanho maior.
  if (bestLayout.totalH > height) {
    let found = false;
    for (let size = minSize; size >= 3.6 && !found; size -= 0.1) {
      for (let lhf = Math.min(lineHeightFactor, 1.2); lhf >= 1.05; lhf -= 0.05) {
        const layout = measureLayout(size, lhf);
        if (layout.totalH <= height) {
          bestSize = size;
          bestLhf = lhf;
          bestLayout = layout;
          found = true;
          break;
        }
      }
    }
    if (!found) {
      bestSize = 3.6;
      bestLhf = 1.05;
      bestLayout = measureLayout(bestSize, bestLhf);
    }
  }

  // Só aumenta o respiro se houver muita sobra. Nunca ultrapassa o entrelinhas
  // base, para não recriar o corte no fim da página.
  if (bestLayout.filledRatio < minFillRatio && bestLayout.lines.length > 0) {
    const targetLineH = Math.min(height * minFillRatio, height) / bestLayout.lines.length;
    const targetLhf = (targetLineH * doc.internal.scaleFactor) / bestSize;
    bestLhf = Math.min(lineHeightFactor, Math.max(bestLhf, targetLhf));
  }

  renderLayout(bestSize, bestLhf);
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
