import * as XLSX from "xlsx";

/** Escopo (hotel + período) vindo do filtro no momento exato do upload. */
export interface NfScope {
  hotelId: string;
  refYear: number;
  refMonth: number;
}

export interface OperaLine {
  property: string;
  confirmationNumber: string;
  guestName: string;
  arrival: string;
  departure: string;
  fiscalBillNumber: string;
  netAmount: number;
  paymentAmount: number;
  /** Chave estável entre uploads MTD — impede duplicidade. */
  entryKey: string;
}

export interface OperaReservation {
  property: string;
  confirmationNumber: string;
  guestName: string;
  arrival: string;
  departure: string;
  lines: OperaLine[];
  totalNet: number;
  totalPayment: number;
}

export interface PrefeituraNota {
  numeroNfse: string;
  dataGeracao: string;
  competencia: string;
  situacao: string;
  valorServico: number;
  descricao: string;
  rps: string | null;
  confirmationNumber: string | null;
  guestNameExtracted: string | null;
  checkIn: string | null;
  checkOut: string | null;
  /** Chave estável entre uploads MTD — impede duplicidade. */
  entryKey: string;
}

function toIsoDate(raw: unknown): string {
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(raw ?? "").trim();
  if (!s) return "";
  // Já vem em ISO (ex.: "2026-08-29" ou "2026-08-29 00:00:00")
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  return s;
}

function parseMoney(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "").trim().replace(/\s/g, "");
  if (!s) return 0;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return Number.parseFloat(normalized) || 0;
}

const CONF_RE = /CONFIRMA[ÇC][ÃA]O:?\s*(\d{4,})/i;
const RESERVA_RE = /RESERVA:?\s*(\d{4,})/i;
const CHECKIN_RE = /CHECK-?IN:?\s*([\d./\-]{6,10})/i;
const CHECKOUT_RE = /CHECK-?OUT:?\s*([\d./\-]{6,10})/i;
/** RPS gravado dentro do texto do serviço (ex.: "... / RPS: 1979 / ..."). */
const RPS_IN_DESC_RE = /\bRPS:?\s*(\d+)/i;
const NAME_RE_1 = /H[OÓ]SPEDE:?\s+([A-ZÀ-Úa-zà-ú\s]+?)\s*\/\s*CPF/i;
const NAME_RE_2 = /H[OÓ]SPEDE:?\s*([A-ZÀ-Úa-zà-ú\s]+?)\s*\/\s*CONFIRMA/i;
const NAME_RE_3 = /H[OÓ]SPEDE:?\s*([A-ZÀ-Úa-zà-ú\s]+?)\s*CONFIRMA/i;

function extractConfirmationNumber(desc: string): string | null {
  const m = CONF_RE.exec(desc) || RESERVA_RE.exec(desc);
  return m ? m[1] : null;
}

