import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  parseOperaReservations,
  parsePrefeituraNotas,
  type NfScope,
  type OperaReservation,
  type PrefeituraNota,
} from "@/lib/nfConferenceParser";

const PAGE = 1000;

/** Leitura sempre fresca: após um upload a próxima abertura já reflete o novo dado. */
const FRESH = { staleTime: 0, gcTime: 60_000, refetchOnMount: "always" as const };

async function fetchAllPaged<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> },
  maxRows = 200_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

interface OperaRow {
  property: string | null;
  confirmation_number: string;
  guest_name: string | null;
  arrival: string | null;
  departure: string | null;
  fiscal_bill_number: string | null;
  net_amount: number | string;
  payment_amount: number | string;
  entry_key: string;
}

interface NotaRow {
  numero_nfse: string;
  data_geracao: string | null;
  competencia: string | null;
  situacao: string | null;
  valor_servico: number | string;
  descricao: string | null;
  rps: string | null;
  confirmation_number: string | null;
  guest_name_extracted: string | null;
  check_in: string | null;
  check_out: string | null;
  entry_key: string;
}

/** Reagrupa as linhas gravadas em reservas (por confirmação). */
function rowsToReservations(rows: OperaRow[]): OperaReservation[] {
  const byConf = new Map<string, OperaReservation>();
  for (const r of rows) {
    const line = {
      property: r.property ?? "",
      confirmationNumber: r.confirmation_number,
      guestName: r.guest_name ?? "",
      arrival: r.arrival ?? "",
      departure: r.departure ?? "",
      fiscalBillNumber: r.fiscal_bill_number ?? "",
      netAmount: Number(r.net_amount) || 0,
      paymentAmount: Number(r.payment_amount) || 0,
      entryKey: r.entry_key,
    };
    const existing = byConf.get(line.confirmationNumber);
    if (existing) {
      existing.lines.push(line);
      existing.totalNet += line.netAmount;
      existing.totalPayment += line.paymentAmount;
    } else {
      byConf.set(line.confirmationNumber, {
        property: line.property,
        confirmationNumber: line.confirmationNumber,
        guestName: line.guestName,
        arrival: line.arrival,
        departure: line.departure,
        lines: [line],
        totalNet: line.netAmount,
        totalPayment: line.paymentAmount,
      });
    }
  }
  return [...byConf.values()];
}

function rowsToNotas(rows: NotaRow[]): PrefeituraNota[] {
  return rows.map((r) => ({
    numeroNfse: r.numero_nfse,
    dataGeracao: r.data_geracao ?? "",
    competencia: r.competencia ?? "",
    situacao: r.situacao ?? "",
    valorServico: Number(r.valor_servico) || 0,
    descricao: r.descricao ?? "",
    rps: r.rps,
    confirmationNumber: r.confirmation_number,
    guestNameExtracted: r.guest_name_extracted,
    checkIn: r.check_in,
    checkOut: r.check_out,
    entryKey: r.entry_key,
  }));
}

/** Contagem agregada no banco — não traz linha nenhuma para o navegador. */
export function useNfScopeCounts(hotelId: string | null, year: number, month: number) {
  return useQuery({
    queryKey: ["nf-counts", hotelId, year, month],
    enabled: !!hotelId,
    ...FRESH,
    queryFn: async () => {
      const scope = (table: "nf_opera_entries" | "nf_nota_entries") =>
        supabase
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq("hotel_id", hotelId!)
          .eq("ref_year", year)
          .eq("ref_month", month);
      const [opera, notas] = await Promise.all([scope("nf_opera_entries"), scope("nf_nota_entries")]);
      if (opera.error) throw opera.error;
      if (notas.error) throw notas.error;
      return { operaRows: opera.count ?? 0, notaRows: notas.count ?? 0 };
    },
  });
}

/** Linhas gravadas do escopo (hotel + mês), buscadas em páginas reais de 1.000. */
export function useNfScopeData(hotelId: string | null, year: number, month: number) {
  return useQuery({
    queryKey: ["nf-scope-data", hotelId, year, month],
    enabled: !!hotelId,
    ...FRESH,
    queryFn: async () => {
      const [operaRows, notaRows] = await Promise.all([
        fetchAllPaged<OperaRow>(() =>
          supabase
            .from("nf_opera_entries")
            .select(
              "property, confirmation_number, guest_name, arrival, departure, fiscal_bill_number, net_amount, payment_amount, entry_key",
            )
            .eq("hotel_id", hotelId!)
            .eq("ref_year", year)
            .eq("ref_month", month)
            .order("id", { ascending: true }),
        ),
        fetchAllPaged<NotaRow>(() =>
          supabase
            .from("nf_nota_entries")
            .select(
              "numero_nfse, data_geracao, competencia, situacao, valor_servico, descricao, rps, confirmation_number, guest_name_extracted, check_in, check_out, entry_key",
            )
            .eq("hotel_id", hotelId!)
            .eq("ref_year", year)
            .eq("ref_month", month)
            .order("id", { ascending: true }),
        ),
      ]);
      return {
        reservations: rowsToReservations(operaRows),
        notas: rowsToNotas(notaRows),
      };
    },
  });
}

