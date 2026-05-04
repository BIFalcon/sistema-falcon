import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  UserPlus,
  Search,
  Mail,
  Shield,
  Hotel as HotelIcon,
  Ban,
  RotateCw,
  Pencil,
  Copy,
  Check,
  Loader2,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  useManagedUsers,
  useInviteUser,
  useUpdateUser,
  useSetUserStatus,
  useResendInvite,
  useSetFinanceiroSubrole,
  type ManagedUser,
} from "@/hooks/useUsers";
import { useAllHotels } from "@/hooks/useHotelAssets";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";

const SELECTABLE_ROLES: { value: AppRole; label: string; scope: string }[] = [
  { value: "controladoria", label: "Controladoria", scope: "Acesso a todos os hotéis" },
  { value: "financeiro", label: "Financeiro", scope: "Acesso a todos os hotéis" },
  { value: "ri", label: "Relações com Investidores", scope: "Acesso a todos os hotéis" },
  { value: "gop", label: "Gerente de Operações (GOP)", scope: "Acesso à cartela de hotéis definida" },
  { value: "gg", label: "Gerente Geral (GG)", scope: "Acesso apenas ao próprio hotel" },
];

const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  pending: "Pendente",
  banned: "Desativado",
};

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    case "pending":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30";
    case "banned":
      return "bg-rose-500/15 text-rose-700 border-rose-500/30";
    default:
      return "";
  }
}

export default function UsuariosPage() {
  const { hasRole, isMaster } = useAuth();
  const canManage = hasRole("processos") || isMaster;

  const { data: users = [], isLoading } = useManagedUsers();
  const { data: hotels = [] } = useAllHotels();

  const [search, setSearch] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.display_name?.toLowerCase().includes(q) ||
        u.roles.some((r) => r.includes(q)),
    );
  }, [users, search]);

  if (!canManage) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            Configurações
          </p>
          <h1 className="text-2xl font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Gerencie acessos, papéis e vínculos com hotéis. Restrito à equipe Processos.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setWizardOpen(true);
          }}
        >
          <UserPlus className="h-4 w-4" />
          Convidar usuário
        </Button>
      </div>

      <Card className="p-4 shadow-soft">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, e-mail ou role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {filtered.length} usuário{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuário</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Hotéis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Nenhum usuário encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((u) => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  hotelsLookup={Object.fromEntries(hotels.map((h) => [h.id, h.name]))}
                  onEdit={() => {
                    setEditing(u);
                    setWizardOpen(true);
                  }}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <UserWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        editing={editing}
        hotels={hotels}
        canCreateMaster={hasRole("processos")}
      />
    </div>
  );
}

/* ----------------------- Linha + ações ----------------------- */

