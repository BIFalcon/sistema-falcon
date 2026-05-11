/**
 * Consolidado de Resultados — visão por hotel para o mês/ano selecionado.
 * Acessível apenas a quem tem acesso a todos os hotéis (não para GG).
 */
import { useMemo } from "react";
import { LayoutGrid } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import { useConsolidadoData, type ConsolidadoRow } from "@/hooks/useConsolidado";
import { MONTHS_PT, formatBRL } from "@/lib/constants";

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(1)}%`;
}

function fmtBRLOrDash(v: number | null): string {
  if (v == null) return "—";
  return formatBRL(v);
}

export default function ConsolidadoPage() {
  const { month, year } = useModuleFilters("consolidado");
  const { allowedHotels } = useAuth();
  const hotelIds = useMemo(() => allowedHotels.map((h) => h.id), [allowedHotels]);
  const hotelById = useMemo(
    () => new Map(allowedHotels.map((h) => [h.id, h])),
    [allowedHotels],
  );

  const { data: rows = [], isLoading } = useConsolidadoData({ hotelIds, year, month });

  // Linha de totais — somas para valores absolutos, médias ponderadas para taxas
  const totals = useMemo(() => {
    const sum = (k: keyof ConsolidadoRow) =>
      rows.reduce((acc, r) => acc + (Number(r[k] ?? 0) || 0), 0);
    const receitaBruta = sum("receitaBruta");
    const taxaFee = sum("taxaFee");
    const incentiveFee = sum("incentiveFee");
    const distribuicaoTotal = sum("distribuicaoTotal");
    const uhsDisponiveis = sum("uhsDisponiveis");
    const gop = sum("gop");
    // Médias ponderadas por UHs disponíveis quando possível
    const wAvg = (k: keyof ConsolidadoRow) => {
      let num = 0;
      let den = 0;
      for (const r of rows) {
        const v = r[k] as number | null;
        const w = r.uhsDisponiveis ?? 0;
        if (v != null && w > 0) {
          num += (v as number) * w;
          den += w;
        }
      }
      return den > 0 ? num / den : null;
    };
    return {
      ocupacao: wAvg("ocupacao"),
      adr: wAvg("adr"),
      revpar: wAvg("revpar"),
      receitaBruta,
      taxaFee,
      incentiveFee,
      distribuicaoTotal,
      uhsDisponiveis,
      distribuicaoPorUh:
        distribuicaoTotal && uhsDisponiveis ? distribuicaoTotal / uhsDisponiveis : null,
      gop,
    };
  }, [rows]);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Fechamento
        </p>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <LayoutGrid className="h-6 w-6" /> Consolidado de Resultados
        </h1>
        <p className="text-sm text-muted-foreground">
          {MONTHS_PT[month - 1]} de {year} — visão consolidada de todos os hotéis
        </p>
      </div>

      <Card className="p-5 shadow-soft">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum dado disponível para este período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                  <TableHead className="text-xs uppercase tracking-wider">Hotel</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Tx. Ocup.</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Diária Média</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">RevPAR</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Receita Bruta</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Fee/Rec.Bruta</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Incentive Fee</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Distrib. Total</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">Distrib./UH</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider text-right">GOP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.hotelId}>
                    <TableCell className="font-medium">
                      {hotelById.get(r.hotelId)?.name ?? r.hotelId}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtPct(r.ocupacao)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.adr)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.revpar)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.receitaBruta)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.taxaFee)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.incentiveFee)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.distribuicaoTotal)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.distribuicaoPorUh)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBRLOrDash(r.gop)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total Geral</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPct(totals.ocupacao)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.adr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.revpar)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.receitaBruta)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.taxaFee)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.incentiveFee)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.distribuicaoTotal)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.distribuicaoPorUh)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtBRLOrDash(totals.gop)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}