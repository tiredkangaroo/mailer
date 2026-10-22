# Mailer

A self-hosted mail-merge web app that sends templated emails through the **Gmail API**. Paste a comma-separated list of recipients, write a message with `{{ variables }}`, and Mailer sends a personalized copy to each recipient — while tracking the delivery state of every recipient so nothing is ever sent twice by accident.

## Features

- **Comma-separated recipients** with optional display names: `john@example.com` or `Jane <jane@example.com>`.
- **Templating** with `{{ variable }}` in the subject, body, CC, and BCC (e.g. `Hey {{ name }}!`).
- **CSV import** for custom per-recipient variables (e.g. `email, name, company` → `{{ company }}`).
- **JSON import** — paste or upload a JSON array of objects (`[{"email": "...", "name": "...", ...}]`); unknown keys become template variables.
- **Sender name** — set a friendly "From" display name so outgoing mail shows your name instead of your raw email address.
- **Live preview** and an in-app templating guide while composing.
- **Attachments** uploaded once and attached to every outgoing message.
- **Per-recipient send state** (`not sent`, `sent`, `failed`) stored for every recipient on every email. A recipient that is `sent` is **never** retried automatically.
- **Retry failed recipients only** — a failed email is re-sent without touching already-sent recipients.
- **Immutability**: once anything has been sent, the email becomes read-only (still viewable, but no edits/deletes).
- **"Open in Gmail"** button per sent recipient, linking straight to the sent message (`https://mail.google.com/mail/u/0/#sent/<message id>`).
- **Crash-safe**: progress is written to disk per recipient, so an interrupted send can be resumed with "Retry failed".

## Tech stack

- Node.js (v22+) + Express
- SQLite via the built-in `node:sqlite` module (no native addons)
- Google APIs (`googleapis`) + Nodemailer (MIME composition)
- Vanilla JS frontend (no build step)

## Prerequisites

- Node.js v22 or newer (tested on Node 25).
- A Google account to send from.
- A Google Cloud project with the **Gmail API** enabled and an **OAuth 2.0 client**.

### 1. Create Google Cloud credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable the **Gmail API**: *APIs & Services → Library → search "Gmail API" → Enable*.
4. Configure the OAuth consent screen: *APIs & Services → OAuth consent screen*.
   - Choose **External** (or **Internal** if you use Google Workspace).
   - Fill in the required app name and your email.
   - Add your sending email as a **Test user** (under *Audience → Test users*) if using External testing mode.
5. Create credentials: *APIs & Services → Credentials → Create credentials → OAuth client ID*.
   - Application type: **Web application**.
   - Authorized redirect URI: `http://localhost:3000/auth/google/callback`
6. Copy the **Client ID** and **Client secret**.

> The app requests `gmail.send` (to send), `gmail.settings.basic` (only to update your "Send mail as" display name), and `openid`/`email` (to identify the signed-in account). It only ever sends *as the signed-in account* and never reads your mailbox. Because it's an unverified app, Google may show a warning during sign-in — that's expected for personal/test use.

### 2. Configure the app

```bash
cp .env.example .env
```

Then edit `.env`:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 3. Install and run

```bash
npm install
npm start          # http://localhost:3000
```

For development with auto-reload: `npm run dev`.

Open **http://localhost:3000**, click **Sign in with Google**, and authorize access.

## Usage

### Writing emails

1. Click **New email**.
2. Enter a **subject** and **body**, optionally using `{{ variables }}`.
3. Add **recipients** (comma- or newline-separated). Use `Name <email>` to set a name:
   ```
   john@example.com, Jane Doe <jane@example.com>
   ```
4. Optionally import a **CSV** with a header row to add custom variables. The first column must be `Email`; a `Name` column is optional. Every other column becomes a template variable, with headers normalized to lowercase `snake_case`:
   ```
   Email,Name,Company Name,Plan
   john@example.com,John Doe,Acme Inc,Pro
   jane@example.com,Jane Smith,Globex,Basic
   ```
   This makes `{{ company_name }}` and `{{ plan }}` available in the templating guide and preview.

   Or import (or paste) **JSON** — an array of objects where `email`/`name` are recognized and other keys become variables:
   ```json
   [
     { "email": "john@example.com", "name": "John Doe", "company": "Acme Inc" },
     { "email": "jane@example.com", "name": "Jane Smith", "company": "Globex" }
   ]
   ```
   This makes `{{ company }}` available in the templating guide and preview.
5. Add **attachments** if needed.
6. **Save draft** to keep working, or **Send** to start sending.

### Templating

Variables are written as `{{ name }}`, `{{ email }}`, or any CSV column / JSON key (lowercased, spaces → underscores). The body `Hey {{ name }}!` becomes `Hey John Doe!` for John's copy. The templating guide in the sidebar lists every available variable and updates as you add recipients or import a CSV/JSON.

### Sending & retrying

- **Send** delivers to every recipient whose state is `not sent`.
- If some fail (e.g. a bounced address or a transient API error), the email shows **Partial** and a **Retry N failed** button.
- **Retry failed** re-sends *only* the failed recipients. Recipients already `sent` are never re-sent.
- Once an email is sent (or partially sent), it becomes **immutable** — you can still view it and retry failures, but can't edit or delete it.

### Opening sent mail in Gmail

Every sent recipient has an **Open in Gmail ↗** button that links to the exact sent message in the Gmail web UI.

### Sender name

Set a friendly **From name** in the top bar (next to your signed-in account) and click **Save**. The app:

1. stores the name and uses it in the `From:` header it sends, and
2. updates your account's primary **"Send mail as" display name** via the Gmail API, which is how Gmail decides what name to show.

> Note: because Gmail derives the displayed sender name from your "Send mail as" settings, changing it here also changes the name Gmail shows for mail you send from Gmail itself. Clear the field and save to revert.

## Project layout

```
server/
  index.js          Express app entry
  config.js         Env configuration
  db.js             SQLite schema + data access
  gmail.js          OAuth + Gmail API helpers
  mail.js           Raw MIME composition (Nodemailer)
  recipients.js     Recipient parsing
  template.js       {{ variable }} rendering
  routes/
    auth.js         Google OAuth flow
    emails.js       Email CRUD, attachments, sending
    settings.js     Sender name settings
public/
  index.html, styles.css, app.js   Frontend (no build step)
data/               SQLite database (created on first run)
uploads/            Stored attachments
```

## Notes & limitations

- The `from` address is always the signed-in Google account (the `gmail.send` scope only permits sending as yourself); only the display name is configurable.
- Sending is sequential per recipient; very large lists take longer. Progress is persisted and visible live in the UI.
- This is intended for trusted, single-user local use. If you deploy it beyond `localhost`, set a strong `SESSION_SECRET`, run over HTTPS, and review your OAuth redirect URI.
