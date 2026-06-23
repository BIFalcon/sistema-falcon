import { ReactNode, Component, type ErrorInfo } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { FilterProvider } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole } from "@/lib/constants";
import { GlobalLoadingBar } from "@/components/ui/GlobalLoadingBar";

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-gradient-sidebar flex items-center justify-center">
      <div className="text-sidebar-foreground/70 text-sm tracking-wider uppercase">
        Carregando…
      </div>
    </div>
  );
}

/**
 * Boundary local da página: mantém o layout (sidebar + header + filtros)
 * funcionando mesmo quando o conteúdo interno quebra, e expõe a mensagem
 * real do erro para facilitar o suporte. Quando o usuário troca de rota,
 * o React desmonta este componente e o estado é resetado automaticamente.
 */
class PageErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PageErrorBoundary]", error, info);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">
            Algo deu errado ao carregar essa página.
          </p>
          <p className="text-sm text-muted-foreground max-w-xl">
            Tente recarregar. Se o problema persistir, copie a mensagem abaixo e
            envie para o suporte.
          </p>
          <pre className="text-xs text-left bg-muted/40 border border-border rounded-md p-3 max-w-2xl overflow-auto whitespace-pre-wrap break-words">
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
              onClick={() => window.location.reload()}
            >
              Recarregar
            </button>
            <button
              className="px-4 py-2 rounded border border-input text-sm"
              onClick={() => this.setState({ error: null })}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Props {
  requireRoles?: AppRole[];
  children?: ReactNode;
}

export function ProtectedLayout({ requireRoles, children }: Props) {
  const { user, loading, hasAnyRole, roles, isMaster } = useAuth();
  const location = useLocation();

  if (loading) return <FullScreenLoader />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!hasAnyRole()) {
    return <Navigate to="/sem-permissao" replace />;
  }

  if (requireRoles && requireRoles.length > 0 && !isMaster) {
    const ok = requireRoles.some((r) => roles.includes(r));
    if (!ok) return <Navigate to="/" replace />;
  }

  return (
    <FilterProvider>
      <SidebarProvider defaultOpen={false}>
        <GlobalLoadingBar />
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <AppHeader />
            <main className="flex-1 p-6 overflow-auto">
              <PageErrorBoundary resetKey={location.pathname}>
                {children ?? <Outlet />}
              </PageErrorBoundary>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </FilterProvider>
  );
}