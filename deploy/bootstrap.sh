#!/bin/sh
# One-command setup for a new household (Linux/macOS).
# Usage:
#   sh bootstrap.sh
#   curl -fsSL https://raw.githubusercontent.com/mowngle/allowance/main/deploy/bootstrap.sh | sh
# Optional: set ALLOWANCE_IP to skip auto-detection (e.g. ALLOWANCE_IP=192.168.1.50 sh bootstrap.sh).
# See SETUP-NEW-HOUSEHOLD.md for manual / Windows / advanced options.
set -eu

RAW="https://raw.githubusercontent.com/mowngle/allowance/main/deploy"
DIR="allowance"
PORT="3000"

# Best-guess LAN IPv4: Linux route source, then macOS default-iface, then hostname.
detect_ip() {
  _ip="$(ip -4 route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  if [ -z "$_ip" ]; then
    _if="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [ -n "$_if" ] && _ip="$(ipconfig getifaddr "$_if" 2>/dev/null || true)"
  fi
  [ -z "$_ip" ] && _ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "$_ip"
}

# 1. Preflight
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker isn't installed. Install it first: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the daemon isn't running. Start Docker and re-run." >&2
  exit 1
fi

# 2. Install dir
mkdir -p "$DIR"
cd "$DIR"

# 3 + 4 + 5. First-time config (idempotent: keep an existing .env)
if [ -f .env ]; then
  echo "Found an existing .env in $(pwd) — keeping it and re-launching."
else
  echo "Downloading compose.yml and .env ..."
  curl -fsSL "$RAW/compose.yml" -o compose.yml
  curl -fsSL "$RAW/.env.example" -o .env

  ip="${ALLOWANCE_IP:-}"
  if [ -z "$ip" ]; then
    ip="$(detect_ip)"
    if [ -r /dev/tty ]; then
      printf 'Detected this machine on the LAN as: %s\n' "${ip:-<none found>}"
      printf 'Press Enter to use http://%s:%s, or type a different IP/hostname: ' "${ip:-CHANGE-ME}" "$PORT"
      if read -r answer </dev/tty && [ -n "$answer" ]; then
        ip="$answer"
      fi
    else
      echo "No terminal for input; using detected IP '${ip:-CHANGE-ME}'. Edit .env if that's wrong."
    fi
  fi
  [ -z "$ip" ] && ip="CHANGE-ME"

  origin="http://$ip:$PORT"
  tmp="$(mktemp)"
  sed "s|^ORIGIN=.*|ORIGIN=$origin|" .env > "$tmp" && mv "$tmp" .env
  echo "Set ORIGIN=$origin"
fi

# 6. Launch
echo "Starting the app (first run pulls the image, creates the DB, generates secrets) ..."
docker compose up -d

# 7. Next steps
origin_now="$(grep '^ORIGIN=' .env | cut -d= -f2-)"
cat <<EOF

Done. Open  ${origin_now}  in a browser.
  1. Onboard your family: create your family, add kids with birthdates, set a parent PIN.
  2. To join another household's leaderboard, open Rivals (see SETUP-NEW-HOUSEHOLD.md).

Update later:   cd $DIR && docker compose pull && docker compose up -d
EOF
