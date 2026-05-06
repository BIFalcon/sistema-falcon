import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GopManager {
  user_id: string;
  display_name: string;
  email: string | null;
  hotel_ids: string[];
}

export function useGopManagers() {
  return useQuery({
    queryKey: ["gop-managers"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<GopManager[]> => {
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "gop");
      if (rolesErr) throw rolesErr;
      const ids = Array.from(new Set((roles ?? []).map((r) => r.user_id)));
      if (ids.length === 0) return [];

      const [{ data: profiles, error: pErr }, { data: hotels, error: hErr }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("user_id, display_name, email")
            .in("user_id", ids),
          supabase.from("user_hotels").select("user_id, hotel_id").in("user_id", ids),
        ]);
      if (pErr) throw pErr;
      if (hErr) throw hErr;

      const byUser = new Map<string, string[]>();
      for (const row of hotels ?? []) {
        const arr = byUser.get(row.user_id) ?? [];
        arr.push(row.hotel_id);
        byUser.set(row.user_id, arr);
      }

      function shortName(full: string): string {
        const f = full.trim();
        if (/geraldo\s+magela/i.test(f)) return "Magela";
        // primeiro nome
        return f.split(/\s+/)[0] || f;
      }
      return (profiles ?? [])
        .map((p) => ({
          user_id: p.user_id,
          display_name: shortName(p.display_name ?? p.email ?? ""),
          email: p.email,
          hotel_ids: byUser.get(p.user_id) ?? [],
        }))
        .filter((g) => g.hotel_ids.length > 0)
        .sort((a, b) => a.display_name.localeCompare(b.display_name));
    },
  });
}