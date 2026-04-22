import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { ShieldAlert } from "lucide-react";
import falconLogo from "@/assets/falcon-logo-white.png";

export default function SemPermissaoPage() {
  const { signOut, user } = useAuth();
  return (
    <main className="min-h-screen w-full bg-gradient-sidebar flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src={falconLogo} alt="Falcon Hotéis" className="h-20 w-auto" />
        </div>
        <Card className="p-8 text-center shadow-card">
          <div className="mx-auto w-12 h-12 rounded-full bg-warning/15 flex items-center justify-center mb-4">
            <ShieldAlert className="w-6 h-6 text-warning" />
          </div>
          <h1 className="text-lg font-semibold mb-2">Acesso não liberado</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Sua conta <span className="font-medium text-foreground">{user?.email}</span> está autenticada,
            mas ainda não possui um papel atribuído. Solicite ao time de Processos.
          </p>
          <Button variant="outline" onClick={signOut} className="w-full">Sair</Button>
        </Card>
      </div>
    </main>
  );
}