import { useAuth } from "@/contexts/AuthContext";
import { ConciliationImports } from "@/components/financeiro/ConciliationImports";
import { ArReportImport } from "@/components/financeiro/ArReportImport";
import { ApReportImport } from "@/components/financeiro/ApReportImport";
import { useLatestArUpload } from "@/hooks/useAccountsReceivable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ConciliacaoPage from "@/pages/ConciliacaoPage";
import ConferenciaNotasFiscaisPage from "@/pages/ConferenciaNotasFiscaisPage";
import { useSearchParams } from "react-router-dom";

export default function ImportacoesPage() {
  const { isMaster, isPatronos, hasRole, isFernando } = useAuth();
  const canConciliar = isMaster || isPatronos || hasRole("controladoria") || hasRole("fernando");
  const canAr = isMaster || isPatronos;
  const canAp = !isFernando && (isMaster || hasRole("financeiro"));
  const invoice = useLatestArUpload("to_invoice");
  const folio = useLatestArUpload("open_folio");
  const [params] = useSearchParams();
  const preferred = params.get("tipo");
  const initial = preferred === "totvs" && (isMaster || hasRole("controladoria")) ? "totvs" : preferred === "notas" && canConciliar ? "notas" : canConciliar ? "conciliacao" : canAr ? "receber" : "pagar";
  return <div className="space-y-6">
    <div><p className="text-xs text-accent font-semibold">Gestão · Financeiro</p><h1 className="text-2xl font-semibold">Importações</h1></div>
    <Tabs key={initial} defaultValue={initial}>
      <TabsList className="flex flex-wrap h-auto gap-1">
        {canConciliar && <TabsTrigger value="conciliacao">Conciliação e Baixas</TabsTrigger>}
        {canAr && <TabsTrigger value="receber">Contas a Receber</TabsTrigger>}
        {canAp && <TabsTrigger value="pagar">Contas a Pagar</TabsTrigger>}
        {(isMaster || hasRole("controladoria")) && <TabsTrigger value="totvs">Razão TOTVS / Journal</TabsTrigger>}
        {(isMaster || isPatronos || hasRole("controladoria")) && <TabsTrigger value="notas">Notas Fiscais</TabsTrigger>}
      </TabsList>
      {canConciliar && <TabsContent value="conciliacao"><ConciliationImports /></TabsContent>}
      {canAr && <TabsContent value="receber" className="space-y-4"><ArReportImport kind="to_invoice" lastUpload={invoice.data} isManager={canAr} /><ArReportImport kind="open_folio" lastUpload={folio.data} isManager={canAr} /></TabsContent>}
      {canAp && <TabsContent value="pagar"><ApReportImport /></TabsContent>}
      {(isMaster || hasRole("controladoria")) && <TabsContent value="totvs"><ConciliacaoPage importMode /></TabsContent>}
      {(isMaster || isPatronos || hasRole("controladoria")) && <TabsContent value="notas"><ConferenciaNotasFiscaisPage importMode /></TabsContent>}
    </Tabs>
  </div>;
}