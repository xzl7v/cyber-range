import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLabsModule } from '../labs-module/server/labs.js';

const moduleDirectory = resolve(dirname(fileURLToPath(import.meta.url)));
const projectRoot = resolve(moduleDirectory, '..');
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.CYBER_RANGE_SESSION_SECRET;
const demoUsername = process.env.DEMO_USERNAME;
const demoPassword = process.env.DEMO_PASSWORD;
const demoDisplayName = process.env.DEMO_DISPLAY_NAME || 'Demo User';
const runtimeUrl = process.env.CYBER_RANGE_RUNTIME_URL || 'http://runtime-manager:3001';
const labsDatabase = process.env.LABS_DATABASE || join(projectRoot, 'labs-module', '.data', 'labs.sqlite');
const dist = join(projectRoot, 'labs-module', 'dist');

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
if (!sessionSecret || sessionSecret.length < 24) throw new Error('CYBER_RANGE_SESSION_SECRET is required and must contain at least 24 characters.');
if (!demoUsername || !demoPassword) throw new Error('DEMO_USERNAME and DEMO_PASSWORD are required. See .env.example.');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Build the Labs module frontend before starting the gateway.');

const demoUserId = 'demo-user';
const availableRoles = ['student', 'instructor'];

const seedLabs = [
  {
    name: 'Hydra SSH Training Lab',
    slug: 'hydra',
    description: 'Practice password-cracking methodology against an intentionally vulnerable, isolated SSH training target.',
    difficulty: 'Easy',
    estimatedDuration: 30,
    category: 'Password security',
    requiredTools: ['Kali Linux', 'Hydra', 'SSH'],
    learningObjectives: ['Identify an SSH service on an isolated target.', 'Run Hydra only against the authorized training target.', 'Submit the discovered training credentials.'],
    instructions: 'Start the lab to open your isolated Kali desktop. From the Kali terminal, identify the target named target, then use Hydra against its SSH service. The training user is trainee. Submit the discovered password below.',
    enabled: true,
    published: true,
    tasks: [
      {
        title: 'Discover the SSH password',
        description: 'Use Hydra from your Kali desktop against the isolated SSH target. Submit the discovered password.',
        score: 100,
        hints: ['The target hostname is target.', 'The target user is trainee.', 'Hydra supports the ssh protocol.'],
        validationType: 'answer',
        expectedAnswer: 'Lab12345',
        completionRequirements: 'Submit the discovered password.',
        caseSensitive: true,
      },
    ],
  },
];

const cookieName = 'cyber_range_session';
const tokenVersion = '1';
const maxAgeSeconds = 8 * 60 * 60;

function sign(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}
function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function encodeToken(role) {
  const payload = {
    v: tokenVersion,
    userId: demoUserId,
    username: demoUsername,
    role,
    displayName: demoDisplayName,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}
function decodeToken(token) {
  if (typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || !safeEqual(sign(body), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.v !== tokenVersion || payload.userId !== demoUserId || payload.username !== demoUsername || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
function cookieValue(request) {
  const header = request.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName) return decodeURIComponent(rest.join('='));
  }
  return null;
}
function userFromRequest(request) {
  const payload = decodeToken(cookieValue(request));
  if (!payload) return null;
  return {
    id: demoUserId,
    username: demoUsername,
    role: payload.role || null,
    displayName: demoDisplayName,
    availableRoles,
  };
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((request, response, next) => {
  request.user = userFromRequest(request);
  response.set('X-Content-Type-Options', 'nosniff');
  next();
});

const labs = createLabsModule({
  databasePath: labsDatabase,
  resolveUser: (request) => request.user?.role ? request.user : null,
  seedLabs,
  runtime: {
    startSession: async ({ attemptId, labId, studentId, lab }) => {
      const response = await fetch(`${runtimeUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Runtime-User-Id': studentId,
          'X-Runtime-User-Role': 'student',
        },
        body: JSON.stringify({ attemptId, labId, studentId, labSlug: lab?.slug, labName: lab?.name }),
        signal: AbortSignal.timeout(600000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error?.message || data.message || 'Unable to start the lab environment.');
        error.code = data.error?.code || 'SESSION_START_FAILED';
        throw error;
      }
      return data.session;
    },
  },
});

app.get('/login', (request, response) => {
  if (request.user) return response.redirect('/app');
  response.sendFile(join(moduleDirectory, 'public', 'login.html'));
});
app.post('/login', (request, response) => {
  const username = String(request.body?.username || '').trim();
  const password = String(request.body?.password || '');
  if (username !== demoUsername || password !== demoPassword) {
    return response.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'The username or password is incorrect.' } });
  }
  const token = encodeToken(null);
  response.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
  response.json({ user: { id: demoUserId, username: demoUsername, role: null, displayName: demoDisplayName, availableRoles } });
});
app.post('/logout', (request, response) => {
  response.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  response.json({ loggedOut: true });
});
app.post('/api/session/role', (request, response) => {
  if (!request.user) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
  const role = String(request.body?.role || '');
  if (!availableRoles.includes(role)) return response.status(400).json({ error: { code: 'INVALID_ROLE', message: 'Choose student or instructor.' } });
  const token = encodeToken(role);
  response.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
  response.set('Cache-Control', 'no-store').json({ user: { id: demoUserId, username: demoUsername, role, displayName: demoDisplayName, availableRoles } });
});
app.get('/api/me', (request, response) => {
  if (!request.user) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
  response.set('Cache-Control', 'no-store').json({ user: request.user });
});

app.use('/api/labs-module', labs.router);

app.use('/api/runtime', async (request, response) => {
  if (!request.user) return response.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Sign in to continue.' } });
  if (request.user.role !== 'student') return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Select the student workspace before using the runtime.' } });
  
  response.set('Cache-Control', 'no-store');
  
  try {
    const targetUrl = `http://runtime-manager:3001${request.originalUrl.replace('/api/runtime', '')}`;
    const proxyResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Runtime-User-Id': request.user.id,
      },
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : JSON.stringify(request.body),
    });
    
    const text = await proxyResponse.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: { code: 'INVALID_JSON', message: text || 'Unreadable response from runtime.' } };
    }
    
    response.status(proxyResponse.status).json(data);
  } catch (error) {
    response.status(502).json({ error: { code: 'RUNTIME_UNREACHABLE', message: 'Unable to reach the runtime manager.' } });
  }
});

app.get('/', (request, response) => response.redirect(request.user ? '/app' : '/login'));
app.get('/app', (request, response) => {
  if (!request.user) return response.redirect('/login');
  response.sendFile(join(dist, 'index.html'));
});
app.get('/app/{*path}', (request, response) => {
  if (!request.user) return response.redirect('/login');
  response.sendFile(join(dist, 'index.html'));
});
app.use('/assets', express.static(join(dist, 'assets')));
app.use('/favicon.svg', express.static(join(dist, 'favicon.svg')));

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
    return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Send valid JSON smaller than 1 MB.' } });
  }
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The gateway could not complete the request.' } });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Cyber Range gateway listening on http://0.0.0.0:${port}`);
});

let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  server.close(() => {
    labs.close();
    process.exit(0);
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
