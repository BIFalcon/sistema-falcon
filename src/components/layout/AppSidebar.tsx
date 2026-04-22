import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Wallet,
  TrendingUp,
  Target,
  Users,
  ClipboardCheck,
  Settings,
  Hotel,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import falconLogo from "@/assets/falcon-logo-white.png";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/constants";

const navGroups = [
  {
    label: "Visão Geral",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard, end: true }],
  },
  {
    label: "Operação",
    items: [
      { title: "Fechamento", url: "/fechamento", icon: FileSpreadsheet },
      { title: "Contas a Pagar", url: "/contas-pagar", icon: Wallet },
      { title: "Contas a Receber", url: "/contas-receber", icon: Wallet },
    ],
  },
  {
    label: "Análise",
    items: [
      { title: "Indicadores DRE", url: "/indicadores", icon: TrendingUp },
      { title: "Metas GG", url: "/metas", icon: Target },
      { title: "RH & People", url: "/rh", icon: Users },
      { title: "Controladoria", url: "/controladoria", icon: ClipboardCheck },
    ],
  },
  {
    label: "Sistema",
    items: [
      { title: "Hotéis", url: "/hoteis", icon: Hotel },
      { title: "Configurações", url: "/configuracoes", icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { profile, roles, isMaster } = useAuth();

  const primaryRole = roles[0];
  const roleLabel = isMaster
    ? "Master"
    : primaryRole
      ? ROLE_LABELS[primaryRole]
      : "—";

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className={`flex items-center ${collapsed ? "justify-center py-3" : "justify-center py-5"}`}>
          <img
            src={falconLogo}
            alt="Falcon Hotéis"
            className={collapsed ? "h-9 w-auto" : "h-16 w-auto"}
          />
        </div>
        {!collapsed && (
          <p className="text-[10px] tracking-[0.18em] text-sidebar-foreground/50 text-center uppercase pb-3">
            Sistema Falcon
          </p>
        )}
      </SidebarHeader>

      <SidebarContent className="py-2">
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-sidebar-foreground/40 text-[10px] font-semibold tracking-[0.14em] uppercase">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = item.end
                    ? location.pathname === item.url
                    : location.pathname.startsWith(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild isActive={active}>
                        <NavLink to={item.url} end={item.end}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-sidebar-foreground truncate">
              {profile?.display_name ?? profile?.email ?? "Usuário"}
            </span>
            <span className="text-[10px] text-sidebar-foreground/50 uppercase tracking-wider">
              {roleLabel}
            </span>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}