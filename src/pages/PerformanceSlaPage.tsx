import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  MessageSquare,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useFilters } from "@/contexts/FilterContext";
import { MONTHS_PT, STATUS_LABELS, type Hotel } from "@/lib/constants";
import {
  usePerfClosings,
  usePerfActivity,
  useClosingTimeline,
  type PerfClosing,
  type StatusLogEntry,
  type ApprovalEntry,
  type CommentEntry,
  type DreVersionEntry,
} from "@/hooks/usePerformanceSla";
import {
  buildStageSla,
  diffHours,
  formatHours,
  toneClass,
  toneDotClass,
  type SlaTone,
} from "@/lib/slaMetrics";

function StatusDot({ tone }: { tone: SlaTone }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${toneDotClass(tone)}`} />;
}

function SlaBadge({ tone, label }: { tone: SlaTone; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs ${toneClass(tone)}`}>
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function fullCycleHours(c: PerfClosing): number | null {
  // primeiro upload (dre_started_at) -> aprovação final do Fernando (dre_approved_at do estágio final).
  // Como o status_dre = "aprovado" significa Fernando aprovou, usamos dre_approved_at.
  return diffHours(c.dre_started_at, c.dre_approved_at);
}

export default function PerformanceSlaPage() {
  const { allowedHotels, isMaster, hasRole } = useAuth();
  const canAccess = isMaster || hasRole("processos");

  // Filtros globais (header)
  const { hotelId, month, year } = useFilters();
  const hotelFilter = hotelId ?? "__all";
  const [userFilter, setUserFilter] = useState<string>("__all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [openClosingId, setOpenClosingId] = useState<string | null>(null);

  const { data: closings = [], isLoading } = usePerfClosings(month, year);
  const { data: activity } = usePerfActivity(closings.map((c) => c.id));

  const hotelMap = useMemo(() => {
    const m = new Map<string, Hotel>();
    allowedHotels.forEach((h) => m.set(h.id, h));
    return m;
  }, [allowedHotels]);

  // Filtros aplicados às linhas dos hotéis
  const filteredRows = useMemo(() => {
    return closings
      .filter((c) => (hotelFilter === "__all" ? true : c.hotel_id === hotelFilter))
      .filter((c) => {
        if (!search) return true;
        const h = hotelMap.get(c.hotel_id);
        return (h?.name ?? c.hotel_id).toLowerCase().includes(search.toLowerCase());
      })
      .map((c) => {
        const dre = buildStageSla(c.dre_started_at, c.dre_approved_at, "dre");
        const carta = buildStageSla(c.carta_started_at, c.carta_approved_at, "carta");
        const cycle = fullCycleHours(c);
        return { closing: c, dre, carta, cycle };
      })
      .filter((r) =>
        overdueOnly ? r.dre.tone === "red" || r.carta.tone === "red" : true,
      );
  }, [closings, hotelFilter, search, hotelMap, overdueOnly]);

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredRows.length;
    let inSla = 0;
    let overdue = 0;
    const cycleDurations: number[] = [];
    filteredRows.forEach((r) => {
      const dreOk = r.dre.withinSla !== false;
      const cartaOk = r.carta.withinSla !== false;
      if (r.dre.withinSla === null && r.carta.withinSla === null) return;
      if (dreOk && cartaOk) inSla++;
      else overdue++;
      if (r.cycle != null) cycleDurations.push(r.cycle);
    });
    const avgCycle =
      cycleDurations.length > 0
        ? cycleDurations.reduce((a, b) => a + b, 0) / cycleDurations.length
        : null;
    return { total, inSla, overdue, avgCycle };
  }, [filteredRows]);

  // Ranking de hotéis (por ciclo)
  const hotelRanking = useMemo(() => {
    const map = new Map<string, { hotelId: string; cycles: number[]; overdue: number; onTime: number }>();
    closings.forEach((c) => {
      const cycle = fullCycleHours(c);
      const dre = buildStageSla(c.dre_started_at, c.dre_approved_at, "dre");
      const carta = buildStageSla(c.carta_started_at, c.carta_approved_at, "carta");
      const e = map.get(c.hotel_id) ?? { hotelId: c.hotel_id, cycles: [], overdue: 0, onTime: 0 };
      if (cycle != null) e.cycles.push(cycle);
      if (dre.withinSla === false || carta.withinSla === false) e.overdue++;
      else if (dre.withinSla === true || carta.withinSla === true) e.onTime++;
      map.set(c.hotel_id, e);
    });
    return Array.from(map.values())
      .map((e) => ({
        hotelId: e.hotelId,
        hotelName: hotelMap.get(e.hotelId)?.name ?? e.hotelId,
        avgCycle: e.cycles.length > 0 ? e.cycles.reduce((a, b) => a + b, 0) / e.cycles.length : null,
        cycles: e.cycles.length,
        onTime: e.onTime,
        overdue: e.overdue,
      }))
      .sort((a, b) => {
        if (a.avgCycle == null) return 1;
        if (b.avgCycle == null) return -1;
        return a.avgCycle - b.avgCycle;
      });
  }, [closings, hotelMap]);

  // Ranking de usuários — calculado a partir de aprovações (com SLA) e ações
  const userRanking = useMemo(() => {
    if (!activity) return [];
    const closingMap = new Map(closings.map((c) => [c.id, c]));

    type Stat = {
      userId: string;
      name: string;
      actions: number;
      onTime: number;
      overdue: number;
      responseHours: number[];
    };
    const map = new Map<string, Stat>();
    const get = (id: string): Stat => {
      let s = map.get(id);
      if (!s) {
        s = {
          userId: id,
          name: activity.profilesMap.get(id) ?? id.slice(0, 8),
          actions: 0,
          onTime: 0,
          overdue: 0,
          responseHours: [],
        };
        map.set(id, s);
      }
      return s;
    };

    // Aprovações: calcular tempo desde último log de status -> created_at da aprovação
    activity.approvals.forEach((a) => {
      const s = get(a.approved_by);
      s.actions++;
      // logs anteriores neste closing/stage
      const prevLogs = activity.logs
        .filter((l) => l.closing_id === a.closing_id && l.field === `status_${a.stage}` && new Date(l.created_at) < new Date(a.created_at));
      const prev = prevLogs[prevLogs.length - 1];
      const startRef = prev?.created_at ?? closingMap.get(a.closing_id)?.created_at ?? null;
      const h = diffHours(startRef, a.created_at);
      if (h != null) {
        s.responseHours.push(h);
        const slaH = a.stage === "carta" ? 24 : 48;
        if (h <= slaH) s.onTime++;
        else s.overdue++;
      }
    });

    // Comentários contam como ações (sem SLA)
    activity.comments.forEach((c) => {
      const s = get(c.author_id);
      s.actions++;
    });

    return Array.from(map.values())
      .map((s) => {
        const total = s.onTime + s.overdue;
        const onTimePct = total > 0 ? (s.onTime / total) * 100 : null;
        const avgResponse =
          s.responseHours.length > 0
            ? s.responseHours.reduce((a, b) => a + b, 0) / s.responseHours.length
            : null;
        return { ...s, onTimePct, avgResponse };
      })
      .filter((s) => (userFilter === "__all" ? true : s.userId === userFilter))
      .sort((a, b) => {
        if (a.onTimePct == null) return 1;
        if (b.onTimePct == null) return -1;
        return b.onTimePct - a.onTimePct;
      });
  }, [activity, closings, userFilter]);

  // Lista de usuários únicos (para filtro)
  const userOptions = useMemo(() => {
    if (!activity) return [];
    return Array.from(activity.profilesMap.entries()).map(([id, name]) => ({ id, name }));
  }, [activity]);

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  if (!canAccess) {
    return (
      <div className="container max-w-2xl py-16 text-center">
        <h1 className="text-2xl font-semibold">Acesso restrito</h1>
        <p className="text-muted-foreground mt-2">
          Este módulo está disponível apenas para Processos e Fernando.
        </p>
      </div>
    );
  }

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Performance SLA</h1>
        <p className="text-muted-foreground mt-1">
          Desempenho de hotéis e usuários nos prazos do workflow de fechamento
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <div>
              <Label className="text-xs">Mês</Label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS_PT.map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Ano</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Hotel</Label>
              <Select value={hotelFilter} onValueChange={setHotelFilter}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos os hotéis</SelectItem>
                  {allowedHotels.map((h) => (
                    <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Usuário</Label>
              <Select value={userFilter} onValueChange={setUserFilter}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Todos os usuários</SelectItem>
                  {userOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Buscar hotel</Label>
              <Input
                placeholder="Nome do hotel"
                className="mt-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <div className="flex items-center gap-2 h-10">
                <Switch id="overdue" checked={overdueOnly} onCheckedChange={setOverdueOnly} />
                <Label htmlFor="overdue" className="text-sm">Só atrasados</Label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Fechamentos</p>
                <p className="text-2xl font-bold mt-1">{kpis.total}</p>
              </div>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Dentro do SLA</p>
                <p className="text-2xl font-bold mt-1 text-emerald-600">{kpis.inSla}</p>
              </div>
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Atrasados</p>
                <p className="text-2xl font-bold mt-1 text-red-600">{kpis.overdue}</p>
              </div>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Ciclo Médio</p>
                <p className="text-2xl font-bold mt-1">{formatHours(kpis.avgCycle)}</p>
              </div>
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="hotels" className="space-y-4">
        <TabsList>
          <TabsTrigger value="hotels">Hotéis</TabsTrigger>
          <TabsTrigger value="ranking-hotels">Ranking de Hotéis</TabsTrigger>
          <TabsTrigger value="ranking-users">Ranking de Usuários</TabsTrigger>
        </TabsList>

        {/* Tabela de hotéis */}
        <TabsContent value="hotels">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visão geral por hotel</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : filteredRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Nenhum fechamento encontrado para os filtros selecionados.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hotel</TableHead>
                      <TableHead>Status DRE</TableHead>
                      <TableHead>DRE (SLA 48h)</TableHead>
                      <TableHead>Carta (SLA 24h)</TableHead>
                      <TableHead>Ciclo total</TableHead>
                      <TableHead className="w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRows.map(({ closing, dre, carta, cycle }) => (
                      <TableRow key={closing.id}>
                        <TableCell className="font-medium">
                          {hotelMap.get(closing.hotel_id)?.name ?? closing.hotel_id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {STATUS_LABELS[closing.status_dre]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <SlaBadge tone={dre.tone} label={formatHours(dre.hoursElapsed)} />
                        </TableCell>
                        <TableCell>
                          <SlaBadge tone={carta.tone} label={formatHours(carta.hoursElapsed)} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatHours(cycle)}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setOpenClosingId(closing.id)}>
                            Detalhes
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ranking de hotéis */}
        <TabsContent value="ranking-hotels">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="h-4 w-4" /> Ranking de hotéis (mais rápido → mais lento)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Hotel</TableHead>
                    <TableHead>Ciclos</TableHead>
                    <TableHead>Média do ciclo</TableHead>
                    <TableHead>No prazo</TableHead>
                    <TableHead>Atrasados</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hotelRanking.map((h, idx) => (
                    <TableRow key={h.hotelId}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{h.hotelName}</TableCell>
                      <TableCell>{h.cycles}</TableCell>
                      <TableCell>{formatHours(h.avgCycle)}</TableCell>
                      <TableCell className="text-emerald-600">{h.onTime}</TableCell>
                      <TableCell className="text-red-600">{h.overdue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ranking de usuários */}
        <TabsContent value="ranking-users">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Ranking de usuários
              </CardTitle>
            </CardHeader>
            <CardContent>
              {userRanking.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Sem atividade no período.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Ações</TableHead>
                      <TableHead>No prazo</TableHead>
                      <TableHead>Atrasadas</TableHead>
                      <TableHead>% no prazo</TableHead>
                      <TableHead>Tempo médio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userRanking.map((u, idx) => (
                      <TableRow key={u.userId}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell>{u.actions}</TableCell>
                        <TableCell className="text-emerald-600">{u.onTime}</TableCell>
                        <TableCell className="text-red-600">{u.overdue}</TableCell>
                        <TableCell>
                          {u.onTimePct == null ? "—" : (
                            <span className="inline-flex items-center gap-1.5">
                              {u.onTimePct >= 80 ? (
                                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                              )}
                              {u.onTimePct.toFixed(0)}%
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{formatHours(u.avgResponse)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ClosingDetailSheet
        closingId={openClosingId}
        onClose={() => setOpenClosingId(null)}
        hotelMap={hotelMap}
      />
    </div>
  );
}

function ClosingDetailSheet({
  closingId,
  onClose,
  hotelMap,
}: {
  closingId: string | null;
  onClose: () => void;
  hotelMap: Map<string, Hotel>;
}) {
  const { data, isLoading } = useClosingTimeline(closingId);
  const { data: closings = [] } = usePerfClosings(
    closingId ? new Date().getMonth() + 1 : 1,
    closingId ? new Date().getFullYear() : 2000,
  );
  const closing = closings.find((c) => c.id === closingId);

  // Constrói uma timeline unificada
  type Item =
    | ({ kind: "log" } & StatusLogEntry)
    | ({ kind: "comment" } & CommentEntry)
    | ({ kind: "approval" } & ApprovalEntry)
    | ({ kind: "version" } & DreVersionEntry);

  const timeline = useMemo<Item[]>(() => {
    if (!data) return [];
    const items: Item[] = [
      ...data.logs.map((l) => ({ kind: "log" as const, ...l })),
      ...data.comments.map((c) => ({ kind: "comment" as const, ...c })),
      ...data.approvals.map((a) => ({ kind: "approval" as const, ...a })),
      ...data.versions.map((v) => ({ kind: "version" as const, ...v })),
    ];
    return items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [data]);

  const commentRounds = useMemo(() => {
    if (!data) return { dre: 0, carta: 0 };
    const dre = data.comments.filter((c) => c.stage === "dre").length;
    const carta = data.comments.filter((c) => c.stage === "carta").length;
    return { dre, carta };
  }, [data]);

  const dreSla = closing ? buildStageSla(closing.dre_started_at, closing.dre_approved_at, "dre") : null;
  const cartaSla = closing ? buildStageSla(closing.carta_started_at, closing.carta_approved_at, "carta") : null;

  return (
    <Sheet open={!!closingId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>
                {closing ? hotelMap.get(closing.hotel_id)?.name ?? closing.hotel_id : "Detalhes"}
              </SheetTitle>
              <SheetDescription>
                {closing
                  ? `${MONTHS_PT[closing.month - 1]} / ${closing.year}`
                  : "Carregando..."}
              </SheetDescription>
            </div>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Resumo SLA */}
          {dreSla && cartaSla && (
            <div className="grid grid-cols-2 gap-3">
              <div className="border rounded-md p-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">DRE (48h)</p>
                <div className="mt-2 flex items-center gap-2">
                  <SlaBadge tone={dreSla.tone} label={formatHours(dreSla.hoursElapsed)} />
                </div>
                {dreSla.overdueHours != null && (
                  <p className="text-xs text-red-600 mt-2">
                    Atraso: {formatHours(dreSla.overdueHours)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {commentRounds.dre} comentário(s)
                </p>
              </div>
              <div className="border rounded-md p-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Carta (24h)</p>
                <div className="mt-2 flex items-center gap-2">
                  <SlaBadge tone={cartaSla.tone} label={formatHours(cartaSla.hoursElapsed)} />
                </div>
                {cartaSla.overdueHours != null && (
                  <p className="text-xs text-red-600 mt-2">
                    Atraso: {formatHours(cartaSla.overdueHours)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  {commentRounds.carta} comentário(s)
                </p>
              </div>
            </div>
          )}

          {/* Timeline */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Linha do tempo</h3>
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem eventos registrados.</p>
            ) : (
              <ol className="relative border-l border-border ml-2 space-y-4">
                {timeline.map((item, idx) => {
                  const prev = timeline[idx - 1];
                  const elapsed = prev ? diffHours(prev.created_at, item.created_at) : null;
                  return <TimelineItem key={`${item.kind}-${item.id}`} item={item} elapsed={elapsed} />;
                })}
              </ol>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TimelineItem({
  item,
  elapsed,
}: {
  item:
    | ({ kind: "log" } & StatusLogEntry)
    | ({ kind: "comment" } & CommentEntry)
    | ({ kind: "approval" } & ApprovalEntry)
    | ({ kind: "version" } & DreVersionEntry);
  elapsed: number | null;
}) {
  const date = format(new Date(item.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR });

  let icon = <Activity className="h-3.5 w-3.5" />;
  let title = "";
  let detail: string | null = null;
  let actor: string | null = null;

  if (item.kind === "log") {
    icon = <Activity className="h-3.5 w-3.5" />;
    title = `${item.field.replace("status_", "").toUpperCase()}: ${STATUS_LABELS[item.new_value] ?? item.new_value}`;
    actor = item.changed_by_name ?? null;
  } else if (item.kind === "comment") {
    icon = <MessageSquare className="h-3.5 w-3.5" />;
    title = `Comentário em ${item.stage.toUpperCase()}`;
    detail = item.content;
    actor = item.author_name ?? null;
  } else if (item.kind === "approval") {
    icon = <CheckCircle2 className="h-3.5 w-3.5" />;
    title = `Aprovação ${item.stage.toUpperCase()}: ${STATUS_LABELS[item.status] ?? item.status}`;
    detail = item.notes ?? null;
    actor = item.approved_by_name ?? null;
  } else if (item.kind === "version") {
    icon = <FileText className="h-3.5 w-3.5" />;
    title = `DRE v${item.version_number} — ${item.file_name}`;
    actor = item.author_name ?? null;
  }

  return (
    <li className="ml-4">
      <span className="absolute -left-[7px] flex h-3.5 w-3.5 items-center justify-center rounded-full bg-background border border-border">
        {icon}
      </span>
      <div className="text-xs text-muted-foreground">{date}</div>
      <div className="text-sm font-medium mt-0.5">{title}</div>
      {actor && <div className="text-xs text-muted-foreground mt-0.5">por {actor}</div>}
      {detail && (
        <div className="text-xs mt-1 p-2 rounded bg-muted/50 border border-border whitespace-pre-wrap">
          {detail}
        </div>
      )}
      {elapsed != null && (
        <div className="text-[10px] text-muted-foreground mt-1">
          +{formatHours(elapsed)} desde o evento anterior
        </div>
      )}
    </li>
  );
}