# Notifications

Podlog can send notifications when episodes finish processing or fail. Two channels are supported: Telegram and email. Configure either or both from the **Notifications** tab of the `/settings` page in the web UI. The older `/notifications` route redirects there.

The Notifications tab holds three sections: **Telegram**, **Email** and **General**. (Settings has four tabs overall — Notifications, Inference, Prompts and Backups — so everything on this page lives under the first one.)

## Telegram Setup

1. **Create a bot:** Open Telegram and search for **@BotFather**. Send `/newbot` and follow the prompts. Copy the **bot token** (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).

2. **Get your chat ID:** Start a chat with your new bot and send it any message. Then visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Find `"chat":{"id":123456789}` in the response — that number is your **Chat ID**. In a private chat it is also your Telegram **user ID**, which you will need below if you want to send the bot commands.

   > Once the bot is enabled for commands (next section), this URL stops returning anything: Telegram hands each update to one consumer, and Podlog becomes that consumer. Use `/whoami` from then on.

3. **Configure in Podlog:** Go to `/settings`, open the **Notifications** tab, find the **Telegram** section, enter your bot token and chat ID, and click **Save**.

4. **Test:** Click **Send test message**. You should receive a message from your bot in Telegram.

## Telegram Bot Commands

Notifications only go one way. You can also let the bot **answer commands**, which turns the chat into a small remote window into Podlog: check the queue from your phone without being on the home network, opening a port, or running a VPN. Podlog reaches Telegram from inside the Docker network by long-polling, so nothing inbound is exposed.

This is the first part of Podlog that answers to someone other than "whoever is on the LAN", so it is **off until you say who may use it**:

1. In `/settings` → **Notifications** → **Telegram**, fill in **Allowed user IDs** with the numeric Telegram user IDs that may talk to the bot, comma-separated. Your own is the Chat ID from step 2 above. Save.
2. Anyone else can find theirs by sending the bot `/whoami` — that is the one command that answers everybody, and it answers with nothing but the sender's own ID.
3. Everyone not on the list gets a one-line refusal, and the refused ID is logged by the `pipeline` container so you can copy it into the list.

Leave the field empty and the bot never reads a message; notifications keep working as before. The same list can be set as `TELEGRAM_ALLOWED_USER_IDS` in `.env`; the UI value wins where both exist. Changes take effect within about half a minute, no restart needed.

| Command | Reply |
|---|---|
| `/ask <question>` | Ask AI from the chat. The bot replies "Thinking…" at once and edits that message as the answer streams in, then appends up to five sources with the episode and timestamp (linked when the LAN address is known). Uses the model and provider configured in Settings → Inference; one question at a time, since one local model serves everyone. A local answer can take a minute or two on CPU |
| `/search <words>` | The top five transcript hits, with podcast, episode, speaker, timestamp and a snippet. Same syntax as the [search page](04-search.md): `"exact phrase"`, `-exclude`, `OR`, `speaker:Name`. Add `p2`, `p3`… for the next page. Each hit links to the episode at that moment; the link uses the LAN address `make up` detected, so it opens only on the home network |
| `/transcript <episode>` | Sends the episode's transcript as a file, the same export as the episode page's Export button. `<episode>` is an episode id or a few words from the title; when several titles match you get a numbered list and reply `/transcript 2`. Add `md` for Markdown instead of plain text |
| `/queue` | What the pipeline is doing: counts per state, the episode being processed and its stage, the next few pending, the latest failures |
| `/whoami` | Your numeric Telegram user ID (works for everyone) |
| `/help`, `/start` | The command list |

