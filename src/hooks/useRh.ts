import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseRhFile, type ParsedRhEmployee } from "@/lib/rhParser";
import { detectGender } from "@/lib/rhGenderDetector";

// ---------- types ----------

export interface RhEmployee {
  id: string;
  hotel_id: string;
  employee_key: string;
  name: string;
  cpf: string | null;
  position: string | null;
  department: string | null;
  admission_date: string | null;
  termination_date: string | null;
  termination_reason: string | null;
  birth_date: string | null;
  gender: string | null;
  salary: number | null;
  status: string;
  source_format: string | null;
  reference_month: number | null;
  reference_year: number | null;
  upload_id: string | null;
  raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface RhCalendarDate {
  id: string;
  date_day: number;
  date_month: number;
  title: string;
  category: string;
  recurring: boolean;
  notes: string | null;
}

export interface RhOrgNode {
  id: string;
  parent_id: string | null;
  name: string;
  position: string | null;
  department: string | null;
  hotel_id: string | null;
  photo_url: string | null;
  is_open_position: boolean;
  sort_order: number;
}

export interface RhTraining {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  duration_minutes: number | null;
  mandatory: boolean;
  media_url: string | null;
  image_url: string | null;
  created_by: string;
  created_at: string;
}

export interface RhPolicy {
  id: string;
  title: string;
  category: string | null;
  content: string | null;
  document_url: string | null;
  version: string | null;
  published: boolean;
  created_by: string;
  created_at: string;
}

// ---------- queries ----------

export function useRhEmployees(hotelId?: string, referenceMonth?: number, referenceYear?: number) {
  return useQuery({
    queryKey: ["rh", "employees", hotelId ?? "all", referenceYear ?? "all-years", referenceMonth ?? "all-months"],
    queryFn: async () => {
      let q = supabase.from("rh_employees").select("*").order("name");
      if (hotelId) q = q.eq("hotel_id", hotelId);
      if (referenceMonth) q = q.eq("reference_month", referenceMonth);
      if (referenceYear) q = q.eq("reference_year", referenceYear);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RhEmployee[];
    },
  });
}

export function useRhCalendarDates() {
  return useQuery({
    queryKey: ["rh", "calendar-dates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_calendar_dates")
        .select("*")
        .order("date_month")
        .order("date_day");
      if (error) throw error;
      return (data ?? []) as RhCalendarDate[];
    },
  });
}

export function useOrgNodes(hotelId?: string) {
  return useQuery({
    queryKey: ["rh", "org-nodes", hotelId ?? "all"],
    queryFn: async () => {
      let q = supabase.from("rh_org_nodes").select("*").order("sort_order");
      if (hotelId) q = q.or(`hotel_id.is.null,hotel_id.eq.${hotelId}`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as RhOrgNode[];
    },
  });
}

export function useRhTrainings() {
  return useQuery({
    queryKey: ["rh", "trainings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_trainings")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RhTraining[];
    },
  });
}

export function useRhPolicies() {
  return useQuery({
    queryKey: ["rh", "policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rh_policies")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as RhPolicy[];
    },
  });
}

// ---------- mutations ----------

export function useUploadRhFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, hotelId, referenceMonth, referenceYear }: { file: File; hotelId: string; referenceMonth: number; referenceYear: number }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Não autenticado");

      const parsed = await parseRhFile(file);

      const { data: uploadRow, error: upErr } = await supabase
        .from("rh_uploads")
        .insert({
          hotel_id: hotelId,
          file_name: file.name,
          file_path: `${hotelId}/${Date.now()}_${file.name}`,
          file_size: file.size,
          uploaded_by: userId,
          detected_format: parsed.format,
          parsed_count: parsed.employees.length,
          parse_error: parsed.warnings.length ? parsed.warnings.join(" | ") : null,
          reference_month: referenceMonth,
          reference_year: referenceYear,
          metadata: { warnings: parsed.warnings, reference_month: referenceMonth, reference_year: referenceYear } as never,
        })
        .select()
        .single();
      if (upErr) throw upErr;

      if (parsed.employees.length > 0) {
        const rows = parsed.employees.map((e: ParsedRhEmployee) => ({
          hotel_id: hotelId,
          upload_id: uploadRow.id,
          employee_key: e.employee_key,
          name: e.full_name,
          cpf: e.cpf,
          position: e.role,
          department: e.department,
          admission_date: e.admission_date,
          termination_date: e.dismissal_date,
          birth_date: e.birth_date,
          gender: e.gender_raw || detectGender(e.full_name),
          salary: e.salary,
          status: e.status,
          source_format: parsed.format,
          reference_month: referenceMonth,
          reference_year: referenceYear,
          raw: e.raw as never,
        }));
        const { error: empErr } = await supabase
          .from("rh_employees")
          .upsert(rows, { onConflict: "hotel_id,employee_key,reference_year,reference_month" });
        if (empErr) throw empErr;
      }

      return { upload: uploadRow, parsed };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh", "employees"] });
    },
  });
}

export function useAddCalendarPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      date_id: string;
      year: number;
      title: string;
      content?: string;
      media_url?: string;
      status?: string;
      attachments?: Array<{ name: string; url: string }>;
    }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("rh_calendar_posts")
        .insert({
          author_id: userId,
          date_id: input.date_id,
          year: input.year,
          title: input.title,
          content: input.content ?? null,
          media_url: input.media_url ?? null,
          status: input.status ?? "draft",
          attachments: (input.attachments ?? []) as never,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh", "calendar-posts"] });
    },
  });
}

