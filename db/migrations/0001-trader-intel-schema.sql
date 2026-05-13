create schema if not exists trader_intel;

grant usage on schema trader_intel to service_role;
grant all on all tables in schema trader_intel to service_role;
grant all on all sequences in schema trader_intel to service_role;
