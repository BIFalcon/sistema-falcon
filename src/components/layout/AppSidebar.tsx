import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  FileSpreadsheet,
  Mail,
  Wallet,
  TrendingUp,
  Settings,
  Hotel,
  ClipboardList,
  ArrowDownCircle,
  ArrowUpCircle,
  Target,
  Users,
  ShieldCheck,
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
      { title: "Fechamento", url: "/fechamento", icon: ClipboardList },
      { title: "Contas a Pagar", url: "/contas-pagar", icon: ArrowUpCircle, soon: true },
      { title: "Contas a Receber", url: "/contas-receber", icon: ArrowDownCircle, soon: true },
    ],
  },
  {
    label: "Análise",
    items: [
      { title: "Indicadores DRE", url: "/indicadores", icon: TrendingUp, soon: true },
      { title: "Metas GG", url: "/metas", icon: Target, soon: true },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "RH & People", url: "/rh", icon: Users, soon: true },
      { title: "Controladoria", url: "/controladoria", icon: ShieldCheck, soon: true },
      { title: "Hotéis", url: "/hoteis", icon: Hotel },
      { title: "Configurações", url: "/configuracoes", icon: Settings, soon: true },
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
                          <span className="flex-1">{item.title}</span>
                          {!collapsed && (item as { soon?: boolean }).soon && (
                            <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sidebar-accent/20 text-sidebar-foreground/60">
                              Em breve
                            </span>
                          )}
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