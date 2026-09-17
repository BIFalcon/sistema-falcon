/**
 * Hook para o Consolidado de Resultados — busca, para cada hotel permitido,
 * o fechamento do mês/ano e as linhas DRE (versão mais recente), montando
 * uma linha por hotel com indicadores e taxas para a tabela consolidada.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ConsolidadoRow {
  hotelId: string;
  closingId: string | null;
  statusDre: string | null;
  ocupacao: number | null;          // 0..1 ou %
  adr: number | null;
  revpar: number | null;
  receitaBruta: number | null;
  taxaFee: number | null;            // Taxa Falcon s/ Receita
  incentiveFee: number | null;       // Taxa de Sucesso
  distribuicaoTotal: number | null;
  uhsDisponiveis: number | null;
  distribuicaoPorUh: number | null;
  gop: number | null;
  fundoReserva: number | null;       // (-) Fundo de Reservas e Reposição Patrimonial
}

interface ParsedLine {
  closing_id?: string;
  line_label: string;
  line_value: number | null;
  line_type?: string | null;
  version_number?: number | null;
}

function findIndicator(lines: ParsedLine[], key: string): number | null {
  const rx = new RegExp(`^\\[${key}\\]`, "i");
  const hit = lines.find((l) => l.line_type === "indicator" && rx.test(l.line_label));
  return hit?.line_value ?? null;
}

function findLineByPattern(lines: ParsedLine[], patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const hits = lines.filter((l) => l.line_type !== "indicator" && p.test(l.line_label));
    for (const hit of hits) {
      if (hit.line_value != null && hit.line_value !== 0) return hit.line_value;
    }
  }
  return null;
}

/**
 * True quando existe ao menos uma linha contábil (line_type !== "indicator")
 * cujo rótulo bate com algum dos padrões — independentemente do valor.
 * Usado para decidir se devemos cair para o fallback de indicadores.
 */
function hasLineMatching(lines: ParsedLine[], patterns: RegExp[]): boolean {
  return lines.some(
    (l) => l.line_type !== "indicator" && patterns.some((p) => p.test(l.line_label)),
  );
}

/**
 * Fallback: alguns hotéis (ex.: Manhattan) só expõem a linha
 * "Taxa de Administração s/ GOP" como indicador derivado da DRE,
 * e não como linha contábil "line". Procuramos também entre
 * indicadores, ignorando o prefixo `[chave]` no início do rótulo.
 *
 * IMPORTANTE: ignoramos prefixos `[bline_*]` (orçamento/budget) e
 * `[pline_*]` (ano anterior) — esses representam projeções/comparativos,
 * não o valor real do mês corrente.
 */
function findIndicatorByPattern(
  lines: ParsedLine[],
  patterns: RegExp[],
  targetMonth?: number,
): number | null {
  for (const p of patterns) {
    const hits = lines.filter((l) => {
      if (l.line_type !== "indicator") return false;
      const prefixMatch = l.line_label.match(/^\s*\[([^\]]+)\]\s*/);
      const key = prefixMatch?.[1] ?? "";
      // Ignora projeções de orçamento (bline_*) e ano anterior (pline_*).
      if (/^(bline|pline)_/i.test(key)) return false;
      // Série mensal do ano corrente: só aceita o mês alvo (evita cair
      // no primeiro mês não-zero, tipicamente janeiro).
      const cm = /^cline_(\d{1,2})$/i.exec(key);
      if (cm) {
        if (!targetMonth) return false;
        if (Number(cm[1]) !== targetMonth) return false;
      }
      const label = l.line_label.replace(/^\s*\[[^\]]+\]\s*/, "");
      return p.test(label);
    });
    for (const hit of hits) {
      if (hit.line_value != null && hit.line_value !== 0) return hit.line_value;
    }
  }
  return null;
}