function UserRow({
  user,
  hotelsLookup,
  onEdit,
}: {
  user: ManagedUser;
  hotelsLookup: Record<string, string>;
  onEdit: () => void;
}) {
  const setStatus = useSetUserStatus();
  const resend = useResendInvite();
  const [confirmBan, setConfirmBan] = useState(false);
  const [linkDialog, setLinkDialog] = useState<string | null>(null);

  const primaryRoleLabel = user.is_master
    ? "Master"
    : user.roles[0]
      ? ROLE_LABELS[user.roles[0]]
      : "—";

  async function handleResend() {
    try {
      const res = await resend.mutateAsync(user.user_id);
      if (res.invite_link) {
        setLinkDialog(res.invite_link);
      } else {
        toast.success("Convite reenviado");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao reenviar");
    }
  }

  async function handleToggleStatus() {
    try {
      await setStatus.mutateAsync({
        user_id: user.user_id,
        status: user.status === "banned" ? "active" : "banned",
      });
      toast.success(user.status === "banned" ? "Usuário reativado" : "Usuário desativado");
      setConfirmBan(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  const hotelNames = user.hotel_ids
    .map((id) => hotelsLookup[id] ?? id)
    .slice(0, 2);
  const moreHotels = user.hotel_ids.length - hotelNames.length;

  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{user.display_name ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{user.email}</span>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            {user.is_master && <Shield className="h-3.5 w-3.5 text-primary" />}
            <span className="text-sm">{primaryRoleLabel}</span>
          </div>
        </TableCell>
        <TableCell>
          {user.is_master || ["controladoria", "financeiro", "ri"].includes(user.roles[0] ?? "") ? (
            <span className="text-xs text-muted-foreground italic">Todos</span>
          ) : hotelNames.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {hotelNames.map((n) => (
                <Badge key={n} variant="secondary" className="text-[10px]">
                  {n}
                </Badge>
              ))}
              {moreHotels > 0 && (
                <Badge variant="outline" className="text-[10px]">
                  +{moreHotels}
                </Badge>
              )}
            </div>
          )}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={statusBadgeClass(user.status)}>
            {STATUS_LABEL[user.status]}
          </Badge>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(user.created_at).toLocaleDateString("pt-BR")}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={onEdit}
              disabled={user.is_protected}
              title={user.is_protected ? "Usuário protegido" : "Editar"}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleResend}
              disabled={resend.isPending}
              title="Reenviar convite"
            >
              {resend.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (user.status === "banned" ? handleToggleStatus() : setConfirmBan(true))}
              disabled={user.is_protected || setStatus.isPending}
              title={
                user.is_protected
                  ? "Usuário protegido"
                  : user.status === "banned"
                    ? "Reativar"
                    : "Desativar"
              }
            >
              {user.status === "banned" ? (
                <RotateCw className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Ban className="h-3.5 w-3.5 text-rose-600" />
              )}
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <AlertDialog open={confirmBan} onOpenChange={setConfirmBan}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              {user.display_name ?? user.email} perderá acesso ao sistema. Você poderá reativar a qualquer
              momento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleStatus}>Desativar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <InviteLinkDialog link={linkDialog} onClose={() => setLinkDialog(null)} />
    </>
  );
}

/* ----------------------- Wizard de convite/edição ----------------------- */

interface WizardProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ManagedUser | null;
  hotels: { id: string; name: string }[];
  canCreateMaster: boolean;
}

