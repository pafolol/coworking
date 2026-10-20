#!/usr/bin/env bash
# Deploys the coworking backend at https://api.canilarpit.com/coworking/
# Run with: sudo bash deploy-backend.sh
set -euo pipefail

APP=coworking
DIR=/home/pafo/coworking/coworking/backend
SITE=/etc/nginx/sites-available/larp

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo"; exit 1; }

cat > /etc/systemd/system/$APP.socket <<EOF
[Unit]
Description=Coworking GDL Gunicorn Socket

[Socket]
ListenStream=/run/$APP.sock
SocketUser=pafo
SocketGroup=www-data
SocketMode=0660
RemoveOnStop=true

[Install]
WantedBy=sockets.target
EOF

# One worker only: APScheduler runs inside the app (jobs would repeat per worker) and the DB is SQLite.
cat > /etc/systemd/system/$APP.service <<EOF
[Unit]
Description=Coworking GDL FastAPI
Requires=$APP.socket
After=network.target

[Service]
User=pafo
Group=www-data
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=$DIR/.venv/bin/gunicorn --workers 1 --worker-class uvicorn.workers.UvicornWorker --forwarded-allow-ips=* app.main:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Add the location to the HTTPS server block (the last "}" in the file), once.
if ! grep -q "/run/$APP.sock" "$SITE"; then
    cp "$SITE" "$SITE.bak-$(date +%Y%m%d-%H%M%S)"
    python3 - "$SITE" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
block = """
    # Coworking GDL backend; the /coworking/ prefix is stripped (app routes are /api/...).
    location ^~ /coworking/ {
        proxy_pass http://unix:/run/coworking.sock:/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 25m;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
"""
i = text.rstrip().rfind("}")
open(path, "w").write(text[:i] + block + text[i:])
PY
fi

systemctl daemon-reload
systemctl enable --now $APP.socket
systemctl restart $APP.service

nginx -t
systemctl reload nginx

sleep 3
curl -s -o /dev/null -w "GET /coworking/api/public/info -> %{http_code}\n" https://api.canilarpit.com/coworking/api/public/info
echo "Logs: journalctl -u $APP -f"