export function useNfUploads(hotelId: string | null, year: number, month: number) {
  return useQuery({
    queryKey: ["nf-uploads", hotelId, year, month],
    enabled: !!hotelId,
    ...FRESH,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nf_uploads")
        .select("id, kind, file_name, rows_total, rows_inserted, created_at")
        .eq("hotel_id", hotelId!)
        .eq("ref_year", year)
        .eq("ref_month", month)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

const CHUNK = 500;

/**
 * Envio dos arquivos MTD. O escopo (hotel + período) é o do filtro no instante
 * do clique — recebido como parâmetro, nunca lido de estado possivelmente antigo.
 * A chave estável (entry_key) garante que reenviar o mês inteiro não duplique.
 */
export function useUploadNfFiles() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      scope,
      operaFile,
      prefeituraFile,
    }: {
      scope: NfScope;
      operaFile: File;
      prefeituraFile: File;
    }) => {
      const [reservations, notas] = await Promise.all([
        parseOperaReservations(operaFile, scope),
        parsePrefeituraNotas(prefeituraFile, scope),
      ]);

      if (!reservations.length) {
        throw new Error(
          `Não foi possível ler nenhuma reserva no arquivo do Opera (${operaFile.name}). Confira se é o relatório de Conferência de Notas Fiscais.`,
        );
      }
      if (!notas.length) {
        throw new Error(
          `Não foi possível ler nenhuma nota no arquivo da Prefeitura (${prefeituraFile.name}). O layout desse arquivo pode ser diferente — envie o arquivo para análise.`,
        );
      }


      const insertUpload = async (kind: "opera" | "nota", fileName: string, total: number) => {
        const { data, error } = await supabase
          .from("nf_uploads")
          .insert({
            hotel_id: scope.hotelId,
            ref_year: scope.refYear,
            ref_month: scope.refMonth,
            kind,
            file_name: fileName,
            rows_total: total,
            uploaded_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        return data.id as string;
      };

      const scopeCount = async (table: "nf_opera_entries" | "nf_nota_entries") => {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq("hotel_id", scope.hotelId)
          .eq("ref_year", scope.refYear)
          .eq("ref_month", scope.refMonth);
        if (error) throw error;
        return count ?? 0;
      };
      const operaBefore = await scopeCount("nf_opera_entries");
      const notaBefore = await scopeCount("nf_nota_entries");

      const operaLines = reservations.flatMap((r) => r.lines);
      const operaUploadId = await insertUpload("opera", operaFile.name, operaLines.length);
      const notaUploadId = await insertUpload("nota", prefeituraFile.name, notas.length);

      for (let i = 0; i < operaLines.length; i += CHUNK) {
        const batch = operaLines.slice(i, i + CHUNK).map((l) => ({
          hotel_id: scope.hotelId,
          ref_year: scope.refYear,
          ref_month: scope.refMonth,
          upload_id: operaUploadId,
          entry_key: l.entryKey,
          property: l.property || null,
          confirmation_number: l.confirmationNumber,
          guest_name: l.guestName || null,
          arrival: l.arrival || null,
          departure: l.departure || null,
          fiscal_bill_number: l.fiscalBillNumber || null,
          net_amount: l.netAmount,
          payment_amount: l.paymentAmount,
        }));
        const { error } = await supabase
          .from("nf_opera_entries")
          .upsert(batch, { onConflict: "entry_key", ignoreDuplicates: true });
        if (error) throw error;
      }

      for (let i = 0; i < notas.length; i += CHUNK) {
        const batch = notas.slice(i, i + CHUNK).map((n) => ({
          hotel_id: scope.hotelId,
          ref_year: scope.refYear,
          ref_month: scope.refMonth,
          upload_id: notaUploadId,
          entry_key: n.entryKey,
          numero_nfse: n.numeroNfse,
          data_geracao: n.dataGeracao || null,
          competencia: n.competencia || null,
          situacao: n.situacao || null,
          valor_servico: n.valorServico,
          descricao: n.descricao || null,
          rps: n.rps,
          confirmation_number: n.confirmationNumber,
          guest_name_extracted: n.guestNameExtracted,
          check_in: n.checkIn,
          check_out: n.checkOut,
        }));
        const { error } = await supabase
          .from("nf_nota_entries")
          .upsert(batch, { onConflict: "entry_key", ignoreDuplicates: true });
        if (error) throw error;
      }

      // Linhas realmente novas = diferença medida no banco (repetidas são ignoradas).
      const operaInserted = (await scopeCount("nf_opera_entries")) - operaBefore;
      const notaInserted = (await scopeCount("nf_nota_entries")) - notaBefore;

      await Promise.all([
        supabase.from("nf_uploads").update({ rows_inserted: operaInserted }).eq("id", operaUploadId),
        supabase.from("nf_uploads").update({ rows_inserted: notaInserted }).eq("id", notaUploadId),
      ]);

      return {
        operaTotal: operaLines.length,
        notaTotal: notas.length,
        operaInserted,
        notaInserted,
      };
    },
    onSuccess: (_d, vars) => {
      const { hotelId, refYear, refMonth } = vars.scope;
      qc.invalidateQueries({ queryKey: ["nf-scope-data", hotelId, refYear, refMonth] });
      qc.invalidateQueries({ queryKey: ["nf-counts", hotelId, refYear, refMonth] });
      qc.invalidateQueries({ queryKey: ["nf-uploads", hotelId, refYear, refMonth] });
    },
  });
}
