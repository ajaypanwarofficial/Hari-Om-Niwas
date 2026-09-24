# Hari Om Niwas: website, booking calendar and guest check-in

This repository runs three things for Hari Om Niwas, a homestay in Jodhpur
that is listed on Airbnb, Booking.com and MakeMyTrip/Goibibo:

| What | Address | Who it's for |
|---|---|---|
| **Homepage** | [hariomniwas.in](https://hariomniwas.in) | Guests |
| **Check-in form** | [hariomniwas.in/checkin](https://hariomniwas.in/checkin) | Guests, on arrival |
| **Calendar dashboard** | [hariomniwas.in/dashboard](https://hariomniwas.in/dashboard) | Us only (needs a PIN) |

It costs nothing to run: GitHub hosts the site and does the syncing, and a free
Cloudflare Worker keeps the syncing on time. There is no server to look after.

---

## The problem this solves

The house is listed on three platforms. If a guest books on Booking.com, Airbnb
and MMT must close those nights too, or someone else can book them. That's a
double booking.

Each platform can publish its bookings as a **calendar link** (an "iCal" link,
ending in `.ics`) and can read other calendar links. This project sits in the
middle: it reads all three platforms' links, merges them, and gives each platform
one link back with everyone else's bookings in it.

```
 Airbnb ─────┐                                   ┌──► feed-for-airbnb.ics  ──► Airbnb
 Booking.com ┼──► sync (every 15 min) ──► merge ─┼──► feed-for-booking.ics ──► Booking.com
 MMT/Goibibo ┘          ▲                        ├──► feed-for-ingo.ics    ──► MMT/Goibibo
                        │                        └──► calendar.json        ──► our dashboard
         blocked-dates.json (dates we close ourselves)
```

Each platform gets a feed that **leaves out its own bookings**, so a platform
never sees its own reservation come back as a block.

---

## How an update travels, and how long it takes

When a guest books on Booking.com:

1. **Booking.com updates its calendar link.** It usually takes 15–30 minutes.
   We can't speed this up.
2. **Our sync notices.** A Cloudflare Worker starts the sync every 15 minutes,
   so this takes up to 15 minutes.
3. **The sync saves the new calendar** to this repository. It takes about 15 seconds.
4. **GitHub Pages publishes it.** It takes about a minute. The dashboard and the
   three feeds are now up to date.
5. **Airbnb and MMT read their feed** on their own schedule, which we don't
   control. It's often within an hour.

Our dashboard should show a new booking about **30–45 minutes** after it's made.

**Why Cloudflare is needed:** GitHub can run the sync on a 15-minute schedule
itself, but on the free plan it treats scheduled runs as low priority. In
practice they started 2–5 hours apart, so updates took up to 6 hours. A run
*requested* through GitHub's API starts immediately, so the Cloudflare Worker
makes that request every 15 minutes. GitHub's own schedule stays on as a slow
backup.

---

## Everyday use

### Reading the dashboard

Open [hariomniwas.in/dashboard](https://hariomniwas.in/dashboard) and enter the
PIN. The browser remembers it after that.

- **Coloured tags** on a day mean that night is taken. Pink = Airbnb, dark blue =
  Booking.com, orange = MMT/Goibibo, dark brown = blocked by us.
- **Today** has a terracotta outline around the whole day and a ring around
  the date.
- **Shaded days** are part of a long weekend (3+ days of weekends and public
  holidays in a row). Holiday names appear in small red text.
- **"Upcoming bookings"** lists every stay from today onwards.
- **The line under the title** says when the sync last checked the platforms.
  - `Checked 24 Sept, 3:15 pm` means all is well.
  - `— no check for 2 hours` means the Cloudflare timer has stopped. See
    [Troubleshooting](#troubleshooting).
  - `— last run failure` means the sync itself failed. See Troubleshooting.
- **Red text under the calendar** such as `Booking.com feed failed` means one
  platform's link couldn't be read. That platform's last known bookings are kept,
  so nothing gets unblocked by accident.

### Closing dates yourself (family visit, repairs)

**Don't** close dates on just one platform. The other platforms won't find out.
In particular, Airbnb's link only shares real guest reservations, so dates
closed only on Airbnb are never passed on.

Instead, edit `blocked-dates.json` in this repository (on GitHub, open the
file, click the pencil icon, then **Commit changes**):

```json
[
  { "from": "2026-12-24", "to": "2026-12-26", "note": "Family" }
]
```

- `from` and `to` are the **first and last night** that are closed, both
  included. The example closes the nights of the 24th, 25th and 26th, and a new
  guest can check in on the 27th.
- Add more lines inside the `[ ]` for more date ranges, with a comma between them.
- To reopen dates, delete the line. An empty list is `[]`.
- It takes effect on every platform at the next sync.
- If a line is mistyped, only that line is skipped. The sync log on GitHub says
  which one.

### Guest check-in

`hariomniwas.in/checkin` shows our [Tally](https://tally.so) check-in form.
Answers are collected in Tally, not in this repository. To change the questions,
edit the form in Tally. The page picks up the change by itself.

---

## What's in this repository

```
├── docs/                         Everything published at hariomniwas.in
│   ├── index.html                The homepage
│   ├── images/                   Photos used on the homepage
│   ├── checkin/index.html        The check-in page (shows the Tally form)
│   ├── CNAME                     Tells GitHub Pages our domain name
│   └── dashboard/
│       ├── index.html            The calendar dashboard
│       ├── holidays.json         Rajasthan public holidays (edited by hand)
│       ├── calendar.json         ┐
│       ├── merged.ics            │ Written by the sync. Don't edit by hand;
│       └── feed-for-*.ics        ┘ the next sync overwrites them.
├── scripts/sync.js               The sync: reads, merges and writes the calendars
├── blocked-dates.json            Dates we close ourselves (see above)
├── cloudflare-worker/
│   └── sync-timer.js             Starts the sync every 15 minutes, on time
└── .github/workflows/
    ├── sync-calendar.yml         Runs scripts/sync.js on GitHub's servers
    └── deploy-pages.yml          Not used for now (see below)
```

### How the sync decides what counts as a booking

The platforms' calendar links are messy. Each one also includes the blocks it
copied from the *other* platforms. Passed on unfiltered, those copies would echo
back and forth. `scripts/sync.js` handles this:

- **Airbnb:** only entries labelled "Reserved" are kept. Everything else Airbnb
  lists is a copy or a manual close.
- **Booking.com and MMT:** they label real bookings and copies the same way. An
  entry is dropped as a copy if every one of its nights is already covered by an
  Airbnb reservation or one of our own blocked dates.
- **A platform's link fails to load:** its last known bookings are kept. Dropping
  them would unblock those nights everywhere.
- **Nothing changed:** nothing is saved, so the site isn't rebuilt every 15 minutes.

---

## Setting it up from scratch

You only need this if you're rebuilding everything, e.g. in a new GitHub
account.

1. **Put the files on GitHub** in a public repository. Actions minutes are free
   for public repositories.
2. **Add the platforms' calendar links as secrets.** Repository → Settings →
   Secrets and variables → Actions → New repository secret. Add each one:
   - `AIRBNB_ICAL_URL`: Airbnb → Listing → Availability → Sync calendars → Export
   - `BOOKING_ICAL_URL`: Booking.com extranet → Rates & availability → Sync calendars
   - `INGO_ICAL_URL`: InGo-MMT → Calendar sync / iCal export

   These are secret because anyone with the link can read the booking dates.
3. **Turn on GitHub Pages.** Settings → Pages → Source: **Deploy from a branch**
   → `main` → `/docs`. Keep this setting. See the note on `deploy-pages.yml` below.
4. **Point the domain at GitHub Pages.** In the domain registrar's DNS settings,
   add the A records GitHub lists in its Pages documentation for an apex domain.
   `docs/CNAME` already contains `hariomniwas.in`.
5. **Run the sync once.** Actions tab → "Sync OTA Calendars" → Run workflow.
   After about a minute, `hariomniwas.in/dashboard/feed-for-airbnb.ics` and the
   other feeds should load in a browser.
6. **Give each platform its feed.** In each platform's "import calendar" setting,
   paste its own link:
   - Airbnb: `https://hariomniwas.in/dashboard/feed-for-airbnb.ics`
   - Booking.com: `https://hariomniwas.in/dashboard/feed-for-booking.ics`
   - MMT/Goibibo: `https://hariomniwas.in/dashboard/feed-for-ingo.ics`
7. **Set up the Cloudflare timer**, as described in the next section.

### The Cloudflare timer (sync-timer.js)

Setup takes about 10 minutes, once, on Cloudflare's free plan.

1. **Make a GitHub token** the Worker can use to start the sync. GitHub (your
   profile) → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories** → `Hari-Om-Niwas`
   - Permissions: **Actions → Read and write**. Leave everything else as "No access".
   - Expiry: choose one, and **put a reminder in your calendar** a few days
     before it runs out.
2. **Create the Worker.** Cloudflare dashboard → Workers & Pages → Create →
   Worker. Name it `hon-sync-timer` → Deploy → Edit code. Replace everything
   with the contents of `cloudflare-worker/sync-timer.js`, then Deploy.
3. **Give it the token.** The Worker → Settings → Variables and Secrets → Add →
   Type: *Secret*, Name: `GITHUB_TOKEN`, Value: the token.
4. **Set the timer.** The Worker → Settings → Trigger Events → Add → Cron
   Triggers → `*/15 * * * *`, which means every 15 minutes.

**To check it works:** after 15–20 minutes, GitHub's Actions tab should show
"Sync OTA Calendars" runs marked `workflow_dispatch`, one every 15 minutes.

**When the token expires:** make a new token (step 1) and replace the secret
(step 3). You don't need to change anything else.

### About deploy-pages.yml

`deploy-pages.yml` is an alternative way to publish the site, through GitHub
Actions. It's switched off in practice because Pages is set to "Deploy from a
branch", and it should stay that way. GitHub doesn't let one workflow's commits
start another workflow. If Pages were switched to "GitHub Actions", the sync's
commits would never be published and the dashboard would stop updating. It's
harmless as it is. It runs when someone edits `docs/`, and the branch deploy
publishes the site either way.

---

## Troubleshooting

| What you see | Likely cause | What to do |
|---|---|---|
| Dashboard says `no check for 1 hour` or more | The Cloudflare timer stopped, usually because the token expired | Cloudflare → the Worker → Logs shows the error. Make a new token and replace the `GITHUB_TOKEN` secret. |
| Dashboard says `last run failure` | The sync failed | GitHub → Actions → the latest "Sync OTA Calendars" run → open it to read the error. |
| Red text: `Booking.com feed failed (HTTP 404)` | That platform's link changed or was reset | Copy the new export link from the platform and update the matching secret. |
| Red text: `No URL configured (missing secret)` | A secret is missing or misspelled | Check the secret names match exactly (step 2 of setup). |
| A booking shows on a platform but not on the dashboard | The platform hasn't updated its link yet, or it's within the 15-minute window | Wait 30–45 minutes. To check right away: Actions → "Sync OTA Calendars" → Run workflow. |
| A change to a page doesn't show | Browser cache | Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows). On a phone, close and reopen the tab. |

---

## Things to know

- **The dashboard PIN is a curtain, not a lock.** It's set by the `PIN` line
  near the top of the script in `docs/dashboard/index.html`. Since the repository
  is public, anyone who looks at the code can find it, and the files behind the
  dashboard (`calendar.json`, the feeds) can be opened directly by anyone who
  knows the address. They contain only dates and platform names, no guest
  details. If that ever matters, the fix is a Cloudflare Worker that checks a
  login before serving the dashboard.
- **Holidays are entered by hand** in `docs/dashboard/holidays.json`. 2026 is
  confirmed. 2027 is marked provisional until Rajasthan publishes its official
  list, usually in December. Festivals that follow the moon (Eid and some
  others) can shift by a day.
- **Changing homepage photos:** put the new images in `docs/images/` and update
  the matching `<img>` lines in `docs/index.html`.
- **The homepage door animation** plays once when the page opens and is skipped
  for visitors who have "reduce motion" turned on. To remove it, delete the
  `#door-scene` block and its script in `docs/index.html`.
