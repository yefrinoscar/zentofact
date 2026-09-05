#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if ! pg_isready -q; then
  sudo pg_ctlcluster 16 main start
fi

for _ in $(seq 1 30); do
  pg_isready -q && break
  sleep 1
done
pg_isready -q

sudo -u postgres psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zento') THEN
    CREATE ROLE zento LOGIN SUPERUSER PASSWORD 'zento';
  ELSE
    ALTER ROLE zento WITH LOGIN SUPERUSER PASSWORD 'zento';
  END IF;
END $$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='zentofact'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE zentofact OWNER zento"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -d zentofact -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
sudo -u postgres psql -v ON_ERROR_STOP=1 -d zentofact -c "GRANT ALL ON SCHEMA public TO zento;"

env_file="$root/.env"
if [[ ! -f "$env_file" ]]; then
  secret="$(openssl rand -hex 32)"
  cat > "$env_file" <<EOF
DATABASE_URL_POSTGRES=postgresql://zento:zento@127.0.0.1:5432/zentofact
BETTER_AUTH_SECRET=${secret}
AUTH_BASE_URL=http://127.0.0.1:3010
WEB_ORIGINS=http://127.0.0.1:3011,http://localhost:3011
ADMIN_EMAIL=admin@zentofact.local
ADMIN_PASSWORD=ZentoFactLocal123
AUTH_SUPERADMIN_EMAIL=admin@zentofact.local
SEED_PREVIEW=true
FALABELLA_SYNC_ENABLED=false
MERCADO_LIBRE_SYNC_ENABLED=false
MERCADO_LIBRE_SANDBOX=true
MARKETPLACE_PUBLICATION_MUTATION_ENABLED=false
AUTO_EMIT_ENABLED=false
SUNAT_FORCE_ENV=beta
VITE_APP_ENV=development
EOF
  chmod 600 "$env_file"
fi

echo "cloud-agent-start=ok"
