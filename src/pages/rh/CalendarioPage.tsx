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
import { Plus, Sparkles, Building2, Loader2, Paperclip, X, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRhCalendarDates, useAddCalendarPost, type RhCalendarDate } from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";
import { MONTHS_PT } from "@/lib/constants";

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
    queryKey: ["rh", "calendar-posts", dateId, year],
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

export default function CalendarioPage() {
  const { data: dates = [] } = useRhCalendarDates();
  const { hasRole, isMaster } = useAuth();
  const canPost = isMaster || hasRole("rh") || hasRole("marketing");
  const [open, setOpen] = useState<RhCalendarDate | null>(null);
  const year = new Date().getFullYear();
  const addPost = useAddCalendarPost();

  const grouped = useMemo(() => {
    const map: Record<number, RhCalendarDate[]> = {};
    for (const d of dates) (map[d.date_month] ??= []).push(d);
    return map;
  }, [dates]);

  const posts = useCalendarPosts(open?.id ?? null, year);

  const [form, setForm] = useState({ title: "", content: "", status: "draft" });
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
        const { error } = await supabase.storage.from("rh-photos").upload(path, file, { upsert: true });
        if (error) { toast.error(`Erro ao enviar ${file.name}`); continue; }
        const { data } = supabase.storage.from("rh-photos").getPublicUrl(path);
        uploaded.push({ name: file.name, url: data.publicUrl });
      }
      setAttachments((a) => [...a, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (status: "draft" | "ideia" | "acao") => {
    if (!open) return;
    if (!form.title.trim()) { toast.error("Informe um título."); return; }
    try {
      await addPost.mutateAsync({
        date_id: open.id, year, title: form.title, content: form.content || undefined, status,
        attachments,
      });
      toast.success("Registrado com sucesso.");
      setForm({ title: "", content: "", status: "draft" });
      setAttachments([]);
      posts.refetch();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message ?? "desconhecido"));
    }
  };

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
        <h1 className="text-3xl font-semibold">Calendário comemorativo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Ideias de marketing e ações realizadas pelos hotéis ao longo do ano.
        </p>
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
                        <p className="text-sm font-medium truncate">{d.title}</p>
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

      {/* Modal */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {String(open.date_day).padStart(2, "0")}/{String(open.date_month).padStart(2, "0")} — {open.title}
                </DialogTitle>
              </DialogHeader>
              <Tabs defaultValue="ideias">
                <TabsList className="w-full">
                  <TabsTrigger value="ideias" className="flex-1"><Sparkles className="h-3.5 w-3.5 mr-2" /> Ideias Marketing</TabsTrigger>
                  <TabsTrigger value="acoes" className="flex-1"><Building2 className="h-3.5 w-3.5 mr-2" /> Ações dos Hotéis</TabsTrigger>
                </TabsList>

                {(["ideias", "acoes"] as const).map((tab) => {
                  const filterStatus = tab === "ideias" ? "ideia" : "acao";
                  const filtered = (posts.data ?? []).filter((p: any) => p.status === filterStatus);
                  return (
                    <TabsContent key={tab} value={tab} className="space-y-4 mt-4">
                      {posts.isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : filtered.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Nada registrado ainda.</p>
                      ) : (
                        <div className="divide-y divide-border">
                          {filtered.map((p: any) => (
                            <div key={p.id} className="py-3">
                              <p className="text-sm font-medium">{p.title}</p>
                              {p.content && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{p.content}</p>}
                              {Array.isArray(p.attachments) && p.attachments.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {p.attachments.map((att: { name: string; url: string }, i: number) => (
                                    <a
                                      key={i}
                                      href={att.url}
                                      target="_blank"
                                      rel="noreferrer"
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

                      {(tab === "ideias" ? canPost : true) && (
                        <Card className="p-3 bg-muted/30 space-y-2">
                          <Label className="text-xs">{tab === "ideias" ? "Postar ideia" : "Registrar ação"}</Label>
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
                            <Input
                              type="file"
                              multiple
                              disabled={uploading}
                              onChange={(e) => handleFiles(e.target.files)}
                            />
                            {attachments.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {attachments.map((att, i) => (
                                  <span
                                    key={i}
                                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-background border border-border"
                                  >
                                    <FileText className="h-3 w-3" />
                                    <span className="truncate max-w-[140px]">{att.name}</span>
                                    <button
                                      type="button"
                                      onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                                      className="text-muted-foreground hover:text-destructive"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleSubmit(tab === "ideias" ? "ideia" : "acao")}
                            disabled={addPost.isPending || uploading}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            {tab === "ideias" ? "Postar ideia" : "Registrar ação"}
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
    </div>
  );
}