import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
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
import HoteisPage from "./pages/HoteisPage";
import UsuariosPage from "./pages/UsuariosPage";
import NotificacoesPage from "./pages/NotificacoesPage";
import ContasPagarPage from "./pages/ContasPagarPage";
import ContasReceberPage from "./pages/ContasReceberPage";
import FinanceiroVisaoGeralPage from "./pages/FinanceiroVisaoGeralPage";
import IndicadoresDrePage from "./pages/IndicadoresDrePage";
import PerfilPage from "./pages/PerfilPage";
import HomePage from "./pages/HomePage";
import ConciliacaoPage from "./pages/ConciliacaoPage";
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

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
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

              {/* Compat: rotas antigas */}
              <Route path="/dre" element={<Navigate to="/fechamento/dre" replace />} />
              <Route path="/carta" element={<Navigate to="/fechamento/carta" replace />} />

              {/* Análise */}
              <Route path="/indicadores" element={<RoleGuard roles={["gop", "gg", "controladoria", "operacoes", "viewer"]}><IndicadoresDrePage /></RoleGuard>} />
              <Route path="/metas" element={<EmBreve />} />

              {/* Gestão — Financeiro */}
              <Route path="/financeiro" element={<RoleGuard roles={["financeiro", "gg"]}><FinanceiroVisaoGeralPage /></RoleGuard>} />
              <Route path="/financeiro/contas-pagar" element={<RoleGuard roles={["financeiro"]}><ContasPagarPage /></RoleGuard>} />
              <Route path="/financeiro/contas-receber" element={<RoleGuard roles={["financeiro", "gg"]}><ContasReceberPage /></RoleGuard>} />
              <Route path="/rh" element={<EmBreve />} />
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
  </QueryClientProvider>
);

export default App;
