#!/bin/bash
# Sync-Audio deployment script for Ubuntu VPS
# Run as root: bash deploy.sh

set -e

echo "=== Installing system dependencies ==="
apt update -y
apt install -y nodejs npm mysql-server ffmpeg graphicsmagick git

echo "=== Installing Node 18 ==="
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

echo "=== Setting up MySQL ==="
systemctl start mysql
systemctl enable mysql
mysql -e "CREATE DATABASE IF NOT EXISTS sync_audio;"
mysql -e "CREATE USER IF NOT EXISTS 'syncaudio'@'localhost' IDENTIFIED BY 'changeme123';"
mysql -e "GRANT ALL PRIVILEGES ON sync_audio.* TO 'syncaudio'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

echo "=== Importing database (if dump exists) ==="
if [ -f sync_audio_dump.sql ]; then
  mysql sync_audio < sync_audio_dump.sql
  echo "Database imported."
else
  echo "No dump file found — import manually: mysql sync_audio < your_dump.sql"
fi

echo "=== Installing PM2 (process manager) ==="
npm install -g pm2

echo "=== Installing app dependencies ==="
npm install --production

echo "=== Creating .env for production ==="
cat > .env << 'EOF'
PORT=8081
DB_HOST=127.0.0.1
DB_USER=syncaudio
DB_PASSWORD=changeme123
DB_DATABASE=sync_audio
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=YOUR_PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_PAYPAL_CLIENT_SECRET
PAYPAL_RETURN_URL=http://YOUR_SERVER_IP:8081/account/
BASE_URL=http://YOUR_SERVER_IP:8081
MAILGUN_API_KEY=YOUR_MAILGUN_KEY
EOF
echo "Edit .env with your real values before starting!"

echo "=== Opening firewall port 8081 ==="
ufw allow 8081/tcp || true

echo "=== Starting app with PM2 ==="
pm2 start index.js --name sync-audio
pm2 save
pm2 startup

echo ""
echo "=== DONE ==="
echo "App is running at http://$(curl -s ifconfig.me):8081"
echo ""
echo "IMPORTANT - before testing:"
echo "1. Edit .env with your real PayPal/Mailgun keys"
echo "2. Revert paypal_login.js DEV bypass"
echo "3. Change FFmpeg path in admin.js to just: ffmpeg"
echo "4. Import your database: mysql sync_audio < your_dump.sql"
echo ""
echo "Useful commands:"
echo "  pm2 logs sync-audio    # view logs"
echo "  pm2 restart sync-audio # restart app"
echo "  pm2 stop sync-audio    # stop app"
