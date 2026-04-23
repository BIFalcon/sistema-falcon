import { NavLink, useLocation } from "react-router-dom";
import {
  ClipboardList,
  FileSpreadsheet,
  Mail,
  Wallet,
  Send,
  TrendingUp,
  Target,
  ArrowDownCircle,
  ArrowUpCircle,
  Users,
  ShieldCheck,
  Hotel,
  Settings,
  UserCog,
  Image as ImageIcon,
  ChevronRight,
  LayoutGrid,
  Gauge,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import falconLogo from "@/assets/falcon-logo-white.png";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABELS } from "@/lib/constants";

type LeafItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
  end?: boolean;
  requireMaster?: boolean;
};

type GroupItem = LeafItem & {
  children?: LeafItem[];
};

const navGroups: { label: string; items: GroupItem[] }[] = [
  {
    label: "Operação",
    items: [
      {
        title: "Fechamento",
        url: "/fechamento",
        icon: ClipboardList,
        children: [
          { title: "Visão Geral", url: "/fechamento", icon: LayoutGrid, end: true },
          { title: "DRE", url: "/fechamento/dre", icon: FileSpreadsheet },
          { title: "Carta ao Investidor", url: "/fechamento/carta", icon: Mail },
          { title: "Financeiro", url: "/fechamento/financeiro", icon: Wallet },
          { title: "Envio", url: "/fechamento/envio", icon: Send, soon: true },
          { title: "Performance SLA", url: "/fechamento/performance", icon: Gauge, requireMaster: true },
        ],
      },
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
      {
        title: "Financeiro",
        url: "/financeiro",
        icon: Wallet,
        soon: true,
        children: [
          { title: "Visão Geral", url: "/financeiro", icon: LayoutGrid, end: true, soon: true },
          { title: "Contas a Pagar", url: "/financeiro/contas-pagar", icon: ArrowUpCircle, soon: true },
          { title: "Contas a Receber", url: "/financeiro/contas-receber", icon: ArrowDownCircle, soon: true },
        ],
      },
      { title: "RH & People", url: "/rh", icon: Users, soon: true },
      { title: "Controladoria", url: "/controladoria", icon: ShieldCheck, soon: true },
    ],
  },
  {
    label: "Configurações",
    items: [
      { title: "Usuários", url: "/configuracoes/usuarios", icon: UserCog },
      { title: "Hotéis", url: "/configuracoes/hoteis", icon: Hotel },
      { title: "Notificações", url: "/configuracoes/notificacoes", icon: Mail },
      { title: "Assets", url: "/configuracoes/assets", icon: ImageIcon, soon: true },
    ],
  },
];

function SoonBadge() {
  return (
    <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-sidebar-accent/20 text-sidebar-foreground/60">
      Em breve
    </span>
  );
}

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

  const isActiveUrl = (url: string, end?: boolean) =>
    end ? location.pathname === url : location.pathname === url || location.pathname.startsWith(url + "/");

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
                  const hasChildren = !!item.children?.length;
                  const parentActive = isActiveUrl(item.url, false);

                  if (!hasChildren) {
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActiveUrl(item.url, item.end)}>
                          <NavLink to={item.url} end={item.end}>
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{item.title}</span>
                            {!collapsed && item.soon && <SoonBadge />}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }

                  return (
                    <Collapsible
                      key={item.url}
                      defaultOpen={parentActive}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton isActive={parentActive}>
                            <item.icon className="h-4 w-4" />
                            <span className="flex-1">{item.title}</span>
                            {!collapsed && item.soon && <SoonBadge />}
                            {!collapsed && (
                              <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            )}
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        {!collapsed && (
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.children!.map((child) => (
                                <SidebarMenuSubItem key={child.url}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isActiveUrl(child.url, child.end)}
                                  >
                                    <NavLink to={child.url} end={child.end}>
                                      <child.icon className="h-3.5 w-3.5" />
                                      <span className="flex-1">{child.title}</span>
                                      {child.soon && <SoonBadge />}
                                    </NavLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        )}
                      </SidebarMenuItem>
                    </Collapsible>
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
