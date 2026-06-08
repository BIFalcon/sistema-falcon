import { useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, ExternalLink, Pencil, Trash2, Loader2, Upload, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRhTrainings, type RhTraining } from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";

export default function TreinamentosPage() {
  const { data: trainings = [] } = useRhTrainings();
  const { isMaster, hasRole } = useAuth();
  const canEdit = isMaster || hasRole("rh");
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RhTraining | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "", media_url: "", duration_minutes: "", mandatory: false, image_url: "" as string | null | "" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  const grouped = useMemo(() => {
    const map: Record<string, RhTraining[]> = {};
    for (const t of trainings) (map[t.category ?? "Outros"] ??= []).push(t);
    return map;
  }, [trainings]);

  const open = (t?: RhTraining) => {
    if (t) {
      setEditing(t);
      setForm({
        title: t.title, description: t.description ?? "", category: t.category ?? "",
        media_url: t.media_url ?? "", duration_minutes: String(t.duration_minutes ?? ""), mandatory: t.mandatory,
        image_url: t.image_url ?? "",
      });
    } else {
      setCreating(true);
      setForm({ title: "", description: "", category: "", media_url: "", duration_minutes: "", mandatory: false, image_url: "" });
    }
    setImageFile(null);
  };
  const close = () => { setEditing(null); setCreating(false); setImageFile(null); };

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      let image_url: string | null = form.image_url || null;
      if (imageFile) {
        const safeName = imageFile.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-zA-Z0-9._-]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "");
        const path = `trainings/${Date.now()}_${safeName || "imagem"}`;
        const { error: upErr } = await supabase.storage
          .from("rh-assets")
          .upload(path, imageFile, { upsert: false, contentType: imageFile.type });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from("rh-assets").getPublicUrl(path);
        image_url = pub.publicUrl;
      }
      const payload = {
        title: form.title,
        description: form.description || null,
        category: form.category || null,
        media_url: form.media_url || null,
        image_url,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        mandatory: form.mandatory,
        created_by: u.user?.id ?? "",
      };
      if (editing) {
        const { error } = await supabase.from("rh_trainings").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rh_trainings").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success("Salvo."); qc.invalidateQueries({ queryKey: ["rh", "trainings"] }); close(); },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rh_trainings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removido."); qc.invalidateQueries({ queryKey: ["rh", "trainings"] }); },
  });

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
          <h1 className="text-3xl font-semibold">Treinamentos</h1>
          <p className="text-sm text-muted-foreground mt-1">Biblioteca de treinamentos e links para a plataforma Solid.</p>
        </div>
        {canEdit && (<Button onClick={() => open()}><Plus className="h-4 w-4 mr-2" />Novo treinamento</Button>)}
      </div>

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cat}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map((t) => (
              <Card key={t.id} className="p-4 shadow-soft flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold flex-1">{t.title}</p>
                  {t.mandatory && <Badge variant="outline" className="border-destructive/40 text-destructive text-[10px]">Obrigatório</Badge>}
                </div>
                {t.description && <p className="text-xs text-muted-foreground line-clamp-3">{t.description}</p>}
                <div className="flex items-center justify-between gap-2 mt-auto pt-2">
                  {t.media_url ? (
                    <a href={t.media_url} target="_blank" rel="noreferrer" className="text-xs text-accent inline-flex items-center gap-1 hover:underline">
                      <ExternalLink className="h-3 w-3" /> Abrir no Solid
                    </a>
                  ) : <span className="text-xs text-muted-foreground">Sem link</span>}
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => open(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove.mutate(t.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      {trainings.length === 0 && <p className="text-sm text-muted-foreground">Nenhum treinamento cadastrado.</p>}

      <Dialog open={!!editing || creating} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} treinamento</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex.: Atendimento, Compliance" /></div>
            <div><Label>Descrição</Label><Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>URL (Solid)</Label><Input value={form.media_url} onChange={(e) => setForm({ ...form, media_url: e.target.value })} placeholder="https://..." /></div>
            <div><Label>Duração (min)</Label><Input type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Checkbox checked={form.mandatory} onCheckedChange={(v) => setForm({ ...form, mandatory: !!v })} /><Label className="!mt-0">Obrigatório</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={close}>Cancelar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}