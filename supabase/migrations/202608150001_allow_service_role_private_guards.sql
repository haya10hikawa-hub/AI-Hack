-- Server-side ingestion uses the Supabase secret/service role client for
-- accountless public sessions. Evidence and gap writes fire privacy guard
-- triggers in the private schema, so service_role must be able to execute
-- those guard functions. Browser roles remain excluded.

grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
