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
import ContasPagarPage from "./pages/ContasPagarPage";
import ContasReceberPage from "./pages/ContasReceberPage";
import ClientesPage from "./pages/ClientesPage";
import FinanceiroVisaoGeralPage from "./pages/FinanceiroVisaoGeralPage";
import IndicadoresDrePage from "./pages/IndicadoresDrePage";
import PerfilPage from "./pages/PerfilPage";
import HomePage from "./pages/HomePage";
import ConciliacaoPage from "./pages/ConciliacaoPage";
import TurnoverPage from "./pages/rh/TurnoverPage";
import CalendarioPage from "./pages/rh/CalendarioPage";
import OrganogramaPage from "./pages/rh/OrganogramaPage";
import TreinamentosPage from "./pages/rh/TreinamentosPage";
import PoliticasPage from "./pages/rh/PoliticasPage";
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
  const { isMaster, roles } = useAuth();
  if (masterOnly && !isMaster) return <Navigate to="/" replace />;
  if (allowed && !isMaster && !allowed.some((r) => roles.includes(r))) {
    return <Navigate to="/" replace />;
  }
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
              <Route path="/fechamento" element={<FechamentoPage />} />
              <Route path="/fechamento/dre" element={<DrePage />} />
              <Route path="/fechamento/carta" element={<CartaPage />} />
              <Route path="/fechamento/financeiro" element={<RoleGuard roles={["financeiro"]}><FinanceiroPage /></RoleGuard>} />
              <Route path="/fechamento/envio" element={<RoleGuard roles={["ri"]}><EnvioPage /></RoleGuard>} />
              <Route path="/fechamento/performance" element={<RoleGuard masterOnly><PerformanceSlaPage /></RoleGuard>} />
              <Route
                path="/fechamento/consolidado"
                element={
                  <RoleGuard roles={["controladoria", "gop", "ri", "financeiro", "processos"]}>
                    <ConsolidadoPage />
                  </RoleGuard>
                }
              />

              {/* Compat: rotas antigas */}
              <Route path="/dre" element={<Navigate to="/fechamento/dre" replace />} />
              <Route path="/carta" element={<Navigate to="/fechamento/carta" replace />} />

              {/* Análise */}
              <Route path="/indicadores" element={<RoleGuard roles={["gop", "gg", "controladoria", "operacoes", "viewer"]}><IndicadoresDrePage /></RoleGuard>} />
              <Route path="/metas" element={<EmBreve />} />

              {/* Gestão — Financeiro */}
              <Route path="/financeiro" element={<RoleGuard roles={["financeiro", "gg"]}><FinanceiroVisaoGeralPage /></RoleGuard>} />
              <Route path="/financeiro/contas-pagar" element={<RoleGuard roles={["financeiro"]}><ContasPagarPage /></RoleGuard>} />
              <Route path="/financeiro/contas-receber" element={<RoleGuard roles={["financeiro", "gg", "adm", "gop"]}><ContasReceberPage /></RoleGuard>} />
              <Route path="/financeiro/contas-receber/clientes" element={<RoleGuard roles={["financeiro", "gg", "adm"]}><ClientesPage /></RoleGuard>} />
              <Route path="/rh" element={<Navigate to="/rh/turnover" replace />} />
              <Route path="/rh/turnover" element={<TurnoverPage />} />
              <Route path="/rh/calendario" element={<CalendarioPage />} />
              <Route path="/rh/organograma" element={<OrganogramaPage />} />
              <Route path="/rh/treinamentos" element={<TreinamentosPage />} />
              <Route path="/rh/politicas" element={<PoliticasPage />} />
              <Route path="/controladoria" element={<EmBreve />} />
              <Route path="/controladoria/conciliacao" element={<RoleGuard roles={["controladoria"]}><ConciliacaoPage /></RoleGuard>} />

              {/* Configurações */}
              <Route path="/configuracoes/usuarios" element={<RoleGuard masterOnly><UsuariosPage /></RoleGuard>} />
              <Route path="/configuracoes/hoteis" element={<RoleGuard masterOnly><HoteisPage /></RoleGuard>} />
              <Route path="/configuracoes/notificacoes" element={<RoleGuard masterOnly><NotificacoesPage /></RoleGuard>} />
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
