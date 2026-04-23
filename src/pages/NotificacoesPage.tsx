import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  EVENT_LABELS,
  NotificationRow,
  NotificationStatus,
  useNotificationQueue,
  useProcessNotifications,
} from "@/hooks/useNotifications";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, RefreshCw, Send, AlertCircle, Clock, CheckCircle2, MinusCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_OPTIONS: { value: NotificationStatus | "all"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendentes" },
  { value: "dispatched", label: "Enviados" },
  { value: "skipped", label: "Ignorados" },
  { value: "failed", label: "Falha" },
];

function StatusBadge({ status }: { status: NotificationStatus }) {
  const map = {
    pending: { label: "Pendente", icon: Clock, className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
    dispatched: { label: "Enviado", icon: CheckCircle2, className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
    skipped: { label: "Ignorado", icon: MinusCircle, className: "bg-muted text-muted-foreground border-border" },
    failed: { label: "Falha", icon: AlertCircle, className: "bg-destructive/10 text-destructive border-destructive/20" },
  } as const;
  const cfg = map[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </Badge>
  );
}

export default function NotificacoesPage() {
  const { isMaster, hasRole } = useAuth();
  const canManage = isMaster || hasRole("processos");
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | "all">("all");
  const [selected, setSelected] = useState<NotificationRow | null>(null);

  const { data: items = [], isLoading } = useNotificationQueue(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );
  const process = useProcessNotifications();

  const stats = useMemo(() => {
    const counts: Record<NotificationStatus, number> = {
      pending: 0, dispatched: 0, skipped: 0, failed: 0,
    };
    for (const it of items) counts[it.status]++;
    return counts;
  }, [items]);

  async function handleProcess() {
    try {
      const r = await process.mutateAsync();
      const data = r as { processed?: number; dispatched?: number; skipped?: number; domain_ready?: boolean };
      if (data?.domain_ready === false) {
        toast.info(
          `Processados ${data.processed ?? 0} itens. Domínio notify.falconhoteis.com.br ainda não configurado — todos foram marcados como ignorados.`,
        );
      } else {
        toast.success(`Enviados: ${data?.dispatched ?? 0} | Ignorados: ${data?.skipped ?? 0}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao processar fila");
    }
  }

  if (!canManage) {
    return (
      <div className="max-w-2xl mx-auto pt-12">
        <Card className="p-8 text-center shadow-soft">
          <Mail className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="text-lg font-semibold mb-1">Acesso restrito</h2>
          <p className="text-sm text-muted-foreground">
            Apenas perfis Master ou Processos podem visualizar a fila de notificações.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Configurações</p>
          <h1 className="text-2xl font-semibold text-foreground">Notificações do workflow</h1>
          <p className="text-sm text-muted-foreground">
            Fila de e-mails automáticos disparados pelo fluxo de fechamento.
          </p>
        </div>
        <Button onClick={handleProcess} disabled={process.isPending} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${process.isPending ? "animate-spin" : ""}`} />
          Processar fila
        </Button>
      </div>

      <Card className="p-4 shadow-soft border-amber-500/30 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-foreground mb-1">
              Domínio de e-mail aguardando configuração
            </p>
            <p className="text-muted-foreground">
              O domínio <code className="px-1 py-0.5 rounded bg-muted text-xs">notify.falconhoteis.com.br</code> ainda
              não está ativo. Os e-mails são gerados e enfileirados normalmente, mas o disparo real fica como{" "}
              <strong>ignorado</strong> até o domínio ser configurado. Quando estiver pronto, os próximos e-mails
              da fila serão enviados automaticamente.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Pendentes", value: stats.pending, icon: Clock, color: "text-amber-600" },
          { label: "Enviados", value: stats.dispatched, icon: CheckCircle2, color: "text-emerald-600" },
          { label: "Ignorados", value: stats.skipped, icon: MinusCircle, color: "text-muted-foreground" },
          { label: "Falha", value: stats.failed, icon: AlertCircle, color: "text-destructive" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <Card key={s.label} className="p-4 shadow-soft">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</span>
                <Icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <p className="text-2xl font-semibold">{s.value}</p>
            </Card>
          );
        })}
      </div>

      <Card className="p-5 shadow-soft">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider">Fila de notificações</h3>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as NotificationStatus | "all")}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground italic">Carregando…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nenhuma notificação no momento.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 hover:bg-secondary/40">
                <TableHead className="text-xs uppercase tracking-wider">Quando</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Evento</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Destinatário</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Assunto</TableHead>
                <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(n.created_at).toLocaleString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-xs">{EVENT_LABELS[n.event] ?? n.event}</TableCell>
                  <TableCell className="text-xs">
                    <div className="flex flex-col">
                      <span className="font-medium">{n.recipient_email ?? "—"}</span>
                      {n.recipient_role && (
                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
                          {n.recipient_role}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[300px] truncate">{n.subject}</TableCell>
                  <TableCell><StatusBadge status={n.status} /></TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setSelected(n)}>
                      Ver
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">{selected?.subject}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider">Evento</p>
                  <p className="font-medium">{EVENT_LABELS[selected.event] ?? selected.event}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider">Status</p>
                  <StatusBadge status={selected.status} />
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider">Destinatário</p>
                  <p className="font-medium">{selected.recipient_email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground uppercase tracking-wider">Papel</p>
                  <p className="font-medium">{selected.recipient_role ?? "—"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground uppercase tracking-wider">Link</p>
                  <a href={selected.link_url} className="text-primary underline break-all">
                    {selected.link_url}
                  </a>
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="text-muted-foreground uppercase tracking-wider text-xs mb-2">Conteúdo</p>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-muted/40 p-3 rounded-md">
                  {selected.body_md}
                </pre>
              </div>
              {selected.error_message && (
                <div className="border-t pt-4">
                  <p className="text-muted-foreground uppercase tracking-wider text-xs mb-1">Mensagem do sistema</p>
                  <p className="text-xs">{selected.error_message}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
