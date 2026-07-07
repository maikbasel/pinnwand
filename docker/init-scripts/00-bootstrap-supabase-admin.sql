-- The supabase/postgres image's migrate.sh (run by the standard postgres
-- entrypoint) connects as supabase_admin to bootstrap roles & schemas. The
-- AMI build pre-creates that role; the Docker build does not. Create it
-- here so migrate.sh can connect, then init-scripts/99-roles.sql resets
-- the password to match POSTGRES_PASSWORD anyway.
\set pgpass `echo "$POSTGRES_PASSWORD"`

CREATE USER supabase_admin SUPERUSER PASSWORD :'pgpass';
