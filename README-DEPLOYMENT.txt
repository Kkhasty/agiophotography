AGIO PHOTOGRAPHY — SUPABASE REBUILD CANDIDATE

Contains converted frontend, Supabase browser adapter, SQL migrations, Edge Functions and original backup. The live GitHub Pages site and spreadsheet have not been changed. This is not a verified production deployment.

Before publishing: run migrations in order; deploy Edge Functions create-booking, admin-staff and workspace; verify server secrets SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY; provision the initial Auth user and profile; run the acceptance tests below. Never put the service-role key in browser code.

Initial administrator profile SQL (after creating the Auth user in Supabase Authentication):
insert into public.agio_staff_profiles(user_id,full_name,role,active) select id,'Agio Photography Administrator','super_admin',true from auth.users where lower(email)=lower('agiophotography@gmail.com') on conflict(user_id) do update set role='super_admin',active=true;
Use a new unique password, not the password previously shared in chat.

Acceptance tests: public catalogue loads from Supabase; a new booking is saved; overlapping booking is rejected; admin login works; staff/photographer roles see only authorized bookings; staff create/deactivate works; catalogue changes persist; deletion behaviour is verified; payment status cannot be set from a customer-supplied reference.

Important limitations requiring verification: the current frontend still contains legacy local state and some workflows (customer portal, payment confirmation and explicit collection deletion) need end-to-end reconciliation. Routine collection sync is intentionally upsert-only to prevent incomplete browser caches from deleting database records. Public bookings now create/update a customer CRM record transactionally. Google Sheets records are not automatically migrated by this build. Export and map legacy data deliberately before importing. Payment gateway public keys do not prove payment; production payment requires verified gateway webhooks.

Do not replace the live site until all tests pass on a staging branch. No Supabase or GitHub deployment has been performed by this package.
