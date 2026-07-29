import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { X, Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  useAllHotelContextos,
  useConfirmNoChanges,
  isAnswered,
  needsRefresh,
} from "@/hooks/useHotelContexto";

const DISMISS_KEY = "falcon:hotel-contexto-banner-dismissed";

export function HotelContextoBanner() {
  const { hasRole, allowedHotels } = useAuth();
  const isGg = hasRole("gg");
  const navigate = useNavigate();
  const confirmNoChanges = useConfirmNoChanges();
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "1",
  );

  const { data: contextos = [] } = useAllHotelContextos(isGg);

  if (!isGg || dismissed || allowedHotels.length === 0) return null;

  const byHotel = (id: string) => contextos.find((c) => c.hotel_id === id) ?? null;

  const pending = allowedHotels.find((h) => !isAnswered(byHotel(h.id)));
  const stale = pending ? null : allowedHotels.find((h) => needsRefresh(byHotel(h.id)));
  const target = pending ?? stale;
  if (!target) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="mx-6 mt-4 rounded-lg border border-accent/40 bg-accent/5 px-4 py-3 flex items-start gap-3">
      <Sparkles className="h-4 w-4 mt-0.5 text-accent shrink-0" />
      <div className="flex-1 min-w-0">
        {pending ? (
          <>
            <p className="text-sm font-medium">
              Seu hotel ainda não tem contexto cadastrado.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Isso afeta a qualidade das análises de IA geradas para o {target.name}. Leva menos de
              5 minutos.
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Button size="sm" onClick={() => navigate("/perfil-hotel/contexto")}>
                Preencher agora
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                Lembrar depois
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">
              Alguma coisa mudou no contexto do {target.name} desde a última resposta?
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              <Button size="sm" onClick={() => navigate("/perfil-hotel/contexto")}>
                Sim, quero atualizar
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={confirmNoChanges.isPending}
                onClick={async () => {
                  try {
                    await confirmNoChanges.mutateAsync(target.id);
                    toast.success("Obrigado! Contexto confirmado.");
                  } catch (e) {
                    toast.error("Não foi possível confirmar: " + ((e as Error)?.message ?? ""));
                  }
                }}
              >
                Não, continua igual
              </Button>
            </div>
          </>
        )}
      </div>
      <button onClick={dismiss} aria-label="Fechar aviso" className="text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
