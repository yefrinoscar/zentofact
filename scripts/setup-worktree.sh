#!/usr/bin/env bash
# Prepara un Git worktree: enlaza .env y node_modules si el origen existe.
# No reemplaza directorios reales que ya estén en este worktree.
# Un symlink incompleto sí se retargetea hacia un origen completo.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

worktree_paths() {
  while IFS= read -r line; do
    case "$line" in
      worktree\ *)
        printf '%s\n' "${line#worktree }"
        ;;
    esac
  done < <(git worktree list --porcelain)
}

principal=""
while IFS= read -r candidate; do
  if [ -z "$principal" ] || [ -d "$candidate/.git" ]; then
    principal="$candidate"
  fi
done < <(worktree_paths)

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

nested_modules_complete() {
  local src="$1"
  [ -d "$src/node_modules" ] || return 1
  [ -f "$src/package-lock.json" ] || return 0
  node -e '
const fs = require("fs");
const path = require("path");
const src = process.argv[1];
const lock = JSON.parse(fs.readFileSync(path.join(src, "package-lock.json"), "utf8"));
const nested = /^packages\/[^/]+\/node_modules\/(@[^/]+\/[^/]+|[^/]+)$/;
for (const key of Object.keys(lock.packages || {})) {
  if (!nested.test(key)) continue;
  if (!fs.existsSync(path.join(src, key, "package.json"))) {
    process.exit(1);
  }
}
' "$src"
}

ensure_link() {
  local rel="$1"
  local source="$2"
  local dest="$root/$rel"

  if [ ! -e "$source" ]; then
    echo "$rel: origen no disponible ($source)."
    return 0
  fi

  if [ -L "$dest" ]; then
    local current
    current="$(readlink "$dest")"
    if [ "$current" = "$source" ]; then
      echo "$rel ya apunta al origen."
      return 0
    fi
    rm "$dest"
    ln -s "$source" "$dest"
    echo "Actualizado $rel -> $source"
    return 0
  fi

  if [ -d "$dest" ]; then
    if [ -z "$(ls -A "$dest" 2>/dev/null)" ]; then
      rmdir "$dest"
    else
      local child base
      for child in "$source"/*; do
        [ -e "$child" ] || continue
        base="$(basename "$child")"
        if [ ! -e "$dest/$base" ] && [ ! -L "$dest/$base" ]; then
          ln -s "$child" "$dest/$base"
          echo "Creado $rel/$base -> $child"
        fi
      done
      echo "$rel ya existe; no se reemplaza el directorio."
      return 0
    fi
  elif [ -e "$dest" ]; then
    echo "$rel ya existe; no se reemplaza."
    return 0
  fi

  mkdir -p "$(dirname "$dest")"
  ln -s "$source" "$dest"
  echo "Creado $rel -> $source"
}

link_modules_from() {
  local src="$1"
  ensure_link "node_modules" "$src/node_modules"
  local pkg
  for pkg in "$src"/packages/*; do
    [ -d "$pkg/node_modules" ] || continue
    ensure_link "packages/$(basename "$pkg")/node_modules" "$pkg/node_modules"
  done
}

remove_module_symlinks() {
  if [ -L "$root/node_modules" ]; then
    rm "$root/node_modules"
  fi
  local dest
  for dest in "$root"/packages/*/node_modules; do
    [ -L "$dest" ] || continue
    rm "$dest"
  done
}

find_shareable_source() {
  local candidate
  if [ -n "$principal" ] && [ "$principal" != "$root" ] && [ -f "$principal/$lock" ] &&
    cmp -s "$root/$lock" "$principal/$lock" && nested_modules_complete "$principal"; then
    printf '%s\n' "$principal"
    return 0
  fi
  while IFS= read -r candidate; do
    [ "$candidate" != "$root" ] || continue
    [ -f "$candidate/$lock" ] || continue
    cmp -s "$root/$lock" "$candidate/$lock" || continue
    nested_modules_complete "$candidate" || continue
    printf '%s\n' "$candidate"
    return 0
  done < <(worktree_paths)
  return 1
}

env_source=""
if [ -f "$principal/.env" ]; then
  env_source="$principal/.env"
else
  while IFS= read -r candidate; do
    if [ "$candidate" != "$root" ] && [ -f "$candidate/.env" ]; then
      env_source="$candidate/.env"
      break
    fi
  done < <(worktree_paths)
fi

if [ -n "$env_source" ]; then
  link_if_missing ".env" "$env_source"
else
  echo ".env: todavía no hay un origen en el principal ni en otro worktree."
fi

if lock="$(find_lock)"; then
  node_source=""
  if [ "$lock" = "package-lock.json" ]; then
    node_source="$(find_shareable_source || true)"
  else
    if [ -d "$principal/node_modules" ] && [ -f "$principal/$lock" ] && cmp -s "$root/$lock" "$principal/$lock"; then
      node_source="$principal"
    else
      while IFS= read -r candidate; do
        if [ "$candidate" != "$root" ] && [ -d "$candidate/node_modules" ] && [ -f "$candidate/$lock" ] &&
          cmp -s "$root/$lock" "$candidate/$lock"; then
          node_source="$candidate"
          break
        fi
      done < <(worktree_paths)
    fi
  fi

  if [ -n "$node_source" ]; then
    echo "Origen de node_modules: $node_source"
    link_modules_from "$node_source"
  elif [ ! -e "$root/node_modules" ] || [ -L "$root/node_modules" ]; then
    echo "node_modules: lock distinto o sin origen completo; npm install en este worktree."
    remove_module_symlinks
    ${NPM_INSTALL_CMD:-npm install}
  elif [ -d "$root/node_modules" ] && [ "$lock" = "package-lock.json" ] && ! nested_modules_complete "$root"; then
    echo "node_modules local incompleto; npm install en este worktree."
    ${NPM_INSTALL_CMD:-npm install}
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

if [ -f "$root/package-lock.json" ] && [ -d "$root/node_modules" ] && ! nested_modules_complete "$root"; then
  echo "Fallo: packages/*/node_modules incompleto (better-auth u otro paquete no hoisted)." >&2
  exit 1
fi

if [ "$ok" -eq 0 ]; then
  echo "El worktree quedó sin .env ni node_modules compartidos."
  exit 0
fi
