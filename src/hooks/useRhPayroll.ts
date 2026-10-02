import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePayrollFile } from "@/lib/rhPayrollParser";

export interface PayrollSummary {
  total_cost: number;
  headcount: number;
  admitted: number;
  experience: number;
  terminated: number;
  has_termination_data: boolean;
  departments: { department: string; total_cost: number; headcount: number }[];
}

export function usePayrollSummary(hotelId?: string, month?: number, year?: number) {
  return useQuery({
    enabled: !!hotelId && !!month && !!year,
    queryKey: ["rh-payroll", "summary", hotelId, year, month],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rh_payroll_summary", {
        _hotel_id: hotelId!, _month: month!, _year: year!,
      });
      if (error) throw error;
      return data as unknown as PayrollSummary;
    },
  });
}

export function usePayrollHistory(hotelId?: string, year?: number) {
  return useQuery({
    enabled: !!hotelId && !!year,
    queryKey: ["rh-payroll", "history", hotelId, year],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rh_payroll_history", { _hotel_id: hotelId!, _year: year! });
      if (error) throw error;
      return (data ?? []) as { reference_month: number; total_cost: number; headcount: number }[];
    },
  });
}

/** Valores individuais — RLS só devolve linhas para RH/Master. */
export function usePayrollEntries(enabled: boolean, hotelId?: string, month?: number, year?: number) {
  return useQuery({
    enabled: enabled && !!hotelId && !!month && !!year,
    queryKey: ["rh-payroll", "entries", hotelId, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_payroll_entries")
        .select("id, employee_name, position, department, bond, admission_date, termination_date, base_salary, fgts, inss_patronal, total_cost")
        .eq("hotel_id", hotelId!).eq("reference_month", month!).eq("reference_year", year!)
        .order("department").order("employee_name")
        .range(0, 4999);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Roomnights = Ocupação × UHs disponíveis do consolidado da DRE. */
export function usePayrollRoomnights(hotelId?: string, month?: number, year?: number) {
  return useQuery({
    enabled: !!hotelId && !!month && !!year,
    queryKey: ["rh-payroll", "roomnights", hotelId, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consolidado_resultados_cache")
        .select("ocupacao, uhs_disponiveis")
        .eq("hotel_id", hotelId!).eq("month", month!).eq("year", year!)
        .maybeSingle();
      if (error) throw error;
      if (!data?.ocupacao || !data?.uhs_disponiveis) return null;
      return Math.round(Number(data.ocupacao) * Number(data.uhs_disponiveis));
    },
  });
}

export function useUploadPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, month, year }: { file: File; month: number; year: number }) => {
      const { data: hotels, error: hErr } = await supabase.from("hotels").select("id, name");
      if (hErr) throw hErr;
      const parsed = await parsePayrollFile(file, hotels ?? []);
      if (!parsed.sheets.length) throw new Error("Nenhuma aba corresponde a um hotel cadastrado.");

      const { data: up, error: uErr } = await supabase.from("rh_payroll_uploads").insert({
        file_name: file.name,
        reference_month: month,
        reference_year: year,
        hotels_imported: parsed.sheets.map((s) => s.hotelId),
        sheets_ignored: parsed.ignoredSheets,
        has_termination_column: parsed.hasTerminationColumn,
        rows_imported: parsed.sheets.reduce((a, s) => a + s.rows.length, 0),
      }).select("id").single();
      if (uErr) throw uErr;

      for (const s of parsed.sheets) {
        // Reenvio do mesmo mês substitui o retrato daquele hotel/mês; outros meses ficam intactos.
        const { error: dErr } = await supabase.from("rh_payroll_entries").delete()
          .eq("hotel_id", s.hotelId).eq("reference_month", month).eq("reference_year", year);
        if (dErr) throw dErr;
        for (let i = 0; i < s.rows.length; i += 500) {
          const { error } = await supabase.from("rh_payroll_entries").insert(
            s.rows.slice(i, i + 500).map((r) => ({
              ...r, upload_id: up.id, hotel_id: s.hotelId, reference_month: month, reference_year: year,
            })),
          );
          if (error) throw error;
        }
      }
      return parsed;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rh-payroll"] }),
  });
}

export async function logSensitiveExport(p: {
  module: string; format: string; hotelId?: string; month?: number; year?: number; details?: Record<string, unknown>;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("not authenticated");
  const { error } = await supabase.from("sensitive_export_log").insert({
    user_id: u.user.id,
    module: p.module,
    export_format: p.format,
    hotel_id: p.hotelId ?? null,
    reference_month: p.month ?? null,
    reference_year: p.year ?? null,
    details: (p.details ?? {}) as never,
  });
  if (error) throw error;
}
