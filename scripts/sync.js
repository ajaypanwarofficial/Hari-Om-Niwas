// Hari Om Niwas — calendar hub sync
// Fetches each OTA's iCal feed, parses it, merges into one dataset,
// and writes docs/calendar.json + docs/merged.ics for GitHub Pages to serve.

const https = require('https');
const fs = require('fs');
const path = require('path');

const FEEDS = [
  { name: 'Airbnb', key: 'airbnb', url: process.env.AIRBNB_ICAL_URL },
  { name: 'Booking.com', key: 'booking', url: process.env.BOOKING_ICAL_URL },
  { name: 'MMT / Goibibo', key: 'ingo', url: process.env.INGO_ICAL_URL },
];

const OUT_DIR = path.join(__dirname, '..', 'docs', 'dashboard');

function fetchText(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          return resolve(fetchText(res.headers.location, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

// iCal "unfolds" continuation lines that start with a space or tab.
function unfold(text) {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseDate(value) {
  // Handles YYYYMMDD and YYYYMMDDTHHMMSS(Z)
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: `${y}-${mo}-${d}`, allDay: true };
  return { date: `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? 'Z' : ''}`, allDay: false };
}

function parseICS(text, sourceKey, sourceName) {
  const lines = unfold(text);
  const events = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') {
      cur = {};
    } else if (line === 'END:VEVENT') {
      if (cur && cur.start && cur.end) events.push(cur);
      cur = null;
    } else if (cur) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).split(';')[0];
      const value = line.slice(idx + 1);
      if (key === 'DTSTART') cur.start = parseDate(value);
      else if (key === 'DTEND') cur.end = parseDate(value);
      else if (key === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',');
      else if (key === 'UID') cur.uid = value;
    }
  }
  return events.map((e, i) => ({
    uid: e.uid || `${sourceKey}-${i}`,
    source: sourceKey,
    sourceName,
    summary: e.summary || 'Booked',
    start: e.start.date,
    end: e.end.date,
    allDay: e.start.allDay,
  }));
}

function nightsBetween(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  return Math.max(1, Math.round((end - start) / 86400000));
}

function toICSDate(iso, allDay) {
  if (allDay) return iso.replace(/-/g, '');
  return iso.replace(/[-:]/g, '').replace('.000', '');
}

function buildMergedICS(events) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Hari Om Niwas//Calendar Hub//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Hari Om Niwas — All Platforms',
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.source}-${ev.uid}@hariomniwas.in`);
    lines.push(`DTSTART${ev.allDay ? ';VALUE=DATE' : ''}:${toICSDate(ev.start, ev.allDay)}`);
    lines.push(`DTEND${ev.allDay ? ';VALUE=DATE' : ''}:${toICSDate(ev.end, ev.allDay)}`);
    lines.push(`SUMMARY:Booked — ${ev.sourceName}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function main() {
  const allEvents = [];
  const status = [];

  for (const feed of FEEDS) {
    if (!feed.url) {
      status.push({ name: feed.name, ok: false, error: 'No URL configured (missing secret)' });
      continue;
    }
    try {
      const text = await fetchText(feed.url);
      const events = parseICS(text, feed.key, feed.name);
      allEvents.push(...events);
      status.push({ name: feed.name, ok: true, count: events.length });
    } catch (err) {
      status.push({ name: feed.name, ok: false, error: err.message });
    }
  }

  allEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

  const enriched = allEvents.map((e) => ({
    ...e,
    nights: e.allDay ? nightsBetween(e.start, e.end) : null,
  }));

  fs.mkdirSync(OUT_DIR, { recursive: true });

  fs.writeFileSync(
    path.join(OUT_DIR, 'calendar.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sources: status,
        bookings: enriched,
      },
      null,
      2
    )
  );

  fs.writeFileSync(path.join(OUT_DIR, 'merged.ics'), buildMergedICS(allEvents));

  console.log('Sync complete.');
  console.log(JSON.stringify(status, null, 2));

  // Fail the Action loudly if every single feed failed — that's the "silent failure" we want to avoid.
  if (status.every((s) => !s.ok)) {
    console.error('All feeds failed — check secrets and source URLs.');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseICS, buildMergedICS, unfold, parseDate, nightsBetween };
