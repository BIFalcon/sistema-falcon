import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { sendLovableEmail } from "npm:@lovable.dev/email-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type AppRole =
  | "processos"
  | "fernando"
  | "controladoria"
  | "patronos"
  | "gop"
  | "ri"
  | "gg"
  | "rh"
  | "operacoes"
  | "viewer";

type Action =
  | "invite"
  | "update"
  | "set_status"
  | "resend_invite"
  | "delete_user";

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
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
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

    const payload = (await req.json()) as Payload;

    switch (payload.action) {
      case "invite": {
        if (!payload.email) return json({ error: "email_required" }, 400);
        if (payload.is_master && !isProcessos) {
          return json({ error: "only_processos_can_create_master" }, 403);
        }

        const redirectTo =
          (req.headers.get("origin") ?? "") + "/reset-password";

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
          : payload.primary_role === "gop" || payload.primary_role === "gg"
            ? payload.hotel_ids ?? []
            : []; // controladoria/financeiro/ri = acesso global via is_master?? não — eles têm acesso a todos via aplicação; sem vínculos explícitos.

        if (hotelsScope.length) {
          await admin.from("user_hotels").insert(
            hotelsScope.map((hotel_id) => ({ user_id: userId!, hotel_id })),
          );
        }

        // 5) Gera UM único link de convite. Esse link dispara o email via
        //    auth-email-hook E retorna o action_link para o processos copiar
        //    se quiser repassar manualmente. Como é o único token gerado,
        //    nada o invalida.
        const linkType = existingProfile ? "recovery" : "invite";
        const { data: linkData, error: linkErr } =
          await admin.auth.admin.generateLink({
            type: linkType,
            email: payload.email,
            options: { redirectTo },
          });
        if (linkErr) {
          return json({ error: linkErr.message }, 400);
        }
        actionLink = linkData?.properties?.action_link ?? null;

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
                Este link é válido por 72 horas. Se você não esperava este
                convite, ignore este e-mail.
              </p>
            </div>
          `;
          try {
            await sendLovableEmail({
              from: "Sistema Falcon <noreply@notify.falconhoteis.com.br>",
              to: payload.email,
              subject: "Convite — Sistema Falcon Hotels",
              html,
            });
          } catch (emailErr) {
            console.error("[invite] falha ao enviar e-mail:", emailErr);
            // Não bloqueia — o link ainda é retornado para copiar manualmente
          }
        }

        return json({ ok: true, user_id: userId, invite_link: actionLink });
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
          : payload.primary_role === "gop" || payload.primary_role === "gg"
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
          // Reativa: remove o ban no auth (não restaura roles automaticamente).
          try {
            await admin.auth.admin.updateUserById(payload.user_id, {
              ban_duration: "none",
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
          .select("email, display_name")
          .eq("user_id", payload.user_id)
          .maybeSingle();
        if (!prof?.email) return json({ error: "user_not_found" }, 404);

        const redirectTo =
          (req.headers.get("origin") ?? "") + "/reset-password";

        // Sempre usa magiclink para garantir que o usuário
        // recebe um e-mail funcional independente do estado
        const linkType = "magiclink" as const;

        // Gera UM único link — invalida qualquer token anterior pendente,
        // dispara o email novo e retorna a URL para copiar.
        const { data: linkData, error: linkErr } =
          await admin.auth.admin.generateLink({
            type: linkType,
            email: prof.email,
            options: { redirectTo },
          });
        if (linkErr) return json({ error: linkErr.message }, 400);
        const actionLink = linkData?.properties?.action_link ?? null;

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
                Este link é válido por 72 horas. Se você não solicitou este
                acesso, ignore este e-mail.
              </p>
            </div>
          `;
          try {
            await sendLovableEmail({
              from: "Sistema Falcon <noreply@notify.falconhoteis.com.br>",
              to: prof.email,
              subject: "Novo acesso — Sistema Falcon Hotels",
              html,
            });
          } catch (emailErr) {
            console.error("[resend_invite] falha ao enviar e-mail:", emailErr);
          }
        }

        return json({
          ok: true,
          invite_link: actionLink,
        });
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