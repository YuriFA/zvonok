-- One-time setup inside the existing zvonok postgres container:
--   docker exec -i postgres-zvonok psql -U zvonok_admin -d zvonok < monitoring/sql/monitoring-init.sql
-- Replace the passwords (match monitoring/.env) before running.

-- Read-only metrics user for postgres_exporter (uses pg_monitor).
CREATE ROLE metrics_reader LOGIN PASSWORD 'CHANGE_ME_metrics';
GRANT pg_monitor TO metrics_reader;

-- Database and owner for self-hosted GlitchTip (Sentry-compatible errors).
CREATE ROLE glitchtip LOGIN PASSWORD 'CHANGE_ME_glitchtip';
CREATE DATABASE glitchtip OWNER glitchtip;