// ---------- metrics ----------

export interface RhMetrics {
  total: number;
  ativos: number;
  inativos: number;
  pctExperiencia: number;       // % com admissão < 90 dias
  pctTurnover: number;          // (adm + desl) / 2 / total * 100
  pctRotatividade: number;      // desligamentos / total * 100
  porSexo: { M: number; F: number; N: number };
  porFaixaEtaria: Record<string, number>;
  tempoCasaMedio: number;       // em anos, considerando ativos
}

const FAIXAS = [
  { label: "18-25", min: 18, max: 25 },
  { label: "26-35", min: 26, max: 35 },
  { label: "36-45", min: 36, max: 45 },
  { label: "46-55", min: 46, max: 55 },
  { label: "56+", min: 56, max: 200 },
];

function ageYears(birth: string | null, ref: Date): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  if (Number.isNaN(b.getTime())) return null;
  let age = ref.getFullYear() - b.getFullYear();
  const m = ref.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < b.getDate())) age--;
  return age;
}

function diffDays(from: string | null, to: Date): number | null {
  if (!from) return null;
  const d = new Date(from);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((to.getTime() - d.getTime()) / 86400000);
}

export function calcMetrics(
  employees: RhEmployee[],
  filterMonth?: number,
  filterYear?: number,
): RhMetrics {
  // Data de referência = último dia do mês/ano filtrados (ou hoje se não houver filtro).
  // Garante que ativos/sexo/faixa etária/tempo de casa reflitam o período escolhido,
  // e não apenas o momento atual.
  const now = new Date();
  const targetMonth = filterMonth ?? now.getMonth() + 1;
  const targetYear = filterYear ?? now.getFullYear();
  const referenceDate = new Date(targetYear, targetMonth, 0, 23, 59, 59); // último dia do mês
  const refTs = referenceDate.getTime();

  const isActiveAtRef = (e: RhEmployee): boolean => {
    const adm = e.admission_date ? new Date(e.admission_date).getTime() : NaN;
    if (Number.isNaN(adm) || adm > refTs) return false;
    if (!e.termination_date) return true;
    const term = new Date(e.termination_date).getTime();
    if (Number.isNaN(term)) return true;
    return term > refTs;
  };

  // Considera somente colaboradores que existiam até a data de referência.
  const knownAtRef = employees.filter((e) => {
    const adm = e.admission_date ? new Date(e.admission_date).getTime() : NaN;
    return !Number.isNaN(adm) && adm <= refTs;
  });
  const total = knownAtRef.length;
  const ativos = knownAtRef.filter(isActiveAtRef).length;
  const inativos = total - ativos;

  const ninetyMs = 90 * 86400000;

  let novos = 0;
  let admissoes = 0;
  let desligamentos = 0;
  const porSexo = { M: 0, F: 0, N: 0 };
  const porFaixaEtaria: Record<string, number> = Object.fromEntries(FAIXAS.map((f) => [f.label, 0]));
  porFaixaEtaria["desconhecida"] = 0;
  let tempoCasaSum = 0;
  let tempoCasaCount = 0;

  for (const e of knownAtRef) {
    const activeAtRef = isActiveAtRef(e);
    // sexo
    const g = (e.gender || "N").toUpperCase();
    if (activeAtRef) {
      if (g === "M" || g === "F") porSexo[g]++;
      else porSexo.N++;
    }

    // faixa etária (somente ativos)
    if (activeAtRef) {
      const age = ageYears(e.birth_date, referenceDate);
      if (age === null) porFaixaEtaria["desconhecida"]++;
      else {
        const f = FAIXAS.find((x) => age >= x.min && age <= x.max);
        porFaixaEtaria[f?.label ?? "desconhecida"]++;
      }
      // tempo de casa
      const days = diffDays(e.admission_date, referenceDate);
      if (days !== null && days >= 0) {
        tempoCasaSum += days / 365.25;
        tempoCasaCount++;
      }
    }

    // experiência: admitidos há menos de 90 dias
    if (e.admission_date) {
      const adm = new Date(e.admission_date).getTime();
      if (!Number.isNaN(adm) && refTs - adm < ninetyMs && refTs - adm >= 0 && activeAtRef) novos++;
    }

    // movimentações do mês/ano filtrados
    if (e.admission_date) {
      const adm = new Date(e.admission_date);
      if (adm.getFullYear() === targetYear && adm.getMonth() + 1 === targetMonth) {
        admissoes++;
      }
    }
    if (e.termination_date) {
      const term = new Date(e.termination_date);
      if (term.getFullYear() === targetYear && term.getMonth() + 1 === targetMonth) {
        desligamentos++;
      }
    }
  }

  const safeTotal = total || 1;
  return {
    total,
    ativos,
    inativos,
    pctExperiencia: (novos / safeTotal) * 100,
    pctTurnover: ((admissoes + desligamentos) / 2 / safeTotal) * 100,
    pctRotatividade: (desligamentos / safeTotal) * 100,
    porSexo,
    porFaixaEtaria,
    tempoCasaMedio: tempoCasaCount ? tempoCasaSum / tempoCasaCount : 0,
  };
}