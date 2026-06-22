import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plus, Heart, Users as UsersIcon, Building2, Loader2, Paperclip, X, FileText, Pencil, Trash2, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useRhCalendarDates,
  useAddCalendarPost,
  useUpdateCalendarPost,
  useDeleteCalendarPost,
  useAddCalendarDate,
  useMarketingMarkedDates,
  type RhCalendarDate,
} from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";
import { MONTHS_PT } from "@/lib/constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function daysUntil(day: number, month: number): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), month - 1, day);
  if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) {
    target.setFullYear(now.getFullYear() + 1);
  }
  return Math.floor((target.getTime() - now.setHours(0, 0, 0, 0)) / 86400000);
}

function categoryTone(c: string) {
  if (c === "feriado") return "border-destructive/40 text-destructive";
  if (c === "comemorativa") return "border-accent/40 text-accent";
  return "border-muted-foreground/30 text-muted-foreground";
}

function useCalendarPosts(dateId: string | null, year: number) {
  return useQuery({
    queryKey: ["marketing", "calendar-posts", dateId, year],
    queryFn: async () => {
      if (!dateId) return [];
      const { data, error } = await supabase
        .from("rh_calendar_posts")
        .select("*")
        .eq("date_id", dateId)
        .eq("year", year)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!dateId,
  });
}

/**
 * endo     = material de Endomarketing (postado pelo Marketing)
 * hospedes = material para Ação com Hóspedes (postado pelo Marketing)
 * hotel    = ações realizadas pelo hotel (postado pelo GG)
 */
type PostKind = "endo" | "hospedes" | "hotel";
const KIND_META: Record<PostKind, { label: string; short: string; icon: any; chip: string; ring: string; accent: string }> = {
  endo: {
    label: "Material — Endomarketing",
    short: "Endomarketing",
    icon: Heart,
    chip: "bg-pink-500/10 text-pink-700 dark:text-pink-300 border-pink-500/40",
    ring: "border-l-4 border-pink-500",
    accent: "text-pink-600 dark:text-pink-400",
  },
  hospedes: {
    label: "Material — Ação com Hóspedes",
    short: "Ação com Hóspedes",
    icon: UsersIcon,
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/40",
    ring: "border-l-4 border-sky-500",
    accent: "text-sky-600 dark:text-sky-400",
  },
  hotel: {
    label: "Ação realizada pelo hotel",
    short: "Ação do Hotel",
    icon: Building2,
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
    ring: "border-l-4 border-emerald-500",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
};

const KIND_TO_STATUS: Record<PostKind, string> = { endo: "ideia", hospedes: "acao", hotel: "hotel_acao" };
const STATUS_TO_KIND: Record<string, PostKind> = { ideia: "endo", acao: "hospedes", hotel_acao: "hotel" };

export default function MarketingCalendarioPage() {
  const { data: dates = [] } = useRhCalendarDates();
  const { hasRole, isMaster, user } = useAuth();
  const isMarketing = isMaster || hasRole("marketing");
  const canManageDates = isMaster || hasRole("marketing") || hasRole("rh");
  const canPost: Record<PostKind, boolean> = {
    endo: isMarketing,
    hospedes: isMarketing,
    hotel: isMarketing || hasRole("gg") || hasRole("gop"),
  };
  const [open, setOpen] = useState<RhCalendarDate | null>(null);
  const year = new Date().getFullYear();
  const addPost = useAddCalendarPost();
  const updatePost = useUpdateCalendarPost();
  const deletePost = useDeleteCalendarPost();
  const addDate = useAddCalendarDate();
  const { data: markedDates } = useMarketingMarkedDates(year);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: "", content: "" });
  const [newDateOpen, setNewDateOpen] = useState(false);
  const [newDate, setNewDate] = useState({ day: "", month: "", title: "", category: "comemorativa", notes: "" });

  const grouped = useMemo(() => {
    const map: Record<number, RhCalendarDate[]> = {};
    for (const d of dates) (map[d.date_month] ??= []).push(d);
    return map;
  }, [dates]);

  const posts = useCalendarPosts(open?.id ?? null, year);

  const [form, setForm] = useState({ title: "", content: "" });
  const [attachments, setAttachments] = useState<Array<{ name: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: Array<{ name: string; url: string }> = [];
      for (const file of Array.from(files)) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `calendar/${year}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from("marketing-assets").upload(path, file, { upsert: true });
        if (error) { toast.error(`Erro ao enviar ${file.name}`); continue; }
        // signed URL (1 year) for download/display
        const { data: signed } = await supabase.storage.from("marketing-assets").createSignedUrl(path, 60 * 60 * 24 * 365);
        uploaded.push({ name: file.name, url: signed?.signedUrl ?? path });
      }
      setAttachments((a) => [...a, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (kind: PostKind) => {
    if (!open) return;
    if (!form.title.trim()) { toast.error("Informe um título."); return; }
    try {
      const status = KIND_TO_STATUS[kind];
      await addPost.mutateAsync({
        date_id: open.id, year, title: form.title, content: form.content || undefined, status, attachments,
      });
      toast.success("Registrado com sucesso.");
      setForm({ title: "", content: "" });
      setAttachments([]);
      posts.refetch();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message ?? "desconhecido"));
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">Marketing</p>
          <h1 className="text-3xl font-semibold">Calendário</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ideias de Endomarketing e ações para os hóspedes ao longo do ano.
          </p>
        </div>
        {canManageDates && (
          <Button size="sm" onClick={() => setNewDateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nova data
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {MONTHS_PT.map((monthName, i) => {
          const monthNum = i + 1;
          const items = grouped[monthNum] ?? [];
          if (items.length === 0) return null;
          return (
            <Card key={monthNum} className="p-4 shadow-soft">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{monthName}</p>
              <div className="space-y-2">
                {items.map((d) => {
                  const dd = daysUntil(d.date_day, d.date_month);
                  const hasMarketing = markedDates?.has(d.id);
                  return (
                    <button
                      key={d.id}
                      onClick={() => setOpen(d)}
                      className="w-full text-left flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                    >
                      <div className="h-9 w-9 rounded-md bg-accent/10 text-accent flex items-center justify-center text-xs font-semibold shrink-0">
                        {String(d.date_day).padStart(2, "0")}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate flex items-center gap-1.5">
                          {hasMarketing && (
                            <Sparkles className="h-3 w-3 text-pink-500 shrink-0" aria-label="Marketing postou ideias" />
                          )}
                          <span className="truncate">{d.title}</span>
                        </p>
                        <Badge variant="outline" className={`text-[10px] mt-0.5 ${categoryTone(d.category)}`}>
                          {d.category}
                        </Badge>
                      </div>
                      {dd >= 0 && dd <= 7 && (
                        <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30 border text-[10px]">
                          {dd === 0 ? "hoje" : `${dd}d`}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {String(open.date_day).padStart(2, "0")}/{String(open.date_month).padStart(2, "0")} — {open.title}
                </DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="endo">
                <TabsList className="w-full">
                  {(["endo", "hospedes", "hotel"] as PostKind[]).map((k) => {
                    const M = KIND_META[k];
                    const Icon = M.icon;
                    return (
                      <TabsTrigger key={k} value={k} className="flex-1">
                        <Icon className={`h-3.5 w-3.5 mr-2 ${M.accent}`} /> {M.short}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {(["endo", "hospedes", "hotel"] as PostKind[]).map((kind) => {
                  const M = KIND_META[kind];
                  const filterStatus = KIND_TO_STATUS[kind];
                  const filtered = (posts.data ?? []).filter((p: any) => p.status === filterStatus);
                  return (
                    <TabsContent key={kind} value={kind} className="space-y-4 mt-4">
                      {posts.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : filtered.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Nada registrado ainda.</p>
                      ) : (
                        <div className="space-y-2">
                          {filtered.map((p: any) => (
                            <div key={p.id} className={`pl-3 py-2 pr-2 rounded-md bg-muted/30 ${M.ring}`}>
                              {editingId === p.id ? (
                                <div className="space-y-2">
                                  <Input
                                    value={editForm.title}
                                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                  />
                                  <Textarea
                                    rows={3}
                                    value={editForm.content}
                                    onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          await updatePost.mutateAsync({
                                            id: p.id,
                                            title: editForm.title,
                                            content: editForm.content || null,
                                          });
                                          toast.success("Atualizado.");
                                          setEditingId(null);
                                          posts.refetch();
                                        } catch (e: any) {
                                          toast.error("Erro: " + (e?.message ?? "desconhecido"));
                                        }
                                      }}
                                      disabled={updatePost.isPending}
                                    >
                                      Salvar
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                                      Cancelar
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={`text-[10px] ${M.chip}`}>{M.short}</Badge>
                                    <p className="text-sm font-medium flex-1">{p.title}</p>
                                    {p.author_id === user?.id && (
                                      <div className="flex gap-1">
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6"
                                          onClick={() => {
                                            setEditingId(p.id);
                                            setEditForm({ title: p.title, content: p.content ?? "" });
                                          }}
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6 text-destructive"
                                          onClick={async () => {
                                            if (!confirm("Excluir este post?")) return;
                                            try {
                                              await deletePost.mutateAsync(p.id);
                                              toast.success("Excluído.");
                                              posts.refetch();
                                            } catch (e: any) {
                                              toast.error("Erro: " + (e?.message ?? "desconhecido"));
                                            }
                                          }}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    )}
                                  </div>
                                  {p.content && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{p.content}</p>}
                                </>
                              )}
                              {Array.isArray(p.attachments) && p.attachments.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {p.attachments.map((att: { name: string; url: string }, i: number) => (
                                    <a
                                      key={i}
                                      href={att.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      download={att.name}
                                      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-border hover:bg-muted/50"
                                    >
                                      <FileText className="h-3 w-3" />
                                      <span className="truncate max-w-[180px]">{att.name}</span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {canPost[kind] && (
                        <Card className={`p-3 bg-muted/30 space-y-2 ${M.ring}`}>
                          <Label className={`text-xs flex items-center gap-1.5 ${M.accent}`}>
                            <M.icon className="h-3 w-3" /> {kind === "hotel" ? "Registrar ação do hotel" : `Postar ${M.short}`}
                          </Label>
                          <Input
                            placeholder="Título"
                            value={form.title}
                            onChange={(e) => setForm({ ...form, title: e.target.value })}
                          />
                          <Textarea
                            placeholder="Descrição (opcional)"
                            value={form.content}
                            onChange={(e) => setForm({ ...form, content: e.target.value })}
                            rows={3}
                          />
                          <div className="space-y-1.5">
                            <Label className="text-xs flex items-center gap-1.5">
                              <Paperclip className="h-3 w-3" /> Anexos (opcional)
                            </Label>
                            <Input type="file" multiple disabled={uploading} onChange={(e) => handleFiles(e.target.files)} />
                            {attachments.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {attachments.map((att, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-background border border-border">
                                    <FileText className="h-3 w-3" />
                                    <span className="truncate max-w-[140px]">{att.name}</span>
                                    <button type="button" onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button size="sm" onClick={() => handleSubmit(kind)} disabled={addPost.isPending || uploading}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Postar {M.label}
                          </Button>
                        </Card>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={newDateOpen} onOpenChange={setNewDateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova data no calendário</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Dia</Label>
                <Input
                  type="number"
                  min={1}
                  max={31}
                  value={newDate.day}
                  onChange={(e) => setNewDate({ ...newDate, day: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Mês</Label>
                <Select value={newDate.month} onValueChange={(v) => setNewDate({ ...newDate, month: v })}>
                  <SelectTrigger><SelectValue placeholder="Mês" /></SelectTrigger>
                  <SelectContent>
                    {MONTHS_PT.map((m, i) => (
                      <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Título</Label>
              <Input value={newDate.title} onChange={(e) => setNewDate({ ...newDate, title: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Categoria</Label>
              <Select value={newDate.category} onValueChange={(v) => setNewDate({ ...newDate, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="comemorativa">Comemorativa</SelectItem>
                  <SelectItem value="feriado">Feriado</SelectItem>
                  <SelectItem value="informativo">Informativa</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Notas (opcional)</Label>
              <Textarea
                rows={2}
                value={newDate.notes}
                onChange={(e) => setNewDate({ ...newDate, notes: e.target.value })}
              />
            </div>
            <Button
              className="w-full"
              disabled={addDate.isPending}
              onClick={async () => {
                const d = Number(newDate.day);
                const m = Number(newDate.month);
                if (!d || d < 1 || d > 31 || !m || m < 1 || m > 12) {
                  toast.error("Informe dia e mês válidos.");
                  return;
                }
                if (!newDate.title.trim()) {
                  toast.error("Informe um título.");
                  return;
                }
                try {
                  await addDate.mutateAsync({
                    date_day: d,
                    date_month: m,
                    title: newDate.title.trim(),
                    category: newDate.category,
                    notes: newDate.notes || undefined,
                  });
                  toast.success("Data adicionada.");
                  setNewDate({ day: "", month: "", title: "", category: "comemorativa", notes: "" });
                  setNewDateOpen(false);
                } catch (e: any) {
                  toast.error("Erro: " + (e?.message ?? "desconhecido"));
                }
              }}
            >
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}