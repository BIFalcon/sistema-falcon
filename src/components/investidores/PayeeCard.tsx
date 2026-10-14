import type { PayeeJson } from "@/hooks/useInvestors";
import { StatusSelo } from "./StatusSelo";

export function PayeeCard({ p }: { p: PayeeJson }) {
  const banco = [p.banco_nome, p.banco_codigo].filter(Boolean).join(" ") || "—";
  return (
    <div className="rounded border p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{p.nome_favorecido}</span>
        <StatusSelo status={p.status_dados} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Documento</span><span>{p.documento_favorecido ?? "—"}</span>
        <span className="text-muted-foreground">Banco</span><span>{banco}</span>
        <span className="text-muted-foreground">Agência</span><span>{p.agencia ?? "—"}</span>
        <span className="text-muted-foreground">Conta</span><span>{p.conta ?? "—"}</span>
        <span className="text-muted-foreground">Chave PIX</span><span>{p.chave_pix ? `${p.chave_pix}${p.tipo_chave_pix ? ` (${p.tipo_chave_pix})` : ""}` : "—"}</span>
      </div>
      {p.observacao && <p className="text-xs text-muted-foreground">Obs.: {p.observacao}</p>}
    </div>
  );
}
