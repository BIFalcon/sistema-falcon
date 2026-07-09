import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pencil, Loader2, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrgNodes, type RhOrgNode } from "@/hooks/useRh";
import { useAuth } from "@/contexts/AuthContext";
import { useSignedPrivateUrl } from "@/lib/privateStorage";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface NodeWithChildren extends RhOrgNode {
  children: NodeWithChildren[];
}

function buildTree(nodes: RhOrgNode[]): NodeWithChildren[] {
  const map = new Map<string, NodeWithChildren>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));
  const roots: NodeWithChildren[] = [];
  map.forEach((n) => {
    if (n.parent_id && map.has(n.parent_id)) map.get(n.parent_id)!.children.push(n);
    else roots.push(n);
  });
  return roots;
}

function useResponsibilities(nodeId: string | null) {
  return useQuery({
    queryKey: ["rh", "responsibilities", nodeId],
    queryFn: async () => {
      if (!nodeId) return [];
      const { data, error } = await supabase
        .from("rh_org_responsibilities")
        .select("*")
        .eq("node_id", nodeId)
        .order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!nodeId,
  });
}

function OrgNode({
  node,
  canEdit,
  onEdit,
}: {
  node: NodeWithChildren;
  canEdit: boolean;
  onEdit: (n: NodeWithChildren) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<{ standard: boolean; execs: boolean }>({
    standard: true,
    execs: false,
  });
  const hasChildren = node.children.length > 0;
  const isVacant = node.is_open_position;
  const isAccountExecutive = node.node_type === "account_executive";
  const photoUrl = useSignedPrivateUrl(node.photo_url, "rh-photos");

  const standardChildren = node.children.filter((c) => c.node_type !== "account_executive");
  const execChildren = node.children.filter((c) => c.node_type === "account_executive");
  const hasBothGroups = standardChildren.length > 0 && execChildren.length > 0;

  const renderChildrenRow = (list: NodeWithChildren[]) => (
    <div className={list.length > 4 ? "grid grid-cols-3 gap-4 justify-items-center" : "flex flex-row items-start gap-4"}>
      {list.map((child) => (
        <div key={child.id} className="flex flex-col items-center">
          {list.length > 1 && list.length <= 4 && (
            <div className="h-4 border-l border-border" />
          )}
          <OrgNode node={child} canEdit={canEdit} onEdit={onEdit} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col items-center">
      <div className="relative group">
        <div
          className={`rounded-xl border bg-card p-3 shadow-sm select-none transition-shadow
            ${isAccountExecutive ? "w-32 border-dashed border-orange-300" : "w-36"}
            ${hasChildren ? "cursor-pointer hover:shadow-md" : ""}
            ${isVacant ? "border-dashed opacity-60" : ""}`}
          onClick={() => hasChildren && setExpanded((x) => !x)}
        >
          <div className={`w-14 h-14 rounded-full overflow-hidden mx-auto mb-2 bg-muted border-2 flex items-center justify-center ${isAccountExecutive ? "border-orange-300" : "border-primary/20"}`}>
            {node.photo_url && photoUrl ? (
              <img src={photoUrl} alt={node.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold text-muted-foreground">
                {isVacant ? "?" : (node.name?.charAt(0).toUpperCase() ?? "?")}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-center leading-tight truncate">
            {isVacant ? "Vaga em Aberto" : node.name}
          </p>
          {node.position && (
            <p className="text-[10px] text-muted-foreground text-center truncate mt-0.5">
              {node.position}
            </p>
          )}
          {node.department && (
            <Badge variant="outline" className="text-[9px] mt-1 w-full justify-center truncate">
              {node.department}
            </Badge>
          )}
          {isAccountExecutive && (
            <Badge variant="outline" className="text-[9px] mt-1 w-full justify-center text-orange-600 border-orange-300">
              Exec. de Contas
            </Badge>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onEdit(node); }}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          )}
          {hasChildren && (
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-2.5 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px] shadow-sm z-10">
              {expanded ? "−" : "+"}
            </div>
          )}
        </div>
      </div>

      {expanded && hasChildren && (
        <div className="flex flex-col items-center mt-5">
          <div className="h-5 border-l border-border" />
          {hasBothGroups ? (
            <div className="flex flex-col items-center gap-4">
              {/* Grupo Padrão / GGs — nível hierárquico principal */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setExpandedGroups((s) => ({ ...s, standard: !s.standard }))}
                  className="text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 rounded-full px-3 py-1 hover:bg-primary/20 transition-colors"
                >
                  {expandedGroups.standard ? "▾" : "▸"} Gerentes Gerais ({standardChildren.length})
                </button>
                {expandedGroups.standard && (
                  <div className="flex flex-col items-center mt-3">
                    <div className="h-3 border-l border-border" />
                    {renderChildrenRow(standardChildren)}
                  </div>
                )}
              </div>
              {/* Grupo Execs. de Conta — nível de assessoria/staff */}
              <div className="flex flex-col items-center">
                <button
                  type="button"
                  onClick={() => setExpandedGroups((s) => ({ ...s, execs: !s.execs }))}
                  className="text-[11px] font-semibold uppercase tracking-wider text-orange-600 bg-orange-50 dark:bg-orange-950/30 border border-dashed border-orange-300 rounded-full px-3 py-1 hover:bg-orange-100 dark:hover:bg-orange-950/50 transition-colors"
                >
                  {expandedGroups.execs ? "▾" : "▸"} Executivos de Conta ({execChildren.length})
                </button>
                {expandedGroups.execs && (
                  <div className="flex flex-col items-center mt-3">
                    <div className="h-3 border-l border-dashed border-orange-300" />
                    {renderChildrenRow(execChildren)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            renderChildrenRow(node.children)
          )}
        </div>
      )}
    </div>
  );
}

export default function OrganogramaPage() {
  const { data: nodes = [] } = useOrgNodes();
  const { hasRole, isMaster } = useAuth();
  const canEdit = isMaster || hasRole("rh");
  const qc = useQueryClient();

  const [editing, setEditing] = useState<NodeWithChildren | null>(null);
  const [form, setForm] = useState({
    name: "",
    position: "",
    photo_url: "",
    responsibilities: "",
    email: "",
    phone: "",
    node_type: "standard",
    parent_id: "" as string,
  });
  const [addingNode, setAddingNode] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    position: "",
    department: "",
    parent_id: "",
    node_type: "standard",
  });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const resps = useResponsibilities(editing?.id ?? null);
  const editingPhotoUrl = useSignedPrivateUrl(form.photo_url || null, "rh-photos");

  const tree = useMemo(() => buildTree(nodes), [nodes]);

  const openEdit = (n: NodeWithChildren) => {
    setEditing(n);
    setForm({
      name: n.name,
      position: n.position ?? "",
      photo_url: n.photo_url ?? "",
      responsibilities: "",
      email: n.email ?? "",
      phone: n.phone ?? "",
      node_type: n.node_type ?? "standard",
      parent_id: n.parent_id ?? "",
    });
  };

  useEffect(() => {
    if (resps.data && editing) {
      setForm((f) => ({ ...f, responsibilities: resps.data!.map((r: any) => r.description).join("\n") }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resps.data, editing?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      if (form.parent_id === editing.id) {
        throw new Error("Um nó não pode ser superior de si mesmo.");
      }
      if (form.parent_id && descendantIds.has(form.parent_id)) {
        throw new Error("Não é possível escolher um subordinado como superior.");
      }
      const { error } = await supabase.from("rh_org_nodes").update({
        name: form.name,
        position: form.position || null,
        photo_url: form.photo_url || null,
        email: form.email || null,
        phone: form.phone || null,
        node_type: form.node_type || "standard",
        parent_id: form.parent_id || null,
      }).eq("id", editing.id);
      if (error) throw error;

      await supabase.from("rh_org_responsibilities").delete().eq("node_id", editing.id);
      const lines = form.responsibilities.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length) {
        await supabase.from("rh_org_responsibilities").insert(
          lines.map((description, i) => ({ node_id: editing.id, description, sort_order: i })),
        );
      }
    },
    onSuccess: () => {
      toast.success("Atualizado.");
      qc.invalidateQueries({ queryKey: ["rh", "org-nodes"] });
      qc.invalidateQueries({ queryKey: ["rh", "responsibilities"] });
      setEditing(null);
    },
    onError: (e: any) => toast.error("Erro: " + (e?.message ?? "desconhecido")),
  });

  const addNode = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("rh_org_nodes").insert({
        name: addForm.name,
        position: addForm.position || null,
        department: addForm.department || null,
        parent_id: addForm.parent_id || null,
        node_type: addForm.node_type || "standard",
        sort_order: 999,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh", "org-nodes"] });
      toast.success("Colaborador adicionado.");
      setAddingNode(false);
      setAddForm({ name: "", position: "", department: "", parent_id: "", node_type: "standard" });
    },
    onError: (e: any) => toast.error("Erro: " + (e?.message ?? "desconhecido")),
  });

  const removeNode = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rh_org_nodes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh", "org-nodes"] });
      toast.success("Removido do organograma.");
      setEditing(null);
    },
    onError: (e: any) => toast.error("Erro: " + (e?.message ?? "desconhecido")),
  });

  const handleEdit = (n: NodeWithChildren) => openEdit(n);

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent mb-1">RH & People</p>
          <h1 className="text-3xl font-semibold">Organograma</h1>
          <p className="text-sm text-muted-foreground mt-1">Estrutura organizacional da Falcon.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setAddingNode(true)} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-2" /> Adicionar colaborador
          </Button>
        )}
      </div>

      <div className="overflow-x-auto overflow-y-auto min-h-[400px] max-h-[80vh] p-6 border rounded-lg bg-muted/20">
        <div className="flex flex-col items-center gap-6 w-max mx-auto">
          {tree.map((root) => (
            <OrgNode key={root.id} node={root} canEdit={canEdit} onEdit={handleEdit} />
          ))}
          {tree.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum nó cadastrado.</p>
          )}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar nó</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
            <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Cargo</Label><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} /></div>
            <div>
              <Label>E-mail</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@falconhoteis.com.br" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(00) 00000-0000" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.node_type} onValueChange={(v) => setForm({ ...form, node_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Gerente Geral / Padrão</SelectItem>
                  <SelectItem value="account_executive">Executivo de Contas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Foto</Label>
              {form.photo_url && editingPhotoUrl && (
                <img src={editingPhotoUrl} alt="" className="w-16 h-16 rounded-full object-cover border" />
              )}
              <Input
                type="file"
                accept="image/*"
                disabled={uploadingPhoto}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingPhoto(true);
                  try {
                    const ext = file.name.split(".").pop() ?? "jpg";
                    const path = `org/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                    const { error } = await supabase.storage
                      .from("rh-photos")
                      .upload(path, file, { upsert: true });
                    if (error) {
                      toast.error("Erro ao enviar foto.");
                      return;
                    }
                    // Bucket is private — store the raw path; signed URLs are generated on read.
                    setForm((f) => ({ ...f, photo_url: path }));
                  } finally {
                    setUploadingPhoto(false);
                  }
                }}
              />
              {form.photo_url && (
                <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, photo_url: "" }))}>
                  Remover foto
                </Button>
              )}
            </div>
            <div>
              <Label>Responsabilidades (uma por linha)</Label>
              <Textarea rows={5} value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            {canEdit && editing && (
              <Button
                variant="destructive"
                size="sm"
                disabled={removeNode.isPending}
                onClick={() => {
                  if (!confirm(`Remover ${editing.name} do organograma?`)) return;
                  removeNode.mutate(editing.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Remover do organograma
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                {save.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                Salvar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addingNode} onOpenChange={setAddingNode}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Adicionar colaborador</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></div>
            <div><Label>Cargo</Label><Input value={addForm.position} onChange={(e) => setAddForm({ ...addForm, position: e.target.value })} /></div>
            <div><Label>Departamento</Label><Input value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })} /></div>
            <div>
              <Label>Tipo</Label>
              <Select value={addForm.node_type} onValueChange={(v) => setAddForm({ ...addForm, node_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Gerente Geral / Padrão</SelectItem>
                  <SelectItem value="account_executive">Executivo de Contas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Subordinado a</Label>
              <Select value={addForm.parent_id || "__root__"} onValueChange={(v) => setAddForm({ ...addForm, parent_id: v === "__root__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Nó raiz (sem superior)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Nó raiz (sem superior)</SelectItem>
                  {nodes.map((n) => (
                    <SelectItem key={n.id} value={n.id}>{n.name}{n.position ? ` — ${n.position}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingNode(false)}>Cancelar</Button>
            <Button onClick={() => addNode.mutate()} disabled={addNode.isPending || !addForm.name.trim()}>
              {addNode.isPending && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
