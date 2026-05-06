/**
 * Upload retroativo de DRE — usado por Masters para carregar uma planilha
 * histórica e armazenar TODOS os meses presentes nela de uma só vez,
 * pulando o workflow de aprovação (todos os fechamentos criados ficam
 * direto como "aprovado").
 *
 * A planilha DRE da Falcon contém 12 colunas mensais (Jan..Dez). Para cada
 * mês com dados, criamos/atualizamos o closing correspondente e gravamos
 * uma versão com as linhas parseadas, do mesmo jeito que `useUploadDre`
 * faria no fluxo normal — porém sem disparar notificações de workflow
 * (status já entra como "aprovado").
 */
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { sanitizeFileName } from "@/lib/constants";
import { parseDreExcel, getDreLineCategory, getDreLineCategorization, type ParsedDre } from "@/lib/dreParser";

export interface RetroUploadResult {
  monthsDetected: number[];
  monthsProcessed: number[];
  monthsFailed: { month: number; error: string }[];
}

function hasAnyData(parsed: ParsedDre): boolean {
  // Aceita se tem pelo menos um indicador com valor numérico válido
  // independente de monthColumnIndex (que pode ser null em alguns templates)
  return Object.values(parsed.indicators).some(
    (i) => i && typeof i.value === "number" && Number.isFinite(i.value),
  );
}

export async function uploadRetroactiveDre(input: {
  hotelId: string;
  year: number;
  file: File;
  userId: string;
  upToMonth: number;
}): Promise<RetroUploadResult> {
  const { hotelId, year, file, userId, upToMonth } = input;

  // 1. Detecta quais meses (1..12) realmente têm dados no arquivo.
  const monthsDetected: number[] = [];
  const parsedByMonth = new Map<number, ParsedDre>();
  for (let m = 1; m <= upToMonth; m++) {
    try {
      const parsed = await parseDreExcel(file, { targetMonth: m });
      if (hasAnyData(parsed)) {
        monthsDetected.push(m);
        parsedByMonth.set(m, parsed);
      }
    } catch {
      // ignora — mês sem dados ou erro de leitura é tratado depois
    }
  }

  const monthsProcessed: number[] = [];
  const monthsFailed: { month: number; error: string }[] = [];

  for (const month of monthsDetected) {
    try {
      const parsed = parsedByMonth.get(month)!;

      // 2. find or create closing
      const { data: existing, error: findErr } = await supabase
        .from("closings")
        .select("id, status_dre")
        .eq("hotel_id", hotelId)
        .eq("year", year)
        .eq("month", month)
        .maybeSingle();
      if (findErr) throw findErr;

      let closingId = existing?.id;
      if (!closingId) {
        const { data: created, error: createErr } = await supabase
          .from("closings")
          .insert({
            hotel_id: hotelId,
            year,
            month,
            status_dre: "aprovado",
          })
          .select("id")
          .single();
        if (createErr) throw createErr;
        closingId = created.id;
      }

      // 3. próxima versão
      const { data: lastVer } = await supabase
        .from("dre_versions")
        .select("version_number")
        .eq("closing_id", closingId)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextVersion = (lastVer?.[0]?.version_number ?? 0) + 1;

      // 4. upload do arquivo (uma cópia por closing — versões diferentes
      //    ficam isoladas em pastas diferentes no bucket).
      const cleanName = sanitizeFileName(file.name);
      const path = `${closingId}/v${nextVersion}_${cleanName}`;
      const { error: upErr } = await supabase.storage
        .from("closings")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      // 5. dre_versions
      const { error: insErr } = await supabase.from("dre_versions").insert({
        closing_id: closingId,
        version_number: nextVersion,
        file_url: path,
        file_name: file.name,
        author_id: userId,
      });
      if (insErr) throw insErr;

      // 6. dre_parsed_lines (indicadores + linhas + séries + previous)
      const indicatorRows = Object.values(parsed.indicators)
        .filter((i): i is NonNullable<typeof i> => !!i)
        .map((i) => ({
          closing_id: closingId!,
          version_number: nextVersion,
          line_label: `[${i.key}] ${i.label}`,
          line_type: "indicator",
          line_value: i.value,
        }));

      const KEY_LINE_RX = [
        /^por\s+uh$/i,
        /distribui[çc][ãa]o\s+por\s+uh/i,
        /distribui[çc][ãa]o\s+\/\s*uh/i,
        /resultado\s+por\s+uh/i,
      ];
      const baseRows = parsed.lines.slice(0, 1000);
      const baseSet = new Set(baseRows.map((l) => l.row));
      const extraKeyRows = parsed.lines.filter(
        (l) => !baseSet.has(l.row) && KEY_LINE_RX.some((rx) => rx.test(l.label)),
      );
      const otherRows = [...baseRows, ...extraKeyRows].map((l) => {
        const cat = getDreLineCategorization(l.label);
        return {
          closing_id: closingId!,
          version_number: nextVersion,
          line_label: l.label,
          line_type: "line",
          line_value: l.value,
          line_level: l.level ?? 3,
          line_category: cat?.catMacro ?? getDreLineCategory(l.label),
          line_segment: cat?.segment ?? null,
        };
      });

      const seriesRows: typeof indicatorRows = [];
      const pushSeries = (
        scope: "cur" | "prev" | "budget",
        map: typeof parsed.currentSeries,
      ) => {
        for (const [k, arr] of Object.entries(map ?? {})) {
          if (!arr) continue;
          arr.forEach((v, i) => {
            if (v == null) return;
            seriesRows.push({
              closing_id: closingId!,
              version_number: nextVersion,
              line_label: `[series_${scope}_${k}_${i + 1}]`,
              line_type: "indicator",
              line_value: v,
            });
          });
        }
      };
      pushSeries("cur", parsed.currentSeries);
      pushSeries("prev", parsed.previousSeries);
      pushSeries("budget", parsed.budgetSeries);

      const prevIndicatorRows: typeof indicatorRows = [];
      for (const [k, v] of Object.entries(parsed.previousIndicators ?? {})) {
        if (v == null) continue;
        prevIndicatorRows.push({
          closing_id: closingId!,
          version_number: nextVersion,
          line_label: `[prev_${k}]`,
          line_type: "indicator",
          line_value: v,
        });
      }

      const budgetIndicatorRows: typeof indicatorRows = [];
      for (const [k, v] of Object.entries(parsed.budgetIndicators ?? {})) {
        if (v == null) continue;
        budgetIndicatorRows.push({
          closing_id: closingId!,
          version_number: nextVersion,
          line_label: `[budget_${k}]`,
          line_type: "indicator",
          line_value: v,
        });
      }

      if (
        indicatorRows.length ||
        otherRows.length ||
        seriesRows.length ||
        prevIndicatorRows.length ||
        budgetIndicatorRows.length
      ) {
        const { error: insertErr } = await supabase
          .from("dre_parsed_lines")
          .insert([
            ...indicatorRows,
            ...otherRows,
            ...seriesRows,
            ...prevIndicatorRows,
            ...budgetIndicatorRows,
          ]);
        if (insertErr) throw insertErr;
      }

      // 7. garante status aprovado (caso closing já existisse em outro estado)
      if (existing && existing.status_dre !== "aprovado") {
        await supabase
          .from("closings")
          .update({ status_dre: "aprovado" } as TablesUpdate<"closings">)
          .eq("id", closingId);
      }

      monthsProcessed.push(month);
    } catch (err) {
      monthsFailed.push({
        month,
        error: err instanceof Error ? err.message : "Falha desconhecida",
      });
    }
  }

  return { monthsDetected, monthsProcessed, monthsFailed };
}