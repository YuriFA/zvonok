# infra/gateway/

Shared Traefik v3 edge for the production VPS: terminates TLS (Let's Encrypt,
TLS challenge) for every site on the host and publishes Prometheus metrics on
host loopback (`127.0.0.1:8082`, consumed by `infra/monitoring/`). Runs at
`~/gateway` on the VPS as its own compose project; both app stacks (zvonok,
wallet) attach to the external `web` docker network.

## Files on the VPS (`~/gateway/`)

- `docker-compose.yml` - identical to the one here; diff before redeploying
- `.env` - `ACME_EMAIL` only; never committed (template: `.env.example`)
- `acme.json` - LE account and certificate private keys; never committed,
  must stay `chmod 600`

## Deploy

```
scp infra/gateway/docker-compose.yml vps:~/gateway/
ssh vps 'cd ~/gateway && docker compose up -d'
```

Verify: `curl -s 127.0.0.1:8082/metrics | grep traefik_` returns series, and
public edge does not serve metrics: `curl -s -o /dev/null -w '%{http_code}'
http://127.0.0.1/metrics` is not 200.
