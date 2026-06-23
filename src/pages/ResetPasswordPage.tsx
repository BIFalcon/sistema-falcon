import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PasswordInput, isPasswordStrong } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import falconLogo from "@/assets/falcon-logo-white.png";

/**
 * supabase.functions.invoke jogou FunctionsHttpError com mensagem genérica
 * ("non-2xx status code") quando a função respondeu com 4xx/5xx. O corpo
 * com o erro real precisa ser lido manualmente do Response em error.context.
 */
async function readInvokeError(error: unknown, data: { error?: string } | null): Promise<string | null> {
  if (data?.error) return mapKnownError(data.error);
  if (!error) return null;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.text === "function") {
    try {
      const text = await ctx.clone().text();
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) return mapKnownError(parsed.error);
      } catch {
        if (text) return text;
      }
    } catch {
      // ignore
    }
  }
  return (error as Error)?.message ?? null;
}

function mapKnownError(code: string): string {
  switch (code) {
    case "invalid_or_used":
      return "Este link de definição de senha já foi utilizado ou foi substituído por um link mais recente. Verifique seu e-mail pelo convite mais novo ou solicite um novo link.";
    case "expired":
      return "Este link expirou. Solicite um novo convite ou um novo link de recuperação de senha.";
    case "missing_token":
      return "Link inválido. Abra novamente o convite recebido por e-mail.";
    case "weak_password":
      return "A senha não atende aos requisitos mínimos.";
    default:
      return code;
  }
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const init = async () => {
      try {
        const search = new URLSearchParams(window.location.search);
        const customSetupToken = search.get("setup_token");
        if (customSetupToken) {
          const { data, error } = await supabase.functions.invoke("manage-users", {
            body: { action: "validate_password_setup", setup_token: customSetupToken },
          });
          if (error || data?.error) {
            const msg = await readInvokeError(error, data);
            throw new Error(msg ?? "Não foi possível validar o link.");
          }
          setSetupToken(customSetupToken);
          setSessionReady(true);
          return;
        }

        // 1) Hash tokens (#access_token=...&refresh_token=...&type=recovery)
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.substring(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(hash);
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) throw error;
          // limpa o hash da URL
          window.history.replaceState(null, "", window.location.pathname);
          setSessionReady(true);
          return;
        }

        // 2) Query params (PKCE / verifyOtp): ?token_hash=...&type=recovery
        const token_hash = search.get("token_hash");
        const type = search.get("type");
        if (token_hash && type) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type: type as "recovery" | "invite" | "signup" | "email_change",
          });
          if (error) throw error;
          window.history.replaceState(null, "", window.location.pathname);
          setSessionReady(true);
          return;
        }

        // 3) Já existe sessão ativa? (ex.: usuário já clicou e o listener pegou)
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setSessionReady(true);
          return;
        }

        setInitError(
          "Link inválido ou expirado. Solicite um novo convite ou um novo link de recuperação de senha.",
        );
      } catch (e) {
        setInitError(
          e instanceof Error
            ? `Não foi possível validar o link: ${e.message}`
            : "Não foi possível validar o link. Solicite um novo convite.",
        );
      } finally {
        setInitializing(false);
      }
    };
    init();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionReady) {
      toast.error("Sessão não inicializada", {
        description: "Abra novamente o link recebido por e-mail.",
      });
      return;
    }
    if (!isPasswordStrong(password)) {
      toast.error("Senha não atende aos requisitos", {
        description: "Verifique os requisitos abaixo do campo de senha.",
      });
      return;
    }
    if (password !== confirm) {
      toast.error("Senhas diferentes", { description: "Confirme a mesma senha." });
      return;
    }
    setSubmitting(true);
    const { error } = setupToken
      ? await supabase.functions.invoke("manage-users", {
          body: { action: "complete_password_setup", setup_token: setupToken, password },
        }).then(({ data, error: fnError }) => ({ error: fnError || (data?.error ? new Error(data.error) : null) }))
      : await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error("Erro", { description: error.message });
    } else {
      toast.success("Senha atualizada", { description: "Faça login com sua nova senha." });
      await supabase.auth.signOut();
      navigate("/login", { replace: true });
    }
  };

  return (
    <main className="min-h-screen w-full bg-gradient-sidebar flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <img src={falconLogo} alt="Falcon Hotéis" className="h-24 w-auto" />
        </div>
        <Card className="p-8 shadow-card">
          <h1 className="text-xl font-semibold mb-1">Definir nova senha</h1>
          <p className="text-sm text-muted-foreground mb-6">Crie uma senha forte para sua conta.</p>
          {initializing && (
            <p className="text-sm text-muted-foreground">Validando link…</p>
          )}
          {!initializing && initError && (
            <div className="space-y-4">
              <p className="text-sm text-destructive">{initError}</p>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => navigate("/login", { replace: true })}
              >
                Voltar ao login
              </Button>
            </div>
          )}
          {!initializing && !initError && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">Nova senha</Label>
              <PasswordInput
                id="pw"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                showChecklist
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Confirmar senha</Label>
              <PasswordInput
                id="pw2"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Salvando…" : "Salvar nova senha"}
            </Button>
          </form>
          )}
        </Card>
      </div>
    </main>
  );
}