const TAXA_FEE_PATTERNS = [
  /taxas?\s+(de\s+)?administra[çc][ãa]o\s+falcon/i,
  /taxa\s+falcon/i,
  /^fees?\s+falcon/i,
  /fees?\s+falcon\s+hotels?/i,
  /taxas?\s+(de\s+)?administra[çc][ãa]o\s+s\/\s*receita/i,
];
const TAXA_SUCESSO_PATTERNS = [
  /taxa\s+(de\s+)?sucesso/i,
  /incentive\s+fee/i,
  /taxa\s+(de\s+)?administra[çc][ãa]o\s+s\/\s*gop/i,
  /taxa\s+de\s+administra[çc][ãa]o\s+s[\/\\]\s*gop/i,
  /taxa.*adm.*gop/i,
  /5010209006/i,
];

const FUNDO_RESERVA_PATTERNS = [
  /fundo\s+de\s+reservas?\s+e\s+reposi[çc][ãa]o\s+patrimonial/i,
  /fundo\s+de\s+reservas?(\s+e\s+reposi[çc][ãa]o)?/i,
  /reposi[çc][ãa]o\s+patrimonial/i,
];

// Hotéis sem distribuição por UH
const NO_DISTRIB_UH_HOTELS = new Set([
  "ibis-styles-confins",
  "mercure-macae",
  "ibis-budget-recife",
]);

const DISTRIBUICAO_POR_UH_PATTERNS = [
  /distribui[çc][ãa]o\s+por\s+(tipo\s+(de\s+)?)?uh/i,
  /^por\s+uh$/i,
  /distribui[çc][ãa]o\s+por\s+uh/i,
  /dividendo\s+efetivamente\s+distribu[íi]do\s+\(por\s+apartamento\)/i,
];

// Linha "Lucro / Prejuízo a Distribuir do período" (e variantes).
// Quando presente na DRE, ela tem prioridade sobre o Lucro Líquido /
// Prejuízo do Exercício (que ainda fica acima dela na DRE, antes das
// deduções de taxas pós-GOP). É essa linha que deve alimentar a coluna
// "Distrib. Total" do Consolidado.
const LUCRO_A_DISTRIBUIR_PATTERNS = [
  /lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir\s+(do|no)\s+per[íi]odo/i,
  /lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir/i,
  /^\s*lucro\s+a\s+distribuir/i,
  /^\s*preju[íi]zo\s+a\s+distribuir/i,
  /resultado\s+a\s+distribuir/i,
];

// Override por hotel: no Ibis Budget Recife (Jaboatão) a linha que
// representa a "Distribuição Total" da DRE é o "Resultado Operacional
// Líquido" — a linha "Lucro / Prejuízo a Distribuir do período" vem
// sempre zerada nesse modelo. Mesma particularidade já tratada no
// dreParser para o indicador `lucro_liquido`.
const LUCRO_A_DISTRIBUIR_PATTERNS_BY_HOTEL: Record<string, RegExp[]> = {
  "ibis-budget-recife": [
    /^resultado\s+operacional\s+l[íi]quido/i,
    ...[
      /lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir\s+(do|no)\s+per[íi]odo/i,
      /lucro\s*\/?\s*preju[íi]zo\s+a\s+distribuir/i,
    ],
  ],
};

/**
 * Lê o resumo já pré-computado em `consolidado_resultados_cache`.
 * A tabela é recalculada por trigger no banco a cada nova versão de DRE
 * (dre_versions / dre_parsed_lines) e a cada mudança de status/distribuição
 * do fechamento — portanto aqui basta um SELECT simples.
 */
