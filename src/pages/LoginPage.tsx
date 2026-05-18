import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import falconLogo from "@/assets/falcon-logo-white.png";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");

  useEffect(() => {
    if (!loading && user) navigate("/", { replace: true });
  }, [user, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (error) {
      toast.error("Falha no acesso", { description: "Verifique e-mail e senha." });
    } else {
      navigate("/", { replace: true });
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Erro", { description: error.message });
    } else {
      toast.success("E-mail enviado", {
        description: "Verifique sua caixa de entrada para redefinir a senha.",
      });
      setMode("login");
    }
  };

  return (
    <main className="min-h-screen w-full bg-gradient-sidebar flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <img src={falconLogo} alt="Falcon Hotéis" className="h-24 w-auto opacity-95" />
        </div>
        <Card className="p-8 shadow-card border-border/60">
          <h1 className="text-xl font-semibold text-foreground mb-1">
            {mode === "login" ? "Acesso ao Sistema Falcon" : "Recuperar senha"}
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === "login"
              ? "Use suas credenciais corporativas."
              : "Informe seu e-mail para receber o link de redefinição."}
          </p>

          <form
            onSubmit={mode === "login" ? handleLogin : handleForgot}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="seu.nome@falconhoteis.com.br"
              />
            </div>

            {mode === "login" && (
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting
                ? "Aguarde…"
                : mode === "login"
                  ? "Entrar"
                  : "Enviar link de recuperação"}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => setMode(mode === "login" ? "forgot" : "login")}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {mode === "login" ? "Esqueci minha senha" : "Voltar ao login"}
            </button>
          </div>

          <p className="mt-6 text-xs text-muted-foreground text-center border-t border-border pt-4">
            Acesso restrito por convite. Solicite ao time de Processos.
          </p>
        </Card>
      </div>
    </main>
  );
}