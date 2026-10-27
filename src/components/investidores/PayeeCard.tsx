import { AlertTriangle } from "lucide-react";
import type { PayeeJson } from "@/hooks/useInvestors";
import { formatDocumento, formatTelefone, payeeIssues } from "@/lib/brValidation";
import { StatusSelo } from "./StatusSelo";

const TIPO_CONTA: Record<string, string> = { corrente: "Corrente", poupanca: "Poupança" };

export function PayeeCard({ p, percentual }: { p: PayeeJson; percentual?: number }) {
  const banco = [p.banco_nome, p.banco_codigo].filter(Boolean).join(" ") || "—";
  // Formato só é conferido quando os dados estão visíveis por completo.
  const issues = payeeIssues(p);
  const formato = p.full ? issues.formato : [];
  return (
    <div className="rounded border p-3 space-y-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{p.nome_favorecido}{percentual != null && <span className="ml-2 text-primary">{percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</span>}</span>
        <StatusSelo status={p.status_dados} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Documento</span><span>{p.full ? formatDocumento(p.documento_favorecido) || "—" : p.documento_favorecido ?? "—"}</span>
        <span className="text-muted-foreground">E-mail</span><span className="break-all">{p.email ?? "—"}</span>
        <span className="text-muted-foreground">Telefone</span><span>{p.telefone ? formatTelefone(p.telefone) : "—"}</span>
        <span className="text-muted-foreground">Banco</span><span>{banco}</span>
        <span className="text-muted-foreground">Agência</span><span>{p.agencia ?? "—"}</span>
        <span className="text-muted-foreground">Conta</span><span>{p.conta ?? "—"}{p.tipo_conta ? ` (${TIPO_CONTA[p.tipo_conta]})` : ""}</span>
        <span className="text-muted-foreground">Chave PIX</span><span className="break-all">{p.chave_pix ? `${p.chave_pix}${p.tipo_chave_pix ? ` (${p.tipo_chave_pix})` : ""}` : "—"}</span>
      </div>
      {(formato.length > 0 || issues.remessa.length > 0) && (
        <div className="rounded bg-warning/10 border border-warning/30 p-2 text-xs space-y-0.5">
          {issues.remessa.length > 0 && <div className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Pendente para remessa: falta {issues.remessa.join(", ")}</div>}
          {formato.map((m) => <div key={m} className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{m}</div>)}
        </div>
      )}
      {p.observacao && <p className="text-xs text-muted-foreground">Obs.: {p.observacao}</p>}
    </div>
  );
}
