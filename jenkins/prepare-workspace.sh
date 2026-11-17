#!/usr/bin/env bash
set -euo pipefail
umask 027

# Prepara el workspace CI aislado únicamente en:
#   <repo_root>/.ci-workspace
# - Preserva el directorio raíz y su inodo (no ejecuta rm -rf sobre el contenedor montado).
# - Conserva historial real de commits de la rama activa sin copiar .git del anfitrión.
# - Incorpora cambios locales rastreados y archivos nuevos legítimos no rastreados.
# - Excluye estrictamente .env, secretos, enlaces simbólicos externos y artefactos.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
AUTHORIZED_DIR="${REPO_ROOT}/.ci-workspace"

if [[ $# -gt 1 ]]; then
  echo "ERROR: Demasiados argumentos. Uso: $0 [${AUTHORIZED_DIR}]" >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  RAW_ARG="$1"
  if [[ -z "${RAW_ARG}" ]]; then
    echo "ERROR: El argumento de destino no puede estar vacío." >&2
    exit 1
  fi
  RESOLVED_ARG="$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${RAW_ARG}")"
  if [[ "${RESOLVED_ARG}" != "${AUTHORIZED_DIR}" ]]; then
    echo "ERROR: Destino no autorizado ('${RAW_ARG}' -> '${RESOLVED_ARG}'). Solo se permite '${AUTHORIZED_DIR}'." >&2
    exit 1
  fi
fi

if ! git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: ${REPO_ROOT} no es un repositorio Git válido." >&2
  exit 1
fi

GIT_TOPLEVEL="$(git -C "${REPO_ROOT}" rev-parse --show-toplevel)"
if [[ "${GIT_TOPLEVEL}" != "${REPO_ROOT}" ]]; then
  echo "ERROR: La raíz detectada (${REPO_ROOT}) no coincide con el toplevel Git (${GIT_TOPLEVEL})." >&2
  exit 1
fi

if [[ -L "${AUTHORIZED_DIR}" ]]; then
  echo "ERROR: ${AUTHORIZED_DIR} no puede ser un enlace simbólico." >&2
  exit 1
fi

if [[ -e "${AUTHORIZED_DIR}" && ! -d "${AUTHORIZED_DIR}" ]]; then
  echo "ERROR: ${AUTHORIZED_DIR} existe pero no es un directorio." >&2
  exit 1
fi

mkdir -p "${AUTHORIZED_DIR}"
chmod 0750 "${AUTHORIZED_DIR}"

# Verificar .env.example antes de permitir su copia (solo placeholders permitidos)
if [[ -f "${REPO_ROOT}/.env.example" ]]; then
  python3 - "${REPO_ROOT}/.env.example" << 'PY'
import pathlib, re, sys
p = pathlib.Path(sys.argv[1])
for idx, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
    s = line.strip()
    if not s or s.startswith("#") or "=" not in s:
        continue
    k, v = s.split("=", 1)
    k = k.strip().upper()
    v = v.strip().strip("'\"")
    if k.endswith(("_PASSWORD", "_SECRET", "_SECRET_KEY", "_TOKEN", "_PRIVATE_KEY")) or k in {"PASSWORD", "SECRET", "TOKEN"}:
        if v and not v.startswith("CHANGE_ME_"):
            raise SystemExit(f"ERROR: Posible secreto no placeholder en .env.example línea {idx} ({k}).")
PY
fi

# Limpiar únicamente el contenido interno preservando el inodo del directorio .ci-workspace
find "${AUTHORIZED_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +

TMP_STAGE="$(mktemp -d)"
cleanup() {
  rm -rf -- "${TMP_STAGE}"
}
trap cleanup EXIT

CURRENT_BRANCH="$(git -C "${REPO_ROOT}" symbolic-ref --short -q HEAD || true)"
HEAD_SHA="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"

if [[ -n "${CURRENT_BRANCH}" ]]; then
  git clone --quiet --local --no-hardlinks --no-checkout \
    --branch "${CURRENT_BRANCH}" --single-branch "${REPO_ROOT}" "${TMP_STAGE}/repo"
else
  git clone --quiet --local --no-hardlinks --no-checkout \
    "${REPO_ROOT}" "${TMP_STAGE}/repo"
fi

mv "${TMP_STAGE}/repo/.git" "${AUTHORIZED_DIR}/.git"
git -C "${AUTHORIZED_DIR}" remote remove origin >/dev/null 2>&1 || true

# Copiar archivos rastreados modificados/actuales y archivos nuevos legítimos no rastreados
COUNTS="$(python3 - "${REPO_ROOT}" "${AUTHORIZED_DIR}" << 'PY'
import fnmatch
import os
import pathlib
import shutil
import subprocess
import sys

repo_root = pathlib.Path(sys.argv[1]).resolve()
target_dir = pathlib.Path(sys.argv[2]).resolve()

SENSITIVE_BASENAMES = {".env"}
SENSITIVE_GLOBS = ("*.pem", "*.key", "*.crt", "*.p12", "*.jks", "*.secret", "*id_rsa*", "*id_ed25519*")
ARTIFACT_PARTS = {
    ".ci-workspace",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "coverage",
    "test-results",
    ".scannerwork",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    "htmlcov",
    "jenkins_home",
    "sonarqube_data",
    "sonarqube_logs",
    "sonarqube_extensions",
    "postgres_data",
    "portainer_data",
}
TEMP_SUFFIXES = (".pyc", ".pyo", ".log", ".tmp", ".bak", ".orig", ".swp", ".swo", ".tsbuildinfo")
ALLOWED_UNTRACKED_PREFIXES = (
    "backend/app/",
    "backend/tests/",
    "backend/migrations/",
    "frontend/src/",
    "frontend/public/",
    "jenkins/",
    "docs/",
    "database/",
    "tests/",
)
ALLOWED_UNTRACKED_ROOT_FILES = {
    "Jenkinsfile",
    "sonar-project.properties",
    "docker-compose.yml",
    "README.md",
    ".gitignore",
    ".dockerignore",
    ".env.example",
}


def is_excluded(rel_path: str) -> str | None:
    p = pathlib.PurePosixPath(rel_path)
    name = p.name
    if any(part in ARTIFACT_PARTS for part in p.parts):
        return "artefacto"
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        return "sensible"
    if any(fnmatch.fnmatch(name, pat) for pat in SENSITIVE_GLOBS):
        return "sensible"
    if name.endswith(TEMP_SUFFIXES) or name.endswith("~") or name == ".coverage" or name.startswith(".coverage."):
        return "temporal"
    if name == "coverage.xml" or fnmatch.fnmatch(name, "junit*.xml"):
        return "temporal"
    return None


def copy_regular_safe(rel_path: str) -> bool:
    src = repo_root / rel_path
    if os.path.islink(src):
        resolved = pathlib.Path(os.path.realpath(src))
        try:
            resolved_rel = resolved.relative_to(repo_root).as_posix()
        except ValueError:
            print(f"OMITIDO (symlink externo): {rel_path}", file=sys.stderr)
            return False
        if not resolved.is_file() or is_excluded(resolved_rel):
            print(f"OMITIDO (symlink inválido/sensible): {rel_path}", file=sys.stderr)
            return False
        src = resolved

    if not src.exists():
        return False
    if not src.is_file():
        return False

    dst = target_dir / rel_path
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return True


tracked_raw = subprocess.check_output(["git", "-C", str(repo_root), "ls-files", "-z"])
tracked = [x.decode("utf-8") for x in tracked_raw.split(b"\x00") if x]

untracked_raw = subprocess.check_output(
    ["git", "-C", str(repo_root), "ls-files", "--others", "--exclude-standard", "-z"]
)
untracked = [x.decode("utf-8") for x in untracked_raw.split(b"\x00") if x]

copied_tracked = 0
for rel in tracked:
    reason = is_excluded(rel)
    if reason:
        print(f"OMITIDO ({reason}): {rel}", file=sys.stderr)
        continue
    if copy_regular_safe(rel):
        copied_tracked += 1

copied_untracked = 0
for rel in untracked:
    reason = is_excluded(rel)
    if reason:
        print(f"OMITIDO ({reason}): {rel}", file=sys.stderr)
        continue
    if not (rel.startswith(ALLOWED_UNTRACKED_PREFIXES) or rel in ALLOWED_UNTRACKED_ROOT_FILES):
        print(f"OMITIDO (no rastreado fuera de alcance CI): {rel}", file=sys.stderr)
        continue
    if copy_regular_safe(rel):
        copied_untracked += 1

print(f"tracked={copied_tracked} untracked={copied_untracked}")
PY
)"

