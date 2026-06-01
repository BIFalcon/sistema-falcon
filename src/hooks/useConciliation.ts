import { useMemo } from "react";
import type { RazaoLine, JournalLine } from "@/lib/conciliationParser";
import type { ConciliationCategory } from "@/lib/conciliationCodes";
import { normalizaDescricaoRazao } from "@/lib/conciliationCodes";

export interface CategoryResult {
  categoria: ConciliationCategory;
  totalDebito: number;
  totalCreditoRazao: number;
  totalJournal: number;
  conciliado: boolean;
  divergencia: number;
  apenasNoJournal: JournalLine[];
  apenasNoRazao: RazaoLine[];
  emAmbos: Array<{ razao: RazaoLine; journal: JournalLine }>;
  debitLines: RazaoLine[];
  estornados: RazaoLine[];
}

export interface ConciliationResult {
  period: string;
  categories: CategoryResult[];
  hasErrors: boolean;
}

const TOLERANCE = 0.05;

const toCents = (value: number) => Math.round(value * 100);

const normalizeText = (value: string) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const hasNameMatch = (razao: RazaoLine, journal: JournalLine) => {
  const historico = normalizeText(razao.historico);
  const nameParts = [journal.guestFirstName, journal.guestLastName]
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter((part) => part.length > 2) ?? [];

  if (!historico || nameParts.length === 0) return false;
  return nameParts.every((part) => historico.includes(part));
};

const normKey = (s: string) => {
  const onlyDigits = String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return onlyDigits || String(s ?? "").trim();
};

/**
 * Extrai o Transaction Number do Journal a partir do campo Histórico do Razão.
 * O TOTVS costuma gravar como "Doc: 310685257 Data emissão:..."
 */
function extractDocFromHistorico(historico: string | null | undefined): string {
  if (!historico) return "";
  const m = historico.match(/Doc:\s*(\d+)/i);
  return m ? m[1] : "";
}

function namesMatch(historico: string, guestFullName: string): boolean {
  const hist = historico
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z]/g, " ");
  const nameParts = guestFullName
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().split(/\s+/).filter((p) => p.length > 2);
  if (nameParts.length === 0) return false;
  const matches = nameParts.filter((p) => hist.includes(p));
  return matches.length >= Math.min(2, nameParts.length);
}

