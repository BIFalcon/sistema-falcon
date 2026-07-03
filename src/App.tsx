import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import React from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import FechamentoPage from "./pages/FechamentoPage";
import EmBreve from "./pages/EmBreve";
import NotFound from "./pages/NotFound.tsx";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SemPermissaoPage from "./pages/SemPermissaoPage";
import DrePage from "./pages/DrePage";
import CartaPage from "./pages/CartaPage";
import FinanceiroPage from "./pages/FinanceiroPage";
import EnvioPage from "./pages/EnvioPage";
import PerformanceSlaPage from "./pages/PerformanceSlaPage";
import ConsolidadoPage from "./pages/ConsolidadoPage";
import HoteisPage from "./pages/HoteisPage";
import UsuariosPage from "./pages/UsuariosPage";
import NotificacoesPage from "./pages/NotificacoesPage";
import EmailMonitoringPage from "./pages/EmailMonitoringPage";
import ContasPagarPage from "./pages/ContasPagarPage";
import ContasReceberPage from "./pages/ContasReceberPage";
import ClientesPage from "./pages/ClientesPage";
import FinanceiroVisaoGeralPage from "./pages/FinanceiroVisaoGeralPage";
import IndicadoresDrePage from "./pages/IndicadoresDrePage";
import PerfilPage from "./pages/PerfilPage";
import HomePage from "./pages/HomePage";
import ConciliacaoPage from "./pages/ConciliacaoPage";
import TurnoverPage from "./pages/rh/TurnoverPage";
import OrganogramaPage from "./pages/rh/OrganogramaPage";
import TreinamentosPage from "./pages/rh/TreinamentosPage";
import PoliticasPage from "./pages/rh/PoliticasPage";
import MarketingCalendarioPage from "./pages/marketing/CalendarioPage";
import PadroesMarcaPage from "./pages/marketing/PadroesMarcaPage";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedLayout } from "./components/layout/ProtectedLayout";
import { Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import type { AppRole } from "./lib/constants";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 1000 * 60 * 5,
    },
  },
});

