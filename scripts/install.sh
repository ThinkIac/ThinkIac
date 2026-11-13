#!/usr/bin/env bash
# ThinkIac quick starter for a fresh Debian/Ubuntu VPS.
# Usage: curl -fsSL https://raw.githubusercontent.com/ThinkIac/Think/main/scripts/install.sh | sudo bash
set -Eeuo pipefail

REPOSITORY="${THINKIAC_REPOSITORY:-https://github.com/ThinkIac/Think.git}"
REF="${THINKIAC_REF:-main}"
INSTALL_DIR="${THINKIAC_DIR:-/opt/thinkiac}"
SERVICE_NAME="${THINKIAC_SERVICE:-thinkiac}"
RUN_USER="${SUDO_USER:-${USER:-root}}"

fail() { printf '\n[thinkiac] erro: %s\n' "$*" >&2; exit 1; }
note() { printf '[thinkiac] %s\n' "$*"; }
as_root() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
as_app_user() { if [ "$(id -u)" -eq 0 ] && [ "$RUN_USER" != "root" ]; then runuser -u "$RUN_USER" -- "$@"; else "$@"; fi; }

[ "$(uname -s)" = "Linux" ] || fail "este instalador suporta somente Linux"
command -v apt-get >/dev/null || fail "use Docker Compose ou instale em Debian/Ubuntu (apt)"
command -v systemctl >/dev/null || fail "systemd não está disponível; use Docker Compose"

note "instalando dependências do sistema"
as_root apt-get update -y
as_root apt-get install -y ca-certificates curl git build-essential openssl python3

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  note "instalando Node.js 22"
  nodesource_script="$(mktemp)"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o "$nodesource_script"
  as_root bash "$nodesource_script"
  rm -f "$nodesource_script"
  as_root apt-get install -y nodejs
fi

if [ -e "$INSTALL_DIR" ] && [ ! -d "$INSTALL_DIR/.git" ]; then
  fail "$INSTALL_DIR já existe e não é um clone do ThinkIac"
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  if ! as_app_user git -C "$INSTALL_DIR" diff --quiet || ! as_app_user git -C "$INSTALL_DIR" diff --cached --quiet; then
    fail "$INSTALL_DIR possui alterações locais; faça commit ou descarte-as antes de atualizar"
  fi
  note "atualizando o código para $REF"
  as_app_user git -C "$INSTALL_DIR" fetch --depth=1 origin "$REF"
  as_app_user git -C "$INSTALL_DIR" checkout --detach --force FETCH_HEAD
else
  note "baixando ThinkIac ($REF)"
  as_root mkdir -p "$(dirname "$INSTALL_DIR")"
  as_root git clone --depth=1 --branch "$REF" "$REPOSITORY" "$INSTALL_DIR"
  as_root chown -R "$RUN_USER":"$RUN_USER" "$INSTALL_DIR"
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
  note "criando .env inicial"
  as_app_user cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  admin_email="${THINKIAC_ADMIN_EMAIL:-admin@localhost}"
  admin_password="${THINKIAC_ADMIN_PASSWORD:-$(openssl rand -base64 24 | tr -d '\n')}"
  as_app_user sed -i "s|^AUTH_ENV_ADMIN_EMAIL=.*|AUTH_ENV_ADMIN_EMAIL=$admin_email|; s|^AUTH_ENV_ADMIN_PASSWORD=.*|AUTH_ENV_ADMIN_PASSWORD=$admin_password|" "$INSTALL_DIR/.env"
  generated_credentials=1
else
  generated_credentials=0
fi

note "instalando dependências da aplicação"
as_app_user env PUPPETEER_SKIP_DOWNLOAD=1 npm ci --legacy-peer-deps --no-audit --no-fund --prefix "$INSTALL_DIR"

unit_file="/etc/systemd/system/${SERVICE_NAME}.service"
tmp_unit="$(mktemp)"
cat > "$tmp_unit" <<EOF
[Unit]
Description=ThinkIac runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/node $INSTALL_DIR/index.js
Restart=always
RestartSec=5
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF
as_root install -m 0644 "$tmp_unit" "$unit_file"
rm -f "$tmp_unit"
as_root systemctl daemon-reload
as_root systemctl enable --now "$SERVICE_NAME"

note "serviço ativo. Acesse: http://SEU_IP:5040/view/auth/Login"
note "status: sudo systemctl status $SERVICE_NAME"
note "logs:   sudo journalctl -u $SERVICE_NAME -f"
if [ "$generated_credentials" -eq 1 ]; then
  printf '\n[thinkiac] credenciais iniciais (guarde e troque após entrar):\n  e-mail: %s\n  senha: %s\n\n' "$admin_email" "$admin_password"
fi
