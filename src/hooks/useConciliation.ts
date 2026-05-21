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
  linhasDebito: RazaoLine[];
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

      // totalDebito = soma dos MOVIMENTOs (linhas totalizadoras) da categoria.
      // MOVIMENTOs são lançamentos contábeis de fechamento e não têm par no Journal.
      const totalDebito = razaoDestaCateg
        .filter((l) => l.isTotalizador && l.valorDebito > 0)
        .reduce((s, l) => s + l.valorDebito, 0);
      const totalCreditoRazao = creditosRazao.reduce((s, l) => s + l.valorCredito, 0);

      const journalDestaCateg = journalLines.filter(
        (l) => l.categoria === cat && l.credit > 0
      );
      const totalJournal = journalDestaCateg.reduce((s, l) => s + l.credit, 0);

      // Cruzamento por VALOR + NOME do hóspede (Transaction Number != Documento)
      const journalReal = journalDestaCateg.filter((l) => l.credit > 0);

      // Cruzamento direto por Documento (Razão) = Transaction Number (Journal)
      const razaoByDoc = new Map<string, RazaoLine>();
      for (const r of creditosRazao) {
        if (r.documento) razaoByDoc.set(r.documento.trim(), r);
      }

      const emAmbos: CategoryResult["emAmbos"] = [];
      const apenasNoJournal: JournalLine[] = [];

      for (const j of journalReal) {
        const trn = j.transactionNumber?.trim();
        const match = trn ? razaoByDoc.get(trn) : undefined;
        if (match) {
          emAmbos.push({ journal: j, razao: match });
          razaoByDoc.delete(trn!);
        } else {
          apenasNoJournal.push(j);
        }
      }

      const apenasNoRazao = creditosRazao.filter(
        (r) => !emAmbos.some((m) => m.razao.documento === r.documento)
      );

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
        linhasDebito: razaoDestaCateg.filter((l) => l.isTotalizador && l.valorDebito > 0),
      };
    });

    return {
      period: firstDate,
      categories: results,
      hasErrors: results.some((r) => !r.conciliado && r.totalDebito > 0),
    };
  }, [razaoLines, journalLines]);
}