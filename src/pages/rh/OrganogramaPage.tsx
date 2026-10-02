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

const GROUP_ORDER = ["standard", "gerente_comercial", "matriz", "account_executive"] as const;
const GROUP_LABELS: Record<string, string> = {
  standard: "Gerentes Gerais",
  gerente_comercial: "Gerentes Comerciais",
  matriz: "Matriz",
  account_executive: "Executivos de Contas",
};
const normType = (t?: string | null) =>
  (GROUP_ORDER as readonly string[]).includes(t ?? "") ? (t as string) : "standard";

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
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const hasChildren = node.children.length > 0;
  const isVacant = node.is_open_position;
  const isAccountExecutive = node.node_type === "account_executive";
  const photoUrl = useSignedPrivateUrl(node.photo_url, "rh-photos");

  const groups = GROUP_ORDER.map((type) => ({
    type,
    items: node.children.filter((c) => normType(c.node_type) === type),
  })).filter((g) => g.items.length > 0);
  const hasMultipleGroups = groups.length > 1;

  const renderChildrenRow = (list: NodeWithChildren[]) => {
    const rows: NodeWithChildren[][] = [[]];
    list.forEach((child, i) => {
      rows[rows.length - 1].push(child);
      if ((child as any).row_break_after && i < list.length - 1) rows.push([]);
    });
    return (
      <div className="flex flex-col items-center gap-4">
        {rows.map((row, ri) => (
          <div key={ri} className="flex flex-row flex-nowrap items-start gap-4">
            {row.map((child) => (
              <div key={child.id} className="flex flex-col items-center shrink-0">
                {list.length > 1 && <div className="h-4 border-l border-border" />}
                <OrgNode node={child} canEdit={canEdit} onEdit={onEdit} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

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
          {hasMultipleGroups ? (
            <div className="flex flex-col items-center gap-4">
              {groups.map((g) => {
                const isExec = g.type === "account_executive";
                const open = expandedGroups[g.type] ?? !isExec;
                return (
                  <div key={g.type} className="flex flex-col items-center">
                    <button
                      type="button"
                      onClick={() => setExpandedGroups((s) => ({ ...s, [g.type]: !open }))}
                      className={isExec
                        ? "text-[11px] font-semibold uppercase tracking-wider text-orange-600 bg-orange-50 dark:bg-orange-950/30 border border-dashed border-orange-300 rounded-full px-3 py-1 hover:bg-orange-100 dark:hover:bg-orange-950/50 transition-colors"
                        : "text-[11px] font-semibold uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 rounded-full px-3 py-1 hover:bg-primary/20 transition-colors"}
                    >
                      {open ? "▾" : "▸"} {GROUP_LABELS[g.type] ?? g.type} ({g.items.length})
                    </button>
                    {open && (
                      <div className="flex flex-col items-center mt-3">
                        <div className={`h-3 border-l ${isExec ? "border-dashed border-orange-300" : "border-border"}`} />
                        {renderChildrenRow(g.items)}
                      </div>
                    )}
                  </div>
                );
              })}
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
    row_break_after: false,
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

  // IDs de todos os descendentes do nó em edição — não podem virar seu superior (ciclo).
  const descendantIds = useMemo(() => {
    const set = new Set<string>();
    if (!editing) return set;
    const childrenByParent = new Map<string, string[]>();
    nodes.forEach((n) => {
      if (!n.parent_id) return;
      const arr = childrenByParent.get(n.parent_id) ?? [];
      arr.push(n.id);
      childrenByParent.set(n.parent_id, arr);
    });
    const stack = [editing.id];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of childrenByParent.get(cur) ?? []) {
        if (!set.has(child)) {
          set.add(child);
          stack.push(child);
        }
      }
    }
    return set;
  }, [nodes, editing]);

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
      row_break_after: !!(n as any).row_break_after,
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
        row_break_after: form.row_break_after,
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.row_break_after}
                onChange={(e) => setForm({ ...form, row_break_after: e.target.checked })}
              />
              Quebrar linha depois deste cartão
            </label>
            <div>
              <Label>Superior (Gerente)</Label>
              <Select
                value={form.parent_id || "__root__"}
                onValueChange={(v) => setForm({ ...form, parent_id: v === "__root__" ? "" : v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">— Sem superior (raiz) —</SelectItem>
                  {nodes
                    .filter((n) => n.id !== editing?.id && !descendantIds.has(n.id))
                    .map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.name}{n.position ? ` — ${n.position}` : ""}
                      </SelectItem>
                    ))}
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
