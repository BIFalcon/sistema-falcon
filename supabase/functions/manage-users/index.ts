import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
  | "gop"
  | "ri"
  | "financeiro"
  | "gg"
  | "rh"
  | "operacoes"
  | "viewer";

type Action =
  | "invite"
  | "update"
  | "set_status"
  | "resend_invite";

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

        // 1) Tenta inviteUserByEmail; se já existe, gera link de recovery
        let userId: string | null = null;
        let actionLink: string | null = null;

        const invite = await admin.auth.admin.inviteUserByEmail(payload.email, {
          redirectTo,
          data: { display_name: payload.display_name ?? null },
        });

        if (invite.error) {
          // Talvez já exista — buscar
          const { data: existing } = await admin
            .from("profiles")
            .select("user_id")
            .eq("email", payload.email)
            .maybeSingle();
          if (!existing) {
            return json({ error: invite.error.message }, 400);
          }
          userId = existing.user_id;
        } else {
          userId = invite.data.user?.id ?? null;
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
          .not("role", "in", "(processos,fernando)");

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

        // 5) Gera link de convite (recovery) para que processos possa copiar
        const { data: linkData } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: payload.email,
          options: { redirectTo },
        });
        actionLink = linkData?.properties?.action_link ?? null;

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
        const targetIsProtected =
          targetSet.has("processos") || targetSet.has("fernando");

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
          .not("role", "in", "(processos,fernando)");

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

        const { error } = await admin
          .from("profiles")
          .update({ status: payload.status })
          .eq("user_id", payload.user_id);
        if (error) return json({ error: error.message }, 400);
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

        // Tenta reenviar via inviteUserByEmail (envia email automaticamente).
        // Se o usuário já está confirmado, cai para generateLink('recovery').
        const inviteRes = await admin.auth.admin.inviteUserByEmail(prof.email, {
          redirectTo,
          data: { display_name: prof.display_name ?? null },
        });

        if (!inviteRes.error) {
          // Email de convite enviado pelo Supabase Auth.
          const { data: linkData } = await admin.auth.admin.generateLink({
            type: "recovery",
            email: prof.email,
            options: { redirectTo },
          });
          return json({
            ok: true,
            invite_link: linkData?.properties?.action_link ?? null,
          });
        }

        // Fallback: usuário já existe/confirmado — gera link de recovery
        // (também dispara email de recovery via Auth).
        const { data: linkData, error: linkErr } =
          await admin.auth.admin.generateLink({
            type: "recovery",
            email: prof.email,
            options: { redirectTo },
          });
        if (linkErr) return json({ error: linkErr.message }, 400);
        return json({
          ok: true,
          invite_link: linkData?.properties?.action_link ?? null,
        });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});