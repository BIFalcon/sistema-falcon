import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseRhMonthlyFile, type RhMonthlyResult } from "@/lib/rhMonthlyParser";

interface PayrollEntry {
 id: string; employee_name: string; position: string | null; department: string | null; bond: string | null; admission_date: string | null; termination_date: string | null; base_salary: number | null; fgts: number | null; inss_patronal: number | null; total_cost: number | null;
}

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
      if (!hotelId) throw new Error("Selecione um hotel.");
      if (!month || !year) throw new Error("Selecione um período.");
      const { data, error } = await supabase.rpc("get_rh_payroll_summary", {
        _hotel_id: hotelId, _month: month, _year: year,
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
      if (!hotelId) throw new Error("Selecione um hotel.");
      if (!year) throw new Error("Selecione um ano.");
      const { data, error } = await supabase.rpc("get_rh_payroll_history", { _hotel_id: hotelId, _year: year });
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
      if (!hotelId) throw new Error("Selecione um hotel.");
      if (!month || !year) throw new Error("Selecione um período.");
      const { data, error } = await supabase.rpc("get_rh_monthly_payroll_entries", {
        _hotel_id: hotelId, _month: month, _year: year,
      });
      if (error) throw error;
      return (data ?? []) as PayrollEntry[];
    },
  });
}

/** Roomnights = Ocupação × UHs disponíveis do consolidado da DRE. */
export function usePayrollRoomnights(hotelId?: string, month?: number, year?: number) {
  return useQuery({
    enabled: !!hotelId && !!month && !!year,
    queryKey: ["rh-payroll", "roomnights", hotelId, year, month],
    queryFn: async () => {
      if (!hotelId) throw new Error("Selecione um hotel.");
      const { data, error } = await supabase
        .from("consolidado_resultados_cache")
        .select("ocupacao, uhs_disponiveis")
        .eq("hotel_id", hotelId).eq("month", month ?? 0).eq("year", year ?? 0)
        .maybeSingle();
      if (error) throw error;
      if (!data?.ocupacao || !data?.uhs_disponiveis) return null;
      return Math.round(Number(data.ocupacao) * Number(data.uhs_disponiveis));
    },
  });
}

export async function previewMonthlyPayroll(file: File) {
  const { data: hotels, error } = await supabase.from("hotels").select("id, name");
  if (error) throw new Error(error.message);
  return parseRhMonthlyFile(file, hotels ?? []);
}

export function useUploadPayroll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, parsed }: { file: File; parsed: RhMonthlyResult }) => {
      const { error } = await supabase.rpc("import_rh_monthly", {
        _file_name: file.name, _month: parsed.month, _year: parsed.year,
        _rows: parsed.rows as unknown as import("@/integrations/supabase/types").Json,
        _unknown_hotels: parsed.unknownHotels as unknown as import("@/integrations/supabase/types").Json,
      });
      if (error) throw new Error(error.message);
      return parsed;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-payroll"] });
      qc.invalidateQueries({ queryKey: ["rh", "employees"] });
    },
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
