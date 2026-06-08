import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Plus, FileText, Upload, Eye, Trash2, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRhPolicies, type RhPolicy } from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";

export default function PoliticasPage() {
  const { data: policies = [] } = useRhPolicies();
  const { isMaster, hasRole } = useAuth();
  const canEdit = isMaster || hasRole("rh");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", category: "", version: "", content: "", file: null as File | null });
  const [saving, setSaving] = useState(false);

  const view = async (p: RhPolicy) => {
    if (!p.document_url) { toast.error("Sem documento anexado."); return; }
    const { data, error } = await supabase.storage.from("rh-policies").createSignedUrl(p.document_url, 300);
    if (error) { toast.error(error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      let document_url: string | null = null;
      if (form.file) {
        // Sanitize filename: Supabase Storage only accepts ASCII letters,
        // numbers, and a few symbols in object keys. Accents, spaces and
        // other characters cause "Invalid key" errors.
        const safeName = form.file.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "") // strip accents
          .replace(/[^a-zA-Z0-9._-]+/g, "_")
          .replace(/_+/g, "_")
          .replace(/^_+|_+$/g, "");
        const path = `${Date.now()}_${safeName || "documento"}`;
        const { error: upErr } = await supabase.storage.from("rh-policies").upload(path, form.file);
        if (upErr) throw upErr;
        document_url = path;
      }
      const { error } = await supabase.from("rh_policies").insert({
        title: form.title, category: form.category || null, version: form.version || null,
        content: form.content || null, document_url, published: true, created_by: u.user?.id ?? "",
      });
      if (error) throw error;
      toast.success("Política publicada.");
      qc.invalidateQueries({ queryKey: ["rh", "policies"] });
      setOpen(false); setForm({ title: "", category: "", version: "", content: "", file: null });
    } catch (e: any) { toast.error(e?.message ?? "Erro"); }
    finally { setSaving(false); }
  };

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rh_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Removido."); qc.invalidateQueries({ queryKey: ["rh", "policies"] }); },
  });

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
          <h1 className="text-3xl font-semibold">Políticas internas</h1>
          <p className="text-sm text-muted-foreground mt-1">Documentos oficiais de RH.</p>
        </div>
        {canEdit && (<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" />Nova política</Button>)}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {policies.map((p) => (
          <Card key={p.id} className="p-4 shadow-soft flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-accent/10 text-accent flex items-center justify-center shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate">{p.title}</p>
              <p className="text-xs text-muted-foreground">{p.category ?? "Geral"}{p.version ? ` · v${p.version}` : ""}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => view(p)}><Eye className="h-3.5 w-3.5 mr-1" />Ver</Button>
            {canEdit && (
              <Button size="icon" variant="ghost" onClick={() => remove.mutate(p.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </Card>
        ))}
        {policies.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma política cadastrada.</p>}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova política</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Título</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
              <div><Label>Versão</Label><Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} /></div>
            </div>
            <div><Label>Conteúdo (opcional)</Label><Textarea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></div>
            <div>
              <Label>Documento</Label>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" className="hidden"
                  onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1" /> Selecionar arquivo
                </Button>
                {form.file && <span className="text-xs text-muted-foreground truncate">{form.file.name}</span>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !form.title}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}