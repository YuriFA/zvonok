# Tasks: server-host-network

## 1. Compose topology (docker-compose.prod.yml)

- [x] 1.1 `server`: add `network_mode: host`, remove `expose: 3000` and the RTC `ports:` block (mediasoup binds host ports directly)
- [x] 1.2 `server`: change `DATABASE_URL` host from `postgres` to `127.0.0.1`
- [x] 1.3 `postgres`: add loopback-only publish `ports: ["127.0.0.1:5432:5432"]`
- [x] 1.4 `caddy`: add `extra_hosts: ["host.docker.internal:host-gateway"]` and `SERVER_UPSTREAM: host.docker.internal:3000`
- [x] 1.5 Validate: `docker compose -f docker-compose.prod.yml config` parses with no errors

## 2. Caddy upstream (Caddyfile.routes)

- [x] 2.1 Replace every `reverse_proxy server:3000` with `reverse_proxy {$SERVER_UPSTREAM:server:3000}` and document the variable in the file header comment

## 3. Documentation (docs/deployment.md)

- [x] 3.1 Update the architecture diagram: NestJS RTC ports bound directly via host network mode
- [x] 3.2 Add a row to the dev-vs-prod compose differences table (server network mode)
- [x] 3.3 Ports section: document that 3000 is host-bound in prod, must not face the internet, allowed only from Docker subnets; note the egress RTP ingest range stays internal
- [x] 3.4 Firewall section (Step 2): add `sudo ufw allow from 172.16.0.0/12 to any port 3000 proto tcp` with rationale
- [x] 3.5 Update the `PORT` variable row (host-bound in prod, keep firewalled)

## 4. Verification

- [x] 4.1 Dev compose unaffected: `docker compose config` parses; `Caddyfile.routes` default upstream resolves on the bridge network
- [x] 4.2 Confirm no other references to `server:3000` outside Caddyfile.routes and frozen docs/archive
