// Accounts, web sessions, and the OAuth 2.1 authorization server used by AI connectors.
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { one, all, run, id, secret, sha256, now } from './db.js';
import { config } from './config.js';
import { AppError } from './core.js';
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

// ---------- Accounts ----------

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = stored.split(':');
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return timingSafeEqual(a, Buffer.from(hash, 'hex'));
}

export function signUp({ email, name, password, signupCode }) {
  email = (email || '').trim().toLowerCase();
  name = (name || '').trim();
  if (config.signupCode && signupCode !== config.signupCode) throw new AppError(403, 'That sign-up code is not right. Ask the person who invited you.');
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new AppError(400, 'Enter a valid email address.');
  if (!name) throw new AppError(400, 'Enter your name.');
  if (!password || password.length < 8) throw new AppError(400, 'Use a password of at least 8 characters.');
  if (one('SELECT 1 FROM users WHERE email = ?', email)) throw new AppError(409, 'An account with that email already exists. Sign in instead.');
  const uid = id('u');
  run('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)', uid, email, name, hashPassword(password), now());
  return publicUser(uid);
}

export function logIn({ email, password }) {
  const u = one('SELECT * FROM users WHERE email = ?', (email || '').trim().toLowerCase());
  if (!u || !checkPassword(password || '', u.password_hash)) throw new AppError(401, 'Email or password is incorrect.');
  return publicUser(u.id);
}

export const publicUser = (uid) => one('SELECT id, email, name, created_at FROM users WHERE id = ?', uid);

export function createSession(userId) {
  const token = secret();
  run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, Date.now() + config.sessionTtl * 1000);
  return token;
}
export function sessionUser(token) {
  if (!token) return null;
  const s = one('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
  if (!s || s.expires_at < Date.now()) return null;
  return publicUser(s.user_id);
}
export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

// ---------- Which AI is this? ----------
// Attribution label for a connector, guessed from the client name sent at registration.
// The person confirms or edits it on the consent screen (e.g. "Qwen3 via LibreChat").
export function guessAiLabel(clientName = '') {
  const n = clientName.toLowerCase();
  if (n.includes('claude') || n.includes('anthropic')) return 'Claude';
  if (n.includes('chatgpt') || n.includes('openai')) return 'ChatGPT';
  if (n.includes('librechat')) return 'LibreChat';
  if (n.includes('open webui') || n.includes('openwebui')) return 'Open WebUI';
  if (n.includes('lm studio') || n.includes('lmstudio')) return 'LM Studio';
  return clientName.trim().slice(0, 40) || 'AI assistant';
}

// ---------- OAuth provider (plugs into the MCP SDK's auth router) ----------

const clientsStore = {
  getClient(clientId) {
    const row = one('SELECT data FROM oauth_clients WHERE client_id = ?', clientId);
    return row ? JSON.parse(row.data) : undefined;
  },
  registerClient(client) {
    const full = { ...client, client_id: id('cl', 12), client_id_issued_at: Math.floor(Date.now() / 1000) };
    run('INSERT INTO oauth_clients (client_id, data, created_at) VALUES (?,?,?)', full.client_id, JSON.stringify(full), now());
    return full;
  },
};

function issueTokens(clientId, userId, aiLabel, scopes, resource) {
  const access = secret(), refresh = secret();
  const t = Date.now();
  run(`INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, ai_label, scopes, resource, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    sha256(access), 'access', clientId, userId, aiLabel, scopes, resource, t + config.accessTokenTtl * 1000, now());
  run(`INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, ai_label, scopes, resource, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    sha256(refresh), 'refresh', clientId, userId, aiLabel, scopes, resource, t + config.refreshTokenTtl * 1000, now());
  return {
    access_token: access, token_type: 'bearer', expires_in: config.accessTokenTtl,
    refresh_token: refresh, scope: scopes || undefined,
  };
}

export const oauthProvider = {
  clientsStore,

  // Called after the SDK validates client_id / redirect_uri / PKCE params.
  // We park the request and send the browser to our sign-in + consent page.
  async authorize(client, params, res) {
    const reqId = id('oar', 12);
    run('INSERT INTO oauth_requests (id, client_id, params, csrf, expires_at) VALUES (?,?,?,?,?)', reqId, client.client_id,
      JSON.stringify({ ...params, resource: params.resource?.href }), secret(16), Date.now() + 15 * 60 * 1000);
    res.redirect(`/oauth/consent?req=${encodeURIComponent(reqId)}`);
  },

  async challengeForAuthorizationCode(client, code) {
    const row = one('SELECT * FROM oauth_codes WHERE code_hash = ?', sha256(code));
    if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('Invalid authorization code');
    return row.code_challenge;
  },

  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    const row = one('SELECT * FROM oauth_codes WHERE code_hash = ?', sha256(code));
    run('DELETE FROM oauth_codes WHERE code_hash = ?', sha256(code)); // single use
    if (!row || row.client_id !== client.client_id || row.expires_at < Date.now()) throw new InvalidGrantError('Invalid or expired authorization code');
    if (redirectUri && redirectUri !== row.redirect_uri) throw new InvalidGrantError('redirect_uri does not match');
    return issueTokens(client.client_id, row.user_id, row.ai_label, row.scopes, resource?.href ?? row.resource);
  },

  async exchangeRefreshToken(client, refreshToken, _scopes, resource) {
    const row = one(`SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'`, sha256(refreshToken));
    if (!row || row.client_id !== client.client_id || row.expires_at < Date.now()) throw new InvalidGrantError('Invalid or expired refresh token');
    run('DELETE FROM oauth_tokens WHERE token_hash = ?', sha256(refreshToken)); // rotate
    return issueTokens(client.client_id, row.user_id, row.ai_label, row.scopes, resource?.href ?? row.resource);
  },

  async verifyAccessToken(token) {
    const row = one(`SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'`, sha256(token));
    if (!row || row.expires_at < Date.now()) throw new InvalidTokenError('Invalid or expired token');
    return {
      token, clientId: row.client_id, scopes: row.scopes ? row.scopes.split(' ') : [],
      expiresAt: Math.floor(row.expires_at / 1000),
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { userId: row.user_id, via: row.ai_label },
    };
  },

  async revokeToken(client, { token }) {
    run('DELETE FROM oauth_tokens WHERE token_hash = ? AND client_id = ?', sha256(token), client.client_id);
  },
};

