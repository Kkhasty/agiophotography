import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, serviceKey);

    const body = await req.json();
    const record = body?.record;
    const required = ["bookingRef", "clientName", "clientEmail", "clientPhone",
      "date", "startTime", "endTime", "serviceId", "photographerId"];
    for (const key of required) {
      if (!record?.[key]) return json({ error: `Booking is missing ${key}.` }, 400);
    }

    const email = String(record.clientEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Enter a valid email address." }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record.date)) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(record.startTime)) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(record.endTime)) ||
        String(record.endTime) <= String(record.startTime)) {
      return json({ error: "The selected date or time is invalid." }, 400);
    }
    if (String(record.date) < new Date().toISOString().slice(0, 10)) {
      return json({ error: "Bookings cannot be made for a past date." }, 400);
    }

    const { data: serviceRows, error: serviceError } = await db
      .from("agio_records").select("data")
      .eq("collection", "Services");
    if (serviceError) throw serviceError;
    const services = (serviceRows || []).map((x: any) => x.data);
    const service = services.find((s: any) => String(s.id) === String(record.serviceId));
    if (!service || service.active === false) {
      return json({ error: "The selected photography package is unavailable." }, 400);
    }

    const selectedAddonIds = Array.isArray(record.addons)
      ? record.addons.map((a: any) => String(a.id)) : [];
    const allowedAddons = (service.addons || []).filter((a: any) =>
      selectedAddonIds.includes(String(a.id)));
    const trustedTotal = Number(service.price || 0) +
      allowedAddons.reduce((sum: number, a: any) => sum + Number(a.price || 0), 0);

    const { data: photographerRows, error: photographerError } = await db
      .from("agio_records").select("data").eq("collection", "Photographers");
    if (photographerError) throw photographerError;
    const photographers = (photographerRows || []).map((x: any) => x.data);
    const photographer = photographers.find((p: any) => String(p.id) === String(record.photographerId));
    if (!photographer || photographer.active === false) {
      return json({ error: "The selected photographer is unavailable." }, 400);
    }
    if (photographer.workingHours) {
      const day = new Date(`${record.date}T12:00:00`).getDay();
      const hours = photographer.workingHours[day];
      const minutes = (value: string) => { const [h, m] = String(value || "").split(":").map(Number); return h * 60 + m; };
      const start = minutes(record.startTime), end = minutes(record.endTime);
      if (!hours || !hours.active || start < minutes(hours.start) || end > minutes(hours.end)) {
        return json({ error: "The selected time is outside this photographer’s working hours." }, 400);
      }
      if (Number(service.durationMinutes || service.duration || 60) < 360 && hours.breakStart && hours.breakEnd && start < minutes(hours.breakEnd) && minutes(hours.breakStart) < end) {
        return json({ error: "The selected time overlaps the photographer’s break." }, 400);
      }
    }

    const safeRecord = {
      ...record,
      id: String(record.id || crypto.randomUUID()),
      clientEmail: email,
      photographerName: photographer.name || record.photographerName,
      serviceName: service.name || service.title || record.serviceName,
      addons: allowedAddons,
      totalAmount: trustedTotal,
      durationMinutes: Number(service.durationMinutes || service.duration || 60),
      depositAmount: Math.round(trustedTotal * Number(service.depositPercent || 40) / 100),
      amountPaid: 0,
      balanceRemaining: trustedTotal,
      status: "Pending",
      createdAt: new Date().toISOString(),
    };

    // The SQL function takes a transaction-scoped advisory lock for this
    // photographer/date and checks overlaps before inserting.
    const { data: savedRecord, error: bookingError } = await db.rpc("agio_create_booking_atomic", {
      p_record: safeRecord,
    });
    if (bookingError) {
      if (bookingError.code === "23P01" || String(bookingError.message || "").includes("just been booked")) {
        return json({ error: "That time has just been booked. Please choose another available time." }, 409);
      }
      throw bookingError;
    }


    return json({ ok: true, record: savedRecord || safeRecord });
  } catch (error) {
    console.error("create-booking:", error);
    return json({ error: "We could not save the booking. Please try again." }, 500);
  }
});
