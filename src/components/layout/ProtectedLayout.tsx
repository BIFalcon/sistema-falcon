import { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { FilterProvider } from "@/contexts/FilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { AppRole } from "@/lib/constants";

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-gradient-sidebar flex items-center justify-center">
      <div className="text-sidebar-foreground/70 text-sm tracking-wider uppercase">
        Carregando…
      </div>
    </div>
  );
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
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <AppHeader />
            <main className="flex-1 p-6 overflow-auto">{children ?? <Outlet />}</main>
          </div>
        </div>
      </SidebarProvider>
    </FilterProvider>
  );
}