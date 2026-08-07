import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./StatusBadge";
import { useClosings, useEnsureClosing, type ClosingRow } from "@/hooks/useClosings";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { hotelSkipsCarta } from "@/lib/constants";
import { toast } from "sonner";

interface Props {
  hotelId: string | null;
  month: number;
  year: number;
}

export function ClosingTable({ hotelId, month, year }: Props) {
  const navigate = useNavigate();
  const { allowedHotels, isMaster } = useAuth();
  const ensure = useEnsureClosing();
  const { data: closings = [], isLoading } = useClosings({ hotelId, month, year });

  // Constrói linhas: para cada hotel permitido (e que aparece no fechamento),
  // exibir o closing existente OU placeholder.
  const closingHotels = allowedHotels.filter((h) => h.show_in_closing !== false);
  const visibleHotels = hotelId ? closingHotels.filter((h) => h.id === hotelId) : closingHotels;
  const byHotel = new Map(closings.map((c) => [c.hotel_id, c]));

  async function startClosing(hid: string) {
    try {
      const c = await ensure.mutateAsync({ hotelId: hid, month, year });
      navigate(`/fechamento/dre?closing=${c.id}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao iniciar fechamento");
    }
  }

  function openStage(c: ClosingRow, stage: "dre" | "carta" | "financeiro" | "envio") {
    navigate(`/fechamento/${stage}?closing=${c.id}`);
  }

  const stageButton = (c: ClosingRow, stage: "dre" | "carta" | "financeiro" | "envio", status: ClosingRow["status_dre"]) => (
    <button
      type="button"
      onClick={() => openStage(c, stage)}
      className="rounded-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      title="Abrir"
    >
      <StatusBadge status={status} />
    </button>
  );

  if (visibleHotels.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground shadow-soft">
        {isMaster ? "Nenhum hotel cadastrado." : "Você não tem acesso a nenhum hotel ainda. Solicite ao administrador."}
      </Card>
    );
  }

  return (
    <Card className="shadow-soft overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/40 hover:bg-secondary/40">
            <TableHead className="text-xs uppercase tracking-wider">Hotel</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">DRE</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Carta</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Financeiro</TableHead>
            <TableHead className="text-xs uppercase tracking-wider">Envio</TableHead>
            <TableHead className="text-right text-xs uppercase tracking-wider">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleHotels.map((h) => {
            const c = byHotel.get(h.id);
            const skipsCarta = hotelSkipsCarta(h.id);
            return (
              <TableRow key={h.id} className="hover:bg-secondary/30">
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{h.name}</span>
                    {skipsCarta && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Sem carta ao investidor
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{c ? stageButton(c, "dre", c.status_dre) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  {c
                    ? stageButton(c, "carta", skipsCarta ? "nao_aplicavel" : c.status_carta)
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{c ? stageButton(c, "financeiro", c.status_financeiro) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell>{c ? stageButton(c, "envio", c.status_envio) : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right">
                  {c ? null : (
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => startClosing(h.id)} disabled={ensure.isPending}>
                      <Plus className="h-3.5 w-3.5" /> Iniciar
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {isLoading && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                Carregando…
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}