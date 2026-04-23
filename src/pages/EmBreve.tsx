import { Card } from "@/components/ui/card";
import { Construction } from "lucide-react";
import { useLocation } from "react-router-dom";

const TITLES: Record<string, string> = {
  "/fechamento/envio": "Envio",
  "/financeiro": "Financeiro — Visão Geral",
  "/financeiro/contas-pagar": "Contas a Pagar",
  "/financeiro/contas-receber": "Contas a Receber",
  "/indicadores": "Indicadores DRE",
  "/metas": "Metas GG",
  "/rh": "RH & People",
  "/controladoria": "Controladoria",
  "/configuracoes/usuarios": "Usuários",
  "/configuracoes/assets": "Assets",
};

export default function EmBreve({ title: titleProp }: { title?: string } = {}) {
  const { pathname } = useLocation();
  const title = titleProp ?? TITLES[pathname] ?? "Módulo";
  return (
    <div className="max-w-2xl mx-auto mt-16">
      <Card className="p-12 text-center shadow-soft">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <Construction className="h-8 w-8 text-accent" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent mb-2">
          Em construção
        </p>
        <h1 className="text-2xl font-semibold text-foreground mb-3">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Este módulo ainda está sendo desenvolvido. Em breve estará disponível por aqui.
        </p>
      </Card>
    </div>
  );
}