Every command is read-only. Nothing you can send the bot changes a feed, an episode, a setting or a backup. Read the [Security model](01-installation.md#security-model) for what putting someone on the list means.

The bot's log lines are prefixed `telegram_bot_` in `docker compose logs pipeline`. `telegram_bot_conflict` means something else is calling `getUpdates` with the same token — usually a second Podlog install, or the manual `getUpdates` URL from setup still open in a browser tab.

## Email Setup

Email notifications require an SMTP server that the Podlog containers can reach. Three common approaches:

### Option A: Local Postfix (Linux)

The simplest option if you're running Podlog on a Linux machine.

1. **Install Postfix:**
   ```bash
   sudo apt install postfix
   ```
   During setup, choose **"Internet Site"** to send directly to recipients.

2. **Allow Docker containers to relay through Postfix:**
   ```bash
   sudo postconf -e 'mynetworks = 127.0.0.0/8 [::ffff:127.0.0.0]/104 [::1]/128 172.16.0.0/12'
   sudo systemctl reload postfix
   ```
   This adds the Docker bridge network to Postfix's trusted networks.

3. **Configure in Podlog:** Go to `/settings` → **Notifications** → the **Email** section. The default SMTP settings (`host.docker.internal` port `25`, no TLS) work with local Postfix. Just enter your recipient email address and click **Save**.

4. **Test:** Click **Send test email**.

> **Deliverability note:** Emails sent directly from a home machine (no SPF/DKIM, residential IP) often land in spam at Gmail, Outlook, ProtonMail, etc. This is fine for self-notifications, but check your spam folder. For better deliverability, use an external SMTP provider (Option B).

### Option B: External SMTP (Gmail, Fastmail, etc.)

Use an existing email provider's SMTP server for reliable delivery.

1. **Gmail example:**
   - Enable 2-Factor Authentication on your Google account
   - Go to Google Account > Security > App passwords, create one for "Mail"
   - In Podlog `/settings` → Notifications → Email → SMTP Configuration:
     - Host: `smtp.gmail.com`
     - Port: `587`
     - Username: `your.email@gmail.com`
     - Password: the app password you created
     - TLS: enabled

2. **Other providers:** Check your provider's SMTP documentation for host, port, and TLS settings.

### Option C: Docker Mailserver

For a self-contained setup without installing anything on the host, you can run a mail server as another Docker container. [docker-mailserver](https://github.com/docker-mailserver/docker-mailserver) is a popular option. Configuration details are beyond the scope of this guide — refer to their documentation.

## Notification Frequency

Configure how often you receive success notifications (failures are always sent immediately):

| Frequency | Behavior |
|---|---|
| **Immediate** | One notification per completed episode |
| **Daily digest** | Summary of all completed episodes, sent at 8:00 AM UTC |
| **Weekly digest** | Summary sent Monday at 8:00 AM UTC |

Set the frequency in the **General** section of the Notifications tab.

## Health Monitoring

Podlog includes a host-level health check script that monitors all services and sends Telegram alerts when something goes down (or recovers). It runs via cron on the host machine — not inside Docker — so it can detect when Docker services themselves are unhealthy.

### What It Checks

| Check | Method |
|---|---|
| **PostgreSQL** | `pg_isready` |
| **Pipeline API** | HTTP GET `/api/health` |
| **Web app** | HTTP check on port 3000 |
| **Worker** | `docker compose ps` status |
| **Zombie jobs** | DB query for jobs stuck in `picked` status beyond the configured threshold |

### Setup

1. **Install `postgresql-client`** (needed for `pg_isready` and zombie job queries):
   ```bash
   # Ubuntu/Debian
   sudo apt install postgresql-client

   # macOS
   brew install libpq
   ```

2. **Configure Telegram credentials** — the health check uses the same Telegram bot token and chat ID as episode notifications. If `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set in `.env`, those are used. Otherwise, the script falls back to whatever you configured in the web UI.

3. **Install the cron job:**
   ```bash
   make health-install    # Installs cron entry (runs every 15 minutes)
   ```

4. **Verify it works:**
   ```bash
   make health-check      # Run once manually
   ```

### How Alerts Work

The script tracks service state in `~/.podlog-health-state.json` and only sends Telegram messages on **state transitions**:

- **Service goes down:** you get an alert with which service failed and why
- **Service recovers:** you get a recovery message
- **Zombie jobs detected:** you get notified about stuck jobs (even though the system will eventually catch and fail them, you'll know they exist)
- **Steady state:** no repeated alerts (no spam if something stays down between checks)

### Configuration

All health check settings are optional in `.env`:

| Variable | Default | Description |
|---|---|---|
| `HEALTH_CHECK_PIPELINE_URL` | `http://localhost:8000` | Pipeline API URL as seen from the host |
| `HEALTH_CHECK_WEB_URL` | `http://localhost:3000` | Web app URL as seen from the host |
| `HEALTH_CHECK_DB_HOST` | `localhost` | PostgreSQL host for `pg_isready` |
| `HEALTH_CHECK_DB_PORT` | `5432` | PostgreSQL port |
| `HEALTH_CHECK_DB_USER` | `postgres` | PostgreSQL user |
| `HEALTH_CHECK_DB_NAME` | `podlog` | Database name |
| `HEALTH_CHECK_ZOMBIE_THRESHOLD_MINUTES` | `60` | Minutes before a `picked` job is considered a zombie |

### Uninstall

```bash
make health-uninstall    # Removes the cron entry
```

Logs are written to `/tmp/podlog-healthcheck.log`.

## Environment Variables

Notifications can also be configured via `.env` instead of the web UI. Values set in the UI override `.env` values. See [Configuration](10-configuration.md) for the full list.

---

**Next:** [Configuration](10-configuration.md) | **Back:** [Queue Dashboard](08-queue.md) | **Home:** [Guide](README.md)
