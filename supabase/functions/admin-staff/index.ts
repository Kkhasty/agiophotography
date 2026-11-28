import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Please sign in." }, 401);

    const adminDb = createClient(url, serviceKey);
    const callerClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Your session is invalid." }, 401);

    const { data: caller, error: profileError } = await adminDb
      .from("agio_staff_profiles").select("*")
      .eq("user_id", authData.user.id).eq("active", true).maybeSingle();
    if (profileError) throw profileError;
    if (!caller || !["super_admin", "administrator"].includes(caller.role)) {
      return json({ error: "Administrator permission required." }, 403);
    }

    if (req.method === "GET") {
      const { data, error } = await adminDb.from("agio_staff_profiles")
        .select("user_id,full_name,role,photographer_id,active,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = await Promise.all((data || []).map(async (p: any) => {
        const { data: u } = await adminDb.auth.admin.getUserById(p.user_id);
        return { ...p, email: u?.user?.email || "" };
      }));
      return json({ ok: true, records: rows });
    }

    if (req.method === "POST") {
      const input = await req.json();
      const name = String(input.name || "").trim();
      const email = String(input.email || "").trim().toLowerCase();
      const password = String(input.password || "");
      const role = String(input.role || "staff");
      const photographerId = String(input.photographerId || "");
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "Enter a valid name and email address." }, 400);
      }
      if (password.length < 14) return json({ error: "Use a temporary password of at least 14 characters." }, 400);
      if (!["administrator", "staff", "photographer"].includes(role)) {
        return json({ error: "Invalid staff role." }, 400);
      }
      if (role === "administrator" && caller.role !== "super_admin") {
        return json({ error: "Only the Super Administrator can create another administrator." }, 403);
      }
      const { data: created, error: createError } = await adminDb.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (createError) throw createError;
      const { error: saveError } = await adminDb.from("agio_staff_profiles").insert({
        user_id: created.user.id, full_name: name, role,
        photographer_id: photographerId || null, active: true,
      });
      if (saveError) {
        await adminDb.auth.admin.deleteUser(created.user.id);
        throw saveError;
      }
      return json({ ok: true, staff: {
        id: created.user.id, name, email, role, active: true, photographerId,
      } }, 201);
    }

    if (req.method === "PATCH") {
      const input = await req.json();
      const userId = String(input.userId || "");
      const active = input.active === true;
      if (!userId) return json({ error: "Missing staff account." }, 400);
      const { data: target, error: targetError } = await adminDb
        .from("agio_staff_profiles").select("role")
        .eq("user_id", userId).maybeSingle();
      if (targetError) throw targetError;
      if (!target) return json({ error: "Staff account not found." }, 404);
      if (target.role === "super_admin") return json({ error: "The primary Super Administrator cannot be disabled here." }, 403);
      const { error: updateError } = await adminDb.from("agio_staff_profiles")
        .update({ active, updated_at: new Date().toISOString() }).eq("user_id", userId);
      if (updateError) throw updateError;
      const { error: banError } = await adminDb.auth.admin.updateUserById(userId, {
        ban_duration: active ? "none" : "876000h",
      });
      if (banError) throw banError;
      return json({ ok: true });
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    console.error("admin-staff:", error);
    return json({ error: "The staff account operation could not be completed." }, 500);
  }
});
