import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeFileName } from "@/lib/constants";
import { parseDreExcel } from "@/lib/dreParser";
import { mergeDreDatasets, parseDreAnalyticsWorkbook, type DreAnalyticsDataset } from "@/lib/dreAnalytics";
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
        const otherRows = [...baseRows, ...extraKeyRows].map((l) => ({
          closing_id: closingId,
          version_number: nextVersion,
          line_label: l.label,
          line_type: "line",
          line_value: l.value,
        }));
        // Séries mensais Jan-Dez (current e previous) para alimentar gráficos
        // comparativos da Carta. Persistidas como indicadores extras com prefixo
        // [series_<scope>_<key>_<mes>] (mes 1..12).
        const seriesRows: typeof indicatorRows = [];
        const pushSeries = (
          scope: "cur" | "prev",
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
        if (indicatorRows.length || otherRows.length || seriesRows.length || prevIndicatorRows.length) {
          await supabase.from("dre_parsed_lines").insert([
            ...indicatorRows, ...otherRows, ...seriesRows, ...prevIndicatorRows,
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
            } as Record<string, unknown>)
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
          .update({ status_dre: "aguardando_comentarios" } as Record<string, unknown>)
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
export function useDreIndicators(closingId: string | null | undefined) {
  return useQuery({
    enabled: !!closingId,
    queryKey: ["dre-indicators", closingId],
    queryFn: async (): Promise<DreIndicatorRow[]> => {
      if (!closingId) return [];
      const { data, error } = await supabase
        .from("dre_parsed_lines")
        .select("line_label, line_value, version_number, line_type")
        .eq("closing_id", closingId)
        .eq("line_type", "indicator")
        .order("version_number", { ascending: false });
      if (error) throw error;
      // mantém só a versão mais recente
      const top = data?.[0]?.version_number;
      // Filtra também as linhas de séries mensais (que poluiriam o painel),
      // mantendo apenas indicadores do mês corrente ([key]) e do ano
      // anterior ([prev_key]). Cada linha de série tem prefixo [series_…].
      return ((data ?? [])
        .filter((r) => r.version_number === top)
        .filter((r) => !r.line_label.startsWith("[series_"))) as DreIndicatorRow[];
    },
  });
}

export function useDreAnalytics(input: { hotelIds: string[]; year: number }) {
  return useQuery({
    enabled: input.hotelIds.length > 0,
    queryKey: ["dre-analytics", input.hotelIds, input.year],
    queryFn: async (): Promise<DreAnalyticsDataset | null> => {
      const datasets: DreAnalyticsDataset[] = [];
      for (const hotelId of input.hotelIds) {
        const { data: closing, error: closingError } = await supabase
          .from("closings")
          .select("id, hotel_id, year")
          .eq("hotel_id", hotelId)
          .eq("year", input.year)
          .order("month", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (closingError) throw closingError;
        if (!closing) continue;

        const { data: version, error: versionError } = await supabase
          .from("dre_versions")
          .select("file_url, file_name, version_number")
          .eq("closing_id", closing.id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (versionError) throw versionError;
        if (!version?.file_url) continue;

        const { data: file, error: downloadError } = await supabase.storage
          .from("closings")
          .download(version.file_url);
        if (downloadError) throw downloadError;
        datasets.push(parseDreAnalyticsWorkbook(await file.arrayBuffer(), version.file_name));
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