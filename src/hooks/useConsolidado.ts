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
function findIndicatorByPattern(lines: ParsedLine[], patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const hits = lines.filter((l) => {
      if (l.line_type !== "indicator") return false;
      const prefixMatch = l.line_label.match(/^\s*\[([^\]]+)\]\s*/);
      const key = prefixMatch?.[1] ?? "";
      // Ignora projeções de orçamento (bline_*) e ano anterior (pline_*).
      if (/^(bline|pline)_/i.test(key)) return false;
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

export function useConsolidadoData(input: {
  hotelIds: string[];
  year: number;
  month: number;
}) {
  return useQuery({
    enabled: input.hotelIds.length > 0,
    queryKey: ["consolidado", input.hotelIds, input.year, input.month],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<ConsolidadoRow[]> => {
      const [{ data: closings, error: cErr }, { data: hotelRows }] = await Promise.all([
        supabase
        .from("closings")
        .select("id, hotel_id, final_distribution, estimated_distribution")
        .in("hotel_id", input.hotelIds)
        .eq("year", input.year)
        .eq("month", input.month),
        supabase
          .from("hotels")
          .select("id, num_apartments")
          .in("id", input.hotelIds),
      ]);
      if (cErr) throw cErr;
      const numApartmentsByHotel = new Map<string, number | null>();
      for (const h of (hotelRows ?? []) as { id: string; num_apartments: number | null }[]) {
        numApartmentsByHotel.set(h.id, h.num_apartments ?? null);
      }

      const closingIds = (closings ?? []).map((c) => c.id);
      const linesByClosing = new Map<string, ParsedLine[]>();
      if (closingIds.length > 0) {
        const pageSize = 1000;
        for (let from = 0; ; from += pageSize) {
          const { data, error } = await supabase
            .rpc("get_latest_dre_lines_by_closings", { _closing_ids: closingIds })
            .range(from, from + pageSize - 1);
          if (error) throw error;
          const batch = (data ?? []) as ParsedLine[];
          for (const row of batch) {
            if (!row.closing_id) continue;
            const list = linesByClosing.get(row.closing_id) ?? [];
            list.push(row);
            linesByClosing.set(row.closing_id, list);
          }
          if (batch.length < pageSize) break;
        }
      }

      // Busca adicional para linhas de Taxa Fee, Incentive Fee e Distribuição
      // que são salvas como line_type = "line" (não "indicator")
      if (closingIds.length > 0) {
        const { data: extraLines } = await supabase
          .from("dre_parsed_lines")
          .select("closing_id, line_label, line_value, line_type, version_number")
          .in("closing_id", closingIds)
          .eq("line_type", "line")
          .or([
            "line_label.ilike.%taxa%falcon%",
            "line_label.ilike.%fee%falcon%",
            "line_label.ilike.%taxa%sucesso%",
            "line_label.ilike.%incentive%fee%",
            "line_label.ilike.%distribui%",
            "line_label.ilike.%por uh%",
            "line_label.ilike.%por_uh%",
            "line_label.ilike.%dividendo%",
            "line_label.ilike.%rendimento%",
            "line_label.ilike.%lucro%distribu%",
            "line_label.ilike.%resultado%exerc%",
            "line_label.ilike.%preju%distribu%",
            "line_label.ilike.%resultado%distribu%",
            "line_label.ilike.%taxa%administ%gop%",
            "line_label.ilike.%fundo%reserva%",
            "line_label.ilike.%reposi%patrimonial%",
          ].join(","));

        for (const row of (extraLines ?? []) as ParsedLine[]) {
          if (!row.closing_id) continue;
          const list = linesByClosing.get(row.closing_id) ?? [];
          const existingVersions = list.filter((l) => l.line_type === "line");
          const maxVersion = existingVersions.length > 0
            ? Math.max(...existingVersions.map((l) => (l.version_number ?? 0) as number))
            : (row.version_number ?? 0);
          if ((row.version_number ?? 0) >= maxVersion) {
            list.push(row);
            linesByClosing.set(row.closing_id, list);
          }
        }
      }

      return input.hotelIds.map((hotelId) => {
        const closing = (closings ?? []).find((c) => c.hotel_id === hotelId) ?? null;
        const lines: ParsedLine[] = closing ? linesByClosing.get(closing.id) ?? [] : [];
        const ocupacao = findIndicator(lines, "ocupacao");
        const adr = findIndicator(lines, "adr");
        const revpar = findIndicator(lines, "revpar");
        const receitaBruta = findIndicator(lines, "receita_bruta_total");
        const gop = findIndicator(lines, "gop");
        const uhsDisponiveis = findIndicator(lines, "uhs_disponiveis");
        const distribuicaoTotal =
          (closing?.final_distribution as number | null | undefined) ??
          (closing?.estimated_distribution as number | null | undefined) ??
          null;
        const taxaFee = findLineByPattern(lines, TAXA_FEE_PATTERNS);
        // Só cai para o indicador derivado quando NÃO existe linha contábil
        // correspondente (caso Manhattan). Se a linha existe mas está zerada,
        // o valor real é zero — não substituir por projeção de orçamento.
        const incentiveFee = hasLineMatching(lines, TAXA_SUCESSO_PATTERNS)
          ? findLineByPattern(lines, TAXA_SUCESSO_PATTERNS)
          : findIndicatorByPattern(lines, TAXA_SUCESSO_PATTERNS);
        const fundoReserva = findLineByPattern(lines, FUNDO_RESERVA_PATTERNS);
        // Prioriza a linha explícita da DRE; só cai para o valor salvo no
        // closing (que vem do lucro_liquido do estimador) quando a linha
        // não existir.
        const patterns =
          LUCRO_A_DISTRIBUIR_PATTERNS_BY_HOTEL[hotelId] ?? LUCRO_A_DISTRIBUIR_PATTERNS;
        const lucroADistribuir = findLineByPattern(lines, patterns);
        const distribuicaoTotalFinal =
          lucroADistribuir != null ? lucroADistribuir : distribuicaoTotal;
        const distribuicaoPorUh = NO_DISTRIB_UH_HOTELS.has(hotelId)
          ? null
          : (() => {
              const fromDre = findLineByPattern(lines, DISTRIBUICAO_POR_UH_PATTERNS);
              if (fromDre != null) return Math.abs(fromDre);
              // Block 12: usa nº fixo de apartamentos do hotel (não UHs do mês).
              const numApartments = numApartmentsByHotel.get(hotelId) ?? null;
              return distribuicaoTotalFinal != null && numApartments && numApartments > 0
                ? distribuicaoTotalFinal / numApartments
                : null;
            })();
        return {
          hotelId,
          closingId: closing?.id ?? null,
          ocupacao,
          adr,
          revpar,
          receitaBruta,
          taxaFee: taxaFee != null ? Math.abs(taxaFee) : null,
          incentiveFee: incentiveFee != null ? Math.abs(incentiveFee) : null,
          distribuicaoTotal: distribuicaoTotalFinal,
          uhsDisponiveis,
          distribuicaoPorUh,
          gop,
          fundoReserva: fundoReserva != null ? Math.abs(fundoReserva) : null,
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
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!closingId) return null;
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
      const taxaSucesso =
        findLineByPattern(lines, TAXA_SUCESSO_PATTERNS) ??
        findIndicatorByPattern(lines, TAXA_SUCESSO_PATTERNS);
      return {
        uhsDisponiveis,
        taxaFee: taxaFee != null ? Math.abs(taxaFee) : null,
        taxaSucesso: taxaSucesso != null ? Math.abs(taxaSucesso) : null,
      };
    },
  });
}