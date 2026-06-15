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
  ChevronRight,
  LayoutGrid,
  Gauge,
  Home,
  GitCompare,
  TrendingDown,
  CalendarDays,
  Network,
  GraduationCap,
  FileText,
  Inbox,
  Megaphone,
  Palette,
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
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { useAvatarUrl } from "@/hooks/useProfileAvatar";

type LeafItem = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
  end?: boolean;
  requireMaster?: boolean;
  allowedRoles?: AppRole[];
};

type GroupItem = LeafItem & {
  children?: LeafItem[];
};

const navGroups: { label: string; items: GroupItem[] }[] = [
  {
    label: "Operação",
    items: [
      { title: "Início", url: "/", icon: Home, end: true },
      {
        title: "Fechamento",
        url: "/fechamento",
        icon: ClipboardList,
        allowedRoles: ["processos","fernando","controladoria","gop","ri","financeiro","gg","rh","operacoes","viewer"] as AppRole[],
        children: [
          { title: "Visão Geral", url: "/fechamento", icon: LayoutGrid, end: true },
          { title: "DRE", url: "/fechamento/dre", icon: FileSpreadsheet },
          { title: "Carta ao Investidor", url: "/fechamento/carta", icon: Mail },
          { title: "Financeiro", url: "/fechamento/financeiro", icon: Wallet, allowedRoles: ["financeiro","viewer"] as AppRole[] },
          { title: "Envio", url: "/fechamento/envio", icon: Send, allowedRoles: ["ri"] as AppRole[] },
          { title: "Performance SLA", url: "/fechamento/performance", icon: Gauge, requireMaster: true },
          { title: "Consolidado de Resultados", url: "/fechamento/consolidado", icon: LayoutGrid, allowedRoles: ["controladoria", "gop", "ri", "financeiro", "processos", "viewer"] as AppRole[] },
        ],
      },
    ],
  },
  {
    label: "Análise",
    items: [
      { title: "Indicadores DRE", url: "/indicadores", icon: TrendingUp, allowedRoles: ["gop", "gg", "controladoria", "patronos", "operacoes", "viewer"] as AppRole[] },
      { title: "Metas GG", url: "/metas", icon: Target, soon: true, allowedRoles: ["gop", "gg", "controladoria", "patronos", "operacoes", "viewer"] as AppRole[] },
    ],
  },
  {
    label: "Gestão",
    items: [
      {
        title: "Financeiro",
        url: "/financeiro",
        icon: Wallet,
        allowedRoles: ["financeiro","gg","adm","gop","viewer"] as AppRole[],
        children: [
          { title: "Visão Geral", url: "/financeiro", icon: LayoutGrid, end: true, allowedRoles: ["financeiro","gg","viewer"] as AppRole[] },
          { title: "Contas a Pagar", url: "/financeiro/contas-pagar", icon: ArrowUpCircle, allowedRoles: ["financeiro","viewer"] as AppRole[] },
          { title: "Contas a Receber", url: "/financeiro/contas-receber", icon: ArrowDownCircle, allowedRoles: ["financeiro","gg","adm","gop","viewer"] as AppRole[] },
        ],
      },
      // Adiciona "Clientes" também no menu do financeiro.
      {
        title: "Controladoria",
        url: "/controladoria",
        icon: ShieldCheck,
        allowedRoles: ["controladoria","viewer"] as AppRole[],
        children: [
          { title: "Conciliação TOTVS × Opera", url: "/controladoria/conciliacao", icon: GitCompare },
        ],
      },
    ],
  },
  {
    label: "RH",
    items: [
      {
        title: "RH & People",
        url: "/rh",
        icon: Users,
        allowedRoles: ["processos","fernando","controladoria","patronos","rh","gop","gg","ri","operacoes","viewer"] as AppRole[],
        children: [
          { title: "Turnover & Rotatividade", url: "/rh/turnover", icon: TrendingDown },
          { title: "Organograma", url: "/rh/organograma", icon: Network },
          { title: "Treinamentos", url: "/rh/treinamentos", icon: GraduationCap },
          { title: "Políticas", url: "/rh/politicas", icon: FileText },
        ],
      },
    ],
  },
  {
    label: "Marketing",
    items: [
      {
        title: "Marketing",
        url: "/marketing",
        icon: Megaphone,
        allowedRoles: ["processos","fernando","controladoria","patronos","marketing","gop","gg","ri","operacoes","rh","viewer"] as AppRole[],
        children: [
          { title: "Calendário", url: "/marketing/calendario", icon: CalendarDays },
          { title: "Padronização da Marca", url: "/marketing/padroes-marca", icon: Palette },
        ],
      },
    ],
  },
  {
    label: "Configurações",
    items: [
      { title: "Usuários", url: "/configuracoes/usuarios", icon: UserCog, requireMaster: true },
      { title: "Hotéis", url: "/configuracoes/hoteis", icon: Hotel, requireMaster: true },
      { title: "Notificações", url: "/configuracoes/notificacoes", icon: Mail, requireMaster: true },
      { title: "Monitor de E-mails", url: "/configuracoes/emails", icon: Inbox, requireMaster: true },
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
  const { state, setOpen } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { profile, roles, isMaster, hasRole, canViewPerformanceSla } = useAuth();

  // Mostra TODOS os roles do usuário, com prefixo "Master" quando aplicável.
  const roleNames = roles.map((r) => ROLE_LABELS[r] ?? r);
  const roleLabel = roles.length === 0
    ? "—"
    : isMaster
      ? `Master · ${roleNames.join(", ")}`
      : roleNames.join(", ");

  const isActiveUrl = (url: string, end?: boolean) =>
    end ? location.pathname === url : location.pathname === url || location.pathname.startsWith(url + "/");

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
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
                    // Performance SLA tem regra própria (master | viewer | Fernando CEO)
                    if (item.url === "/fechamento/performance") {
                      if (!canViewPerformanceSla) return null;
                    }
                    const allowed = item.requireMaster
                      ? (isMaster || roles.includes("processos"))
                      : item.allowedRoles
                        ? (isMaster || item.allowedRoles.some((r) => hasRole(r)))
                        : true;
                    if (!allowed) return null;
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild isActive={isActiveUrl(item.url, item.end)}>
                          <NavLink to={item.url} end={item.end}>
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1 truncate">{item.title}</span>
                            {!collapsed && item.soon && <SoonBadge />}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  }

                  const groupAllowed = item.requireMaster
                    ? (isMaster || roles.includes("processos"))
                    : item.allowedRoles
                      ? (isMaster || item.allowedRoles.some((r) => hasRole(r)))
                      : true;
                  if (!groupAllowed) return null;

                  return (
                    <Collapsible
                      key={item.url + (item.allowedRoles?.join(",") ?? "")}
                      defaultOpen={parentActive}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton isActive={parentActive}>
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className="flex-1 truncate">{item.title}</span>
                            {!collapsed && item.soon && <SoonBadge />}
                            {!collapsed && (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            )}
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        {!collapsed && (
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.children!
                                .filter((child) => {
                                  if (child.requireMaster) return isMaster || roles.includes("processos");
                                  if (child.url === "/fechamento/performance") return canViewPerformanceSla;
                                  if (child.allowedRoles) return isMaster || child.allowedRoles.some((r) => hasRole(r));
                                  return true;
                                })
                                .map((child) => (
                                <SidebarMenuSubItem key={child.url}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={isActiveUrl(child.url, child.end)}
                                    className="text-[13px]"
                                  >
                                    <NavLink to={child.url} end={child.end}>
                                      <child.icon className="h-3.5 w-3.5 shrink-0" />
                                      <span className="flex-1 truncate">{child.title}</span>
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
          <SidebarUserFooter
            displayName={profile?.display_name ?? profile?.email ?? "Usuário"}
            roleLabel={roleLabel}
            userId={profile?.user_id}
            initial={(profile?.display_name ?? profile?.email ?? "U")[0].toUpperCase()}
          />
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

function SidebarUserFooter({
  displayName,
  roleLabel,
  userId,
  initial,
}: {
  displayName: string;
  roleLabel: string;
  userId: string | null | undefined;
  initial: string;
}) {
  const { data: avatarUrl } = useAvatarUrl(userId);
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 rounded-full bg-sidebar-accent/20 text-sidebar-foreground flex items-center justify-center text-xs font-semibold overflow-hidden shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs font-medium text-sidebar-foreground truncate">
          {displayName}
        </span>
        <span className="text-[10px] text-sidebar-foreground/50 uppercase tracking-wider truncate">
          {roleLabel}
        </span>
      </div>
    </div>
  );
}
