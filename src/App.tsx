import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SemPermissaoPage from "./pages/SemPermissaoPage";
import DrePage from "./pages/DrePage";
import CartaPage from "./pages/CartaPage";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedLayout } from "./components/layout/ProtectedLayout";

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
              <Route path="/" element={<Index />} />
              <Route path="/dre" element={<DrePage />} />
              <Route path="/carta" element={<CartaPage />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
