import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";

type LogRow = {
  id: string;
  message_id: string | null;
  template_name: string | null;
  recipient_email: string | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

const RANGES: Record<string, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    sent: "bg-emerald-100 text-emerald-800 border-emerald-200",
    dlq: "bg-red-100 text-red-800 border-red-200",
    failed: "bg-red-100 text-red-800 border-red-200",
    bounced: "bg-orange-100 text-orange-800 border-orange-200",
    complained: "bg-orange-100 text-orange-800 border-orange-200",
    suppressed: "bg-amber-100 text-amber-800 border-amber-200",
    pending: "bg-slate-100 text-slate-700 border-slate-200",
  };
  return (
    <Badge variant="outline" className={map[status] ?? "bg-slate-100 text-slate-700"}>
      {status}
    </Badge>
  );
}

export default function EmailMonitoringPage() {
  const [range, setRange] = useState<keyof typeof RANGES>("7d");
  const [template, setTemplate] = useState<string>("__all");
  const [status, setStatus] = useState<string>("__all");

  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - RANGES[range]);
    return d.toISOString();
  }, [range]);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["email-monitoring", since],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_send_log")
        .select("id,message_id,template_name,recipient_email,status,error_message,created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return data as LogRow[];
    },
  });

  // Deduplicate by message_id, keeping latest row (already ordered DESC).
  const deduped = useMemo(() => {
    if (!data) return [] as LogRow[];
    const seen = new Set<string>();
    const out: LogRow[] = [];
    for (const r of data) {
      const key = r.message_id ?? r.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [data]);

  const templates = useMemo(() => {
    const s = new Set<string>();
    deduped.forEach((r) => r.template_name && s.add(r.template_name));
    return Array.from(s).sort();
  }, [deduped]);

  const filtered = useMemo(() => {
    return deduped.filter((r) => {
      if (template !== "__all" && r.template_name !== template) return false;
      if (status !== "__all" && r.status !== status) return false;
      return true;
    });
  }, [deduped, template, status]);

  const stats = useMemo(() => {
    const s = { total: filtered.length, sent: 0, dlq: 0, suppressed: 0, pending: 0 };
    filtered.forEach((r) => {
      if (r.status === "sent") s.sent++;
      else if (r.status === "dlq" || r.status === "failed") s.dlq++;
      else if (r.status === "suppressed") s.suppressed++;
      else if (r.status === "pending") s.pending++;
    });
    return s;
  }, [filtered]);

  const visibleRows = filtered.slice(0, 200);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monitoramento de E-mails</h1>
          <p className="text-sm text-muted-foreground">
            Status de envio dos e-mails do sistema (notificações, convites, fluxo de aprovação).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["24h", "7d", "30d"] as const).map((r) => (
          <Button
            key={r}
            size="sm"
            variant={range === r ? "default" : "outline"}
            onClick={() => setRange(r)}
          >
            {r === "24h" ? "Últimas 24h" : r === "7d" ? "Últimos 7 dias" : "Últimos 30 dias"}
          </Button>
        ))}
        <Select value={template} onValueChange={setTemplate}>
          <SelectTrigger className="w-[260px] h-9">
            <SelectValue placeholder="Tipo de e-mail" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os tipos</SelectItem>
            {templates.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[200px] h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todos os status</SelectItem>
            <SelectItem value="sent">Enviado</SelectItem>
            <SelectItem value="dlq">Falhou (DLQ)</SelectItem>
            <SelectItem value="failed">Falhou</SelectItem>
            <SelectItem value="pending">Pendente</SelectItem>
            <SelectItem value="suppressed">Suprimido</SelectItem>
            <SelectItem value="bounced">Bounce</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total único" value={stats.total} />
        <StatCard label="Enviados" value={stats.sent} tone="emerald" />
        <StatCard label="Falharam" value={stats.dlq} tone="red" />
        <StatCard label="Suprimidos" value={stats.suppressed} tone="amber" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            E-mails ({filtered.length}
            {filtered.length > visibleRows.length ? `, mostrando ${visibleRows.length}` : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : visibleRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum e-mail no período/filtros selecionados.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Destinatário</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Quando</TableHead>
                    <TableHead>Erro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.template_name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.recipient_email ?? "—"}</TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell className="text-xs text-red-700 max-w-[280px] truncate" title={r.error_message ?? ""}>
                        {r.error_message ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "red" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "red"
        ? "text-red-700"
        : tone === "amber"
          ? "text-amber-700"
          : "text-foreground";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`text-3xl font-semibold mt-1 ${toneClass}`}>{value.toLocaleString("pt-BR")}</p>
      </CardContent>
    </Card>
  );
}