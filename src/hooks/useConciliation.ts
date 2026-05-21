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
      const razaoDestaCateg = razaoLines.filter(
        (l) => normalizaDescricaoRazao(l.descricao) === cat
      );
      const creditosRazao  = razaoDestaCateg.filter((l) => !l.isTotalizador && l.valorCredito > 0);

      // Soma TODOS os débitos da categoria (não só os com flag isTotalizador)
      const totalDebito = razaoDestaCateg
        .filter((l) => l.valorDebito > 0)
        .reduce((s, l) => s + l.valorDebito, 0);
      const totalCreditoRazao = creditosRazao.reduce((s, l) => s + l.valorCredito, 0);

      const journalDestaCateg = journalLines.filter(
        (l) => l.categoria === cat && l.credit > 0
      );
      const totalJournal = journalDestaCateg.reduce((s, l) => s + l.credit, 0);

      // Cruzamento por VALOR + NOME do hóspede (Transaction Number != Documento)
      const journalReal = journalDestaCateg.filter((l) => l.credit > 0);

      // Agrupa créditos do Razão por valor em centavos
      const razaoByValue = new Map<number, RazaoLine[]>();
      for (const r of creditosRazao) {
        const cents = toCents(r.valorCredito);
        if (!razaoByValue.has(cents)) razaoByValue.set(cents, []);
        razaoByValue.get(cents)!.push(r);
      }

      // Cruza Journal com Razão por valor + nome
      const matchedRazaoIndices = new Map<number, Set<number>>();
      const emAmbos: CategoryResult["emAmbos"] = [];
      const apenasNoJournal: JournalLine[] = [];

      for (const j of journalReal) {
        const cents = toCents(j.credit);
        const candidates = razaoByValue.get(cents) ?? [];
        const usedIndices = matchedRazaoIndices.get(cents) ?? new Set<number>();
        const matchIdx = candidates.findIndex(
          (r, idx) =>
            !usedIndices.has(idx) &&
            namesMatch(r.historico, j.guestFullName || j.companyName || "")
        );
        if (matchIdx >= 0) {
          usedIndices.add(matchIdx);
          matchedRazaoIndices.set(cents, usedIndices);
          emAmbos.push({ journal: j, razao: candidates[matchIdx] });
        } else {
          apenasNoJournal.push(j);
        }
      }

      const apenasNoRazao = creditosRazao.filter((r) => {
        const cents = toCents(r.valorCredito);
        const candidates = razaoByValue.get(cents) ?? [];
        const usedIndices = matchedRazaoIndices.get(cents) ?? new Set<number>();
        return !usedIndices.has(candidates.indexOf(r));
      });

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
      };
    });

    return {
      period: firstDate,
      categories: results,
      hasErrors: results.some((r) => !r.conciliado && r.totalDebito > 0),
    };
  }, [razaoLines, journalLines]);
}