export function useConsolidadoData(input: {
  hotelIds: string[];
  year: number;
  month: number;
}) {
  return useQuery({
    enabled: input.hotelIds.length > 0,
    queryKey: ["consolidado", input.hotelIds, input.year, input.month],
    staleTime: 0,
    gcTime: 60 * 1000,
    refetchOnMount: "always",
    queryFn: async (): Promise<ConsolidadoRow[]> => {
      const { data, error } = await supabase
        .from("consolidado_resultados_cache")
        .select(
          "hotel_id, closing_id, status_dre, ocupacao, adr, revpar, receita_bruta, taxa_fee, incentive_fee, distribuicao_total, uhs_disponiveis, distribuicao_por_uh, gop, fundo_reserva",
        )
        .in("hotel_id", input.hotelIds)
        .eq("year", input.year)
        .eq("month", input.month);
      if (error) throw error;

      const byHotel = new Map(
        (data ?? []).map((r) => [r.hotel_id as string, r]),
      );

      return input.hotelIds.map((hotelId) => {
        const r = byHotel.get(hotelId);
        return {
          hotelId,
          closingId: r?.closing_id ?? null,
          statusDre: r?.status_dre ?? null,
          ocupacao: r?.ocupacao ?? null,
          adr: r?.adr ?? null,
          revpar: r?.revpar ?? null,
          receitaBruta: r?.receita_bruta ?? null,
          taxaFee: r?.taxa_fee ?? null,
          incentiveFee: r?.incentive_fee ?? null,
          distribuicaoTotal: r?.distribuicao_total ?? null,
          uhsDisponiveis: r?.uhs_disponiveis ?? null,
          distribuicaoPorUh: r?.distribuicao_por_uh ?? null,
          gop: r?.gop ?? null,
          fundoReserva: r?.fundo_reserva ?? null,
        } satisfies ConsolidadoRow;
      });
    },
  });
}

/**
 * Versão para um único closing — usado no diálogo do Financeiro
 * para mostrar Distribuição/UH, Taxa Fee e Taxa de Sucesso.
 */
export function useClosingFinanceMetrics(closingId: string | null) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["closing-finance-metrics", closingId],
    staleTime: 30 * 1000,
    queryFn: async () => {
      if (!closingId) return null;
      const { data: closingRow } = await supabase
        .from("closings")
        .select("month, hotel_id, final_distribution, estimated_distribution")
        .eq("id", closingId)
        .maybeSingle();
      const closingMonth = (closingRow?.month as number | undefined) ?? undefined;
      const hotelId = (closingRow?.hotel_id as string | undefined) ?? undefined;
      const lines: ParsedLine[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .rpc("get_latest_dre_lines", { _closing_id: closingId })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as ParsedLine[];
        lines.push(...batch);
        if (batch.length < pageSize) break;
      }
      const uhsDisponiveis = findIndicator(lines, "uhs_disponiveis");
      const taxaFee = findLineByPattern(lines, TAXA_FEE_PATTERNS);
      const taxaSucesso = hasLineMatching(lines, TAXA_SUCESSO_PATTERNS)
        ? findLineByPattern(lines, TAXA_SUCESSO_PATTERNS)
        : findIndicatorByPattern(lines, TAXA_SUCESSO_PATTERNS, closingMonth);
      const patterns =
        (hotelId && LUCRO_A_DISTRIBUIR_PATTERNS_BY_HOTEL[hotelId]) ||
        LUCRO_A_DISTRIBUIR_PATTERNS;
      const lucroADistribuir = findLineByPattern(lines, patterns);
      const distribuicaoTotal =
        lucroADistribuir != null
          ? lucroADistribuir
          : (closingRow?.final_distribution as number | null | undefined) ??
            (closingRow?.estimated_distribution as number | null | undefined) ??
            null;
      let distribuicaoPorUh: number | null = null;
      if (hotelId && !NO_DISTRIB_UH_HOTELS.has(hotelId)) {
        const fromDre = findLineByPattern(lines, DISTRIBUICAO_POR_UH_PATTERNS);
        if (fromDre != null) {
          distribuicaoPorUh = Math.abs(fromDre);
        } else {
          const { data: hotelRow } = await supabase
            .from("hotels")
            .select("num_apartments")
            .eq("id", hotelId)
            .maybeSingle();
          const numApartments = (hotelRow?.num_apartments as number | null | undefined) ?? null;
          if (distribuicaoTotal != null && numApartments && numApartments > 0) {
            distribuicaoPorUh = distribuicaoTotal / numApartments;
          }
        }
      }
      return {
        uhsDisponiveis,
        taxaFee: taxaFee != null ? Math.abs(taxaFee) : null,
        taxaSucesso: taxaSucesso != null ? Math.abs(taxaSucesso) : null,
        distribuicaoTotal,
        distribuicaoPorUh,
      };
    },
  });
}