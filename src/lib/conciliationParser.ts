import * as XLSX from "xlsx";
import { getCategoriaFromCode } from "./conciliationCodes";

export interface RazaoLine {
  date: string; // ISO YYYY-MM-DD
  descricao: string;
  lancamento: string;
  historico: string;
  documento: string;
  valorDebito: number;
  valorCredito: number;
  isTotalizador: boolean;
}

export interface JournalLine {
  date: string; // ISO YYYY-MM-DD
  transactionNumber: string;
  receiptNumber: string;
  transactionCode: string;
  transactionDescription: string;
  guestFirstName: string;
  guestLastName: string;
  guestFullName: string;
  companyName: string;
  debit: number;
  credit: number;
  categoria: string | null;
}

function toIsoDate(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) > 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return s;
}

export function parseRazao(file: File): Promise<RazaoLine[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1, blankrows: false, defval: null, raw: false,
        });

        const headerIdx = 0;
        const header = (rows[headerIdx] ?? []).map((c) => String(c ?? "").toLowerCase().trim());
        const findCol = (...names: string[]) => {
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

        const iData = findCol("data");
        const iDesc = findCol("descrição", "descricao");
        const iLanc = findCol("lançamento", "lancamento");
        const iHist = findCol("histórico", "historico");
        const iDoc  = findCol("documento");
        const iDeb  = findCol("valor débito", "valor debito", "débito", "debito");
        const iCred = findCol("valor crédito", "valor credito", "crédito", "credito");

        const lines: RazaoLine[] = [];
        for (const row of rows.slice(headerIdx + 1)) {
          const desc = String(row[iDesc] ?? "").trim();
          if (!desc) continue;

          const deb  = parseFloat(String(row[iDeb]  ?? "0").replace(",", ".")) || 0;
          const cred = parseFloat(String(row[iCred] ?? "0").replace(",", ".")) || 0;
          const hist = String(row[iHist] ?? "").trim();
          const doc  = String(row[iDoc]  ?? "").trim();
          const lineDate = toIsoDate(String(row[iData] ?? ""));

          // Tenta categoria pela descrição primeiro
          let categoriaFinal = desc;

          // Se for linha totalizadora sem doc, extrai código do Histórico
          const isTot = deb > 0 && cred === 0 && !doc;
          if (isTot) {
            const mHist = hist.match(/movimento\s+(\d+)/i);
            if (mHist) {
              const catFromCode = getCategoriaFromCode(mHist[1]);
              if (catFromCode) categoriaFinal = catFromCode;
            }
          }

          lines.push({
            date:          lineDate,
            descricao:     categoriaFinal,
            lancamento:    String(row[iLanc] ?? "").trim(),
            historico:     hist,
            documento:     doc,
            valorDebito:   deb,
            valorCredito:  cred,
            isTotalizador: isTot,
          });
        }
        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsBinaryString(file);
  });
}

export function parseJournal(file: File): Promise<JournalLine[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
          header: 1, blankrows: false, defval: null, raw: false,
        });

        const headerIdx = rows.findIndex((r) =>
          r.some((c) => typeof c === "string" && c.toLowerCase().includes("transaction"))
        );
        if (headerIdx === -1) throw new Error("Cabeçalho não encontrado no Journal");

        const header = rows[headerIdx].map((c) => String(c ?? "").toLowerCase().trim());
        const col = (name: string) => header.findIndex((h) => h.includes(name));

        const iDate    = col("transaction date") !== -1 ? col("transaction date") : col("date");
        const iTrnNum  = col("transaction number");
        const iReceipt = col("receipt");
        const iTrnCode = col("transaction code") !== -1 ? col("transaction code") : 4;
        const iTrnDesc = col("transaction code descript") !== -1 ? col("transaction code descript") : col("description");
        const iFirst   = col("first name") !== -1 ? col("first name") : col("individual first");
        const iLast    = col("last name") !== -1 ? col("last name") : col("individual last");
        const iCompany = col("company");
        const iDebit   = col("debit");
        const iCredit  = col("credit");

        const lines: JournalLine[] = [];
        for (const row of rows.slice(headerIdx + 1)) {
          const trnNum = String(row[iTrnNum] ?? "").trim();
          if (!trnNum) continue;

          const code   = String(row[iTrnCode] ?? "").trim();
          const debit  = parseFloat(String(row[iDebit]  ?? "0").replace(",", ".")) || 0;
          const credit = parseFloat(String(row[iCredit] ?? "0").replace(",", ".")) || 0;
          const first  = String(row[iFirst]   ?? "").trim();
          const last   = String(row[iLast]    ?? "").trim();

          lines.push({
            date:                  toIsoDate(String(row[iDate] ?? "")),
            transactionNumber:     trnNum,
            receiptNumber:         String(row[iReceipt] ?? "").trim(),
            transactionCode:       code,
            transactionDescription: String(row[iTrnDesc] ?? "").trim(),
            guestFirstName:        first,
            guestLastName:         last,
            guestFullName:         `${last}, ${first}`.trim().replace(/^,\s*/, ""),
            companyName:           String(row[iCompany] ?? "").trim(),
            debit,
            credit,
            categoria:             getCategoriaFromCode(code),
          });
        }
        resolve(lines);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Erro ao ler arquivo"));
    reader.readAsBinaryString(file);
  });
}