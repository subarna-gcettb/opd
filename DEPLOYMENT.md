# DEPLOYMENT.md

Target: a Linux server (Ubuntu/Debian assumed below) running Node.js and MySQL, behind Nginx as a TLS-terminating reverse proxy.

## 1. Server prerequisites

```bash
# Node.js 18+ (via nvm or your distro's package manager)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt-get install -y nodejs

# MySQL 8
sudo apt-get install -y mysql-server

# PM2 (process manager)
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx
```

## 2. Deploy the code

```bash
git clone <your-repo> /var/www/hms
cd /var/www/hms
npm install --omit=dev
cp .env.example .env
# edit .env with production values — NODE_ENV=production, real secrets, real DB creds
```

`NODE_ENV=production` matters: it turns on `secure` cookies (requires HTTPS) and suppresses stack traces in error responses.

## 3. Database

Create the database and a dedicated app user (least privilege — not root):

```sql
CREATE DATABASE chhayabithi_hms CHARACTER SET utf8mb4;
CREATE USER 'hms_app'@'localhost' IDENTIFIED BY '<strong-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON chhayabithi_hms.* TO 'hms_app'@'localhost';
FLUSH PRIVILEGES;
```

Then apply migrations and seed once:

```bash
node database/migrate.js
node database/seed.js   # only on first deploy — creates the Super Admin
```

For subsequent deploys, only `node database/migrate.js` needs to run (it's idempotent — see PATCHING.md).

## 4. Environment variables

Never commit `.env`. Set real, unique values for `SESSION_SECRET`, `CSRF_SECRET`, `AADHAAR_ENCRYPTION_KEY` (32-byte hex — `openssl rand -hex 32`), and `AADHAAR_HASH_SECRET` in production. Rotating `AADHAAR_ENCRYPTION_KEY` after data has been encrypted with the old key requires a re-encryption migration — do not rotate it casually.

## 5. Process management (PM2)

```bash
pm2 start server.js --name hms-opd
pm2 save
pm2 startup   # prints a command to enable PM2 on boot — run the printed command
```

Useful commands:

```bash
pm2 logs hms-opd
pm2 restart hms-opd     # after a deploy
pm2 reload hms-opd      # zero-downtime reload if running in cluster mode
```

## 6. Nginx reverse proxy + SSL

```nginx
server {
    listen 80;
    server_name hms.chhayabithi.in;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name hms.chhayabithi.in;

    ssl_certificate     /etc/letsencrypt/live/hms.chhayabithi.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hms.chhayabithi.in/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Obtain the certificate with certbot:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hms.chhayabithi.in
```

`app.js` already sets `app.set('trust proxy', 1)`, so `req.ip`/`req.clientIp` resolve correctly behind this proxy, and secure cookies work correctly once traffic is HTTPS end-to-end.

## 7. Log management

PM2 writes logs to `~/.pm2/logs/` by default; rotate them:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
```

Application-level errors are also printed to stdout/stderr (captured by PM2) via `middleware/errorHandler.js` — server-side detail only, never sent to the client in production.

## 8. Database backup

Daily backup via cron:

```bash
# /etc/cron.d/hms-backup
0 2 * * * hms mysqldump -u hms_app -p'<password>' chhayabithi_hms | gzip > /var/backups/hms/hms-$(date +\%F).sql.gz
```

Retain at least 14 days; verify restorability periodically by restoring into a scratch database (see README.md "Backup" section). Store backups off-server (e.g., synced to separate storage) — a backup that lives only on the machine it backs up is not a backup.

## 9. Zero-downtime deploys (basic)

```bash
cd /var/www/hms
git pull
npm install --omit=dev
node database/migrate.js
pm2 reload hms-opd
```

For anything beyond a single app instance, put PM2 in cluster mode (`pm2 start server.js -i max --name hms-opd`) — the app is already stateless with respect to sessions (stored in MySQL, not memory), so this is safe.
