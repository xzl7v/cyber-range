import express from 'express';
import Docker from 'dockerode';
import httpProxy from 'http-proxy';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = resolve(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 3001);
const dockerSocket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const runtimeContainerId = process.env.RUNTIME_CONTAINER_ID || hostname();
const sessionTtlMs = Number(process.env.CYBER_RANGE_SESSION_TTL_MS || 4 * 60 * 60 * 1000);
const kaliImage = process.env.CYBER_RANGE_KALI_IMAGE || '';
const vncPassword = process.env.CYBER_RANGE_VNC_PASSWORD || randomUUID();
const kasmAuthorization = `Basic ${Buffer.from(`kasm_user:${vncPassword}`).toString('base64')}`;
const definitions = JSON.parse(await readFile(process.env.CYBER_RANGE_LAB_DEFINITIONS || join(moduleDirectory, 'lab-definitions.json'), 'utf8'));

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 60000) throw new Error('CYBER_RANGE_SESSION_TTL_MS must be at least 60000.');

const docker = new Docker({ socketPath: dockerSocket });
const proxy = httpProxy.createProxyServer({ ws: true, secure: false });
const sessions = new Map();
const sessionsByAttempt = new Map();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function fail(status, code, message, fields) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.fields = fields;
  return error;
}
function sessionForRequest(request, sessionId = request.params?.sessionId) {
  if (sessionId) return sessions.get(sessionId) || null;
  const header = request.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'cyber_range_kali_session') return sessions.get(decodeURIComponent(rest.join('='))) || null;
  }
  return null;
}
function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    attemptId: session.attemptId,
    labId: session.labId,
    studentId: session.studentId,
    labSlug: session.labSlug,
    labName: session.labName,
    status: session.status,
    createdAt: session.createdAt,
    targetName: session.targets?.[0]?.name || null,
    kaliUrl: session.kaliUrl,
  };
}
function definitionFor(labSlug) {
  if (labSlug && definitions[labSlug]) return definitions[labSlug];
  if (String(labSlug || '').includes('hydra')) return definitions.hydra;
  if (String(labSlug || '').includes('dvwa')) return definitions.dvwa;
  return definitions.default;
}
function safePart(value) {
  const clean = String(value || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  return clean || randomUUID();
}
function followProgress(stream) {
  return new Promise((resolvePromise, rejectPromise) => {
    docker.modem.followProgress(stream, (error, output) => error ? rejectPromise(error) : resolvePromise(output));
  });
}
async function imageExists(name) {
  try { await docker.getImage(name).inspect(); return true; } catch { return false; }
}
async function ensureImage(name, build) {
  if (await imageExists(name)) return;
  console.log(`Preparing image ${name}${build ? ' from local build context' : ' from registry'}...`);
  if (build) {
    const stream = await docker.buildImage({ context: build.context, src: build.src }, {
      t: name,
      dockerfile: build.dockerfile,
      target: build.target,
    });
    await followProgress(stream);
  } else {
    await followProgress(await docker.pull(name));
  }
  console.log(`Image ${name} is ready.`);
}
async function containerById(id) {
  if (!id) return null;
  try { return await docker.getContainer(id).inspect(); } catch { return null; }
}
async function isHealthy(id) {
  const info = await containerById(id);
  return info?.State?.Health?.Status === 'healthy';
}
async function waitForHealthy(id, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(id)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  throw new Error('Timed out waiting for the training target to become healthy.');
}
async function waitForPort(host, portNumber, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise((resolvePromise) => {
      const socket = createConnection({ host, port: portNumber, timeout: 1500 });
      socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
      socket.once('timeout', () => { socket.destroy(); resolvePromise(false); });
      socket.once('error', () => resolvePromise(false));
    });
    if (reachable) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  throw new Error('Timed out waiting for the Kali desktop port.');
}
async function removeContainer(nameOrId) {
  const container = docker.getContainer(nameOrId);
  try { await container.remove({ force: true }); } catch { /* The container may already be gone. */ }
}
async function cleanupContainers(session) {
  for (const target of session.targets || []) await removeContainer(target.containerId || target.name);
  await removeContainer(session.kaliContainerId || session.kaliContainerName);
  if (session.networkName) {
    try { await docker.getNetwork(session.networkName).disconnect({ Container: runtimeContainerId }); } catch { /* The runtime container may not be attached. */ }
    try { await docker.getNetwork(session.networkName).remove(); } catch { /* Network removal is best effort. */ }
  }
}
async function startContainers(session) {
  for (const target of session.targets || []) await docker.getContainer(target.containerId).start();
  await docker.getContainer(session.kaliContainerId).start();
  for (const target of session.targets || []) await waitForHealthy(target.containerId);
}
async function createSession(input) {
  const attemptId = String(input.attemptId || '').trim();
  const labId = String(input.labId || '').trim();
  const studentId = String(input.studentId || '').trim();
  const labSlug = String(input.labSlug || '');
  const labName = String(input.labName || '');
  if (!attemptId || !labId || !studentId) throw fail(400, 'VALIDATION_ERROR', 'attemptId, labId and studentId are required.');
  const existing = sessionsByAttempt.get(attemptId);
  if (existing && ['CREATING', 'STARTING', 'RUNNING', 'STOPPING'].includes(existing.status)) return existing;
  if (existing) {
    sessions.delete(existing.id);
    sessionsByAttempt.delete(attemptId);
    await cleanupContainers(existing);
  }
  const definition = definitionFor(labSlug);
  const sessionId = randomUUID();
  const safe = safePart(sessionId);
  const session = {
    id: sessionId,
    attemptId,
    labId,
    studentId,
    labSlug,
    labName: labName || definition.name,
    status: 'CREATING',
    createdAt: new Date().toISOString(),
    networkName: `cybr-net-${safe}`,
    kaliContainerName: `cybr-kali-${safe}`,
    kaliContainerId: '',
    kaliProxyPort: 0,
    kaliUrl: `/sessions/${sessionId}/kali/?autoclose=1&username=user&password=StudentSecure2026!`,
    targets: [],
  };
  sessions.set(sessionId, session);
  sessionsByAttempt.set(attemptId, session);
  console.log(`Creating session ${sessionId} for attempt ${attemptId}.`);
  try {
    await docker.createNetwork({
      Name: session.networkName,
      Driver: 'bridge',
      Internal: true,
      Labels: { 'cyber-range.session': sessionId, 'cyber-range.attempt': attemptId },
    });
    await docker.getNetwork(session.networkName).connect({ Container: runtimeContainerId });
    const kaliImageName = kaliImage || definition.kaliImage;
    await ensureImage(kaliImageName);
    session.targets = await Promise.all((definition.targets || []).map(async (targetDefinition, index) => {
      const targetName = targetDefinition.name || `target-${index + 1}`;
      await ensureImage(targetDefinition.image, targetDefinition.build);
      const container = await docker.createContainer({
        name: `cybr-${targetName}-${safe}`,
        Image: targetDefinition.image,
        Hostname: targetName,
        HostConfig: {
          NetworkMode: session.networkName,
          Memory: definition.resourceLimits?.target?.memory || 268435456,
          NanoCpus: definition.resourceLimits?.target?.nanoCpus || 500000000,
          RestartPolicy: { Name: 'no' },
          SecurityOpt: ['no-new-privileges'],
        },
        Healthcheck: targetDefinition.healthcheck ? {
          Test: targetDefinition.healthcheck,
          Interval: 5000000000,
          Timeout: 3000000000,
          Retries: 6,
          StartPeriod: 5000000000,
        } : undefined,
        Labels: { 'cyber-range.session': sessionId, 'cyber-range.attempt': attemptId, 'cyber-range.target': targetName },
      });
      return { name: targetName, containerId: container.id };
    }));
    const kaliContainer = await docker.createContainer({
      name: session.kaliContainerName,
      Image: kaliImageName,
      Hostname: `kali-${safe}`,
      ExposedPorts: { '6901/tcp': {} },
      Env: [`VNC_PW=${vncPassword}`, `KASM_SVC_USER_PASSWORD=${vncPassword}`, 'NO_auth=1'],
      HostConfig: {
        NetworkMode: session.networkName,
        Memory: definition.resourceLimits?.kali?.memory || 2147483648,
        NanoCpus: definition.resourceLimits?.kali?.nanoCpus || 2000000000,
        RestartPolicy: { Name: 'no' },
        SecurityOpt: ['no-new-privileges'],
      },
      Labels: { 'cyber-range.session': sessionId, 'cyber-range.attempt': attemptId, 'cyber-range.role': 'kali' },
    });
    session.kaliContainerId = kaliContainer.id;
    session.kaliProxyHost = session.kaliContainerName;
    session.kaliProxyPort = 6901;
    session.status = 'STARTING';
    console.log(`Starting containers for session ${sessionId}.`);
    await startContainers(session);
    await waitForPort(session.kaliProxyHost, session.kaliProxyPort);
    session.status = 'RUNNING';
    console.log(`Session ${sessionId} is running.`);
    return session;
  } catch (error) {
    session.status = 'FAILED';
    session.lastError = error.message;
    console.error(`Session ${sessionId} failed: ${error.message}`);
    await cleanupContainers(session);
    throw error;
  }
}
function requireStudentMatch(request, session) {
  if (!session || request.get('X-Runtime-User-Id') !== session.studentId) throw fail(404, 'NOT_FOUND', 'Runtime session not found.');
}

app.get('/health', (request, response) => response.json({ ok: true }));
app.post('/api/sessions', async (request, response) => {
  const studentId = String(request.body?.studentId || '').trim();
  if (request.get('X-Runtime-User-Id') !== studentId) fail(403, 'FORBIDDEN', 'The authenticated student does not match the requested session.');
  try {
    const session = await createSession(request.body);
    response.json({ session: publicSession(session) });
  } catch (error) {
    if (error.status) throw error;
    throw fail(502, 'SESSION_START_FAILED', error.message || 'Unable to start the lab environment.');
  }
});
app.get('/api/sessions/:sessionId', (request, response) => {
  const session = sessionForRequest(request);
  requireStudentMatch(request, session);
  response.json({ session: publicSession(session) });
});
app.get('/api/sessions', (request, response) => {
  const attemptId = String(request.query.attemptId || '');
  const session = attemptId ? sessionsByAttempt.get(attemptId) : null;
  requireStudentMatch(request, session);
  response.json({ session: publicSession(session) });
});
app.post('/api/sessions/:sessionId/stop', async (request, response) => {
  const session = sessionForRequest(request);
  requireStudentMatch(request, session);
  session.status = 'STOPPING';
  try {
    for (const target of session.targets || []) await docker.getContainer(target.containerId).stop();
    await docker.getContainer(session.kaliContainerId).stop();
    session.status = 'STOPPED';
    response.json({ session: publicSession(session) });
  } catch (error) {
    session.status = 'FAILED';
    session.lastError = error.message;
    throw fail(502, 'SESSION_STOP_FAILED', 'Unable to stop the lab environment.');
  }
});
app.delete('/api/sessions/:sessionId', async (request, response) => {
  const session = sessionForRequest(request);
  requireStudentMatch(request, session);
  await cleanupContainers(session);
  sessions.delete(session.id);
  sessionsByAttempt.delete(session.attemptId);
  response.json({ deleted: true });
});

function proxyErrorHandler(error, request, response) {
  if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
    if (!response.headersSent) response.status(502).json({ error: { code: 'KALI_UNAVAILABLE', message: 'The Kali desktop is not available yet.' } });
    return;
  }
  if (!response.headersSent) response.status(502).json({ error: { code: 'PROXY_ERROR', message: 'Unable to reach the practice environment.' } });
}
function kaliTarget(session, port = 6901, upgrade = false) {
  const origin = `https://127.0.0.1:${port}`;
  const headers = {
    Authorization: kasmAuthorization,
    Origin: origin,
    Host: `127.0.0.1:${port}`,
  };
  if (upgrade) {
    headers.Connection = 'Upgrade';
    headers.Upgrade = 'websocket';
    headers['Sec-WebSocket-Protocol'] = 'binary';
  }
  return {
    target: `https://${session.kaliProxyHost}:${port}`,
    secure: false,
    changeOrigin: true,
    headers,
  };
}
function proxyKali(request, response, session, stripPrefix = false) {
  if (!session || session.status !== 'RUNNING' || !session.kaliProxyPort) return fail(404, 'NOT_FOUND', 'The Kali desktop is not available for this session.');
  response.setHeader('Set-Cookie', `cyber_range_kali_session=${encodeURIComponent(session.id)}; Path=/; SameSite=Lax`);
  const upstreamPath = stripPrefix ? (request.url.replace(/^\/sessions\/[^/]+\/kali/, '') || '/') : request.url;
  request.url = upstreamPath;
  const port = 6901;
  proxy.web(request, response, kaliTarget(session, port), (error) => proxyErrorHandler(error, request, response));
  return null;
}
app.use('/sessions/:sessionId/kali', (request, response) => {
  const error = proxyKali(request, response, sessionForRequest(request), true);
  if (error) throw error;
});
app.use('/websockify', (request, response) => {
  const error = proxyKali(request, response, sessionForRequest(request), false);
  if (error) throw error;
});
app.use('/dist', (request, response) => {
  const error = proxyKali(request, response, sessionForRequest(request), false);
  if (error) throw error;
});
app.use('/vnc.html', (request, response) => {
  const error = proxyKali(request, response, sessionForRequest(request), false);
  if (error) throw error;
});
app.use('/api', (request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Runtime endpoint not found.' } }));
app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  if (error.status) return response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
  if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Send valid JSON smaller than 1 MB.' } });
  response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The runtime manager could not complete the request.' } });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Cyber Range runtime manager listening on http://0.0.0.0:${port}`);
});
server.on('upgrade', (request, socket, head) => {
  let session = null;
  let stripPrefix = false;
  const pathMatch = String(request.url || '').match(/^\/sessions\/([^/]+)\/kali/);
  console.log(`Upgrade request: ${request.url}`);
  if (pathMatch) {
    session = sessions.get(decodeURIComponent(pathMatch[1])) || null;
    stripPrefix = true;
  } else {
    session = sessionForRequest(request);
  }
  console.log(`Upgrade session: ${session?.id || 'none'} status=${session?.status || 'none'} port=${session?.kaliProxyPort || 0}`);
  if (!session || session.status !== 'RUNNING' || !session.kaliProxyPort) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  request.headers.authorization = kasmAuthorization;
  request.headers.connection = 'Upgrade';
  request.headers.upgrade = 'websocket';
  request.headers['sec-websocket-protocol'] = request.headers['sec-websocket-protocol'] || 'binary';
  request.headers.origin = `https://127.0.0.1:6901`;
  request.headers.host = `127.0.0.1:6901`;
  if (stripPrefix) request.url = request.url.replace(/^\/sessions\/[^/]+\/kali/, '') || '/';
  proxy.ws(request, socket, head, kaliTarget(session, 6901, true), (error) => {
    if (error) socket.destroy();
  });
});
proxy.on('error', (error, request, response) => {
  if (response && !response.headersSent) response.end();
});

const cleanupInterval = setInterval(async () => {
  const expiredAt = Date.now() - sessionTtlMs;
  for (const session of sessions.values()) {
    if (session.status === 'RUNNING' && new Date(session.createdAt).getTime() < expiredAt) {
      session.status = 'EXPIRED';
      await cleanupContainers(session).catch(() => {});
      sessions.delete(session.id);
      sessionsByAttempt.delete(session.attemptId);
    }
  }
}, Math.min(300000, sessionTtlMs)).unref();

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  clearInterval(cleanupInterval);
  server.close(() => process.exit(0));
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
