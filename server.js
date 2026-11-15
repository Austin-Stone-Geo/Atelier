// Atelier prototype server: web workspace + remote MCP server (Streamable HTTP) + OAuth 2.1.
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './src/config.js';
import { oauthProvider } from './src/auth.js';
import { buildMcpServer } from './src/mcp.js';
import { apiRouter, consentRouter } from './src/web.js';

const root = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// OAuth 2.1 authorization server: metadata, /authorize, /token, /register (dynamic client registration), /revoke.
const mcpUrl = new URL(config.mcpUrl);
app.use(mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL(config.baseUrl),
  resourceServerUrl: mcpUrl,
  resourceName: 'Atelier',
  scopesSupported: ['atelier'],
}));

// Some clients look for resource metadata at the root path too.
app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({
  resource: mcpUrl.href, authorization_servers: [new URL(config.baseUrl).href], scopes_supported: ['atelier'], resource_name: 'Atelier',
}));

// Remote MCP endpoint. Stateless: a fresh server + transport per request, auth from the bearer token.
const bearer = requireBearerAuth({ verifier: oauthProvider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) });
app.post('/mcp', bearer, express.json({ limit: '4mb' }), async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close(); server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('MCP error', e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
const notAllowed = (_req, res) => res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
app.get('/mcp', bearer, notAllowed);
app.delete('/mcp', bearer, notAllowed);

// Web workspace.
app.use(cookieParser());
app.use(consentRouter());
app.use('/api', apiRouter());
app.use('/vendor/marked.js', express.static(join(root, 'node_modules/marked/lib/marked.umd.js')));
app.use('/vendor/purify.js', express.static(join(root, 'node_modules/dompurify/dist/purify.min.js')));
app.use(express.static(join(root, 'public'), { extensions: ['html'] }));
app.get('/invite/:token', (_req, res) => res.sendFile(join(root, 'public/index.html')));

app.listen(config.port, () => {
  console.log(`Atelier running at ${config.baseUrl}`);
  console.log(`Connector URL for Claude / ChatGPT: ${config.mcpUrl}`);
  if (!config.baseUrl.startsWith('https://')) console.log('Note: AI apps need an HTTPS URL. Set BASE_URL to your tunnel or host (see README).');
});