export function useConciliation(
  razaoLines: RazaoLine[],
  journalLines: JournalLine[],
): ConciliationResult | null {
  return useMemo(() => {
    if (!razaoLines.length && !journalLines.length) return null;

    const CATEGORIES: ConciliationCategory[] = [
      "Cartoes a Processar",
      "Regularizar PIX",
      "Regularizar Dinheiro",
      "Notas a Faturar",
    ];

    const firstDate = razaoLines[0]?.date ?? journalLines[0]?.date ?? "";

    const results: CategoryResult[] = CATEGORIES.map((cat) => {
      const razaoDestaCategAll = razaoLines.filter(
        (l) => normalizaDescricaoRazao(l.descricao) === cat
      );

      // ESTORNOS: quando um mesmo Documento (não-movimento) aparece em DÉBITO
      // e em CRÉDITO dentro da mesma categoria com o mesmo valor, é um estorno
      // e ambas as linhas devem ser ignoradas da conciliação.
      const estornoKeys = new Set<string>();
      const estornados: RazaoLine[] = [];
      const debitsWithDoc = razaoDestaCategAll.filter(
        (l) => l.valorDebito > 0 && l.documento && !l.isTotalizador,
      );
      const creditsWithDoc = razaoDestaCategAll.filter(
        (l) => l.valorCredito > 0 && l.documento,
      );
      for (const d of debitsWithDoc) {
        const match = creditsWithDoc.find(
          (c) =>
            c.documento === d.documento &&
            toCents(c.valorCredito) === toCents(d.valorDebito) &&
            !estornoKeys.has(`c:${c.lancamento}`),
        );
        if (match) {
          estornoKeys.add(`d:${d.lancamento}`);
          estornoKeys.add(`c:${match.lancamento}`);
          estornados.push(d, match);
        }
      }

      const razaoDestaCateg = razaoDestaCategAll.filter(
        (l) =>
          !estornoKeys.has(`d:${l.lancamento}`) &&
          !estornoKeys.has(`c:${l.lancamento}`),
      );
      const creditosRazao = razaoDestaCateg.filter((l) => !l.isTotalizador && l.valorCredito > 0);
      const debitLines = razaoDestaCateg.filter((l) => l.valorDebito > 0);

      // Soma TODOS os débitos da categoria (não só os com flag isTotalizador)
      const totalDebito = debitLines.reduce((s, l) => s + l.valorDebito, 0);
      const totalCreditoRazao = creditosRazao.reduce((s, l) => s + l.valorCredito, 0);

      const journalDestaCateg = journalLines.filter(
        (l) => l.categoria === cat && l.credit > 0
      );
      const totalJournal = journalDestaCateg.reduce((s, l) => s + l.credit, 0);

      // Cruzamento: 1) Documento == Transaction Number, 2) valor + nome.
      const journalReal = journalDestaCateg.filter((l) => l.credit > 0);
      const usedRazao = new Set<string>();
      const usedJournal = new Set<string>();
      const emAmbos: CategoryResult["emAmbos"] = [];

      // Passo 1: match exato por número de documento.
      const razaoByDoc = new Map<string, RazaoLine>();
      for (const r of creditosRazao) {
        let k = normKey(r.documento);
        if (!k) {
          // Fallback: tenta extrair "Doc: <n>" do histórico
          k = normKey(extractDocFromHistorico(r.historico));
        }
        if (k && !razaoByDoc.has(k)) razaoByDoc.set(k, r);
      }
      for (const j of journalReal) {
        const k = normKey(j.transactionNumber);
        const r = k ? razaoByDoc.get(k) : undefined;
        if (r && !usedRazao.has(r.lancamento)) {
          usedRazao.add(r.lancamento);
          usedJournal.add(j.transactionNumber);
          emAmbos.push({ journal: j, razao: r });
        }
      }

      // Passo 2: match por valor + nome (fallback).
      const razaoByValue = new Map<number, RazaoLine[]>();
      for (const r of creditosRazao) {
        if (usedRazao.has(r.lancamento)) continue;
        const cents = toCents(r.valorCredito);
        if (!razaoByValue.has(cents)) razaoByValue.set(cents, []);
        razaoByValue.get(cents)!.push(r);
      }
      const apenasNoJournal: JournalLine[] = [];
      for (const j of journalReal) {
        if (usedJournal.has(j.transactionNumber)) continue;
        const cents = toCents(j.credit);
        const candidates = razaoByValue.get(cents) ?? [];
        const idx = candidates.findIndex(
          (r) =>
            !usedRazao.has(r.lancamento) &&
            namesMatch(r.historico, j.guestFullName || j.companyName || ""),
        );
        if (idx >= 0) {
          const r = candidates[idx];
          usedRazao.add(r.lancamento);
          emAmbos.push({ journal: j, razao: r });
        } else {
          // Passo 3: valor + data + qualquer parte do nome (>=3 chars) no histórico.
          // Aceita como mesmo lançamento quando documento difere mas tudo o mais bate.
          const idx2 = candidates.findIndex((r) => {
            if (usedRazao.has(r.lancamento)) return false;
            if (!r.date || !j.date || r.date !== j.date) return false;
            const hist = r.historico
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
              .toLowerCase();
            const parts = `${j.guestFirstName} ${j.guestLastName} ${j.companyName ?? ""}`
              .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
              .toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
            return parts.some((p) => hist.includes(p));
          });
          if (idx2 >= 0) {
            const r = candidates[idx2];
            usedRazao.add(r.lancamento);
            emAmbos.push({ journal: j, razao: r });
          } else {
            apenasNoJournal.push(j);
          }
        }
      }
      const apenasNoRazao = creditosRazao.filter((r) => !usedRazao.has(r.lancamento));

      // Divergência = apenas TOTVS interno: débito vs soma de créditos
      // O Journal é INFORMATIVO — não entra no cálculo de divergência
      const divergencia = totalDebito - totalCreditoRazao;

      return {
        categoria: cat,
        totalDebito,
        totalCreditoRazao,
        totalJournal,
        conciliado: Math.abs(divergencia) <= TOLERANCE,
        divergencia,
        apenasNoJournal,
        apenasNoRazao,
        emAmbos,
        debitLines,
        estornados,
      };
    });

    return {
      period: firstDate,
      categories: results,
      hasErrors: results.some((r) => !r.conciliado && r.totalDebito > 0),
    };
  }, [razaoLines, journalLines]);
}