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
  opera_property_name?: string | null;
  cnpj?: string | null;
}

export const FALCON_LOGO_KEY = "falcon_logo_url";

/** Safe column list — bank_accounts and cnpj are revoked at the column-grant level. */
const HOTEL_SELECT_COLUMNS =
  "id,name,brand,active,is_active,cover_url,brand_logo_url,opera_property_name,num_apartments,financial_system,show_in_closing,created_at";

export function useAllHotels() {
  return useQuery({
    queryKey: ["hotels", "all"],
    queryFn: async (): Promise<HotelRow[]> => {
      const { data, error } = await supabase
        .from("hotels")
        .select(HOTEL_SELECT_COLUMNS)
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
        .select(HOTEL_SELECT_COLUMNS)
        .eq("id", hotelId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as HotelRow | null;
    },
  });
}

/**
 * Sensitive fields (bank_accounts, cnpj) are only fetchable via a SECURITY DEFINER
 * RPC. Authorized roles: master, controladoria, patronos.
 */
export function useHotelFinancial(hotelId: string | null | undefined) {
  return useQuery({
    enabled: !!hotelId,
    queryKey: ["hotels", "financial", hotelId],
    queryFn: async (): Promise<{ bank_accounts: Array<{ bank: string; account: string }>; cnpj: string | null } | null> => {
      if (!hotelId) return null;
      const { data, error } = await supabase.rpc("get_hotel_financial", { _hotel_id: hotelId });
      if (error) {
        // Not authorized → silently return null so the UI can hide the section.
        return null;
      }
      const row = (data ?? [])[0] as { bank_accounts: unknown; cnpj: string | null } | undefined;
      if (!row) return null;
      return {
        bank_accounts: (row.bank_accounts as Array<{ bank: string; account: string }>) ?? [],
        cnpj: row.cnpj,
      };
    },
  });
}

export function useUpdateHotelAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<HotelRow> }) => {
      const { error } = await supabase
        .from("hotels")
        .update(input.patch as Partial<HotelRow>)
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
