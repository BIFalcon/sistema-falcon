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

      const matchedRazao = new Set<number>();
      const matchedJournal = new Set<number>();
      const emAmbos: Array<{ razao: RazaoLine; journal: JournalLine }> = [];

      const matchPair = (razaoIdx: number, journalIdx: number) => {
        matchedRazao.add(razaoIdx);
        matchedJournal.add(journalIdx);
        emAmbos.push({ razao: creditosRazao[razaoIdx], journal: journalDestaCateg[journalIdx] });
      };

      creditosRazao.forEach((razao, razaoIdx) => {
        const docKey = normKey(razao.documento);
        if (!docKey) return;
        const journalIdx = journalDestaCateg.findIndex(
          (journal, idx) => !matchedJournal.has(idx) && normKey(journal.transactionNumber) === docKey
        );
        if (journalIdx !== -1) matchPair(razaoIdx, journalIdx);
      });

      creditosRazao.forEach((razao, razaoIdx) => {
        if (matchedRazao.has(razaoIdx)) return;
        const candidates = journalDestaCateg
          .map((journal, journalIdx) => ({ journal, journalIdx }))
          .filter(({ journal, journalIdx }) =>
            !matchedJournal.has(journalIdx) &&
            journal.date === razao.date &&
            toCents(journal.credit) === toCents(razao.valorCredito) &&
            hasNameMatch(razao, journal)
          );
        if (candidates.length === 1) matchPair(razaoIdx, candidates[0].journalIdx);
      });

      creditosRazao.forEach((razao, razaoIdx) => {
        if (matchedRazao.has(razaoIdx)) return;
        const candidates = journalDestaCateg
          .map((journal, journalIdx) => ({ journal, journalIdx }))
          .filter(({ journal, journalIdx }) =>
            !matchedJournal.has(journalIdx) &&
            journal.date === razao.date &&
            toCents(journal.credit) === toCents(razao.valorCredito)
          );
        if (candidates.length === 1) matchPair(razaoIdx, candidates[0].journalIdx);
      });

      const apenasNoJournal = journalDestaCateg.filter((_, idx) => !matchedJournal.has(idx));
      const apenasNoRazao = creditosRazao.filter((_, idx) => !matchedRazao.has(idx));
      // Divergência = (Débito TOTVS - Crédito TOTVS) - Journal Opera
      // O Journal deve corresponder ao líquido (débito menos crédito) do Razão.
      const divergencia = (totalDebito - totalCreditoRazao) - totalJournal;

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
      };
    });

    return {
      period: firstDate,
      categories: results,
      hasErrors: results.some((r) => !r.conciliado && r.totalDebito > 0),
    };
  }, [razaoLines, journalLines]);
}