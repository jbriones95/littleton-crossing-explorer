const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const voteFile = path.join(root, 'data', 'votes.json');
const port = Number(process.env.PORT) || 8000;
const salt = process.env.VOTE_HASH_SALT || 'change-this-vote-salt-before-production';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.pdf': 'application/pdf' };

function readVotes() {
  try { return JSON.parse(fs.readFileSync(voteFile, 'utf8')); } catch { return []; }
}
function writeVotes(votes) { fs.mkdirSync(path.dirname(voteFile), { recursive: true }); fs.writeFileSync(voteFile, JSON.stringify(votes, null, 2)); }
function hash(value) { return crypto.createHash('sha256').update(`${salt}:${value}`).digest('hex'); }
function identity(request, browserId) {
  const forwarded = request.headers['x-forwarded-for'];
  const ip = (forwarded ? forwarded.split(',')[0] : request.socket.remoteAddress || 'unknown').trim();
  return hash(`${ip}|${String(browserId || '').slice(0, 120)}`);
}
function send(response, status, body, type = 'application/json; charset=utf-8') { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(type.startsWith('application/json') ? JSON.stringify(body) : body); }
function voteSummary(key, voter) {
  const records = readVotes().filter(record => record.key === key);
  return { adequate: records.filter(record => record.vote === 'adequate').length, inadequate: records.filter(record => record.vote === 'inadequate').length, userVote: records.find(record => record.voter === voter)?.vote || null };
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/api/votes') {
    let key = String(url.searchParams.get('key') || '').slice(0, 200);
    if (!key && request.method !== 'POST') return send(response, 400, { error: 'A crossing key is required.' });
    const voter = identity(request, url.searchParams.get('browserId'));
    if (request.method === 'GET') return send(response, 200, voteSummary(key, voter));
    if (request.method === 'POST') {
      let body = '';
      request.on('data', chunk => { body += chunk; if (body.length > 10000) request.destroy(); });
      request.on('end', () => {
        try {
          const input = JSON.parse(body); key = String(input.key || key).slice(0, 200); const vote = input.vote;
          if (!key) return send(response, 400, { error: 'A crossing key is required.' });
          if (!['adequate', 'inadequate'].includes(vote)) return send(response, 400, { error: 'Invalid vote.' });
          const votes = readVotes(); const record = { key, voter: identity(request, input.browserId), vote, updatedAt: new Date().toISOString() };
          const index = votes.findIndex(item => item.key === key && item.voter === record.voter);
          if (index >= 0) votes[index] = record; else votes.push(record);
          writeVotes(votes); send(response, 200, voteSummary(key, record.voter));
        } catch { send(response, 400, { error: 'Invalid request.' }); }
      });
      return;
    }
    return send(response, 405, { error: 'Method not allowed.' });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return send(response, 405, { error: 'Method not allowed.' });
  const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(root, `.${requested}`);
  if ((file !== root && !file.startsWith(`${root}${path.sep}`)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(response, 404, { error: 'Not found.' });
  response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(file).pipe(response);
});

server.listen(port, () => console.log(`Crossing explorer running at http://localhost:${port}`));