function extractGuestName(desc: string): string | null {
  const m = NAME_RE_1.exec(desc) || NAME_RE_2.exec(desc) || NAME_RE_3.exec(desc);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

function extractRpsFromDescricao(desc: string): string | null {
  const m = RPS_IN_DESC_RE.exec(desc);
  return m ? m[1].replace(/^0+/, "") || m[1] : null;
}

function extractCheckDate(desc: string, re: RegExp): string | null {
  const m = re.exec(desc);
  if (!m) return null;
  const iso = toIsoDate(m[1]);
  return iso || null;
}

const scopePrefix = (s: NfScope) =>
  `${s.hotelId}|${s.refYear}-${String(s.refMonth).padStart(2, "0")}`;

export function parseOperaReservations(
  file: File,
  scope: NfScope,
): Promise<OperaReservation[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          blankrows: false,
          defval: null,
          raw: true,
        });

        // O relatório do Oracle às vezes traz linhas de título antes do
        // cabeçalho real (ex.: "Conferência de Notas Fiscais" na linha 1).
        const headerIdx = rows.findIndex((r) => {
          const cells = (r ?? []).map((c) => String(c ?? "").toLowerCase());
          const joined = cells.join("|");
          return (
            joined.includes("confirmation") &&
            (joined.includes("property") || joined.includes("fiscal"))
          );
        });
        const headerRowIndex = headerIdx >= 0 ? headerIdx : 0;
        const header = (rows[headerRowIndex] ?? []).map((c) =>
          String(c ?? "").toLowerCase().trim(),
        );
        const col = (...names: string[]) => {
          for (const n of names) {
            const idx = header.findIndex((h) => h === n);
            if (idx !== -1) return idx;
          }
          for (const n of names) {
            const idx = header.findIndex((h) => h.includes(n));
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const iProperty = col("property");
        const iConf = col("confirmation number", "confirmation");
        const iArrival = col("arrival date", "arrival");
        const iDeparture = col("departure date", "departure");
        const iGuest = col("guest name", "guest");
        const iFiscal = col("fiscal bill number", "fiscal bill");
        const iNet = col("net amount", "net");
        const iPayment = col("payment amount", "payment");

        const byConf = new Map<string, OperaReservation>();
        const prefix = scopePrefix(scope);
        const occ = new Map<string, number>();

        for (const row of rows.slice(headerRowIndex + 1)) {
          const conf = String(row[iConf] ?? "").trim();
          if (!conf) continue;

          const fiscalRaw = String(row[iFiscal] ?? "").trim();
          const fiscal = fiscalRaw && fiscalRaw.toLowerCase() !== "none" ? fiscalRaw : "";
          const netAmount = parseMoney(row[iNet]);
          const arrival = toIsoDate(row[iArrival]);
          const departure = toIsoDate(row[iDeparture]);

          // Chave estável: só depende do conteúdo da linha e do escopo.
          const base = [
            prefix,
            conf,
            fiscal,
            arrival,
            departure,
            netAmount.toFixed(2),
          ].join("|");
          const seq = (occ.get(base) ?? 0) + 1;
          occ.set(base, seq);
          const entryKey = `${base}|${seq}`;

          const line: OperaLine = {
            property: String(row[iProperty] ?? "").trim(),
            confirmationNumber: conf,
            guestName: String(row[iGuest] ?? "").trim(),
            arrival,
            departure,
            fiscalBillNumber: fiscal,
            netAmount,
            paymentAmount: parseMoney(row[iPayment]),
            entryKey,
          };

          const existing = byConf.get(conf);
          if (existing) {
            existing.lines.push(line);
            existing.totalNet += line.netAmount;
            existing.totalPayment += line.paymentAmount;
          } else {
            byConf.set(conf, {
              property: line.property,
              confirmationNumber: conf,
              guestName: line.guestName,
              arrival: line.arrival,
              departure: line.departure,
              lines: [line],
              totalNet: line.netAmount,
              totalPayment: line.paymentAmount,
            });
          }
        }

        resolve([...byConf.values()]);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo do R&A"));
    reader.readAsBinaryString(file);
  });
}

