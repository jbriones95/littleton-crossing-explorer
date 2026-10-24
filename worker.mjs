const allowedOrigins = new Set([
  'https://littletoncrosswalks.com',
  'https://www.littletoncrosswalks.com',
  'https://jbriones95.github.io',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

function json(body, status, origin = '') {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function validKey(key) {
  return typeof key === 'string' && key.length > 0 && key.length <= 200 && /^[a-z0-9 |._-]+$/.test(key);
}

async function voterHash(request, browserId, salt) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const id = String(browserId || '').slice(0, 120);
  const bytes = new TextEncoder().encode(`${salt}:${ip}|${id}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function voteSummary(db, key, voter) {
  const [counts, current] = await Promise.all([
    db.prepare('SELECT vote, COUNT(*) AS count FROM votes WHERE crossing_key = ? GROUP BY vote').bind(key).all(),
    db.prepare('SELECT vote FROM votes WHERE crossing_key = ? AND voter_hash = ?').bind(key, voter).first()
  ]);
  const result = { adequate: 0, inadequate: 0, userVote: current?.vote || null };
  for (const row of counts.results || []) {
    if (row.vote === 'adequate' || row.vote === 'inadequate') result[row.vote] = Number(row.count) || 0;
  }
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (origin && !allowedOrigins.has(origin)) return json({ error: 'Origin not allowed.' }, 403);
    if (url.pathname !== '/api/votes') return json({ error: 'Not found.' }, 404, origin);

    if (request.method === 'OPTIONS') {
      const headers = new Headers({
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        'Cache-Control': 'no-store'
      });
      if (origin) {
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set('Vary', 'Origin');
      }
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);
    if (!env.DB || !env.VOTE_HASH_SALT) return json({ error: 'Voting service is not configured.' }, 503, origin);

    try {
      let key;
      let vote;
      let browserId;
      if (request.method === 'GET') {
        key = url.searchParams.get('key') || '';
        browserId = url.searchParams.get('browserId') || '';
      } else {
        const length = Number(request.headers.get('Content-Length')) || 0;
        if (length > 4096) return json({ error: 'Request is too large.' }, 413, origin);
        let input;
        try { input = await request.json(); } catch { return json({ error: 'Invalid JSON request.' }, 400, origin); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid request.' }, 400, origin);
        key = String(input.key || '');
        vote = input.vote;
        browserId = input.browserId;
      }
      if (!validKey(key)) return json({ error: 'A valid crossing key is required.' }, 400, origin);
      const voter = await voterHash(request, browserId, env.VOTE_HASH_SALT);

      if (request.method === 'POST') {
        if (vote !== 'adequate' && vote !== 'inadequate') return json({ error: 'Invalid vote.' }, 400, origin);
        await env.DB.prepare(`INSERT INTO votes (crossing_key, voter_hash, vote, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (crossing_key, voter_hash) DO UPDATE SET vote = excluded.vote, updated_at = excluded.updated_at`)
          .bind(key, voter, vote, new Date().toISOString()).run();
      }
      return json(await voteSummary(env.DB, key, voter), 200, origin);
    } catch {
      return json({ error: 'Unable to process vote request.' }, 500, origin);
    }
  }
};
