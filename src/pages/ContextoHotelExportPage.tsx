import { useMemo } from "react";
import * as XLSX from "xlsx";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CONTEXTO_QUESTIONS, useAllHotelContextos } from "@/hooks/useHotelContexto";

export default function ContextoHotelExportPage() {
  const { allowedHotels } = useAuth();
  const { data: contextos = [], isLoading } = useAllHotelContextos();

  const rows = useMemo(
    () =>
      allowedHotels.map((h) => {
        const c = contextos.find((x) => x.hotel_id === h.id);
        return { hotel: h.name, ctx: c ?? null };
      }),
    [allowedHotels, contextos],
  );

  const exportXlsx = () => {
    const data = rows.map((r) => ({
      Hotel: r.hotel,
      "Respondido em": r.ctx?.respondido_em
        ? new Date(r.ctx.respondido_em).toLocaleDateString("pt-BR")
        : "—",
      ...Object.fromEntries(
        CONTEXTO_QUESTIONS.map((q) => [q.label, r.ctx?.[q.field] ?? ""]),
      ),
      "Última confirmação": r.ctx?.ultima_confirmacao_em
        ? new Date(r.ctx.ultima_confirmacao_em).toLocaleDateString("pt-BR")
        : "—",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Contexto");
    XLSX.writeFile(wb, `contexto-hoteis-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">Perfil do Hotel</p>
          <h1 className="text-3xl font-semibold">Contexto — consolidado</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Respostas dos Gerentes Gerais por hotel.
          </p>
        </div>
        <Button onClick={exportXlsx} disabled={isLoading}>
          <Download className="h-4 w-4 mr-2" /> Exportar Excel
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.hotel} className="p-4 shadow-soft space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{r.hotel}</p>
              <Badge variant={r.ctx?.respondido_em ? "outline" : "destructive"}>
                {r.ctx?.respondido_em
                  ? `Respondido em ${new Date(r.ctx.respondido_em).toLocaleDateString("pt-BR")}`
                  : "Sem contexto"}
              </Badge>
            </div>
            {r.ctx?.respondido_em && (
              <div className="space-y-1.5">
                {CONTEXTO_QUESTIONS.map((q) => (
                  <div key={q.field}>
                    <p className="text-xs font-medium text-muted-foreground">{q.label}</p>
                    <p className="text-sm whitespace-pre-wrap">{r.ctx?.[q.field] || "—"}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
