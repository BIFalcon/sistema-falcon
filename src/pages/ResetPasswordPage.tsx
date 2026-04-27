import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PasswordInput, isPasswordStrong } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import falconLogo from "@/assets/falcon-logo-white.png";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordStrong(password)) {
      toast({
        title: "Senha não atende aos requisitos",
        description: "Verifique os requisitos abaixo do campo de senha.",
        variant: "destructive",
      });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Senhas diferentes", description: "Confirme a mesma senha.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Senha atualizada", description: "Faça login com sua nova senha." });
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
        </Card>
      </div>
    </main>
  );
}