export function parsePrefeituraNotas(
  file: File,
  scope: NfScope,
): Promise<PrefeituraNota[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary", cellDates: true });
        const sheetName =
          wb.SheetNames.find(
            (n) => n.toLowerCase().includes("relação") || n.toLowerCase().includes("relacao"),
          ) ?? wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          blankrows: false,
          defval: null,
          raw: true,
        });

        const headerIdx = rows.findIndex((r) => {
          const joined = (r ?? [])
            .map((c) => String(c ?? "").toLowerCase())
            .join("|");
          return (
            joined.includes("nfs-e") ||
            joined.includes("nfse") ||
            joined.includes("valor do servi") ||
            joined.includes("descrição do servi") ||
            joined.includes("descricao do servi") ||
            joined.includes("discrimina") ||
            (joined.includes("situa") && joined.includes("nota")) ||
            (joined.includes("competên") && joined.includes("valor")) ||
            (joined.includes("competen") && joined.includes("valor"))
          );
        });

        const headerRowIndex = headerIdx >= 0 ? headerIdx : 0;
        const header = (rows[headerRowIndex] ?? []).map((c) =>
          String(c ?? "").toLowerCase().trim(),
        );
        const col = (...names: string[]) => {
          for (const n of names) {
            const idx = header.findIndex((h) => h === n);
            if (idx !== -1) return idx;
          }
          for (const n of names) {
            const idx = header.findIndex((h) => h.includes(n));
            if (idx !== -1) return idx;
          }
          return -1;
        };

        const iNumero = col(
          "número nfs-e",
          "numero nfs-e",
          "nfs-e",
          "número da nota",
          "numero da nota",
          "número",
          "numero",
        );
        const iDataGeracao = col("data geração", "data geracao", "data emissão", "data emissao");
        const iCompetencia = col("competência", "competencia");
        const iSituacao = col("situação nfs-e", "situacao nfs-e", "situação", "situacao");
        // Alguns exports deixam "Situação NFS-e" vazia e informam o estado na
        // coluna final "Situação" (Normal / Cancelada) — olhamos todas.
        const situacaoCols = header
          .map((h, i) => (h.includes("situa") ? i : -1))
          .filter((i) => i >= 0);
        const iValor = col("valor do serviço", "valor do servico", "valor total", "valor");
        const iDescricao = col("descrição do serviço", "descricao do servico", "discriminação", "discriminacao");
        // Em várias prefeituras o detalhamento (hóspede, confirmação, RPS)
        // vem em "Informações Complementares", não na descrição do serviço.
        const iInfoCompl = col("informações complementares", "informacoes complementares", "observa");
        const iTomador = col("nome tomador", "nome do tomador", "tomador");
        const iDps = col("dps nº", "dps n", "dps");
        const iRps = col("rps nº", "rps n", "rps");

        const notas: PrefeituraNota[] = [];
        const prefix = scopePrefix(scope);

        for (const row of rows.slice(headerRowIndex + 1)) {
          const numero = iNumero >= 0 ? String(row[iNumero] ?? "").trim() : "";
          if (!numero) continue;

          const situacao = iSituacao >= 0 ? String(row[iSituacao] ?? "").trim() : "";
          // Só descarta o que está explicitamente cancelado/substituído.
          const sitAll = situacaoCols
            .map((i) => String(row[i] ?? "").toLowerCase())
            .join(" ");
          if (/cancel|substitu/.test(sitAll)) continue;


          const descBase = iDescricao >= 0 ? String(row[iDescricao] ?? "").trim() : "";
          const descInfo = iInfoCompl >= 0 ? String(row[iInfoCompl] ?? "").trim() : "";
          const descricao = [descBase, descInfo].filter(Boolean).join(" / ");


          // Resolução do RPS, na ordem: coluna RPS própria → número dentro do
          // texto do serviço → DPS (e nunca DPS quando ele é o próprio número
          // da nota, caso em que não corresponde ao Fiscal Bill do Opera).
          const clean = (v: unknown) => {
            const s = String(v ?? "").trim();
            if (!s) return null;
            return s.replace(/^0+/, "") || s;
          };
          const fromRpsCol = iRps >= 0 ? clean(row[iRps]) : null;
          const fromDesc = extractRpsFromDescricao(descricao);
          const dpsRaw = iDps >= 0 ? clean(row[iDps]) : null;
          const fromDps =
            dpsRaw && dpsRaw !== clean(numero) ? dpsRaw : null;
          const rps = fromRpsCol ?? fromDesc ?? fromDps;

          const entryKey = `${prefix}|nfse|${numero}`;

          notas.push({
            numeroNfse: numero,
            dataGeracao: toIsoDate(row[iDataGeracao]),
            competencia: String(row[iCompetencia] ?? "").trim(),
            situacao,
            valorServico: parseMoney(row[iValor]),
            descricao,
            rps,
            confirmationNumber: extractConfirmationNumber(descricao),
            guestNameExtracted:
              extractGuestName(descricao) ??
              (iTomador >= 0 ? String(row[iTomador] ?? "").trim() || null : null),

            checkIn: extractCheckDate(descricao, CHECKIN_RE),
            checkOut: extractCheckDate(descricao, CHECKOUT_RE),
            entryKey,
          });
        }

        resolve(notas);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo da Prefeitura"));
    reader.readAsBinaryString(file);
  });
}
