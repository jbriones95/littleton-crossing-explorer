import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const origin = 'https://littletoncrosswalks.com';

function createDb() {
  const votes = [];
  return {
    votes,
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async all() {
          const [key] = this.values;
          const selected = votes.filter(row => row.crossing_key === key);
          return { results: ['adequate', 'inadequate'].flatMap(vote => {
            const count = selected.filter(row => row.vote === vote).length;
            return count ? [{ vote, count }] : [];
          }) };
        },
        async first() {
          const [key, voter] = this.values;
          return votes.find(row => row.crossing_key === key && row.voter_hash === voter) || null;
        },
        async run() {
          const [crossing_key, voter_hash, vote, updated_at] = this.values;
          const existing = votes.find(row => row.crossing_key === crossing_key && row.voter_hash === voter_hash);
          if (existing) Object.assign(existing, { vote, updated_at });
          else votes.push({ crossing_key, voter_hash, vote, updated_at });
          return { success: true };
        }
      };
    }
  };
}

function env(DB = createDb()) {
  return { DB, VOTE_HASH_SALT: 'test-only-salt' };
}

function request(method, body, { ip = '192.0.2.5', browserId = 'test-browser', requestOrigin = origin } = {}) {
  const url = new URL('https://votes.test/api/votes');
  const headers = { Origin: requestOrigin, 'CF-Connecting-IP': ip };
  if (method === 'GET') {
    url.searchParams.set('key', 'broadway|littleton blvd');
    url.searchParams.set('browserId', browserId);
  } else headers['Content-Type'] = 'application/json';
  return new Request(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('votes can be submitted, updated, and counted per crossing', async () => {
  const bindings = env();
  const first = await worker.fetch(request('GET'), bindings);
  assert.deepEqual(await first.json(), { adequate: 0, inadequate: 0, userVote: null });
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), origin);

  const submitted = await worker.fetch(request('POST', { key: 'broadway|littleton blvd', browserId: 'test-browser', vote: 'adequate' }), bindings);
  assert.deepEqual(await submitted.json(), { adequate: 1, inadequate: 0, userVote: 'adequate' });

  const updated = await worker.fetch(request('POST', { key: 'broadway|littleton blvd', browserId: 'test-browser', vote: 'inadequate' }), bindings);
  assert.deepEqual(await updated.json(), { adequate: 0, inadequate: 1, userVote: 'inadequate' });

  const otherVoter = await worker.fetch(request('POST', { key: 'broadway|littleton blvd', browserId: 'other-browser', vote: 'adequate' }, { ip: '192.0.2.6' }), bindings);
  assert.deepEqual(await otherVoter.json(), { adequate: 1, inadequate: 1, userVote: 'adequate' });
  assert.equal(bindings.DB.votes.length, 2);
  assert.ok(bindings.DB.votes.every(row => !row.voter_hash.includes('192.0.2.')));
});

test('rejects invalid origins, crossing keys, and vote values', async () => {
  const bindings = env();
  assert.equal((await worker.fetch(request('GET', null, { requestOrigin: 'https://attacker.example' }), bindings)).status, 403);
  const badKey = new Request('https://votes.test/api/votes?key=bad%3Ckey', { headers: { Origin: origin } });
  assert.equal((await worker.fetch(badKey, bindings)).status, 400);
  const badVote = await worker.fetch(request('POST', { key: 'broadway|littleton blvd', vote: 'maybe' }), bindings);
  assert.equal(badVote.status, 400);
});

test('supports cross-origin preflight requests', async () => {
  const response = await worker.fetch(new Request('https://votes.test/api/votes', {
    method: 'OPTIONS', headers: { Origin: origin }
  }), env());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});
