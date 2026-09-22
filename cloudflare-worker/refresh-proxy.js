// Hari Om Niwas — refresh proxy
//
// Why this exists: GitHub Actions' "run this workflow now" API needs a
// token, and a static page (GitHub Pages) can't hold a secret safely —
// anything in the page's JS is visible to anyone who opens dev tools.
// This Worker holds the token instead, on Cloudflare's servers, and the
// dashboard calls this Worker's public URL instead of GitHub directly.
//
// Deploy: paste this whole file into a new Cloudflare Worker (Workers &
// Pages -> Create -> "Quick edit"), no local tooling needed. Then add one
// secret: Settings -> Variables -> "Add secret" -> name it GITHUB_TOKEN,
// value = a GitHub fine-grained personal access token scoped to ONLY this
// one repo, with "Actions" permission set to Read and write and nothing
// else. Never give it broader scope than that.

const OWNER = 'ajaypanwarofficial';
const REPO = 'Hari-Om-Niwas';
const WORKFLOW_FILE = 'sync-calendar.yml';
const ALLOWED_ORIGIN = 'https://hariomniwas.in'; // change if testing from the github.io URL

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/refresh') {
      return new Response('Not found', { status: 404, headers: corsHeaders() });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'hon-refresh-proxy',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    if (ghRes.status === 204) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    const text = await ghRes.text();
    return new Response(JSON.stringify({ ok: false, status: ghRes.status, detail: text }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
