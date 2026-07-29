import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Save, Send, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useModuleFilters } from "@/contexts/FilterContext";
import {
  CONTEXTO_QUESTIONS,
  useHotelContexto,
  useSaveHotelContexto,
  type ContextoAnswers,
} from "@/hooks/useHotelContexto";

const EMPTY: ContextoAnswers = {
  quem_sustenta_hotel: "",
  mudanca_praca: "",
  atrapalha_operacao: "",
  desconto_frequente: "",
  prioridade_3_meses: "",
};

export default function ContextoHotelPage() {
  const { allowedHotels, isMaster, hasRole } = useAuth();
  const { hotelId: filterHotelId, setHotelId } = useModuleFilters("global");
  const isGg = hasRole("gg");

  const hotelId = useMemo(() => {
    if (filterHotelId && allowedHotels.some((h) => h.id === filterHotelId)) return filterHotelId;
    return allowedHotels.length === 1 ? allowedHotels[0].id : null;
  }, [filterHotelId, allowedHotels]);

  const hotel = allowedHotels.find((h) => h.id === hotelId) ?? null;
  const { data: ctx, isLoading } = useHotelContexto(hotelId);
  const save = useSaveHotelContexto();
  const [answers, setAnswers] = useState<ContextoAnswers>(EMPTY);

  const canEdit = isGg || isMaster;
  const readOnlyAsMaster = isMaster && !isGg;

  useEffect(() => {
    setAnswers({
      quem_sustenta_hotel: ctx?.quem_sustenta_hotel ?? "",
      mudanca_praca: ctx?.mudanca_praca ?? "",
      atrapalha_operacao: ctx?.atrapalha_operacao ?? "",
      desconto_frequente: ctx?.desconto_frequente ?? "",
      prioridade_3_meses: ctx?.prioridade_3_meses ?? "",
    });
  }, [ctx, hotelId]);

  const handleSave = async (finalize: boolean) => {
    if (!hotelId) {
      toast.error("Selecione um hotel.");
      return;
    }
    try {
      await save.mutateAsync({ hotelId, answers, finalize });
      toast.success(finalize ? "Respostas enviadas. Obrigado!" : "Rascunho salvo.");
    } catch (e) {
      toast.error("Não foi possível salvar: " + ((e as Error)?.message ?? "erro desconhecido"));
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">Perfil do Hotel</p>
        <h1 className="text-3xl font-semibold">Contexto do Hotel</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Cinco perguntas rápidas que só a gestão do hotel sabe responder. Elas alimentam a Carta ao
          Investidor e as análises de IA. Leva menos de 5 minutos e pode ser salvo como rascunho.
        </p>
      </header>

      {allowedHotels.length > 1 && (
        <div className="max-w-sm">
          <Select value={hotelId ?? ""} onValueChange={(v) => setHotelId(v)}>
            <SelectTrigger><SelectValue placeholder="Selecione o hotel" /></SelectTrigger>
            <SelectContent>
              {allowedHotels.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {readOnlyAsMaster && (
        <Card className="p-3 flex items-start gap-2 border-amber-500/40 bg-amber-500/5">
          <Info className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-muted-foreground">
            Você está vendo como master, não como o Gerente Geral deste hotel. Alterações feitas aqui
            substituem as respostas do hotel.
          </p>
        </Card>
      )}

      {ctx?.respondido_em && (
        <Badge variant="outline">
          Respondido em {new Date(ctx.respondido_em).toLocaleDateString("pt-BR")}
        </Badge>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !hotelId ? (
        <p className="text-sm text-muted-foreground">Selecione um hotel para responder.</p>
      ) : (
        <div className="space-y-4">
          {CONTEXTO_QUESTIONS.map((q) => (
            <Card key={q.field} className="p-4 shadow-soft space-y-2">
              <div>
                <p className="text-sm font-semibold">{q.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{q.hint}</p>
              </div>
              <Textarea
                rows={4}
                value={answers[q.field] ?? ""}
                disabled={!canEdit}
                placeholder="Pode ser curto e direto — o importante é registrar o que existe."
                onChange={(e) => setAnswers((a) => ({ ...a, [q.field]: e.target.value }))}
              />
            </Card>
          ))}

          {canEdit && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => handleSave(false)} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar rascunho
              </Button>
              <Button onClick={() => handleSave(true)} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                Enviar respostas
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {hotel ? `Hotel: ${hotel.name}` : ""}
      </p>
    </div>
  );
}
