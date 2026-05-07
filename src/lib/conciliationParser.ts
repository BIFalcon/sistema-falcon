import * as XLSX from "xlsx";
import { getCategoriaFromCode } from "./conciliationCodes";

export interface RazaoLine {
  date: string;
  descricao: string;
  lancamento: string;
  historico: string;
  documento: string;
  valorDebito: number;
  valorCredito: number;
  isTotalizador: boolean;
}

export interface JournalLine {
  date: string;
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

        const headerIdx = rows.findIndex((r) =>
          r.some((c) => typeof c === "string" && c.toLowerCase().includes("descrição"))
        );
        if (headerIdx === -1) throw new Error("Cabeçalho não encontrado no Razão");

        const header = rows[headerIdx].map((c) => String(c ?? "").toLowerCase().trim());
        const col = (name: string) => header.findIndex((h) => h.includes(name));

        const iData      = col("data");
        const iDesc      = col("descrição") !== -1 ? col("descrição") : col("descricao");
        const iLanc      = col("lançamento") !== -1 ? col("lançamento") : col("lancamento");
        const iHist      = col("histórico") !== -1 ? col("histórico") : col("historico");
        const iDoc       = col("documento");
        const iDeb       = col("débito") !== -1 ? col("débito") : col("debito");
        const iCred      = col("crédito") !== -1 ? col("crédito") : col("credito");

        const lines: RazaoLine[] = [];
        for (const row of rows.slice(headerIdx + 1)) {
          const desc = String(row[iDesc] ?? "").trim();
          if (!desc) continue;

          const deb  = parseFloat(String(row[iDeb]  ?? "0").replace(",", ".")) || 0;
          const cred = parseFloat(String(row[iCred] ?? "0").replace(",", ".")) || 0;

          lines.push({
            date:          String(row[iData] ?? "").trim(),
            descricao:     desc,
            lancamento:    String(row[iLanc] ?? "").trim(),
            historico:     String(row[iHist] ?? "").trim(),
            documento:     String(row[iDoc]  ?? "").trim(),
            valorDebito:   deb,
            valorCredito:  cred,
            isTotalizador: deb > 0 && cred === 0,
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
            date:                  String(row[iDate] ?? "").trim(),
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