// Used by the consent page.
export function pendingRequest(reqId) {
  const r = one('SELECT * FROM oauth_requests WHERE id = ?', reqId);
  if (!r || r.expires_at < Date.now()) return null;
  return { ...r, params: JSON.parse(r.params), client: clientsStore.getClient(r.client_id) };
}

export function approveRequest(reqId, userId, aiLabel) {
  const r = pendingRequest(reqId);
  if (!r) throw new AppError(400, 'This sign-in request expired. Start the connection again from your AI app.');
  run('DELETE FROM oauth_requests WHERE id = ?', reqId);
  const code = secret();
  run(`INSERT INTO oauth_codes (code_hash, client_id, user_id, ai_label, code_challenge, redirect_uri, scopes, resource, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    sha256(code), r.client_id, userId, aiLabel, r.params.codeChallenge, r.params.redirectUri,
    (r.params.scopes || []).join(' '), r.params.resource || null, Date.now() + 5 * 60 * 1000);
  const url = new URL(r.params.redirectUri);
  url.searchParams.set('code', code);
  if (r.params.state) url.searchParams.set('state', r.params.state);
  return url.href;
}

export function denyRequest(reqId) {
  const r = pendingRequest(reqId);
  if (!r) return null;
  run('DELETE FROM oauth_requests WHERE id = ?', reqId);
  const url = new URL(r.params.redirectUri);
  url.searchParams.set('error', 'access_denied');
  if (r.params.state) url.searchParams.set('state', r.params.state);
  return url.href;
}

// Connected AI apps, for the account page.
export function listConnections(userId) {
  return all(`SELECT client_id, ai_label, MIN(created_at) AS connected_at, MAX(created_at) AS last_refreshed
    FROM oauth_tokens WHERE user_id = ? AND kind = 'refresh' AND expires_at > ? GROUP BY client_id, ai_label ORDER BY connected_at`, userId, Date.now())
    .map((r) => ({ ...r, client_name: clientsStore.getClient(r.client_id)?.client_name || '' }));
}
export function disconnect(userId, clientId) {
  run('DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?', userId, clientId);
}
