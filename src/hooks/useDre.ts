import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeFileName } from "@/lib/constants";
import { parseDreExcel } from "@/lib/dreParser";

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
    mutationFn: async (input: { closingId: string; file: File; userId: string }) => {
      const { closingId, file, userId } = input;

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
        const parsed = await parseDreExcel(file);
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
        const otherRows = parsed.lines.slice(0, 200).map((l) => ({
          closing_id: closingId,
          version_number: nextVersion,
          line_label: l.label,
          line_type: "line",
          line_value: l.value,
        }));
        if (indicatorRows.length || otherRows.length) {
          await supabase.from("dre_parsed_lines").insert([...indicatorRows, ...otherRows]);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ status_dre: "aguardando_comentarios" } as any)
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
      return ((data ?? []).filter((r) => r.version_number === top)) as DreIndicatorRow[];
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