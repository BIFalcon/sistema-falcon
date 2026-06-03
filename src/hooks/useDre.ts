import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { sanitizeFileName } from "@/lib/constants";
import { parseDreExcel } from "@/lib/dreParser";
import { INDICATOR_LABELS, getDreLineCategory, getDreLineCategorization } from "@/lib/dreParser";
import type { IndicatorKey } from "@/lib/dreParser";
import { DRE_FIXED_TREE, INDICATORS, type DreTreeNode } from "@/lib/dreParser";
import { mergeDreDatasets, type DreAnalyticsDataset, type DreLineNode } from "@/lib/dreAnalytics";
import { buildAliasIndex } from "@/lib/dreLabelAliases";
import {
  estimateDistribution,
  buildHistoryEntry,
  type HistoryEntry,
} from "@/lib/dreEstimator";

export interface DreVersion {
  id: string;
  closing_id: string;
  version_number: number;
  file_url: string;
  file_name: string;
  author_id: string;
  created_at: string;
}

export function useDreVersions(closingId: string | null | undefined) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["dre-versions", closingId],
    queryFn: async (): Promise<DreVersion[]> => {
      if (!closingId) return [];
      const { data, error } = await supabase
        .from("dre_versions")
        .select("*")
        .eq("closing_id", closingId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DreVersion[];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Faz upload de uma planilha DRE para o bucket `closings` e cria nova linha em dre_versions.
 * Versionamento incremental: pega o maior version_number atual e soma 1.
 * Também garante que o status_dre saia de 'nao_iniciado' para 'aguardando_comentarios'.
 */
export function useUploadDre() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { closingId: string; file: File; userId: string; month: number }) => {
      const { closingId, file, userId, month } = input;

      const { data: existing, error: errVer } = await supabase
        .from("dre_versions")
        .select("version_number")
        .eq("closing_id", closingId)
        .order("version_number", { ascending: false })
        .limit(1);
      if (errVer) throw errVer;
      const nextVersion = (existing?.[0]?.version_number ?? 0) + 1;
      const isFirst = nextVersion === 1;

      const cleanName = sanitizeFileName(file.name);
      const path = `${closingId}/v${nextVersion}_${cleanName}`;

      const { error: upErr } = await supabase.storage
        .from("closings")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      const { error: insErr } = await supabase.from("dre_versions").insert({
        closing_id: closingId,
        version_number: nextVersion,
        file_url: path,
        file_name: file.name,
        author_id: userId,
      });
      if (insErr) throw insErr;

      // Parse Excel client-side e persiste linhas/indicadores
      let parseWarnings: string[] = [];
      let template = "DEFAULT";
      try {
        const parsed = await parseDreExcel(file, { targetMonth: month });
        template = parsed.template;
        parseWarnings = parsed.warnings;
        // Persist key indicators + raw lines (limita a 200 linhas para não estourar)
        const indicatorRows = Object.values(parsed.indicators)
          .filter((i): i is NonNullable<typeof i> => !!i)
          .map((i) => ({
            closing_id: closingId,
            version_number: nextVersion,
            line_label: `[${i.key}] ${i.label}`,
            line_type: "indicator",
            line_value: i.value,
          }));
        // Limite alto para garantir que linhas no fim da DRE (ex.: "Por UH",
        // que aparece após "Lucro / Prejuízo a Distribuir no Período") sejam
        // persistidas e exibidas na tabela DRE da Carta ao Investidor.
        const KEY_LINE_RX = [
          /^por\s+uh$/i,
          /distribui[çc][ãa]o\s+por\s+uh/i,
          /distribui[çc][ãa]o\s+\/\s*uh/i,
          /resultado\s+por\s+uh/i,
        ];
        const baseRows = parsed.lines.slice(0, 1000);
        const baseSet = new Set(baseRows.map((l) => l.row));
        const extraKeyRows = parsed.lines.filter(
          (l) => !baseSet.has(l.row) && KEY_LINE_RX.some((rx) => rx.test(l.label)),
        );
        const otherRows = [...baseRows, ...extraKeyRows].map((l) => {
          const cat = getDreLineCategorization(l.label);
          return {
            closing_id: closingId,
            version_number: nextVersion,
            line_label: l.label,
            line_type: "line",
            line_value: l.value,
            line_level: l.level ?? 3,
            line_category: cat?.catMacro ?? getDreLineCategory(l.label),
            line_segment: cat?.segment ?? null,
          };
        });
        // Séries mensais Jan-Dez (current e previous) para alimentar gráficos
        // comparativos da Carta. Persistidas como indicadores extras com prefixo
        // [series_<scope>_<key>_<mes>] (mes 1..12).
        const seriesRows: typeof indicatorRows = [];
        const pushSeries = (
          scope: "cur" | "prev" | "budget",
          map: typeof parsed.currentSeries,
        ) => {
          for (const [k, arr] of Object.entries(map ?? {})) {
            if (!arr) continue;
            arr.forEach((v, i) => {
              if (v == null) return;
              seriesRows.push({
                closing_id: closingId,
                version_number: nextVersion,
                line_label: `[series_${scope}_${k}_${i + 1}]`,
                line_type: "indicator",
                line_value: v,
              });
            });
          }
        };
        pushSeries("cur", parsed.currentSeries);
        pushSeries("prev", parsed.previousSeries);
        pushSeries("budget", parsed.budgetSeries);
        // Indicadores orçados do mês
        const budgetIndicatorRows: typeof indicatorRows = [];
        for (const [k, v] of Object.entries(parsed.budgetIndicators ?? {})) {
          if (v == null) continue;
          budgetIndicatorRows.push({
            closing_id: closingId,
            version_number: nextVersion,
            line_label: `[budget_${k}]`,
            line_type: "indicator",
            line_value: v,
          });
        }
        // Indicadores do mesmo mês do ano anterior (p/ painel "Indicadores
        // extraídos" e prompt da IA): persistidos com prefixo [prev_<key>].
        const prevIndicatorRows: typeof indicatorRows = [];
        for (const [k, v] of Object.entries(parsed.previousIndicators ?? {})) {
          if (v == null) continue;
          prevIndicatorRows.push({
            closing_id: closingId,
            version_number: nextVersion,
            line_label: `[prev_${k}]`,
            line_type: "indicator",
            line_value: v,
          });
        }
        // Linhas detalhadas do Orçamento — série anual (Jan-Dez por linha)
        const budgetLineRows: typeof otherRows = [];
        for (const bl of parsed.budgetLines ?? []) {
          const cat = getDreLineCategorization(bl.label);
          for (const [monthStr, val] of Object.entries(bl.values)) {
            if (val == null) continue;
            budgetLineRows.push({
              closing_id: closingId,
              version_number: nextVersion,
              line_label: `[bline_${monthStr}] ${bl.label}`,
              line_type: "indicator",
              line_value: val,
              line_level: bl.level ?? 3,
              line_category: cat?.catMacro ?? "Outros",
              line_segment: cat?.segment ?? null,
            });
          }
        }
        // Linhas detalhadas do ANO ANTERIOR — série anual
        const prevLineRows2: typeof otherRows = [];
        for (const pl of parsed.prevLines ?? []) {
          const cat = getDreLineCategorization(pl.label);
          for (const [monthStr, val] of Object.entries(pl.values)) {
            if (val == null) continue;
            prevLineRows2.push({
              closing_id: closingId,
              version_number: nextVersion,
              line_label: `[pline_${monthStr}] ${pl.label}`,
              line_type: "indicator",
              line_value: val,
              line_level: pl.level ?? 3,
              line_category: cat?.catMacro ?? "Outros",
              line_segment: cat?.segment ?? null,
            });
          }
        }
        if (indicatorRows.length || otherRows.length || seriesRows.length || prevIndicatorRows.length || budgetIndicatorRows.length || budgetLineRows.length || prevLineRows2.length) {
          await supabase.from("dre_parsed_lines").insert([
            ...indicatorRows, ...otherRows, ...seriesRows, ...prevIndicatorRows, ...budgetIndicatorRows, ...budgetLineRows, ...prevLineRows2,
          ]);
        }

        // === Estimativa de distribuição ===
        // Buscar até 3 fechamentos aprovados anteriores do mesmo hotel para
        // construir o histórico. Só roda se tivermos hotel_id do closing atual.
        const { data: cur } = await supabase
          .from("closings")
          .select("hotel_id, month, year")
          .eq("id", closingId)
          .maybeSingle();
        if (cur) {
          // pega últimos 3 closings aprovados do mesmo hotel anteriores ao atual
          const { data: prevClosings } = await supabase
            .from("closings")
            .select("id, year, month")
            .eq("hotel_id", cur.hotel_id)
            .eq("status_dre", "aprovado")
            .or(
              `year.lt.${cur.year},and(year.eq.${cur.year},month.lt.${cur.month})`,
            )
            .order("year", { ascending: false })
            .order("month", { ascending: false })
            .limit(3);

          const history: HistoryEntry[] = [];
          if (prevClosings && prevClosings.length > 0) {
            for (const pc of prevClosings) {
              const { data: lines } = await supabase
                .from("dre_parsed_lines")
                .select("line_label, line_value, version_number")
                .eq("closing_id", pc.id)
                .eq("line_type", "indicator")
                .order("version_number", { ascending: false });
              if (!lines || lines.length === 0) continue;
              const topVersion = lines[0].version_number;
              const topRows = lines.filter((l) => l.version_number === topVersion);
              history.push(buildHistoryEntry(topRows));
            }
          }

          const estimate = estimateDistribution(parsed, history);
          await supabase
            .from("closings")
            .update({
              estimated_distribution: estimate.estimated_distribution,
              estimated_lines: estimate.lines as unknown as object,
              estimated_at: new Date().toISOString(),
            } as TablesUpdate<"closings">)
            .eq("id", closingId);
        }
      } catch (parseErr) {
        parseWarnings.push(parseErr instanceof Error ? parseErr.message : "Falha no parsing");
      }

      // Avança status se ainda estava nao_iniciado
      const { data: c } = await supabase
        .from("closings")
        .select("status_dre")
        .eq("id", closingId)
        .maybeSingle();
      if (c && c.status_dre === "nao_iniciado") {
        await supabase
          .from("closings")
          .update({ status_dre: "aguardando_controladoria" } as TablesUpdate<"closings">)
          .eq("id", closingId);
      }

      return { version: nextVersion, isFirst, template, warnings: parseWarnings };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["dre-versions", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closing", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closings"] });
      qc.invalidateQueries({ queryKey: ["dre-indicators", vars.closingId] });
    },
  });
}

