# Card Checker Bot - Deployment Guide

## 📋 Files ko VPS par Upload karo

Saari files (`package.json`, `index.js`, `Dockerfile`, `docker-compose.yml`) ko VPS par upload karo.

```bash
# Example using scp
scp -r . ubuntu@your-vps-ip:/home/ubuntu/card-checker/
```

Ya Git use karo ya manually copy karo.

---

## 🐳 VPS par Deploy karo

### Step 1: Folder mein jao
```bash
cd /home/ubuntu/card-checker
```

### Step 2: Docker image build karo
```bash
docker build -t card-checker-bot .
```

### Step 3: Container run karo
```bash
docker run -d \
  --name card-checker-bot \
  --restart unless-stopped \
  -p 3000:3000 \
  -e PORT=3000 \
  -e TELEGRAM_API_ID=24509063 \
  -e TELEGRAM_API_HASH=980c8b2d466c6cf6b5059ae8cf91f5cb \
  -e TELEGRAM_SESSION="1AZWarzcBu8OXk1GN94aPliXNpDX8wR9l8rHeSssDuSyiZhwhYCCUD_Pi7S3I2trGB0D1tnjtGa1k63VKbpSYdYs_E3d75uGZfHfuq9SpqBtIU2yw2MT4HV3w80TM0NHjN1w8BL1Nz81dENxcz-2ib3akxZu-uR8ri0Gi0BNDIQINL8L7TG2ZTssxRWdOLrpel-hPx3buuE-541NAMSfcFdDPLb0hgVRwrWfeWoaz5y9Dgu5cIINgVBffYgT37fFeWeTBHTEOGuAThsftKT8S-EgHiqyYRl6ipqdmEy8Op07ePNzFHr8YZSo9XdyKQ7HwVRMvJMS9TKeoMgyObQ1xPnVBXnRqKSQ=" \
  card-checker-bot
```

**Ya Docker Compose use karo (easy way):**
```bash
docker-compose up -d --build
```

---

## 📱 Bot Kaise Use Karo

### Commands:

1. **Cards Check karo:**
   Apne Telegram "Saved Messages" ya kisi ChatId mein ye bhejo:
   ```
   /check 4019732000862606|02|27|733
   5425233430109903|02|2027|123
   4111111111111111|12|25|999
   ```

2. **Status dekho:**
   ```
   /status
   ```

3. **Stop karo:**
   ```
   /stop
   ```

---

## 🔍 Logs dekho

```bash
docker logs -f card-checker-bot
```

---

## 🛑 Container Stop/Remove karo

```bash
docker stop card-checker-bot
docker rm card-checker-bot
```

---

## ✅ Health Check

Browser mein jao: `http://your-vps-ip:3000/`

Ya:
```bash
curl http://localhost:3000/health
```

---

## ⚠️ Notes

- Bot sirf aapke apne messages sunegi (security ke liye)
- Har card ke beech 5 second ka gap hai (rate limiting se bachne ke liye)
- Sirf **Approved** cards ki notification milegi
- Declined cards silently skip honge
