import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SENDER_DOMAIN = "notify.falconhoteis.com.br";
const FROM_ADDRESS = `Sistema Falcon <noreply@${SENDER_DOMAIN}>`;

const DEFAULT_APP_BASE_URL = "https://sistema-falcon.lovable.app";
function getAppBaseUrl(): string {
  const v = Deno.env.get("APP_BASE_URL");
  if (v && /^https:\/\//i.test(v)) return v.replace(/\/$/, "");
  return DEFAULT_APP_BASE_URL;
}

async function getUnsubscribeToken(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string> {
  const { data: existing } = await admin
    .from("email_unsubscribe_tokens")
    .select("token")
    .eq("email", email)
    .is("used_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.token) return existing.token as string;
  const token =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  await admin.from("email_unsubscribe_tokens").insert({ email, token });
  return token;
}

async function enqueueInviteEmail(
  admin: ReturnType<typeof createClient>,
  args: { to: string; subject: string; html: string; text: string; label: string },
): Promise<boolean> {
  try {
    const unsubscribeToken = await getUnsubscribeToken(admin, args.to);
    const messageId = `${args.label}-${args.to}-${Date.now()}`;
    const { error } = await admin.rpc("enqueue_email", {
      queue_name: "auth_emails",
      payload: {
        message_id: messageId,
        idempotency_key: messageId,
        purpose: "transactional",
        label: args.label,
        to: args.to,
        from: FROM_ADDRESS,
        sender_domain: SENDER_DOMAIN,
        subject: args.subject,
        html: args.html,
        text: args.text,
        unsubscribe_token: unsubscribeToken,
        queued_at: new Date().toISOString(),
      },
    });
    if (error) {
      console.error("[invite] enqueue_email failed:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[invite] enqueue exception:", e);
    return false;
  }
}

type AppRole =
  | "processos"
  | "fernando"
  | "controladoria"
  | "patronos"
  | "gop"
  | "ri"
  | "gg"
  | "adm"
  | "rh"
  | "marketing"
  | "operacoes"
  | "viewer";

type Action =
  | "invite"
  | "update"
  | "set_status"
  | "resend_invite"
  | "delete_user"
  | "validate_password_setup"
  | "complete_password_setup"
  | "request_password_setup";

interface Payload {
  action: Action;
  // invite / update
  user_id?: string;
  email?: string;
  display_name?: string;
  is_master?: boolean;
  primary_role?: AppRole;
  hotel_ids?: string[];
  // set_status
  status?: "active" | "banned";
  // password setup / reset
  setup_token?: string;
  password?: string;
}

const PASSWORD_SETUP_TTL_HOURS = 24 * 7;
const PASSWORD_SETUP_TTL_LABEL = "7 dias";

function isPasswordStrong(value: string) {
  return value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createPasswordSetupLink(
  admin: ReturnType<typeof createClient>,
  args: { userId: string; email: string; origin: string },
) {
  const token = makeToken();
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + PASSWORD_SETUP_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await admin
    .from("password_setup_tokens")
    .update({ used_at: now })
    .eq("user_id", args.userId)
    .is("used_at", null);

  const { error } = await admin.from("password_setup_tokens").insert({
    user_id: args.userId,
    email: args.email,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (error) throw error;

  return `${args.origin}/reset-password?setup_token=${encodeURIComponent(token)}`;
}

async function getValidPasswordSetupToken(admin: ReturnType<typeof createClient>, token?: string) {
  if (!token) return { error: "missing_token" as const };
  const tokenHash = await sha256Hex(token);
  const { data, error } = await admin
    .from("password_setup_tokens")
    .select("id, user_id, email, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data || data.used_at) return { error: "invalid_or_used" as const };
  if (new Date(data.expires_at).getTime() < Date.now()) return { error: "expired" as const };
  return { data };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as Payload;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    if (payload.action === "validate_password_setup") {
      const result = await getValidPasswordSetupToken(admin, payload.setup_token);
      if (result.error) return json({ ok: false, error: result.error }, 400);
      return json({ ok: true, email: result.data.email, expires_at: result.data.expires_at });
    }

    if (payload.action === "complete_password_setup") {
      if (!payload.password || !isPasswordStrong(payload.password)) {
        return json({ ok: false, error: "weak_password" }, 400);
      }
      const result = await getValidPasswordSetupToken(admin, payload.setup_token);
      if (result.error) return json({ ok: false, error: result.error }, 400);

      const { error: updateErr } = await admin.auth.admin.updateUserById(result.data.user_id, {
        password: payload.password,
        email_confirm: true,
      });
      if (updateErr) {
        const raw = (updateErr.message ?? "").toLowerCase();
        // GoTrue retorna 422 quando a senha é fraca / vazou (HIBP) ou não atende aos requisitos.
        const status = (updateErr as { status?: number }).status;
        if (
          status === 422 ||
          raw.includes("pwned") ||
          raw.includes("weak") ||
          raw.includes("password") ||
          raw.includes("compromised") ||
          raw.includes("breach")
        ) {
          return json({ ok: false, error: "weak_password", detail: updateErr.message }, 400);
        }
        return json({ ok: false, error: updateErr.message }, 400);
      }

      await admin.from("profiles").update({ status: "active" }).eq("user_id", result.data.user_id);
      await admin
        .from("password_setup_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", result.data.id);

      return json({ ok: true });
    }

    if (payload.action === "request_password_setup") {
      if (payload.email) {
        const { data: prof } = await admin
          .from("profiles")
          .select("user_id, email, status")
          .eq("email", payload.email)
          .maybeSingle();
        if (prof?.email && prof.status !== "banned") {
          const origin = getAppBaseUrl();
          const actionLink = await createPasswordSetupLink(admin, {
            userId: prof.user_id,
            email: prof.email,
            origin,
          });
          await enqueueInviteEmail(admin, {
            to: prof.email,
            subject: "Redefinir senha — Sistema Falcon Hotels",
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
                <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 16px;">Redefinir senha</h1>
                <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #333;">Clique no botão abaixo para criar uma nova senha no Sistema Falcon.</p>
                <p style="margin: 0 0 32px;"><a href="${actionLink}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 500;">Redefinir senha</a></p>
                <p style="font-size: 13px; line-height: 1.5; margin: 0; color: #666;">Este link é válido por ${PASSWORD_SETUP_TTL_LABEL}. Se você não solicitou este acesso, ignore este e-mail.</p>
              </div>
            `,
            text: `Redefina sua senha no Sistema Falcon Hotels:\n\n${actionLink}\n\nO link é válido por ${PASSWORD_SETUP_TTL_LABEL}.`,
            label: "password_reset",
          });
        }
      }
      return json({ ok: true });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }

    // Cliente para identificar quem chama
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
    const callerId = userRes.user.id;

    // Verifica se caller é processos ou master
    const { data: callerRoles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    const callerRoleSet = new Set((callerRoles ?? []).map((r) => r.role));
    const isProcessos = callerRoleSet.has("processos");
    const isMaster = isProcessos || callerRoleSet.has("fernando");
    if (!isProcessos && !isMaster) {
      return json({ error: "forbidden" }, 403);
    }

    switch (payload.action) {
      case "invite": {
        if (!payload.email) return json({ error: "email_required" }, 400);
        if (payload.is_master && !isProcessos) {
          return json({ error: "only_processos_can_create_master" }, 403);
        }

        const origin = getAppBaseUrl();

        // 1) Verifica se o usuário já existe.
        const { data: existingProfile } = await admin
          .from("profiles")
          .select("user_id")
          .eq("email", payload.email)
          .maybeSingle();

        let userId: string | null = existingProfile?.user_id ?? null;
        let actionLink: string | null = null;

        // 2) Se não existe, cria o usuário (sem enviar email — vamos enviar
        //    UM único link via generateLink abaixo, evitando tokens duplicados
        //    que invalidam uns aos outros).
        if (!userId) {
          const created = await admin.auth.admin.createUser({
            email: payload.email,
            email_confirm: false,
            user_metadata: { display_name: payload.display_name ?? null },
          });
          if (created.error || !created.data.user) {
            return json({ error: created.error?.message ?? "create_user_failed" }, 400);
          }
          userId = created.data.user.id;
        }

        if (!userId) return json({ error: "no_user_id" }, 500);

        // 2) Garante profile
        await admin.from("profiles").upsert(
          {
            user_id: userId,
            email: payload.email,
            display_name: payload.display_name ?? payload.email.split("@")[0],
            status: "pending",
          },
          { onConflict: "user_id" },
        );

        // 3) Roles (apaga não-protegidas e re-cria)
        await admin
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .neq("role", "processos");

        const rolesToInsert: { user_id: string; role: AppRole; assigned_by: string }[] = [];
        if (payload.is_master) {
          // Master = role 'fernando' (processos é reservado para a equipe Falcon)
          rolesToInsert.push({ user_id: userId, role: "fernando", assigned_by: callerId });
        } else if (payload.primary_role) {
          rolesToInsert.push({
            user_id: userId,
            role: payload.primary_role,
            assigned_by: callerId,
          });
        }
        if (rolesToInsert.length) {
          await admin.from("user_roles").insert(rolesToInsert);
        }

        // 4) Hotéis (apaga e re-cria)
        await admin.from("user_hotels").delete().eq("user_id", userId);
        const hotelsScope = payload.is_master
          ? []
          : payload.primary_role === "gop" || payload.primary_role === "gg" || payload.primary_role === "adm"
            ? payload.hotel_ids ?? []
            : []; // controladoria/financeiro/ri = acesso global via is_master?? não — eles têm acesso a todos via aplicação; sem vínculos explícitos.

        if (hotelsScope.length) {
          await admin.from("user_hotels").insert(
            hotelsScope.map((hotel_id) => ({ user_id: userId!, hotel_id })),
          );
        }

        // 5) Gera um link próprio, com expiração controlada pelo sistema.
        //    Isso evita a expiração curta/variável dos links internos de Auth.
        actionLink = await createPasswordSetupLink(admin, {
          userId,
          email: payload.email,
          origin,
        });

        if (actionLink) {
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
              <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 16px;">Bem-vindo ao Sistema Falcon</h1>
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #333;">
                Você foi convidado para acessar o Sistema Falcon Hotels.
                Clique no botão abaixo para criar sua senha e acessar o sistema.
              </p>
              <p style="margin: 0 0 32px;">
                <a href="${actionLink}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 500;">
                  Criar minha senha
                </a>
              </p>
              <p style="font-size: 13px; line-height: 1.5; margin: 0; color: #666;">
                Este link é válido por ${PASSWORD_SETUP_TTL_LABEL}. Se você não esperava este
                convite, ignore este e-mail.
              </p>
            </div>
          `;
          const text = `Bem-vindo ao Sistema Falcon Hotels.\n\nVocê foi convidado para acessar o sistema. Use o link abaixo para criar sua senha:\n\n${actionLink}\n\nO link é válido por ${PASSWORD_SETUP_TTL_LABEL}.`;
          const emailQueued = await enqueueInviteEmail(admin, {
            to: payload.email,
            subject: "Convite — Sistema Falcon Hotels",
            html,
            text,
            label: "invite",
          });
          return json({
            ok: true,
            user_id: userId,
            invite_link: actionLink,
            email_queued: emailQueued,
          });
        }

        return json({ ok: true, user_id: userId, invite_link: actionLink, email_queued: false });
      }

      case "update": {
        if (!payload.user_id) return json({ error: "user_id_required" }, 400);
        const targetId = payload.user_id;

        // Não pode rebaixar processos/fernando
        const { data: targetRoles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", targetId);
        const targetSet = new Set((targetRoles ?? []).map((r) => r.role));
        const targetIsProtected = targetSet.has("processos");

        if (targetIsProtected && !payload.is_master) {
          return json({ error: "cannot_demote_protected_user" }, 403);
        }

        // Atualiza display_name se veio
        if (payload.display_name !== undefined) {
          await admin
            .from("profiles")
            .update({ display_name: payload.display_name })
            .eq("user_id", targetId);
        }

        // Roles: apaga não-protegidas e re-cria
        await admin
          .from("user_roles")
          .delete()
          .eq("user_id", targetId)
          .neq("role", "processos");

        const rolesToInsert: { user_id: string; role: AppRole; assigned_by: string }[] = [];
        if (payload.is_master && !targetSet.has("fernando")) {
          rolesToInsert.push({ user_id: targetId, role: "fernando", assigned_by: callerId });
        } else if (!payload.is_master && payload.primary_role) {
          rolesToInsert.push({
            user_id: targetId,
            role: payload.primary_role,
            assigned_by: callerId,
          });
        }
        if (rolesToInsert.length) {
          await admin.from("user_roles").insert(rolesToInsert);
        }

        // Hotéis
        await admin.from("user_hotels").delete().eq("user_id", targetId);
        const hotelsScope = payload.is_master
          ? []
          : payload.primary_role === "gop" || payload.primary_role === "gg" || payload.primary_role === "adm"
            ? payload.hotel_ids ?? []
            : [];
        if (hotelsScope.length) {
          await admin.from("user_hotels").insert(
            hotelsScope.map((hotel_id) => ({ user_id: targetId, hotel_id })),
          );
        }

        return json({ ok: true });
      }

      case "set_status": {
        if (!payload.user_id || !payload.status)
          return json({ error: "missing_args" }, 400);

        // Bloqueia ban de usuários protegidos (processos/fernando)
        if (payload.status === "banned") {
          const { data: targetRoles } = await admin
            .from("user_roles")
            .select("role")
            .eq("user_id", payload.user_id);
          const targetSet = new Set((targetRoles ?? []).map((r) => r.role));
          if (targetSet.has("processos")) {
            return json({ error: "cannot_ban_protected_user" }, 403);
          }
        }

        const { error } = await admin
          .from("profiles")
          .update({ status: payload.status })
          .eq("user_id", payload.user_id);
        if (error) return json({ error: error.message }, 400);

        if (payload.status === "banned") {
          // Remove TODOS os vínculos para revogar acesso via RLS imediatamente.
          await admin
            .from("user_roles")
            .delete()
            .eq("user_id", payload.user_id)
            .neq("role", "processos");
          await admin.from("user_hotels").delete().eq("user_id", payload.user_id);
          // Invalida sessões/JWT ativos do usuário banido.
          try {
            await admin.auth.admin.updateUserById(payload.user_id, {
              ban_duration: "876000h",
            });
          } catch (banErr) {
            console.error("[set_status] falha ao banir sessão:", banErr);
          }
        } else if (payload.status === "active") {
          // Reativa: remove o ban no auth, confirma o e-mail e libera login com senha.
          // Importante para casos em que a senha foi definida manualmente fora do fluxo
          // de convite, pois o profile pode estar "active" enquanto o Auth ainda bloqueia
          // login com "Email not confirmed".
          try {
            await admin.auth.admin.updateUserById(payload.user_id, {
              ban_duration: "none",
              email_confirm: true,
            });
          } catch (unbanErr) {
            console.error("[set_status] falha ao reativar sessão:", unbanErr);
          }
        }

        return json({ ok: true });
      }

      case "resend_invite": {
        if (!payload.user_id) return json({ error: "user_id_required" }, 400);
        const { data: prof } = await admin
          .from("profiles")
          .select("email, display_name, status")
          .eq("user_id", payload.user_id)
          .maybeSingle();
        if (!prof?.email) return json({ error: "user_not_found" }, 404);

        const actionLink = await createPasswordSetupLink(admin, {
          userId: payload.user_id,
          email: prof.email,
          origin: getAppBaseUrl(),
        });

        if (actionLink) {
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
              <h1 style="font-size: 22px; font-weight: 600; margin: 0 0 16px;">Novo acesso ao Sistema Falcon</h1>
              <p style="font-size: 15px; line-height: 1.6; margin: 0 0 24px; color: #333;">
                Seu link de acesso ao Sistema Falcon foi renovado.
                Clique no botão abaixo para acessar o sistema.
              </p>
              <p style="margin: 0 0 32px;">
                <a href="${actionLink}" style="display: inline-block; background: #0a0a0a; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-size: 15px; font-weight: 500;">
                  Acessar o sistema
                </a>
              </p>
              <p style="font-size: 13px; line-height: 1.5; margin: 0; color: #666;">
                Este link é válido por ${PASSWORD_SETUP_TTL_LABEL}. Se você não solicitou este
                acesso, ignore este e-mail.
              </p>
            </div>
          `;
          const text = `Seu link de acesso ao Sistema Falcon foi renovado.\n\nAcesse:\n${actionLink}\n\nO link é válido por ${PASSWORD_SETUP_TTL_LABEL}.`;
          const emailQueued = await enqueueInviteEmail(admin, {
            to: prof.email,
            subject: "Novo acesso — Sistema Falcon Hotels",
            html,
            text,
            label: "resend_invite",
          });
          return json({
            ok: true,
            invite_link: actionLink,
            email_queued: emailQueued,
          });
        }

        return json({ ok: true, invite_link: actionLink, email_queued: false });
      }

      case "delete_user": {
        if (!payload.user_id) return json({ error: "user_id_required" }, 400);
        // Bloqueia deleção de processos/fernando
        const { data: targetRoles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", payload.user_id);
        const targetSet = new Set((targetRoles ?? []).map((r) => r.role));
        if (targetSet.has("processos")) {
          return json({ error: "cannot_delete_protected_user" }, 403);
        }
        // Limpa vínculos (FKs sem cascade) e depois deleta o auth user.
        // O profile/user_roles/user_hotels referenciam auth.users via cascade.
        await admin.from("user_hotels").delete().eq("user_id", payload.user_id);
        await admin.from("user_roles").delete().eq("user_id", payload.user_id);
        await admin.from("profiles").delete().eq("user_id", payload.user_id);
        const { error: delErr } = await admin.auth.admin.deleteUser(
          payload.user_id,
        );
        if (delErr) return json({ error: delErr.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});