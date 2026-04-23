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
import HoteisPage from "./pages/HoteisPage";
import UsuariosPage from "./pages/UsuariosPage";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedLayout } from "./components/layout/ProtectedLayout";
import { Navigate } from "react-router-dom";

const queryClient = new QueryClient();

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
              <Route path="/" element={<Navigate to="/fechamento" replace />} />

              {/* Fechamento */}
              <Route path="/fechamento" element={<FechamentoPage />} />
              <Route path="/fechamento/dre" element={<DrePage />} />
              <Route path="/fechamento/carta" element={<CartaPage />} />
              <Route path="/fechamento/financeiro" element={<FinanceiroPage />} />
              <Route path="/fechamento/envio" element={<EnvioPage />} />

              {/* Compat: rotas antigas */}
              <Route path="/dre" element={<Navigate to="/fechamento/dre" replace />} />
              <Route path="/carta" element={<Navigate to="/fechamento/carta" replace />} />

              {/* Análise */}
              <Route path="/indicadores" element={<EmBreve />} />
              <Route path="/metas" element={<EmBreve />} />

              {/* Gestão — Financeiro */}
              <Route path="/financeiro" element={<EmBreve />} />
              <Route path="/financeiro/contas-pagar" element={<EmBreve />} />
              <Route path="/financeiro/contas-receber" element={<EmBreve />} />
              <Route path="/rh" element={<EmBreve />} />
              <Route path="/controladoria" element={<EmBreve />} />

              {/* Configurações */}
              <Route path="/configuracoes/usuarios" element={<UsuariosPage />} />
              <Route path="/configuracoes/hoteis" element={<HoteisPage />} />
              <Route path="/configuracoes/assets" element={<EmBreve />} />
              <Route path="/hoteis" element={<Navigate to="/configuracoes/hoteis" replace />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
