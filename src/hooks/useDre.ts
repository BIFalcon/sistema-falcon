import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeFileName } from "@/lib/constants";

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

      return { version: nextVersion, isFirst };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["dre-versions", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closing", vars.closingId] });
      qc.invalidateQueries({ queryKey: ["closings"] });
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