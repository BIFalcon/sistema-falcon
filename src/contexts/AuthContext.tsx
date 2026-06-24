import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole, Hotel } from "@/lib/constants";
import { MASTER_ROLES } from "@/lib/constants";

interface Profile {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  financeiro_subrole?: "equipe" | "coordenadora" | null;
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  userHotels: Hotel[];
  allowedHotels: Hotel[];
  /** Hotel "Matriz" (rh_only), exposto à parte para uso exclusivo do módulo de RH. */
  matrizHotel: Hotel | null;
  /** True quando o usuário pode ver Matriz no filtro de Turnover/Rotatividade. */
  canSeeMatriz: boolean;
  loading: boolean;
  isMaster: boolean;
  isGg: boolean;
  isFernando: boolean;
  /** Administrativo do hotel — adm. */
  isAdm: boolean;
  /** É o Fernando CEO (identificado pelo e-mail), não apenas alguém com role 'fernando'. */
  isFernandoCEO: boolean;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: () => boolean;
  /** True quando o usuário é da coordenadoria (patronos). */
  isPatronos: boolean;
  /** True quando pode visualizar Performance SLA. */
  canViewPerformanceSla: boolean;
  /** Sub-papel do financeiro: equipe (ops) ou coordenadora (chefe). */
  financeiroSubrole: "equipe" | "coordenadora" | null;
  isFinanceiroEquipe: boolean;
  isFinanceiroCoordenadora: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** E-mail do Fernando CEO real — usado para restrições específicas dele. */
const FERNANDO_CEO_EMAIL = "fernando.fonseca@falconhoteis.com.br";

/** Duração máxima de uma sessão antes de exigir novo login. */
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [userHotels, setUserHotels] = useState<Hotel[]>([]);
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: roleRows }, { data: hotelRows }, { data: allHotelRows }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
        supabase
          .from("user_hotels")
          .select("hotel_id, hotels(id,name,brand,active)")
          .eq("user_id", uid),
        supabase
          .from("hotels")
          .select(
            "id,name,brand,active,is_active,cover_url,brand_logo_url,opera_property_name,num_apartments,financial_system,show_in_closing,rh_only,created_at",
          )
          .eq("is_active", true)
          .order("name"),
      ]);

    setProfile((prof ?? null) as Profile | null);
    setRoles((roleRows ?? []).map((r: { role: AppRole }) => r.role));
    setUserHotels(
      (hotelRows ?? [])
        .map((r: { hotels: Hotel | null }) => r.hotels)
        .filter((h): h is Hotel => !!h && (h as { is_active?: boolean }).is_active !== false),
    );
    setAllHotels((allHotelRows ?? []) as Hotel[]);
  };

  useEffect(() => {
    // listener ANTES do getSession
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Block 9: força expiração de sessão após 24h do último login.
      if (newSession?.user?.last_sign_in_at) {
        const signInTime = new Date(newSession.user.last_sign_in_at).getTime();
        if (Date.now() - signInTime > SESSION_MAX_AGE_MS) {
          supabase.auth.signOut().catch(() => {});
          return;
        }
      }
      const newUid = newSession?.user?.id ?? null;
      // Atualiza session sempre (token refresh, etc.)
      setSession(newSession);

      // Só recarrega dados do perfil quando o usuário REALMENTE muda
      // (login/logout). Eventos como TOKEN_REFRESHED ou SIGNED_IN ao
      // voltar para a aba não devem disparar reload — isso desmontava
      // dialogs/forms abertos pelo usuário.
      setUser((prevUser) => {
        const prevUid = prevUser?.id ?? null;
        if (newUid && newUid !== prevUid) {
          setLoading(true);
          setTimeout(() => {
            loadUserData(newUid).finally(() => setLoading(false));
          }, 0);
        } else if (!newUid && prevUid) {
          setProfile(null);
          setRoles([]);
          setUserHotels([]);
          setAllHotels([]);
          setLoading(false);
        }
        return newSession?.user ?? null;
      });
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      // Block 9: descarta sessão antiga (>24h) já carregada do storage.
      if (s?.user?.last_sign_in_at) {
        const signInTime = new Date(s.user.last_sign_in_at).getTime();
        if (Date.now() - signInTime > SESSION_MAX_AGE_MS) {
          supabase.auth.signOut().finally(() => setLoading(false));
          return;
        }
      }
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        loadUserData(s.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const isMaster = roles.some((r) => (MASTER_ROLES as readonly string[]).includes(r));
  const GLOBAL_ACCESS_ROLES = ["fernando", "controladoria", "patronos", "ri", "rh", "marketing", "operacoes", "viewer"];
  const hasGlobalAccess = isMaster || roles.some((r) => GLOBAL_ACCESS_ROLES.includes(r as string));
  // Hotéis "rh_only" (ex.: Matriz) nunca entram nos filtros globais.
  const isRhOnly = (h: Hotel) => (h as { rh_only?: boolean }).rh_only === true;
  const allowedHotels = (hasGlobalAccess ? allHotels : userHotels).filter((h) => !isRhOnly(h));
  const matrizHotel = allHotels.find(isRhOnly) ?? null;
  const canSeeMatriz =
    !!matrizHotel &&
    (isMaster ||
      roles.includes("rh" as AppRole) ||
      roles.includes("viewer" as AppRole) ||
      roles.includes("fernando" as AppRole));

  const isPatronos = roles.includes("patronos" as AppRole);
  // O papel "financeiro" foi descontinuado: equipe migrou para controladoria, coordenadoria virou patronos.
  const financeiroSubrole: "equipe" | "coordenadora" | null = null;
  const isFinanceiroEquipe = false;
  // Mantido como alias de patronos para compatibilidade com código existente que checa "marcar como Pago".
  const isFinanceiroCoordenadora = isPatronos;
  const isFernandoCEO = user?.email?.toLowerCase() === FERNANDO_CEO_EMAIL;

  /**
   * Shim de compatibilidade: o papel "financeiro" foi removido. Qualquer código
   * legado que ainda peça hasRole("financeiro") deve receber true se o usuário
   * for controladoria OU patronos (sucessores naturais).
   */
  const hasRoleShim = (r: AppRole) => {
    if ((r as string) === "financeiro") {
      return roles.includes("controladoria" as AppRole) || roles.includes("patronos" as AppRole);
    }
    // Todo patrono é controladoria por definição do time.
    if ((r as string) === "controladoria") {
      return roles.includes("controladoria" as AppRole) || roles.includes("patronos" as AppRole);
    }
    return roles.includes(r);
  };

  const value: AuthContextValue = {
    user,
    session,
    profile,
    roles,
    userHotels,
    allowedHotels,
    matrizHotel,
    canSeeMatriz,
    loading,
    isMaster,
    isGg: roles.includes("gg" as AppRole),
    isFernando: roles.includes("fernando" as AppRole),
    isAdm: roles.includes("adm" as AppRole),
    isFernandoCEO,
    hasRole: hasRoleShim,
    hasAnyRole: () => roles.length > 0,
    isPatronos,
    canViewPerformanceSla: isMaster || roles.includes("viewer" as AppRole) || isFernandoCEO,
    financeiroSubrole,
    isFinanceiroEquipe,
    isFinanceiroCoordenadora,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    },
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refresh: async () => {
      if (user) await loadUserData(user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}