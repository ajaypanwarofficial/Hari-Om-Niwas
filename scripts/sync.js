// Hari Om Niwas — calendar hub sync
//
// Fetches each OTA's iCal feed, merges them, and writes to docs/dashboard/:
//   calendar.json          data for the dashboard
//   merged.ics             every booking from every platform
//   feed-for-airbnb.ics    everything EXCEPT Airbnb's own bookings
//   feed-for-booking.ics   everything EXCEPT Booking.com's own bookings
//   feed-for-ingo.ics      everything EXCEPT MMT/Goibibo's own bookings
//
// Each platform imports its own feed-for-*.ics, so it never re-imports
// its own reservations as blocks.
//
// Safety rules:
//   1. If a feed fails, that platform's last known bookings are kept.
//      Dropping them would unblock those nights on every other platform.
//   2. Files are only rewritten when bookings or feed status change, so the
//      workflow doesn't commit (and rebuild Pages) every 15 minutes.
//   5. Past stays are kept as history. Platforms drop a stay from their feed
//      a day or so after checkout; a stay that disappears after its checkout
//      date is kept in calendar.json. A stay that disappears BEFORE its
//      checkout date was cancelled, so it is dropped and the nights reopen.
//   3. From Airbnb, only "Reserved" entries are used. Airbnb labels every
//      other unavailable date "Airbnb (Not available)", including copies of
//      other platforms' bookings it imported. Passing those on would send
//      bookings back to the platform they came from.
//   4. Booking.com labels everything "CLOSED - Not available", guests and
//      copies alike. Any Booking.com or MMT entry whose nights are all
//      already covered by an Airbnb reservation or a date you blocked is
//      treated as a copy and dropped.
//
// Dates you want blocked everywhere (family, maintenance) go in
// blocked-dates.json at the repo root. See that file for the format.

const https = require('https');
const fs = require('fs');
const path = require('path');

const FEEDS = [
  { name: 'Airbnb', key: 'airbnb', url: process.env.AIRBNB_ICAL_URL, keep: (e) => /^reserved$/i.test((e.summary || '').trim()) },
  { name: 'Booking.com', key: 'booking', url: process.env.BOOKING_ICAL_URL },
  { name: 'MMT / Goibibo', key: 'ingo', url: process.env.INGO_ICAL_URL },
];

const OUT_DIR = path.join(__dirname, '..', 'docs', 'dashboard');
const CAL_PATH = path.join(OUT_DIR, 'calendar.json');
const BLOCKED_PATH = path.join(__dirname, '..', 'blocked-dates.json');
const TRUSTED = new Set(['airbnb', 'manual']);

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nightsOf(ev) {
  const out = [];
  for (let d = ev.start.slice(0, 10); d < ev.end.slice(0, 10); d = addDays(d, 1)) out.push(d);
  return out;
}

// blocked-dates.json: [{ "from": "2026-12-24", "to": "2026-12-26", "kind": "closed", "note": "Family" }]
// "from" and "to" are the first and last NIGHT blocked, both included.
// "kind" is "direct" for a guest who booked with us directly; anything else
// (or nothing) means closed. It only changes the dashboard's label: every
// platform sees the same "Blocked — Hari Om Niwas" either way.
function readManualBlocks() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(BLOCKED_PATH, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.warn('blocked-dates.json could not be read: ' + e.message); return []; }
  if (!Array.isArray(raw)) { console.warn('blocked-dates.json must be a list'); return []; }
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  return raw.flatMap((b, i) => {
    if (!b || !ok.test(b.from) || !ok.test(b.to) || b.to < b.from) {
      console.warn(`blocked-dates.json entry ${i + 1} skipped: needs "from" and "to" as YYYY-MM-DD, with "to" not before "from"`);
      return [];
    }
    const end = addDays(b.to, 1);
    return [{
      uid: `manual-${b.from}-${b.to}`, source: 'manual', sourceName: 'Blocked',
      kind: b.kind === 'direct' ? 'direct' : 'closed',
      summary: b.note || (b.kind === 'direct' ? 'Direct booking' : 'Blocked'), start: b.from, end, allDay: true,
      nights: nightsOf({ start: b.from, end }).length,
    }];
  });
}

function fetchText(url, redirectsLeft = 5) {
  if (url.startsWith('file://')) return Promise.resolve(fs.readFileSync(url.slice(7), 'utf8'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'hariomniwas-calendar-sync' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (!data.includes('BEGIN:VCALENDAR')) return reject(new Error('Response is not an iCal feed'));
        resolve(data);
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('Timed out after 20s')));
    req.on('error', reject);
  });
}

function unfold(text) {
  const out = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseDate(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: `${y}-${mo}-${d}`, allDay: true };
  return { date: `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`, allDay: false };
}

