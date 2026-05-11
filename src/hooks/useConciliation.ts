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
}

export interface ConciliationResult {
  period: string;
  categories: CategoryResult[];
  hasErrors: boolean;
}

const TOLERANCE = 0.05;

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
      const razaoDestaCateg = razaoLines.filter(
        (l) => normalizaDescricaoRazao(l.descricao) === cat
      );
      const totalizadores  = razaoDestaCateg.filter((l) => l.isTotalizador);
      const creditosRazao  = razaoDestaCateg.filter((l) => !l.isTotalizador && l.valorCredito > 0);

      const totalDebito       = totalizadores.reduce((s, l) => s + l.valorDebito, 0);
      const totalCreditoRazao = creditosRazao.reduce((s, l) => s + l.valorCredito, 0);

      const journalDestaCateg = journalLines.filter(
        (l) => l.categoria === cat && l.credit > 0
      );
      const totalJournal = journalDestaCateg.reduce((s, l) => s + l.credit, 0);

      const razaoDocSet   = new Set(creditosRazao.map((l) => l.documento.trim()));
      const journalDocSet = new Set(journalDestaCateg.map((l) => l.transactionNumber.trim()));

      const apenasNoJournal = journalDestaCateg.filter(
        (l) => !razaoDocSet.has(l.transactionNumber.trim())
      );
      const apenasNoRazao = creditosRazao.filter(
        (l) => !journalDocSet.has(l.documento.trim())
      );
      const totalComparacao = journalDestaCateg.length > 0 ? totalJournal : totalCreditoRazao;
      const emAmbos = creditosRazao
        .filter((l) => journalDocSet.has(l.documento.trim()))
        .map((r) => ({
          razao: r,
          journal: journalDestaCateg.find(
            (j) => j.transactionNumber.trim() === r.documento.trim()
          )!,
        }));

      return {
        categoria: cat,
        totalDebito,
        totalCreditoRazao,
        totalJournal,
        conciliado: Math.abs(totalDebito - totalComparacao) <= TOLERANCE,
        divergencia: totalDebito - totalComparacao,
        apenasNoJournal,
        apenasNoRazao,
        emAmbos,
      };
    });

    return {
      period: firstDate,
      categories: results,
      hasErrors: results.some((r) => !r.conciliado && r.totalDebito > 0),
    };
  }, [razaoLines, journalLines]);
}