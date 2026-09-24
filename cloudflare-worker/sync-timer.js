// Hari Om Niwas — sync timer
//
// Why this exists: GitHub runs the sync workflow's own 15-minute schedule
// whenever it has spare capacity, which in practice means every 2-5 hours.
// A run started through GitHub's API ("workflow_dispatch") starts at once.
// So this Worker wakes up every 15 minutes on Cloudflare's clock and asks
// GitHub to run the sync now. The workflow's own schedule stays on as a
// backup in case this Worker ever stops.
//
// Deploy (no local tooling needed):
// 1. Cloudflare dashboard -> Workers & Pages -> Create -> Worker -> name it
//    "hon-sync-timer" -> Deploy -> Edit code -> replace everything with this
//    file -> Deploy.
// 2. Settings -> Variables and Secrets -> Add -> type "Secret", name
//    GITHUB_TOKEN, value = a GitHub fine-grained personal access token with
//    access to ONLY the Hari-Om-Niwas repo and ONLY "Actions: Read and write".
// 3. Settings -> Trigger Events -> Add -> Cron Triggers -> "*/15 * * * *".
//
// The Worker has no public URL that does anything: it only acts on its
// cron trigger, so nobody can use it to set off runs.

const OWNER = 'ajaypanwarofficial';
const REPO = 'Hari-Om-Niwas';
const WORKFLOW_FILE = 'sync-calendar.yml';

export default {
  async scheduled(event, env, ctx) {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'hon-sync-timer',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );
    // GitHub answers 204 on success. Anything else is thrown so it shows up
    // as a failed run under the Worker's Logs / Cron Events.
    if (res.status !== 204) {
      throw new Error(`GitHub dispatch failed: ${res.status} ${await res.text()}`);
    }
  },

  async fetch() {
    return new Response('Not found', { status: 404 });
  },
};