function UserWizard({ open, onOpenChange, editing, hotels, canCreateMaster }: WizardProps) {
  const isEdit = !!editing;
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [isMasterFlag, setIsMasterFlag] = useState(false);
  const [primaryRole, setPrimaryRole] = useState<AppRole | "">("");
  const [hotelIds, setHotelIds] = useState<string[]>([]);
  const [financeiroSubrole, setFinanceiroSubrole] =
    useState<"equipe" | "coordenadora">("coordenadora");
  const [linkDialog, setLinkDialog] = useState<string | null>(null);

  const invite = useInviteUser();
  const update = useUpdateUser();
  const setSubrole = useSetFinanceiroSubrole();

  // Reset / preencher quando abre
  useMemo(() => {
    if (!open) return;
    setStep(1);
    if (editing) {
      setDisplayName(editing.display_name ?? "");
      setEmail(editing.email ?? "");
      setIsMasterFlag(editing.is_master);
      const role = editing.roles.find((r) => r !== "processos" && r !== "fernando");
      setPrimaryRole(role ?? "");
      setHotelIds(editing.hotel_ids);
      setFinanceiroSubrole(editing.financeiro_subrole ?? "coordenadora");
    } else {
      setDisplayName("");
      setEmail("");
      setIsMasterFlag(false);
      setPrimaryRole("");
      setHotelIds([]);
      setFinanceiroSubrole("coordenadora");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.user_id]);

  const needsHotelSelection =
    !isMasterFlag && (primaryRole === "gop" || primaryRole === "gg");
  const hasGlobalAccess =
    isMasterFlag || ["controladoria", "financeiro", "ri"].includes(primaryRole);

  // Validações por etapa
  const canAdvanceStep1 =
    displayName.trim().length >= 2 && /\S+@\S+\.\S+/.test(email);
  const canAdvanceStep2 = isMasterFlag || !!primaryRole;
  const canAdvanceStep3 =
    isMasterFlag ||
    hasGlobalAccess ||
    (primaryRole === "gg" && hotelIds.length === 1) ||
    (primaryRole === "gop" && hotelIds.length >= 1);

  async function handleSubmit() {
    try {
      if (isEdit && editing) {
        await update.mutateAsync({
          user_id: editing.user_id,
          display_name: displayName,
          is_master: isMasterFlag,
          primary_role: isMasterFlag ? undefined : (primaryRole as AppRole),
          hotel_ids: needsHotelSelection ? hotelIds : [],
        });
        // Persistir sub-papel do financeiro (independente do edge function)
        if (!isMasterFlag && primaryRole === "financeiro") {
          await setSubrole.mutateAsync({
            user_id: editing.user_id,
            subrole: financeiroSubrole,
          });
        } else if (editing.financeiro_subrole) {
          // Trocou de role: limpa o sub-papel
          await setSubrole.mutateAsync({ user_id: editing.user_id, subrole: null });
        }
        toast.success("Usuário atualizado");
        onOpenChange(false);
      } else {
        const res = await invite.mutateAsync({
          email: email.trim(),
          display_name: displayName.trim(),
          is_master: isMasterFlag,
          primary_role: isMasterFlag ? undefined : (primaryRole as AppRole),
          hotel_ids: needsHotelSelection ? hotelIds : [],
        });
        if (!isMasterFlag && primaryRole === "financeiro" && res?.user_id) {
          await setSubrole.mutateAsync({
            user_id: res.user_id,
            subrole: financeiroSubrole,
          });
        }
        toast.success("Convite criado");
        onOpenChange(false);
        if (res.invite_link) setLinkDialog(res.invite_link);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  const stepsTotal = 4;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Editar usuário" : "Convidar novo usuário"}
            </DialogTitle>
            <DialogDescription>
              Etapa {step} de {stepsTotal}
            </DialogDescription>
          </DialogHeader>

          {/* Stepper visual */}
          <div className="flex items-center gap-2 pb-2">
            {Array.from({ length: stepsTotal }).map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i + 1 <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* ETAPA 1 — Dados básicos */}
          {step === 1 && (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">Nome completo</Label>
                <Input
                  id="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="João da Silva"
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-mail corporativo</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="joao@falconhoteis.com.br"
                  disabled={isEdit}
                  maxLength={255}
                />
                {isEdit && (
                  <p className="text-xs text-muted-foreground">
                    O e-mail não pode ser alterado após o convite.
                  </p>
                )}
              </div>
              {canCreateMaster && (
                <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
                  <Checkbox
                    id="master"
                    checked={isMasterFlag}
                    onCheckedChange={(v) => {
                      setIsMasterFlag(!!v);
                      if (v) {
                        setPrimaryRole("");
                        setHotelIds([]);
                      }
                    }}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label htmlFor="master" className="cursor-pointer flex items-center gap-1.5">
                      <Shield className="h-3.5 w-3.5 text-primary" />
                      Usuário Master
                    </Label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Acesso irrestrito a todos os módulos e hotéis. Use com cautela.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ETAPA 2 — Role principal */}
          {step === 2 && (
            <div className="space-y-4 py-2">
              {isMasterFlag ? (
                <div className="p-4 rounded-lg border bg-primary/5 text-sm">
                  <Shield className="h-4 w-4 text-primary inline mr-2" />
                  Usuário Master tem acesso completo. Pular para a próxima etapa.
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Role principal</Label>
                  <Select value={primaryRole} onValueChange={(v) => setPrimaryRole(v as AppRole)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um role" />
                    </SelectTrigger>
                    <SelectContent>
                      {SELECTABLE_ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <div className="flex flex-col py-0.5">
                            <span className="font-medium">{r.label}</span>
                            <span className="text-[11px] text-muted-foreground">{r.scope}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Sub-papel do Financeiro */}
              {!isMasterFlag && primaryRole === "financeiro" && (
                <div className="space-y-2 p-3 rounded-lg border bg-muted/20">
                  <Label>Sub-papel do Financeiro</Label>
                  <Select
                    value={financeiroSubrole}
                    onValueChange={(v) => setFinanceiroSubrole(v as "equipe" | "coordenadora")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equipe">
                        <div className="flex flex-col py-0.5">
                          <span className="font-medium">Equipe Financeiro</span>
                          <span className="text-[11px] text-muted-foreground">
                            Sobe planilhas, vincula documentos, marca como Inserido/Agendado
                          </span>
                        </div>
                      </SelectItem>
                      <SelectItem value="coordenadora">
                        <div className="flex flex-col py-0.5">
                          <span className="font-medium">Coordenadoria Financeiro</span>
                          <span className="text-[11px] text-muted-foreground">
                            Acesso total — pode marcar lançamentos como Pago
                          </span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="text-xs text-muted-foreground p-3 rounded border bg-muted/20">
                <strong>Próximas fases:</strong> seleção fina de módulos e permissões granulares (upload
                de DRE, aprovação por estágio etc.) será adicionada na próxima entrega. Por enquanto, o
                role já define o acesso padrão de cada perfil.
              </div>
            </div>
          )}

          {/* ETAPA 3 — Hotéis */}
          {step === 3 && (
            <div className="space-y-4 py-2">
              {hasGlobalAccess ? (
                <div className="p-4 rounded-lg border bg-muted/30 text-sm flex items-start gap-3">
                  <HotelIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-medium">Acesso global a todos os hotéis</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isMasterFlag
                        ? "Usuários Master têm acesso a todos os hotéis automaticamente."
                        : "Este role tem acesso a todos os hotéis automaticamente — nenhuma seleção necessária."}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>
                    {primaryRole === "gg"
                      ? "Selecione 1 hotel"
                      : "Selecione os hotéis da cartela"}
                  </Label>
                  <div className="border rounded-lg max-h-72 overflow-auto divide-y">
                    {hotels.map((h) => {
                      const checked = hotelIds.includes(h.id);
                      return (
                        <label
                          key={h.id}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              if (primaryRole === "gg") {
                                setHotelIds(v ? [h.id] : []);
                              } else {
                                setHotelIds(
                                  v ? [...hotelIds, h.id] : hotelIds.filter((x) => x !== h.id),
                                );
                              }
                            }}
                          />
                          <span className="text-sm flex-1">{h.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {hotelIds.length} selecionado{hotelIds.length === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ETAPA 4 — Revisão */}
          {step === 4 && (
            <div className="space-y-3 py-2 text-sm">
              <ReviewRow label="Nome" value={displayName} />
              <ReviewRow label="E-mail" value={email} />
              <ReviewRow
                label="Tipo"
                value={
                  isMasterFlag
                    ? "Master (acesso irrestrito)"
                    : primaryRole
                      ? ROLE_LABELS[primaryRole]
                      : "—"
                }
              />
              {!isMasterFlag && primaryRole === "financeiro" && (
                <ReviewRow
                  label="Sub-papel"
                  value={financeiroSubrole === "equipe" ? "Equipe Financeiro" : "Coordenadoria Financeiro"}
                />
              )}
              <ReviewRow
                label="Hotéis"
                value={
                  hasGlobalAccess
                    ? "Todos os hotéis"
                    : hotelIds
                        .map((id) => hotels.find((h) => h.id === id)?.name ?? id)
                        .join(", ") || "—"
                }
              />
              {!isEdit && (
                <div className="text-xs text-muted-foreground p-3 rounded border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
                  Um link de convite será gerado. Como o domínio de e-mail
                  ainda está em configuração, o link aparecerá na tela para ser copiado e enviado
                  manualmente ao usuário.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex sm:justify-between gap-2">
            <div>
              {step > 1 && (
                <Button variant="outline" onClick={() => setStep(step - 1)}>
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              {step < stepsTotal ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={
                    (step === 1 && !canAdvanceStep1) ||
                    (step === 2 && !canAdvanceStep2) ||
                    (step === 3 && !canAdvanceStep3)
                  }
                >
                  Próximo
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={invite.isPending || update.isPending}
                >
                  {(invite.isPending || update.isPending) && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  {isEdit ? "Salvar alterações" : "Enviar convite"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InviteLinkDialog link={linkDialog} onClose={() => setLinkDialog(null)} />
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 border-b pb-2 last:border-0">
      <span className="text-xs uppercase tracking-wider text-muted-foreground w-24 pt-0.5">
        {label}
      </span>
      <span className="flex-1 text-sm">{value || "—"}</span>
    </div>
  );
}

/* ----------------------- Diálogo de link de convite ----------------------- */

function InviteLinkDialog({ link, onClose }: { link: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Link copiado");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={!!link} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link de convite</DialogTitle>
          <DialogDescription>
            Copie e envie este link manualmente ao usuário. Ele permite criar a senha de acesso.
            Quando o domínio de e-mail estiver configurado, os convites serão enviados automaticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input value={link ?? ""} readOnly className="font-mono text-xs" />
          <Button onClick={copy} size="icon" variant="outline">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}