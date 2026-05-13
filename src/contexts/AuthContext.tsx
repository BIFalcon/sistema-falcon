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
  loading: boolean;
  isMaster: boolean;
  isGg: boolean;
  isFernando: boolean;
  hasRole: (role: AppRole) => boolean;
  hasAnyRole: () => boolean;
  /** Sub-papel do financeiro: equipe (ops) ou coordenadora (chefe). */
  financeiroSubrole: "equipe" | "coordenadora" | null;
  isFinanceiroEquipe: boolean;
  isFinanceiroCoordenadora: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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
        supabase.from("hotels").select("*").order("name"),
      ]);

    setProfile((prof ?? null) as Profile | null);
    setRoles((roleRows ?? []).map((r: { role: AppRole }) => r.role));
    setUserHotels(
      (hotelRows ?? [])
        .map((r: { hotels: Hotel | null }) => r.hotels)
        .filter((h): h is Hotel => !!h),
    );
    setAllHotels((allHotelRows ?? []) as Hotel[]);
  };

  useEffect(() => {
    // listener ANTES do getSession
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
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
  const GLOBAL_ACCESS_ROLES = ["fernando", "controladoria", "financeiro", "ri", "rh", "operacoes", "viewer"];
  const hasGlobalAccess = isMaster || roles.some((r) => GLOBAL_ACCESS_ROLES.includes(r as string));
  const allowedHotels = hasGlobalAccess ? allHotels : userHotels;

  const hasFinanceiroRole = roles.includes("financeiro" as AppRole);
  // Default histórico: financeiro sem sub-flag = coordenadora.
  const financeiroSubrole: "equipe" | "coordenadora" | null = hasFinanceiroRole
    ? (profile?.financeiro_subrole ?? "coordenadora")
    : null;
  const isFinanceiroEquipe = hasFinanceiroRole && financeiroSubrole === "equipe";
  const isFinanceiroCoordenadora = hasFinanceiroRole && financeiroSubrole === "coordenadora";

  const value: AuthContextValue = {
    user,
    session,
    profile,
    roles,
    userHotels,
    allowedHotels,
    loading,
    isMaster,
    isGg: roles.includes("gg" as AppRole),
    isFernando: roles.includes("fernando" as AppRole),
    hasRole: (r) => roles.includes(r),
    hasAnyRole: () => roles.length > 0,
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