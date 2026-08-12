#!/usr/bin/env bash
# Prepara un Git worktree: enlaza .env y node_modules si el origen existe.
# No reemplaza archivos ni directorios que ya estén en este worktree.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

principal=""
while IFS= read -r line; do
  case "$line" in
    worktree\ *)
      candidate="${line#worktree }"
      if [ -z "$principal" ] || [ -d "$candidate/.git" ]; then
        principal="$candidate"
      fi
      ;;
  esac
done < <(git worktree list --porcelain)

if [ -z "$principal" ]; then
  echo "No se pudo identificar el worktree principal." >&2
  exit 1
fi

echo "Worktree actual: $root"
echo "Worktree principal: $principal"

link_if_missing() {
  local name="$1"
  local source="$2"
  if [ -e "$root/$name" ] || [ -L "$root/$name" ]; then
    echo "$name ya existe; no se reemplaza."
    return 0
  fi
  if [ ! -e "$source" ]; then
    echo "$name: origen no disponible ($source)."
    return 0
  fi
  ln -s "$source" "$root/$name"
  echo "Creado $name -> $source"
}

find_lock() {
  for lock in package-lock.json pnpm-lock.yaml yarn.lock; do
    if [ -f "$root/$lock" ]; then
      echo "$lock"
      return 0
    fi
  done
  return 1
}

env_source=""
if [ -f "$principal/.env" ]; then
  env_source="$principal/.env"
else
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        candidate="${line#worktree }"
        if [ "$candidate" != "$root" ] && [ -f "$candidate/.env" ]; then
          env_source="$candidate/.env"
          break
        fi
        ;;
    esac
  done < <(git worktree list --porcelain)
fi

if [ -n "$env_source" ]; then
  link_if_missing ".env" "$env_source"
else
  echo ".env: todavía no hay un origen en el principal ni en otro worktree."
fi

if lock="$(find_lock)"; then
  node_source=""
  if [ -d "$principal/node_modules" ] && cmp -s "$root/$lock" "$principal/$lock"; then
    node_source="$principal/node_modules"
  else
    while IFS= read -r line; do
      case "$line" in
        worktree\ *)
          candidate="${line#worktree }"
          if [ "$candidate" != "$root" ] && [ -d "$candidate/node_modules" ] && [ -f "$candidate/$lock" ] && cmp -s "$root/$lock" "$candidate/$lock"; then
            node_source="$candidate/node_modules"
            break
          fi
          ;;
      esac
    done < <(git worktree list --porcelain)
  fi

  if [ -n "$node_source" ]; then
    link_if_missing "node_modules" "$node_source"
  elif [ ! -e "$root/node_modules" ]; then
    echo "node_modules: lock distinto o sin origen compartible; ejecuta npm install en este worktree."
  fi
fi

ok=0
if [ -L "$root/.env" ] || [ -f "$root/.env" ]; then
  if [ -s "$root/.env" ]; then
    echo "OK .env está presente."
    ok=$((ok + 1))
  else
    echo "AVISO: .env existe pero está vacío." >&2
  fi
fi
if [ -d "$root/node_modules" ]; then
  echo "OK node_modules está presente."
  ok=$((ok + 1))
fi

if [ "$ok" -eq 0 ]; then
  echo "El worktree quedó sin .env ni node_modules compartidos."
  exit 0
fi
