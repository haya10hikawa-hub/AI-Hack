-- Memory Map tables are created after the broad service_role grants in
-- 202608140003_product_completion.sql. Trusted Next.js routes use the
-- service-role admin client for owner-scoped map reads and deletes, so grant
-- direct table access only to that server role.

grant select, insert, update, delete on table public.memory_map_cells
to service_role;

grant select, insert, update, delete on table public.memory_map_cell_memories
to service_role;
