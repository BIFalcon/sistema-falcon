import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtBRL } from "@/lib/formatters";
import type { FinancialDetail, FinancialOverviewRow } from "@/lib/financialOverview";

export function FinancialComparison({ rows, hotels, onDetail, canPayable }: {
  rows: FinancialOverviewRow[]; hotels: { id: string; name: string }[];
  onDetail: (detail: FinancialDetail, hotel: string) => void; canPayable: boolean;
}) {
  const sorted = [...rows].sort((a, b) => (hotels.find(h => h.id === a.hotel_id)?.name ?? a.hotel_id).localeCompare(hotels.find(h => h.id === b.hotel_id)?.name ?? b.hotel_id, "pt-BR"));
  const cell = (value: number, detail: FinancialDetail, hotel: string, enabled = true) => enabled
    ? <Button variant="link" className="h-auto p-0 tabular-nums text-foreground" onClick={() => onDetail(detail, hotel)}>{fmtBRL(value)}</Button>
    : fmtBRL(value);
  return <section className="space-y-3">
    <h2 className="text-lg font-semibold">Comparativo por hotel</h2>
    <Table className="text-xs">
      <TableHeader><TableRow>
        <TableHead className="min-w-48">Hotel</TableHead>
        {["Inadimplência de faturamento", "Pagamentos em atraso", "Juros pagos", "Open Folio", "Não conciliados"].map(label => <TableHead key={label} className="text-right min-w-36">{label}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>{sorted.map(row => <TableRow key={row.hotel_id}>
        <TableCell className="font-medium">{hotels.find(h => h.id === row.hotel_id)?.name ?? row.hotel_id}</TableCell>
        <TableCell className="text-right">{cell(row.defaulting, "defaulting", row.hotel_id)}</TableCell>
        <TableCell className="text-right">{cell(row.overdue, "overdue", row.hotel_id, canPayable)}</TableCell>
        <TableCell className="text-right tabular-nums">{fmtBRL(row.paid_interest)}</TableCell>
        <TableCell className="text-right">{cell(row.open_folio, "folio", row.hotel_id)}</TableCell>
        <TableCell className="text-right">{cell(row.unmatched_opera_amount + row.unmatched_acquirer_amount, "opera", row.hotel_id)}<p className="text-muted-foreground">{row.unmatched_opera_count + row.unmatched_acquirer_count} lançamento(s)</p></TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </section>;
}