function RoleGuard({
  roles: allowed,
  children,
  masterOnly = false,
}: {
  roles?: AppRole[];
  children: React.ReactNode;
  masterOnly?: boolean;
}) {
  const { isMaster, hasRole } = useAuth();
  if (masterOnly && !isMaster) return <Navigate to="/" replace />;
  if (allowed && !isMaster && !allowed.some((r) => hasRole(r))) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function PerformanceSlaGuard({ children }: { children: React.ReactNode }) {
  const { canViewPerformanceSla } = useAuth();
  if (!canViewPerformanceSla) return <Navigate to="/" replace />;
  return <>{children}</>;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">
            Algo deu errado ao carregar o sistema.
          </p>
          <p className="text-sm text-muted-foreground">
            Tente recarregar a página. Se o problema persistir, entre em contato com o suporte.
          </p>
          <button
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
            onClick={() => window.location.reload()}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
    <TooltipProvider>
      <Sonner richColors closeButton />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Públicas */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/sem-permissao" element={<SemPermissaoPage />} />

            {/* Protegidas */}
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/home" element={<HomePage />} />

              {/* Fechamento */}
              <Route path="/fechamento" element={<RoleGuard roles={["processos","fernando","controladoria","gop","ri","financeiro","gg","rh","viewer"]}><FechamentoPage /></RoleGuard>} />
              <Route path="/fechamento/dre" element={<RoleGuard roles={["processos","fernando","controladoria","gop","ri","financeiro","gg","adm","rh","viewer"]}><DrePage /></RoleGuard>} />
              <Route path="/fechamento/carta" element={<RoleGuard roles={["processos","fernando","controladoria","gop","ri","financeiro","gg","rh","viewer"]}><CartaPage /></RoleGuard>} />
              <Route path="/fechamento/financeiro" element={<RoleGuard roles={["controladoria","patronos","viewer"]}><FinanceiroPage /></RoleGuard>} />
              <Route path="/fechamento/envio" element={<RoleGuard roles={["ri"]}><EnvioPage /></RoleGuard>} />
              <Route path="/fechamento/performance" element={<PerformanceSlaGuard><PerformanceSlaPage /></PerformanceSlaGuard>} />
              <Route
                path="/fechamento/consolidado"
                element={
                  <RoleGuard roles={["controladoria","patronos","gop","ri","processos","viewer"]}>
                    <ConsolidadoPage />
                  </RoleGuard>
                }
              />

              {/* Compat: rotas antigas */}
              <Route path="/dre" element={<Navigate to="/fechamento/dre" replace />} />
              <Route path="/carta" element={<Navigate to="/fechamento/carta" replace />} />

              {/* Análise */}
              <Route path="/indicadores" element={<RoleGuard roles={["gop","gg","controladoria","patronos","operacoes","viewer","rh"]}><IndicadoresDrePage /></RoleGuard>} />
              <Route path="/metas" element={<EmBreve />} />

              {/* Gestão — Financeiro */}
              <Route path="/financeiro" element={<RoleGuard roles={["controladoria","patronos","gg","viewer"]}><FinanceiroVisaoGeralPage /></RoleGuard>} />
              <Route path="/financeiro/contas-pagar" element={<RoleGuard roles={["controladoria","patronos","viewer"]}><ContasPagarPage /></RoleGuard>} />
              <Route path="/financeiro/contas-receber" element={<RoleGuard roles={["controladoria","patronos","gg","adm","gop","operacoes","viewer"]}><ContasReceberPage /></RoleGuard>} />
              <Route path="/financeiro/contas-receber/clientes" element={<RoleGuard roles={["controladoria","patronos","gg","adm","viewer"]}><ClientesPage /></RoleGuard>} />
              <Route path="/rh" element={<Navigate to="/rh/turnover" replace />} />
              <Route path="/rh/turnover" element={<RoleGuard roles={["controladoria","patronos","rh","gop","gg","ri","operacoes","viewer"]}><TurnoverPage /></RoleGuard>} />
              <Route path="/rh/calendario" element={<Navigate to="/marketing/calendario" replace />} />
              <Route path="/rh/organograma" element={<RoleGuard roles={["controladoria","patronos","rh","gop","gg","ri","operacoes","viewer"]}><OrganogramaPage /></RoleGuard>} />
              <Route path="/rh/treinamentos" element={<RoleGuard roles={["controladoria","patronos","rh","gop","gg","ri","operacoes","viewer"]}><TreinamentosPage /></RoleGuard>} />
              <Route path="/rh/politicas" element={<RoleGuard roles={["controladoria","patronos","rh","gop","gg","ri","operacoes","viewer"]}><PoliticasPage /></RoleGuard>} />
              {/* Marketing */}
              <Route path="/marketing" element={<Navigate to="/marketing/calendario" replace />} />
              <Route path="/marketing/calendario" element={<RoleGuard roles={["controladoria","patronos","marketing","gop","gg","ri","fernando","operacoes","rh","viewer"]}><MarketingCalendarioPage /></RoleGuard>} />
              <Route path="/marketing/padroes-marca" element={<RoleGuard roles={["controladoria","patronos","marketing","gop","gg","ri","fernando","operacoes","rh","viewer"]}><PadroesMarcaPage /></RoleGuard>} />
              <Route path="/controladoria" element={<EmBreve />} />
              <Route path="/controladoria/conciliacao" element={<RoleGuard roles={["controladoria","patronos","viewer"]}><ConciliacaoPage /></RoleGuard>} />

              {/* Configurações */}
              <Route path="/configuracoes/usuarios" element={<RoleGuard masterOnly><UsuariosPage /></RoleGuard>} />
              <Route path="/configuracoes/hoteis" element={<RoleGuard masterOnly><HoteisPage /></RoleGuard>} />
              <Route path="/configuracoes/notificacoes" element={<RoleGuard masterOnly><NotificacoesPage /></RoleGuard>} />
              <Route path="/configuracoes/emails" element={<RoleGuard masterOnly><EmailMonitoringPage /></RoleGuard>} />
              <Route path="/hoteis" element={<Navigate to="/configuracoes/hoteis" replace />} />
              <Route path="/perfil" element={<PerfilPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
    </ErrorBoundary>
  </QueryClientProvider>
);

export default App;
