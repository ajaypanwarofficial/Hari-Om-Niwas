// Hari Om Niwas — sync timer and dashboard helper
//
// This Worker does two jobs.
//
// 1. Timer. GitHub runs the sync workflow's own 15-minute schedule whenever
//    it has spare capacity, which in practice means every 2-5 hours. A run
//    started through GitHub's API ("workflow_dispatch") starts at once. So
//    this Worker wakes up every 15 minutes on Cloudflare's clock and asks
//    GitHub to run the sync now. The workflow's own schedule stays on as a
//    backup in case this Worker ever stops.
//
// 2. Dashboard helper. The dashboard is a static page and can't change
//    anything itself. It sends these requests here instead:
//      POST /check    is the PIN right?
//      POST /block    { from, to, kind, note }  adds a line to blocked-dates.json
//      POST /unblock  { from, to }              removes that line
//    Each change is committed to blocked-dates.json on GitHub and the sync
//    is started straight away, so the dashboard shows it in about 2 minutes.
//
//    The PIN lives only in this Worker's secrets, never in the public code.
//    Every request must carry it, and a wrong PIN is answered slowly so it
//    can't be guessed quickly.
//
// Deploy (no local tooling needed):
// 1. Cloudflare dashboard -> Workers & Pages -> hon-sync-timer -> Edit code
//    -> replace everything with this file -> Deploy.
// 2. Settings -> Variables and Secrets. Two secrets are needed:
//      GITHUB_TOKEN   a GitHub fine-grained personal access token with access
//                     to ONLY the Hari-Om-Niwas repo, and two permissions:
//                     "Actions: Read and write" and "Contents: Read and write".
//      DASHBOARD_PIN  the dashboard PIN.
// 3. Settings -> Trigger Events -> Cron Triggers -> "*/15 * * * *".

const OWNER = 'ajaypanwarofficial';
const REPO = 'Hari-Om-Niwas';
const WORKFLOW_FILE = 'sync-calendar.yml';
const BLOCKED_FILE = 'blocked-dates.json';
const ALLOWED_ORIGIN = 'https://hariomniwas.in';
const MAX_NIGHTS = 90;
const MAX_NOTE = 60;

const GITHUB_HEADERS = (env) => ({
  Authorization: `Bearer ${env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'hon-sync-timer',
});

async function startSync(env) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    { method: 'POST', headers: GITHUB_HEADERS(env), body: JSON.stringify({ ref: 'main' }) }
  );
  // GitHub answers 204 on success.
  if (res.status !== 204) throw new Error(`GitHub dispatch failed: ${res.status} ${await res.text()}`);
}

// blocked-dates.json is read and written through GitHub's contents API.
// It's base64 there; the notes can hold any text, so decode as UTF-8.
async function readBlocked(env) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${BLOCKED_FILE}?ref=main`,
    { headers: GITHUB_HEADERS(env) }
  );
  if (res.status === 404) return { list: [], sha: undefined };
  if (!res.ok) throw new Error(`Reading ${BLOCKED_FILE} failed: ${res.status}`);
  const file = await res.json();
  const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
  const list = JSON.parse(new TextDecoder().decode(bytes));
  if (!Array.isArray(list)) throw new Error(`${BLOCKED_FILE} is not a list`);
  return { list, sha: file.sha };
}

async function writeBlocked(env, list, sha, message) {
  // One entry per line, the same layout as the README example, so the file stays easy to edit by hand.
  const text = list.length ? '[\n' + list.map((b) => '  ' + JSON.stringify(b)).join(',\n') + '\n]\n' : '[]\n';
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${BLOCKED_FILE}`, {
    method: 'PUT',
    headers: GITHUB_HEADERS(env),
    body: JSON.stringify({
      message, content: btoa(bin), sha, branch: 'main',
      committer: { name: 'hon-dashboard', email: 'actions@users.noreply.github.com' },
    }),
  });
}

// Read, change, write. If someone else changed the file in between, GitHub
// refuses the write (409), so read again and retry once.
async function changeBlocked(env, change, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { list, sha } = await readBlocked(env);
    const next = change(list);
    if (next === null) return false;
    const res = await writeBlocked(env, next, sha, message);
    if (res.ok) return true;
    if (res.status !== 409 && res.status !== 422) throw new Error(`Saving ${BLOCKED_FILE} failed: ${res.status}`);
  }
  throw new Error(`${BLOCKED_FILE} kept changing; try again`);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s) { return typeof s === 'string' && DATE.test(s) && !isNaN(new Date(s + 'T00:00:00Z')); }
function nightsBetween(from, to) { return Math.round((new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000) + 1; }
function todayInIndia() { return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10); }
function short(s) { return new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); }

// Compares the whole string every time, so the answer's timing doesn't hint at how much of the PIN was right.
function samePin(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply(status, body) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-Pin',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  if (request.method !== 'POST' || !['/check', '/block', '/unblock'].includes(url.pathname)) {
    return new Response('Not found', { status: 404 });
  }

  if (!samePin(request.headers.get('X-Pin'), env.DASHBOARD_PIN)) {
    await new Promise((r) => setTimeout(r, 2000));
    return reply(401, { error: 'Wrong code.' });
  }
  if (url.pathname === '/check') return reply(204);

  let body;
  try { body = await request.json(); } catch { return reply(400, { error: 'Bad request.' }); }
  const { from, to } = body || {};
  if (!validDate(from) || !validDate(to) || to < from) return reply(400, { error: 'Check the dates: the last night can\'t be before the first.' });

  if (url.pathname === '/block') {
    if (to < todayInIndia()) return reply(400, { error: 'Those nights are already in the past.' });
    if (nightsBetween(from, to) > MAX_NIGHTS) return reply(400, { error: `That's more than ${MAX_NIGHTS} nights. Block it in smaller parts.` });
    const kind = body.kind === 'direct' ? 'direct' : 'closed';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
    const entry = { from, to, kind };
    if (note) entry.note = note;
    const label = kind === 'direct' ? 'direct booking' : 'closed';
    await changeBlocked(env,
      (list) => (list.some((b) => b && b.from === from && b.to === to) ? null : [...list, entry].sort((a, b) => (a.from < b.from ? -1 : 1))),
      `Block ${short(from)}–${short(to)} (${label}) from dashboard`);
  } else {
    const removed = await changeBlocked(env,
      (list) => { const next = list.filter((b) => !(b && b.from === from && b.to === to)); return next.length === list.length ? null : next; },
      `Unblock ${short(from)}–${short(to)} from dashboard`);
    if (!removed) return reply(404, { error: 'That block is already gone. Refresh the page.' });
  }
  await startSync(env);
  return reply(200, { ok: true });
}

export default {
  async scheduled(event, env, ctx) {
    // Anything but success is thrown so it shows up as a failed run under the Worker's Logs / Cron Events.
    await startSync(env);
  },

  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return reply(500, { error: 'Could not save. Try again in a minute.' });
    }
  },
};
