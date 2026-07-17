import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "user-avatars";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

async function signedUrl(path: string, bust?: string | number) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  if (error || !data?.signedUrl) return null;
  return bust ? `${data.signedUrl}${data.signedUrl.includes("?") ? "&" : "?"}t=${bust}` : data.signedUrl;
}

export function useAvatarUrl(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["avatar-url", userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list("", { search: userId });
      if (error) return null;
      const file = data?.find((f) => f.name.startsWith(userId));
      if (!file) return null;
      const updated = file.updated_at ?? file.created_at ?? "";
      return await signedUrl(file.name, new Date(updated).getTime() || Date.now());
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useUploadAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, file }: { userId: string; file: File }) => {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${userId}.${ext}`;

      // Limpa eventuais arquivos anteriores com extensão diferente
      const { data: existing } = await supabase.storage
        .from(BUCKET)
        .list("", { search: userId });
      const toRemove = (existing ?? [])
        .filter((f) => f.name.startsWith(userId) && f.name !== `${userId}.${ext}`)
        .map((f) => f.name);
      if (toRemove.length) {
        await supabase.storage.from(BUCKET).remove(toRemove);
      }

      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      return await signedUrl(path, Date.now());
    },
    onSuccess: (_url, { userId }) => {
      qc.invalidateQueries({ queryKey: ["avatar-url", userId] });
    },
  });
}