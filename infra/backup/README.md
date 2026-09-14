# infra/backup/

Daily logical backups of every database in the zvonok postgres container
(zvonok, glitchtip, all roles) on the production VPS, plus a weekly automated
restore drill. Scripts run from `~/backup` on the VPS via deploy's crontab.

## What runs

- `pg-backup.sh` - nightly `pg_dumpall | gzip` to
  `~/backup/zvonok-db-YYYY-MM-DD.sql.gz`, integrity-checked (end marker +
  size), 14-day retention, Telegram alert on failure.
- `pg-restore-test.sh` - weekly: restores the newest dump into a throwaway
  `postgres:16` container and verifies `zvonok` and `glitchtip` both come
  back with tables. Telegram alert on failure. Container is removed after.

Crontab (deploy user):

```
15 4 * * * /home/deploy/backup/pg-backup.sh >> /home/deploy/backup/backup.log 2>&1
30 5 * * 6 /home/deploy/backup/pg-restore-test.sh >> /home/deploy/backup/restore-test.log 2>&1
```

## Deploy

```
scp -r infra/backup/ vps:~/backup
scp infra/backup/.env.template vps:~/backup/.env   # fill in, chmod 600
ssh vps 'chmod 700 ~/backup/*.sh'
```

## Manual restore (real disaster)

Into the running container (drops and recreates the databases - destructive):

```
gunzip -c ~/backup/zvonok-db-YYYY-MM-DD.sql.gz \
  | sed -E 's/ GRANTED BY [A-Za-z_][A-Za-z0-9_]*//g' \
  | docker exec -i zvonok-postgres psql -U zvonok_admin -d postgres
```

The `sed` drops PG16 `GRANTED BY` clauses that a fresh restore cannot replay
(the named grantor lacks ADMIN OPTION there); it is the same transform the
weekly drill uses.

## Limits

- Backups live on the same disk as the data: they survive bad migrations,
  human error and container accidents, but not disk death. Offsite copy
  (S3/Backblaze via rclone) is the follow-up step.
- Egress recordings (`zvonok_egress_data` volume) are NOT backed up.
