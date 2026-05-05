import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function PerfilPage() {
  const { profile, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  async function handleSaveName() {
    if (!profile) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: displayName })
      .eq("id", profile.id);
    setSavingName(false);
    if (error) toast.error("Erro ao salvar nome");
    else {
      toast.success("Nome atualizado");
      await refresh();
    }
  }

  async function handleChangePassword() {
    if (newPassword !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("A senha deve ter ao menos 6 caracteres");
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Senha alterada com sucesso");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
          Configurações
        </p>
        <h1 className="text-2xl font-semibold">Meu Perfil</h1>
      </div>

      <Card className="p-5 shadow-soft space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-accent/10 text-accent flex items-center justify-center font-semibold text-lg">
            {(profile?.display_name ?? profile?.email ?? "U")[0].toUpperCase()}
          </div>
          <div>
            <p className="font-semibold">{profile?.display_name ?? "—"}</p>
            <p className="text-xs text-muted-foreground">{profile?.email}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Nome de exibição</Label>
          <div className="flex gap-2">
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Seu nome"
            />
            <Button
              onClick={handleSaveName}
              disabled={savingName || displayName === profile?.display_name}
            >
              Salvar
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5 shadow-soft space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider">Alterar senha</h3>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Nova senha</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div className="space-y-1">
            <Label>Confirmar nova senha</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={savingPassword || !newPassword || !confirmPassword}
            className="w-full"
          >
            Alterar senha
          </Button>
        </div>
      </Card>
    </div>
  );
}