function parseICS(text, sourceKey, sourceName) {
  const events = [];
  let cur = null;
  for (const raw of unfold(text)) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur && cur.start && cur.end) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i === -1) continue;
      const key = line.slice(0, i).split(';')[0];
      const val = line.slice(i + 1);
      if (key === 'DTSTART') cur.start = parseDate(val);
      else if (key === 'DTEND') cur.end = parseDate(val);
      else if (key === 'SUMMARY') cur.summary = val.replace(/\\,/g, ',');
      else if (key === 'UID') cur.uid = val;
    }
  }
  return events
    .filter((e) => e.start && e.end)
    .map((e, i) => ({
      uid: e.uid || `${sourceKey}-${e.start.date}-${i}`,
      source: sourceKey,
      sourceName,
      summary: e.summary || 'Booked',
      start: e.start.date,
      end: e.end.date,
      allDay: e.start.allDay,
      nights: e.start.allDay ? Math.max(1, Math.round((new Date(e.end.date) - new Date(e.start.date)) / 86400000)) : null,
    }));
}

function toICSDate(iso, allDay) {
  return allDay ? iso.replace(/-/g, '') : iso.replace(/[-:]/g, '');
}

function buildICS(events, calName) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hari Om Niwas//Calendar Hub//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${calName}`];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.source}-${ev.uid}@hariomniwas.in`);
    lines.push(`DTSTART${ev.allDay ? ';VALUE=DATE' : ''}:${toICSDate(ev.start, ev.allDay)}`);
    lines.push(`DTEND${ev.allDay ? ';VALUE=DATE' : ''}:${toICSDate(ev.end, ev.allDay)}`);
    lines.push(`SUMMARY:${ev.source === 'manual' ? 'Blocked — Hari Om Niwas' : 'Blocked — ' + ev.sourceName}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function readPrevious() {
  try { return JSON.parse(fs.readFileSync(CAL_PATH, 'utf8')); } catch { return null; }
}

async function main() {
  const prev = readPrevious();
  const prevBookings = (prev && Array.isArray(prev.bookings)) ? prev.bookings : [];
  const all = [];
  const status = [];

  for (const feed of FEEDS) {
    const carried = prevBookings.filter((b) => b.source === feed.key);
    if (!feed.url) {
      all.push(...carried);
      status.push({ name: feed.name, key: feed.key, ok: false, error: 'No URL configured (missing secret)', carriedForward: carried.length });
      continue;
    }
    try {
      const parsed = parseICS(await fetchText(feed.url), feed.key, feed.name);
      const events = feed.keep ? parsed.filter(feed.keep) : parsed;
      all.push(...events);
      const entry = { name: feed.name, key: feed.key, ok: true, count: events.length };
      if (parsed.length !== events.length) entry.ignoredBlocks = parsed.length - events.length;
      status.push(entry);
    } catch (err) {
      // Keep the last known bookings so the other platforms stay blocked.
      all.push(...carried);
      status.push({ name: feed.name, key: feed.key, ok: false, error: err.message, carriedForward: carried.length });
    }
  }

  // Keep finished stays the platforms have stopped listing (rule 5).
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set(all.map((e) => e.source + '|' + e.uid));
  for (const b of prevBookings) {
    if (b.source !== 'manual' && !seen.has(b.source + '|' + b.uid) && b.end.slice(0, 10) <= today) all.push(b);
  }

  const manual = readManualBlocks();
  all.push(...manual);
  status.push({ name: 'Blocked by you', key: 'manual', ok: true, count: manual.length });

  // Drop Booking.com / MMT entries that are only copies of trusted nights.
  const trustedNights = new Set(all.filter((e) => TRUSTED.has(e.source)).flatMap(nightsOf));
  const copies = {};
  for (let i = all.length - 1; i >= 0; i--) {
    const e = all[i];
    if (TRUSTED.has(e.source)) continue;
    const nights = nightsOf(e);
    if (nights.length && nights.every((n) => trustedNights.has(n))) {
      copies[e.source] = (copies[e.source] || 0) + 1;
      all.splice(i, 1);
    }
  }
  for (const st of status) {
    if (copies[st.key]) { st.copiesRemoved = copies[st.key]; if (typeof st.count === 'number') st.count -= copies[st.key]; }
  }

  all.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.source.localeCompare(b.source)));

  const statusForCompare = (s) => (s || []).map(({ key, ok, error }) => ({ key, ok, error: error || null }));
  const unchanged = prev &&
    JSON.stringify(prev.bookings) === JSON.stringify(all) &&
    JSON.stringify(statusForCompare(prev.sources)) === JSON.stringify(statusForCompare(status));

  console.log(JSON.stringify(status, null, 2));

  if (unchanged && FEEDS.every((f) => fs.existsSync(path.join(OUT_DIR, `feed-for-${f.key}.ics`)))) {
    console.log('No change since last sync. Nothing written.');
  } else {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(CAL_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), sources: status, bookings: all }, null, 2) + '\n');
    // The feeds only need nights that can still be booked; history stays in calendar.json.
    const current = all.filter((e) => e.end.slice(0, 10) > today);
    fs.writeFileSync(path.join(OUT_DIR, 'merged.ics'), buildICS(current, 'Hari Om Niwas — All Platforms'));
    for (const f of FEEDS) {
      fs.writeFileSync(
        path.join(OUT_DIR, `feed-for-${f.key}.ics`),
        buildICS(current.filter((e) => e.source !== f.key), `Hari Om Niwas — for ${f.name}`)
      );
    }
    console.log('Bookings or feed status changed. Files written.');
  }

  if (status.every((s) => !s.ok)) {
    console.error('All feeds failed. Check the secrets and source URLs.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { parseICS, buildICS, unfold, parseDate };
