# Notifications

Podlog can send notifications when episodes finish processing or fail. Two channels are supported: Telegram and email. Configure either or both from the `/notifications` page in the web UI.

## Telegram Setup

1. **Create a bot:** Open Telegram and search for **@BotFather**. Send `/newbot` and follow the prompts. Copy the **bot token** (looks like `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`).

2. **Get your chat ID:** Start a chat with your new bot and send it any message. Then visit:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Find `"chat":{"id":123456789}` in the response — that number is your **Chat ID**.

3. **Configure in Podlog:** Go to `/notifications`, open the Telegram tab, enter your bot token and chat ID, and click **Save**.

4. **Test:** Click **Send test message**. You should receive a message from your bot in Telegram.

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

3. **Configure in Podlog:** Go to `/notifications`, open the Email tab. The default SMTP settings (`host.docker.internal` port `25`, no TLS) work with local Postfix. Just enter your recipient email address and click **Save**.

4. **Test:** Click **Send test email**.

> **Deliverability note:** Emails sent directly from a home machine (no SPF/DKIM, residential IP) often land in spam at Gmail, Outlook, ProtonMail, etc. This is fine for self-notifications, but check your spam folder. For better deliverability, use an external SMTP provider (Option B).

### Option B: External SMTP (Gmail, Fastmail, etc.)

Use an existing email provider's SMTP server for reliable delivery.

1. **Gmail example:**
   - Enable 2-Factor Authentication on your Google account
   - Go to Google Account > Security > App passwords, create one for "Mail"
   - In Podlog `/notifications` > Email > SMTP Configuration:
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

Set the frequency on the **General** tab in `/notifications`.

## Environment Variables

Notifications can also be configured via `.env` instead of the web UI. Values set in the UI override `.env` values. See [Configuration](10-configuration.md) for the full list.

---

**Next:** [Configuration](10-configuration.md) | **Back:** [Queue Dashboard](08-queue.md) | **Home:** [Guide](README.md)
