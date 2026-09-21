# Hari Om Niwas — Calendar Hub

Pulls the Airbnb, Booking.com, and MMT/Goibibo (InGo) calendars every 15
minutes, merges them, and publishes:

- `docs/calendar.json` — data for the dashboard
- `docs/merged.ics` — one combined feed to import back into every platform
- `docs/index.html` — the branded dashboard you actually look at

## Setup (one time)

1. **Create a new GitHub repository** (public is fine and free — private repos
   also get free Actions minutes, so either works). Name it anything, e.g.
   `hon-calendar-hub`.

2. **Push these files into it** — the whole folder as-is.

3. **Add your three calendar links as secrets**, not in any file:
   Repo → Settings → Secrets and variables → Actions → New repository secret.
   Create exactly these three:
   - `AIRBNB_ICAL_URL`
   - `BOOKING_ICAL_URL`
   - `INGO_ICAL_URL`

   Paste each platform's export link as the value. **Never commit these links
   directly into a file** — treat them like passwords, since anyone with the
   link can read your booking calendar.

4. **Turn on GitHub Pages**: repo → Settings → Pages → Source: "Deploy from a
   branch" → Branch: `main`, folder: `/docs` → Save.

5. **Edit `docs/index.html`**: find the line
   `const ACTIONS_URL = 'https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO_NAME/...'`
   and put in your actual GitHub username and repo name, so the "Refresh now"
   button points at the right place. Commit that change.

6. **Run it once by hand**: repo → Actions tab → "Sync OTA Calendars" →
   "Run workflow" → Run workflow. Wait about a minute, then refresh.

7. **Your links, once live (via GitHub's own subdomain, before your custom
   domain is pointed at it):**
   - Dashboard: `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/dashboard/`
   - Master feed to import into Airbnb / Booking.com / InGo:
     `https://YOUR_GITHUB_USERNAME.github.io/YOUR_REPO_NAME/dashboard/merged.ics`

## Connecting hariomniwas.in (do this whenever you're ready)

This repo is already structured for your real domain: everything lives under
`docs/`, and `docs/CNAME` is pre-filled with `hariomniwas.in`. Once you point
your domain here, the same dashboard becomes `hariomniwas.in/dashboard`.

1. At wherever hariomniwas.in is registered, add these DNS records (GitHub's
   current required values — worth double-checking against GitHub's own Pages
   custom-domain docs in case they've changed):
   - Four `A` records for the apex domain pointing to GitHub Pages' IPs
   - Or a `CNAME` record if you're using a subdomain like `www`
2. In the repo: Settings → Pages → confirm the custom domain shows
   `hariomniwas.in` and enable "Enforce HTTPS" once it's available.
3. **Don't do this until you actually want hariomniwas.in live** — until you
   build a real homepage at `docs/index.html`, visiting the bare domain will
   404. `docs/dashboard/` and any future `docs/checkin/` will still work fine
   at their own paths regardless.

## Adding more tools later, same repo

Anything else you build — the check-in form embed, the eventual marketing
site — just needs its own folder under `docs/`:
- `docs/checkin/index.html` → `hariomniwas.in/checkin`
- `docs/index.html` (root) → `hariomniwas.in` itself

For the check-in form specifically, since it already lives on Tally, the
`/checkin` page can just be a one-file HTML wrapper with the live form in an
iframe — no need to move the form itself anywhere.

## "Refresh now"

The dashboard's refresh button opens your repo's Actions page on GitHub,
where clicking **Run workflow** triggers an immediate sync. A truly
one-click refresh from the dashboard itself would need a server holding a
GitHub token — which breaks the "free, no server" requirement — so this is
the honest trade-off: one extra click, on a page you're already logged into.

## If a feed ever fails

The dashboard shows which platform's feed failed, in plain text, instead of
silently going stale. If every feed fails at once, the GitHub Action itself
fails too (visible as a red X in the Actions tab and, if you enable it,
GitHub's own failure emails) — so this doesn't fail silently the way an
unmonitored script could.
