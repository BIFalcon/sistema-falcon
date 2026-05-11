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
}

interface ParsedLine {
  closing_id?: string;
  line_label: string;
  line_value: number | null;
  line_type?: string | null;
}

function findIndicator(lines: ParsedLine[], key: string): number | null {
  const rx = new RegExp(`^\\[${key}\\]`, "i");
  const hit = lines.find((l) => l.line_type === "indicator" && rx.test(l.line_label));
  return hit?.line_value ?? null;
}

function findLineByPattern(lines: ParsedLine[], patterns: RegExp[]): number | null {
  for (const p of patterns) {
    const hit = lines.find((l) => l.line_type !== "indicator" && p.test(l.line_label));
    if (hit && hit.line_value != null) return hit.line_value;
  }
  return null;
}

const TAXA_FEE_PATTERNS = [
  /taxas?\s+(de\s+)?administra[çc][ãa]o\s+falcon/i,
  /taxa\s+falcon/i,
  /^fees?\s+falcon/i,
];
const TAXA_SUCESSO_PATTERNS = [
  /taxa\s+(de\s+)?sucesso/i,
  /incentive\s+fee/i,
];

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
      const { data: closings, error: cErr } = await supabase
        .from("closings")
        .select("id, hotel_id, final_distribution, estimated_distribution")
        .in("hotel_id", input.hotelIds)
        .eq("year", input.year)
        .eq("month", input.month);
      if (cErr) throw cErr;

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
        const incentiveFee = findLineByPattern(lines, TAXA_SUCESSO_PATTERNS);
        const distribuicaoPorUh =
          distribuicaoTotal != null && uhsDisponiveis && uhsDisponiveis > 0
            ? distribuicaoTotal / uhsDisponiveis
            : null;
        return {
          hotelId,
          closingId: closing?.id ?? null,
          ocupacao,
          adr,
          revpar,
          receitaBruta,
          taxaFee: taxaFee != null ? Math.abs(taxaFee) : null,
          incentiveFee: incentiveFee != null ? Math.abs(incentiveFee) : null,
          distribuicaoTotal,
          uhsDisponiveis,
          distribuicaoPorUh,
          gop,
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
      const taxaSucesso = findLineByPattern(lines, TAXA_SUCESSO_PATTERNS);
      return {
        uhsDisponiveis,
        taxaFee: taxaFee != null ? Math.abs(taxaFee) : null,
        taxaSucesso: taxaSucesso != null ? Math.abs(taxaSucesso) : null,
      };
    },
  });
}