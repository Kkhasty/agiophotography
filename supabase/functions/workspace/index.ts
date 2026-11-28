import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const ADMIN = ["super_admin", "administrator"];
const ALL_COLLECTIONS = ["Bookings", "Customers", "Services", "Photographers", "Payments", "Inquiries", "Reviews", "BlockedSlots", "Settings"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) throw new Error("Server configuration is incomplete.");
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Sign in to continue." }, 401);

    const adminDb = createClient(url, serviceKey);
    const token = authHeader.slice(7);
    const { data: authData, error: authError } = await adminDb.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session has expired. Please sign in again." }, 401);
    const userId = authData.user.id;
    const { data: profile, error: profileError } = await adminDb.from("agio_staff_profiles")
      .select("user_id,full_name,role,photographer_id,active").eq("user_id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || !profile.active) return json({ error: "This staff account is inactive or not authorized." }, 403);

    const body = await req.json();
    const action = String(body?.action || "");
    const isAdmin = ADMIN.includes(profile.role);
    const isSuper = profile.role === "super_admin";

    if (action === "listBookings") {
      let q = adminDb.from("agio_records").select("record_id,data").eq("collection", "Bookings").order("created_at", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      let records = (data || []).map((x: any) => x.data);
      if (profile.role === "photographer") records = records.filter((b: any) => String(b.photographerId) === String(profile.photographer_id || ""));
      if (profile.role === "staff") records = records.filter((b: any) => String(b.assignedStaffId || "") === userId);
      return json({ ok: true, records, user: { id: userId, name: profile.full_name, role: ({super_admin:"Super Administrator",administrator:"Administrator",staff:"Staff",photographer:"Photographer"} as any)[profile.role], photographerId: profile.photographer_id || "" } });
    }

    if (action === "updateBooking") {
      const id = String(body?.id || "");
      const patch = body?.patch || {};
      const { data: row, error } = await adminDb.from("agio_records").select("data").eq("collection", "Bookings").eq("record_id", id).maybeSingle();
      if (error) throw error;
      if (!row) return json({ error: "Booking not found." }, 404);
      const record = row.data || {};
      if (profile.role === "photographer" && String(record.photographerId) !== String(profile.photographer_id || "")) return json({ error: "You are not allowed to update this booking." }, 403);
      if (profile.role === "staff" && String(record.assignedStaffId || "") !== userId) return json({ error: "You are not allowed to update this booking." }, 403);
      const allowed = isAdmin
        ? ["status", "photographerId", "photographerName", "specialRequirements", "internalNotes", "assignedStaffId", "paymentStatus", "amountPaid", "balanceRemaining"]
        : ["status", "internalNotes"];
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(patch, key)) record[key] = patch[key];
      record.updatedAt = new Date().toISOString();
      const { error: saveError } = await adminDb.from("agio_records").update({ data: record, updated_at: new Date().toISOString() }).eq("collection", "Bookings").eq("record_id", id);
      if (saveError) throw saveError;
      return json({ ok: true, record });
    }

    if (action === "bootstrapData") {
      if (!isAdmin) return json({ error: "Administrator permission required." }, 403);
      const input = body?.data || {};
      const map: Record<string, any[]> = {
        Services: input.services || [], Photographers: input.photographers || [], Reviews: input.reviews || [],
        BlockedSlots: input.blockedSlots || [], Inquiries: input.inquiries || [], Customers: input.customers || [],
        Bookings: input.bookings || [], Settings: input.settings ? [{ id: "studio_settings", ...input.settings }] : [],
      };
      for (const [collection, records] of Object.entries(map)) {
        if (!ALL_COLLECTIONS.includes(collection) || !Array.isArray(records)) continue;
        const { count, error: countError } = await adminDb.from("agio_records").select("record_id", { count: "exact", head: true }).eq("collection", collection);
        if (countError) throw countError;
        if ((count || 0) > 0 || records.length === 0) continue;
        const rows = records.filter((r) => r && (r.id || collection === "Settings")).map((r) => ({ collection, record_id: String(r.id || "studio_settings"), data: r }));
        if (rows.length) { const { error } = await adminDb.from("agio_records").upsert(rows, { onConflict: "collection,record_id" }); if (error) throw error; }
      }
      const result: Record<string, any[]> = {};
      for (const collection of ALL_COLLECTIONS) {
        const { data, error } = await adminDb.from("agio_records").select("data").eq("collection", collection);
        if (error) throw error;
        result[collection] = (data || []).map((x: any) => x.data);
      }
      return json({ ok: true, collections: result });
    }

    if (action === "saveCollection") {
      if (!isAdmin) return json({ error: "Administrator permission required." }, 403);
      const collection = String(body?.name || "");
      const records = body?.records;
      if (!ALL_COLLECTIONS.includes(collection) || ["Bookings", "Customers", "Staff"].includes(collection)) return json({ error: "Collection is not writable through this action." }, 400);
      if (!Array.isArray(records) || records.length > 2000) return json({ error: "Invalid collection." }, 400);
      const rows = records.map((r: any) => { const id = String(r.id || crypto.randomUUID()); return { collection, record_id: id, data: { ...r, id } }; });
      // Safe synchronization is additive/upsert-only. A browser cache may be
      // incomplete, so a routine save must never infer that missing rows were
      // intentionally deleted. Deletions require a separate explicit action.
      if (rows.length) { const { error } = await adminDb.from("agio_records").upsert(rows, { onConflict: "collection,record_id" }); if (error) throw error; }
      return json({ ok: true, count: rows.length });
    }

    if (action === "getCollection") {
      if (!isAdmin) return json({ error: "Administrator permission required." }, 403);
      const collection = String(body?.name || "");
      if (!ALL_COLLECTIONS.includes(collection) || collection === "Staff") return json({ error: "Collection is not available." }, 400);
      const { data, error } = await adminDb.from("agio_records").select("data").eq("collection", collection);
      if (error) throw error;
      return json({ ok: true, records: (data || []).map((x: any) => x.data) });
    }

    return json({ error: "Unknown workspace action." }, 400);
  } catch (error) {
    console.error("workspace:", error);
    return json({ error: "The workspace request could not be completed." }, 500);
  }
});
