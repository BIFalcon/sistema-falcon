import * as XLSX from "xlsx";

export interface OperaLine {
  property: string;
  confirmationNumber: string;
  guestName: string;
  arrival: string;
  departure: string;
  fiscalBillNumber: string;
  netAmount: number;
  paymentAmount: number;
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
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
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
const NAME_RE_1 = /H[OÓ]SPEDE:?\s+([A-ZÀ-Ú\s]+?)\s*\/\s*CPF/i;
const NAME_RE_2 = /H[OÓ]SPEDE:?\s*([A-ZÀ-Ú\s]+?)\s*CONFIRMA/i;

function extractConfirmationNumber(desc: string): string | null {
  const m = CONF_RE.exec(desc) || RESERVA_RE.exec(desc);
  return m ? m[1] : null;
}

function extractGuestName(desc: string): string | null {
  const m = NAME_RE_1.exec(desc) || NAME_RE_2.exec(desc);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

function extractCheckDate(desc: string, re: RegExp): string | null {
  const m = re.exec(desc);
  if (!m) return null;
  const iso = toIsoDate(m[1]);
  return iso || null;
}

export function parseOperaReservations(file: File): Promise<OperaReservation[]> {
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
        // Detecta a primeira linha que contém "confirmation" + "property"
        // ou "fiscal bill".
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

        for (const row of rows.slice(headerRowIndex + 1)) {
          const conf = String(row[iConf] ?? "").trim();
          if (!conf) continue;

          const line: OperaLine = {
            property: String(row[iProperty] ?? "").trim(),
            confirmationNumber: conf,
            guestName: String(row[iGuest] ?? "").trim(),
            arrival: toIsoDate(row[iArrival]),
            departure: toIsoDate(row[iDeparture]),
            fiscalBillNumber: String(row[iFiscal] ?? "").trim(),
            netAmount: parseMoney(row[iNet]),
            paymentAmount: parseMoney(row[iPayment]),
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

export function parsePrefeituraNotas(file: File): Promise<PrefeituraNota[]> {
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

        const header = (rows[0] ?? []).map((c) => String(c ?? "").toLowerCase().trim());
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

        const iNumero = col("número nfs-e", "numero nfs-e", "nfs-e");
        const iDataGeracao = col("data geração", "data geracao");
        const iCompetencia = col("competência", "competencia");
        const iSituacao = col("situação nfs-e", "situacao nfs-e");
        const iValor = col("valor do serviço", "valor do servico");
        const iDescricao = col("descrição do serviço", "descricao do servico");
        const iDps = col("dps nº", "dps n", "dps");
        const iRps = col("rps nº", "rps n", "rps");

        const notas: PrefeituraNota[] = [];
        for (const row of rows.slice(1)) {
          const numero = String(row[iNumero] ?? "").trim();
          if (!numero) continue;

          const situacao = String(row[iSituacao] ?? "").trim();
          if (!situacao.includes("Gerada")) continue;

          const descricao = iDescricao >= 0 ? String(row[iDescricao] ?? "").trim() : "";
          const rpsRaw =
            iRps >= 0 ? row[iRps] : iDps >= 0 ? row[iDps] : null;
          const rps =
            rpsRaw != null && String(rpsRaw).trim() !== ""
              ? String(rpsRaw).trim().replace(/^0+/, "")
              : null;

          notas.push({
            numeroNfse: numero,
            dataGeracao: toIsoDate(row[iDataGeracao]),
            competencia: String(row[iCompetencia] ?? "").trim(),
            situacao,
            valorServico: parseMoney(row[iValor]),
            descricao,
            rps,
            confirmationNumber: extractConfirmationNumber(descricao),
            guestNameExtracted: extractGuestName(descricao),
            checkIn: extractCheckDate(descricao, CHECKIN_RE),
            checkOut: extractCheckDate(descricao, CHECKOUT_RE),
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