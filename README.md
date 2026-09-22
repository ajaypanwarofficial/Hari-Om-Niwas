# Hari Om Niwas — website, calendar hub, and check-in

## What's in this repo now

- `docs/index.html` — the homepage (`hariomniwas.in`)
- `docs/checkin/index.html` — the check-in form, embedded (`hariomniwas.in/checkin`)
- `docs/dashboard/` — the OTA calendar hub, PIN-protected (`hariomniwas.in/dashboard`)
- `docs/images/` — house photos used on the homepage
- `.github/workflows/sync-calendar.yml` — pulls Airbnb/Booking.com/InGo calendars every 15 min
- `scripts/sync.js` — the fetch/merge script the workflow runs

## Setup, in order

1. **Push everything to GitHub** (see the earlier instructions if you need the upload steps again).
2. **Add the three OTA secrets**: repo → Settings → Secrets and variables → Actions →
   `AIRBNB_ICAL_URL`, `BOOKING_ICAL_URL`, `INGO_ICAL_URL`.
3. **Enable Pages**: Settings → Pages → Deploy from a branch → `main` → `/docs`.
4. **Point hariomniwas.in's DNS** at GitHub Pages (the repo already has `docs/CNAME`
   set to `hariomniwas.in`) — GitHub's Pages docs list the current required A
   records for an apex domain.
5. **Run the sync workflow once by hand**: Actions tab → "Sync OTA Calendars" → Run workflow.

## The dashboard PIN — what it actually protects

The PIN (`012345` — change it by editing the `PIN` constant in
`docs/dashboard/index.html`) hides the page from a casual visitor who
stumbles on the link. **Be clear-eyed about its limits:** `calendar.json` and
`holidays.json` remain plain files at a guessable path — anyone who knows or
guesses the exact URL can fetch them directly, PIN or not, because GitHub
Pages is 100% static and has no way to check a password before serving a
file. This is a deterrent, not a lock. If real access control ever matters —
say, once other people are checking this dashboard — that needs the Cloudflare
Worker to sit in front of the whole page as a reverse proxy, checking a
session cookie before serving anything. Worth doing later if it becomes a
real concern; not built now to keep this simple.

## Holidays

`docs/dashboard/holidays.json` has Rajasthan's 2026 public holidays, sourced
and checked as of September 2026. Two things to keep in mind:
- **Lunar-calendar dates (Eid, some others) are approximate** until confirmed
  closer to the date by moon sighting — this is normal, not a bug in the data.
- **2027 isn't in there yet.** Add it once the Rajasthan government's 2027
  notification is out (usually announced toward the end of the preceding year).

## The homepage door animation

A one-time entrance animation (illustrated arch doors swinging open) plays
once per page load, respecting `prefers-reduced-motion` for anyone who has
that turned on. Worth knowing: this is a bigger flourish than the Hari Om
Niwas brand guide's own rule of "no animation beyond a 150ms fade" — it's
included because it matches specifically what was asked for, but if it ever
feels like it works against the calm, unhurried feeling the rest of the
brand goes for, cutting it back to a plain fade is a one-line change (delete
the `#door-scene` block and its script).

## Replacing photos later

Once the exterior signage/board photos are ready, drop new images into
`docs/images/`, update the `<img>` tags in `docs/index.html`, and this is a
straight swap — nothing else needs to change.


## Blocking dates yourself (family, maintenance)

Don't block dates on one platform only. From Airbnb, the sync passes on
guest reservations only, so a date you close on Airbnb alone won't reach
the other platforms.

Instead, list the dates in `blocked-dates.json` at the repo root. They are
blocked on every platform at the next sync:

```json
[
  { "from": "2026-12-24", "to": "2026-12-26", "note": "Family" }
]
```

`from` and `to` are the first and last **night** blocked, both included.
The example blocks the nights of 24, 25 and 26 December; the 27th is free
for a new check-in. Remove an entry to unblock. A mistyped entry is skipped
and a warning appears in the workflow log; the rest of the sync still runs.
