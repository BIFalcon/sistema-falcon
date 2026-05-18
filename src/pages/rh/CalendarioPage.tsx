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
import { Plus, Sparkles, Building2, Loader2 } from "lucide-react";
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

  const handleSubmit = async (status: "draft" | "ideia" | "acao") => {
    if (!open) return;
    if (!form.title.trim()) { toast.error("Informe um título."); return; }
    try {
      await addPost.mutateAsync({
        date_id: open.id, year, title: form.title, content: form.content || undefined, status,
      });
      toast.success("Registrado com sucesso.");
      setForm({ title: "", content: "", status: "draft" });
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
                          <Button
                            size="sm"
                            onClick={() => handleSubmit(tab === "ideias" ? "ideia" : "acao")}
                            disabled={addPost.isPending}
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