# Verificaciones explícitas de aislamiento sobre el workspace final
if find "${AUTHORIZED_DIR}" -path "${AUTHORIZED_DIR}/.git" -prune -o \( -name ".env" -o \( -name ".env.*" ! -name ".env.example" \) \) -print | grep -q .; then
  echo "ERROR CRÍTICO: Archivo .env* no permitido detectado en el workspace aislado." >&2
  find "${AUTHORIZED_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  exit 1
fi

for required in Jenkinsfile sonar-project.properties backend/pyproject.toml frontend/package.json; do
  if [[ ! -f "${AUTHORIZED_DIR}/${required}" ]]; then
    echo "ERROR: Archivo requerido ausente en workspace aislado: ${required}" >&2
    exit 1
  fi
done

if [[ -n "$(git -C "${AUTHORIZED_DIR}" status --porcelain)" ]]; then
  git -C "${AUTHORIZED_DIR}" config user.name "Restaurante Smart CI Snapshot"
  git -C "${AUTHORIZED_DIR}" config user.email "ci-snapshot@restaurante-smart.local"
  git -C "${AUTHORIZED_DIR}" add -A
  git -C "${AUTHORIZED_DIR}" commit -q -m "ci: uncommitted working-tree overlay over ${HEAD_SHA}"
  OVERLAY_INFO="overlay sobre commit real ${HEAD_SHA}"
else
  OVERLAY_INFO="exacto en commit real ${HEAD_SHA}"
fi

# Endurecer permisos efectivos dentro del workspace aislado (sin escritura de grupo ni acceso a otros)
chmod 0750 "${AUTHORIZED_DIR}"
find "${AUTHORIZED_DIR}" -type d -exec chmod 0750 {} +
find "${AUTHORIZED_DIR}" -type f -exec chmod go-w,o-rwx {} +

echo "OK: Workspace CI aislado en ${AUTHORIZED_DIR} (${COUNTS}; ${OVERLAY_INFO}; inodo=$(stat -c %i "${AUTHORIZED_DIR}"))."