/**
 * Lê os indicadores parseados da última versão do DRE.
 */
export interface DreIndicatorRow {
  line_label: string;
  line_value: number | null;
  version_number: number;
}

type DreParsedLineRecord = DreIndicatorRow & {
  closing_id?: string;
  line_type?: string | null;
  line_level?: number | null;
  line_category?: string | null;
  line_segment?: string | null;
};

async function fetchLatestDreParsedLines(closingId: string): Promise<DreParsedLineRecord[]> {
  const rows: DreParsedLineRecord[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .rpc("get_latest_dre_lines", { _closing_id: closingId })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as DreParsedLineRecord[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function fetchLatestDreParsedLinesByClosingIds(closingIds: string[]): Promise<Map<string, DreParsedLineRecord[]>> {
  const result = new Map<string, DreParsedLineRecord[]>();
  if (closingIds.length === 0) return result;
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .rpc("get_latest_dre_lines_by_closings", { _closing_ids: closingIds })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = (data ?? []) as DreParsedLineRecord[];
    for (const row of batch) {
      if (!row.closing_id) continue;
      const list = result.get(row.closing_id) ?? [];
      list.push(row);
      result.set(row.closing_id, list);
    }
    if (batch.length < pageSize) break;
  }
  return result;
}

export function useDreIndicators(closingId: string | null | undefined) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["dre-indicators", closingId],
    queryFn: async (): Promise<DreIndicatorRow[]> => {
      if (!closingId) return [];
      // Filtra também as linhas de séries mensais (que poluiriam o painel),
      // mantendo apenas indicadores do mês corrente ([key]) e do ano
      // anterior ([prev_key]). Cada linha de série tem prefixo [series_…].
      const data = await fetchLatestDreParsedLines(closingId);
      return (data
        .filter((r) => r.line_type === "indicator")
        .filter((r) => !r.line_label.startsWith("[series_"))) as DreIndicatorRow[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useDreAnalytics(input: { hotelIds: string[]; year: number; month: number; periodMonths?: number }) {
  return useDreAnalyticsImpl(input);
}

function useDreAnalyticsImpl(input: {
  hotelIds: string[];
  year: number;
  month: number;
  periodMonths?: number;
}) {
  return useQuery({
    enabled: input.hotelIds.length > 0,
    queryKey: ["dre-analytics", [...input.hotelIds].sort().join(","), input.year, input.month, input.periodMonths ?? 1],
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
    queryFn: async (): Promise<DreAnalyticsDataset | null> => {
      const datasets: DreAnalyticsDataset[] = [];
      const nMonths = input.periodMonths ?? 1;
      const startMonth = Math.max(1, input.month - nMonths + 1);
      const currentMonthRange = Array.from(
        { length: input.month - startMonth + 1 },
        (_, i) => startMonth + i,
      );
      const fullYearRange = Array.from({ length: 12 }, (_, i) => i + 1);
      const { data: allClosings, error: closingsError } = await supabase
        .from("closings")
        .select("id, month, hotel_id")
        .in("hotel_id", input.hotelIds)
        .eq("year", input.year)
        .in("month", fullYearRange);
      if (closingsError) throw closingsError;
      const linesByClosingId = await fetchLatestDreParsedLinesByClosingIds((allClosings ?? []).map((c) => c.id));

      const results = await Promise.all(
        input.hotelIds.map(async (hotelId): Promise<DreAnalyticsDataset | null> => {
          const allYearClosings = (allClosings ?? []).filter((c) => c.hotel_id === hotelId);
          const currentClosings = allYearClosings.filter((c) => currentMonthRange.includes(c.month));

          if (!currentClosings?.length && !allYearClosings?.length) return null;

        type LineRow = {
          line_label: string;
          line_value: number | null;
          version_number: number;
          _month: number;
          line_level?: number | null;
          line_type?: string | null;
          line_category?: string | null;
          line_segment?: string | null;
        };
        // Linhas do período atual → alimentam série "current"
        const currentLines: LineRow[] = [];
        for (const closing of currentClosings ?? []) {
          const closingLines = linesByClosingId.get(closing.id) ?? [];
          if (!closingLines?.length) continue;
          currentLines.push(
            ...closingLines
              .map((l) => ({ ...l, _month: closing.month })) as LineRow[]
          );
        }

        // Linhas de todos os meses → alimentam séries "budget" e "previous"
        const allYearLines: LineRow[] = [];
        for (const closing of allYearClosings ?? []) {
          const alreadyRead = currentClosings?.some((c) => c.id === closing.id);
          if (alreadyRead) {
            allYearLines.push(...currentLines.filter((l) => l._month === closing.month));
            continue;
          }
          const closingLines = linesByClosingId.get(closing.id) ?? [];
          if (!closingLines?.length) continue;
          allYearLines.push(
            ...closingLines
              .map((l) => ({ ...l, _month: closing.month })) as LineRow[]
          );
        }

        // Combina: current usa currentLines, budget/previous usam allYearLines
        const allLines: LineRow[] = [...new Map(
          [...currentLines, ...allYearLines].map((l) => [`${l._month}:${l.line_label}`, l])
        ).values()];
        if (!allLines.length) return null;

        const seriesCur: Record<string, (number | null)[]> = {};
        const seriesPrev: Record<string, (number | null)[]> = {};
        const seriesBudget: Record<string, (number | null)[]> = {};
        const budgetIndicators: Record<string, number | null> = {};
        const indicators: Record<string, { label: string; value: number | null }> = {};

        for (const line of currentLines) {
          const lbl = line.line_label;
          const val = line.line_value;

          const curMatch = lbl.match(/^\[series_cur_(.+)_(\d+)\]$/);
          if (curMatch) {
            const [, key, mStr] = curMatch;
            const m = parseInt(mStr, 10) - 1;
            if (!seriesCur[key]) seriesCur[key] = Array(12).fill(null);
            seriesCur[key][m] = val ?? null;
            continue;
          }

          const prevMatch = lbl.match(/^\[series_prev_(.+)_(\d+)\]$/);
          if (prevMatch) {
            const [, key, mStr] = prevMatch;
            const m = parseInt(mStr, 10) - 1;
            if (!seriesPrev[key]) seriesPrev[key] = Array(12).fill(null);
            seriesPrev[key][m] = val ?? null;
            continue;
          }

          const budgetSeriesMatch = lbl.match(/^\[series_budget_(.+)_(\d+)\]$/);
          if (budgetSeriesMatch) {
            const [, key, mStr] = budgetSeriesMatch;
            const m = parseInt(mStr, 10) - 1;
            if (!seriesBudget[key]) seriesBudget[key] = Array(12).fill(null);
            seriesBudget[key][m] = val ?? null;
            continue;
          }
          const budgetIndMatch = lbl.match(/^\[budget_([^\]\s]+)\]/);
          if (budgetIndMatch) {
            budgetIndicators[budgetIndMatch[1]] = val ?? null;
            continue;
          }

          const indMatch = lbl.match(/^\[([^\]\s]+)\]/);
          if (indMatch && !indMatch[1].startsWith("prev_") && !indMatch[1].startsWith("series_")) {
            const key = indMatch[1];
            indicators[key] = {
              label: INDICATOR_LABELS[key as IndicatorKey] ?? key,
              value: val ?? null,
            };
          }
        }

        // Processa allYearLines para budget e previous (série anual completa)
        for (const line of allYearLines) {
          const lbl = line.line_label;
          const val = line.line_value;
          const mIdx = (line._month ?? input.month) - 1;

          const budgetSeriesMatch = lbl.match(/^\[series_budget_(.+)_(\d+)\]$/);
          if (budgetSeriesMatch) {
            const [, key, mStr] = budgetSeriesMatch;
            const m = parseInt(mStr, 10) - 1;
            if (!seriesBudget[key]) seriesBudget[key] = Array(12).fill(null);
            seriesBudget[key][m] = val ?? null;
            continue;
          }
          const budgetIndMatch = lbl.match(/^\[budget_([^\]\s]+)\]/);
          if (budgetIndMatch) {
            if (budgetIndicators[budgetIndMatch[1]] == null) {
              budgetIndicators[budgetIndMatch[1]] = val ?? null;
            }
            const key = budgetIndMatch[1];
            if (!seriesBudget[key]) seriesBudget[key] = Array(12).fill(null);
            seriesBudget[key][mIdx] = val ?? null;
            continue;
          }
          const prevSeriesMatch = lbl.match(/^\[series_prev_(.+)_(\d+)\]$/);
          if (prevSeriesMatch) {
            const [, key, mStr] = prevSeriesMatch;
            const m = parseInt(mStr, 10) - 1;
            if (!seriesPrev[key]) seriesPrev[key] = Array(12).fill(null);
            seriesPrev[key][m] = val ?? null;
            continue;
          }
          const prevIndMatch = lbl.match(/^\[prev_([^\]\s]+)\]/);
          if (prevIndMatch) {
            const key = prevIndMatch[1];
            if (!seriesPrev[key]) seriesPrev[key] = Array(12).fill(null);
            seriesPrev[key][mIdx] = val ?? null;
            continue;
          }
        }

        // Mapas de séries anuais para linhas detalhadas de orçamento e ano anterior
        // Formato no banco: "[bline_3] Salários" = valor de março do orçamento
        const budgetDetailSeries = new Map<string, (number | null)[]>();
        const prevDetailSeries = new Map<string, (number | null)[]>();

        for (const line of allLines) {
          const lbl = line.line_label;
          const val = line.line_value;

          const bMatch = lbl.match(/^\[bline_(\d+)\]\s(.+)$/);
          if (bMatch) {
            const m = parseInt(bMatch[1], 10) - 1;
            const label = bMatch[2];
            if (!budgetDetailSeries.has(label)) budgetDetailSeries.set(label, Array(12).fill(null));
            budgetDetailSeries.get(label)![m] = val ?? null;
            continue;
          }

          const pMatch = lbl.match(/^\[pline_(\d+)\]\s(.+)$/);
          if (pMatch) {
            const m = parseInt(pMatch[1], 10) - 1;
            const label = pMatch[2];
            if (!prevDetailSeries.has(label)) prevDetailSeries.set(label, Array(12).fill(null));
            prevDetailSeries.get(label)![m] = val ?? null;
            continue;
          }
        }

        const nodes: DreLineNode[] = [];
        const allKeys = new Set([
          ...Object.keys(seriesCur),
          ...Object.keys(indicators),
          ...Object.keys(seriesBudget),
          ...Object.keys(seriesPrev),
        ]);

        for (const key of allKeys) {
          const current = seriesCur[key] ?? Array(12).fill(null);
          const previous = seriesPrev[key] ?? Array(12).fill(null);

          for (const line of allLines) {
            const lbl = line.line_label;
            const indM = lbl.match(/^\[([^\]\s]+)\]/);
            if (
              indM &&
              indM[1] === key &&
              !lbl.startsWith("[series_") &&
              !lbl.startsWith("[prev_") &&
              !lbl.startsWith("[budget_")
            ) {
              const mIdx = (line._month ?? input.month) - 1;
              if (current[mIdx] == null) current[mIdx] = line.line_value ?? null;
            }
          }

          const budget = seriesBudget[key] ?? Array(12).fill(null);
          if (!seriesBudget[key] && budgetIndicators[key] != null) {
            budget[input.month - 1] = budgetIndicators[key];
          }

          nodes.push({
            id: `1:${key}`,
            label: indicators[key]?.label ?? INDICATOR_LABELS[key as IndicatorKey] ?? key,
            level: 1,
            series: {
              current,
              budget,
              previous,
            },
          children: [],
          });
        }

        // Agrupa linhas por label combinando meses do período (mantém ordem
        // de primeira aparição via Map).
        const linesByLabel = new Map<string, {
          level: number;
          category: string;
          segment: string | null;
          values: Map<number, number | null>;
        }>();
        for (const line of allLines) {
          if (line.line_type !== "line") continue;
          const lbl = line.line_label;
          if (!lbl || lbl.startsWith("[")) continue;
          const level = (line.line_level ?? 3) as number;
          const category = (line.line_category ?? "Despesas Específicas") as string;
          const segment = ((line as { line_segment?: string | null }).line_segment) ?? null;
          const month = line._month ?? input.month;
          if (!linesByLabel.has(lbl)) {
            linesByLabel.set(lbl, { level, category, segment, values: new Map() });
          }
          linesByLabel.get(lbl)!.values.set(month, line.line_value ?? null);
        }

        // Normaliza string para comparação tolerante a variações
        const normLabel = (s: string): string =>
          s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
            .toLowerCase().replace(/\s+/g, " ").trim();

        // Comparação ainda mais tolerante: ignora acentos, caixa, conteúdo
        // entre parênteses, marcadores contábeis "(=)", "(+)", "(-)",
        // pontuação e dobras de espaço. Também aceita match por
        // "contém" quando o termo mais curto tem >= 6 chars (ex.:
        // "Despesas Fixas Totais" vs "DESPESAS FIXAS TOTAIS (R$)").
        const cleanForMatch = (s: string) =>
          s
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            // remove marcadores tipo (=) (+) (-) no início
            .replace(/^\s*\(\s*[=+\-]\s*\)\s*/, "")
            // remove qualquer grupo entre parênteses
            .replace(/\s*\([^)]*\)/g, "")
            // troca pontuação por espaço
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const aliasIndex = buildAliasIndex(cleanForMatch);
        const looseLabelMatch = (a: string, b: string): boolean => {
          const ca = cleanForMatch(a);
          const cb = cleanForMatch(b);
          if (!ca || !cb) return false;
          if (ca === cb) return true;
          const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
          if (shorter.length >= 6 && longer.includes(shorter)) return true;
          // Aliases manuais (sinônimos / typos / reordenações)
          const aliasesA = aliasIndex.get(ca);
          if (aliasesA && aliasesA.includes(cb)) return true;
          const aliasesB = aliasIndex.get(cb);
          if (aliasesB && aliasesB.includes(ca)) return true;
          // Match também por containment via alias
          if (aliasesA && aliasesA.some((al) => al && (al === cb || (al.length >= 6 && (al.includes(cb) || cb.includes(al)))))) return true;
          if (aliasesB && aliasesB.some((al) => al && (al === ca || (al.length >= 6 && (al.includes(ca) || ca.includes(al)))))) return true;
          return false;
        };

        // Busca série de um label nos dados do banco
        const findSeriesForLabel = (label: string): (number | null)[] => {
          const norm = normLabel(label);
          for (const [lbl, data] of linesByLabel) {
            if (looseLabelMatch(lbl, label)) {
              const series: (number | null)[] = Array(12).fill(null);
              for (const [m, v] of data.values) series[m - 1] = v;
              return series;
            }
          }
          return Array(12).fill(null);
        };

        // Busca série de budget para um label da árvore fixa
        const findBudgetForLabel = (label: string): (number | null)[] => {
          const norm = normLabel(label);
          // 1. Linha detalhada do orçamento (série anual completa via [bline_M])
          for (const [lbl, series] of budgetDetailSeries) {
            if (looseLabelMatch(lbl, label)) return series;
          }
          // 2. Indicadores parseados (séries mensais ou valor único)
          for (const ind of INDICATORS) {
            if (ind.rx.some((rx) => rx.test(label))) {
              if (seriesBudget[ind.key]) return seriesBudget[ind.key]!;
              if (budgetIndicators[ind.key] != null) {
                const s: (number | null)[] = Array(12).fill(null);
                s[input.month - 1] = budgetIndicators[ind.key];
                return s;
              }
            }
          }
          return Array(12).fill(null);
        };

        // Busca série de ano anterior para um label da árvore fixa
        const findPreviousForLabel = (label: string): (number | null)[] => {
          const norm = normLabel(label);
          // 1. Linha detalhada do ano anterior (série anual completa via [pline_M])
          for (const [lbl, series] of prevDetailSeries) {
            if (looseLabelMatch(lbl, label)) return series;
          }
          // 2. Indicadores parseados
          for (const ind of INDICATORS) {
            if (ind.rx.some((rx) => rx.test(label))) {
              if (seriesPrev[ind.key]) return seriesPrev[ind.key]!;
            }
          }
          return Array(12).fill(null);
        };

        // Converte DreTreeNode em DreLineNode recursivamente
        const buildFixedNode = (treeNode: DreTreeNode, depth: number): DreLineNode => {
          const current  = findSeriesForLabel(treeNode.label);
          const budget   = findBudgetForLabel(treeNode.label);
          const previous = findPreviousForLabel(treeNode.label);
          const children = (treeNode.children ?? []).map((child) =>
            buildFixedNode(child, depth + 1)
          );
          return {
            id: `fixed:${depth}:${treeNode.label.toLowerCase().trim()}`,
            label: treeNode.label,
            level: Math.min(depth + 1, 3) as 1 | 2 | 3,
            series: { current, budget, previous },
            children,
          };
        };

        const fixedRootNodes: DreLineNode[] = DRE_FIXED_TREE.map((node) =>
          buildFixedNode(node, 0)
        );

        const flattenNodes = (ns: DreLineNode[]): DreLineNode[] =>
          ns.flatMap((n) => [n, ...flattenNodes(n.children)]);
        const allFlat = [...nodes, ...flattenNodes(fixedRootNodes)];

          if (nodes.length || fixedRootNodes.length) {
            return {
              tree: [...nodes, ...fixedRootNodes],
              flat: allFlat,
              hotelCount: 1,
              sourceNames: [hotelId],
            };
          }
          return null;
        })
      );

      for (const ds of results) {
        if (ds) datasets.push(ds);
      }

      if (!datasets.length) return null;
      return datasets.length === 1 ? datasets[0] : mergeDreDatasets(datasets);
    },
  });
}

/**
 * Gera URL assinada (privado) para download de uma versão do DRE.
 */
export async function getDreSignedUrl(path: string, expiresInSeconds = 60 * 60): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("closings")
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}