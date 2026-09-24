import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import NotificacoesPage from "./NotificacoesPage";
import EmailMonitoringPage from "./EmailMonitoringPage";

/** Notificações do workflow + Monitor de E-mails numa página só, com abas internas. */
export default function NotificacoesEmailsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("aba") === "emails" ? "emails" : "notificacoes";
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setParams(v === "emails" ? { aba: "emails" } : {}, { replace: true })}
      className="space-y-4"
    >
      <TabsList>
        <TabsTrigger value="notificacoes">Notificações</TabsTrigger>
        <TabsTrigger value="emails">Monitor de E-mails</TabsTrigger>
      </TabsList>
      <TabsContent value="notificacoes" className="mt-0"><NotificacoesPage /></TabsContent>
      <TabsContent value="emails" className="mt-0"><EmailMonitoringPage /></TabsContent>
    </Tabs>
  );
}
