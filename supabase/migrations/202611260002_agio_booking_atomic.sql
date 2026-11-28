-- Atomic booking creation: prevents two visitors claiming the same photographer/time.
-- Run after 202611260001_agio_security.sql.
create or replace function public.agio_create_booking_atomic(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_date date;
  v_start time;
  v_end time;
  v_photographer text;
  v_existing jsonb;
  v_email text;
  v_customer_id text;
  v_customer jsonb;
begin
  if jsonb_typeof(p_record) <> 'object' then
    raise exception 'Invalid booking record';
  end if;
  v_id := coalesce(nullif(p_record->>'id',''), gen_random_uuid()::text);
  v_date := (p_record->>'date')::date;
  v_start := (p_record->>'startTime')::time;
  v_end := (p_record->>'endTime')::time;
  v_photographer := nullif(p_record->>'photographerId','');
  if v_photographer is null or v_end <= v_start then
    raise exception 'Invalid booking time or photographer';
  end if;

  -- Serialize booking attempts for the same photographer and date.
  perform pg_advisory_xact_lock(hashtextextended(v_date::text || ':' || v_photographer, 0));

  select data into v_existing
  from public.agio_records
  where collection = 'Bookings'
    and data->>'date' = v_date::text
    and data->>'photographerId' = v_photographer
    and coalesce(data->>'status','') not in ('Cancelled','Rejected')
    and (data->>'startTime')::time < v_end
    and (data->>'endTime')::time > v_start
  limit 1;

  if v_existing is not null then
    raise exception 'That time has just been booked. Please choose another available time.' using errcode = '23P01';
  end if;

  insert into public.agio_records(collection, record_id, data)
  values ('Bookings', v_id, jsonb_set(p_record, '{id}', to_jsonb(v_id), true));

  -- Keep the customer CRM in the same transaction as the booking. The
  -- normalized email-derived record key prevents duplicate customer rows.
  v_email := lower(trim(coalesce(p_record->>'clientEmail','')));
  if v_email <> '' then
    v_customer_id := 'cust_' || md5(v_email);
    select data into v_customer
      from public.agio_records
      where collection = 'Customers' and record_id = v_customer_id;
    v_customer := coalesce(v_customer, '{}'::jsonb) || jsonb_build_object(
      'id', v_customer_id,
      'name', coalesce(p_record->>'clientName',''),
      'email', v_email,
      'phone', coalesce(p_record->>'clientPhone',''),
      'preferredService', coalesce(p_record->>'serviceName',''),
      'lastBookingDate', v_date::text,
      'totalBookings', coalesce((v_customer->>'totalBookings')::integer,0) + 1,
      'notes', coalesce(p_record->>'specialRequirements','')
    );
    insert into public.agio_records(collection, record_id, data)
      values ('Customers', v_customer_id, v_customer)
      on conflict (collection, record_id) do update set
        data = excluded.data, updated_at = now();
  end if;

  return jsonb_set(p_record, '{id}', to_jsonb(v_id), true);
end;
$$;

revoke all on function public.agio_create_booking_atomic(jsonb) from public, anon, authenticated;
grant execute on function public.agio_create_booking_atomic(jsonb) to service_role;
