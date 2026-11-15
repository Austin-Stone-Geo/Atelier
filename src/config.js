// All settings come from environment variables; defaults work for local development.
const port = Number(process.env.PORT || 3000);
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');

export const config = {
  port,
  // The public HTTPS URL people reach Atelier at. AI apps require HTTPS, so set this
  // to your tunnel or host URL (e.g. https://atelier.example.com) when connecting Claude/ChatGPT.
  baseUrl,
  mcpUrl: `${baseUrl}/mcp`,
  dbPath: process.env.DB_PATH || './data/atelier.db',
  secureCookies: baseUrl.startsWith('https://'),
  // Set TRUST_PROXY=1 when running behind a reverse proxy / tunnel / PaaS load balancer.
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : false,
  // 'open' lets anyone create an account; 'code' requires SIGNUP_CODE (good for a public URL).
  signupCode: process.env.SIGNUP_CODE || '',
  accessTokenTtl: 60 * 60 * 24,          // 24 hours
  refreshTokenTtl: 60 * 60 * 24 * 90,    // 90 days
  sessionTtl: 60 * 60 * 24 * 30,         // 30 days
};
