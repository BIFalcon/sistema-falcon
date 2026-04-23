import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface HotelRow {
  id: string;
  name: string;
  brand: string;
  active: boolean;
  cover_url: string | null;
  brand_logo_url: string | null;
  created_at: string;
  financial_system: "totvs" | "omie" | null;
}

export const FALCON_LOGO_KEY = "falcon_logo_url";

export function useAllHotels() {
  return useQuery({
    queryKey: ["hotels", "all"],
    queryFn: async (): Promise<HotelRow[]> => {
      const { data, error } = await supabase
        .from("hotels")
        .select("*")
        .order("name");
      if (error) throw error;
      return (data ?? []) as HotelRow[];
    },
  });
}

export function useHotel(hotelId: string | null | undefined) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["hotels", hotelId],
    queryFn: async (): Promise<HotelRow | null> => {
      if (!hotelId) return null;
      const { data, error } = await supabase
        .from("hotels")
        .select("*")
        .eq("id", hotelId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as HotelRow | null;
    },
  });
}

export function useUpdateHotelAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<HotelRow> }) => {
      const { error } = await supabase
        .from("hotels")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update(input.patch as any)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["hotels"] });
      qc.invalidateQueries({ queryKey: ["hotels", v.id] });
    },
  });
}

export async function uploadHotelAsset(
  hotelId: string,
  kind: "cover" | "brand-logo",
  file: File,
): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${hotelId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("hotel-assets")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("hotel-assets").getPublicUrl(path);
  return data.publicUrl;
}

/* ───────── Falcon institucional (system-assets) ───────── */

export function useFalconLogo() {
  return useQuery({
    queryKey: ["system-settings", FALCON_LOGO_KEY],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", FALCON_LOGO_KEY)
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? null) as string | null;
    },
  });
}

export function useUpdateFalconLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { url: string; userId: string }) => {
      const { error } = await supabase.from("system_settings").upsert({
        key: FALCON_LOGO_KEY,
        value: input.url,
        updated_by: input.userId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system-settings", FALCON_LOGO_KEY] }),
  });
}

export async function uploadFalconLogo(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `falcon-logo-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("system-assets")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from("system-assets").getPublicUrl(path);
  return data.publicUrl;
}
