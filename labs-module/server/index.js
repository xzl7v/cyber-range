import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLabsModule } from './labs.js';

const moduleDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const developmentUsers = [
  { id: 'instructor', role: 'instructor', displayName: 'Development Instructor' },
  { id: 'student-a', role: 'student', displayName: 'Development Student A' },
  { id: 'student-b', role: 'student', displayName: 'Development Student B' },
];

export function startServer({ development = process.argv.includes('--dev'), serveDist = process.argv.includes('--serve-dist') } = {}) {
  if (development && process.env.NODE_ENV === 'production') throw new Error('Development identities are disabled in production.');
  const port = Number(process.env.PORT || 4300);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const dist = join(moduleDirectory, 'dist');
  if (serveDist && !existsSync(join(dist, 'index.html'))) throw new Error('Build the frontend before using --serve-dist.');
  const app = express();
  app.disable('x-powered-by');
  if (development) app.get('/api/dev/users', (request, response) => response.set('Cache-Control', 'no-store').json({ users: developmentUsers }));
  const labs = createLabsModule({
    databasePath: process.env.LABS_DATABASE || join(moduleDirectory, '.data', 'labs.sqlite'),
    resolveUser: (request) => development ? developmentUsers.find((user) => user.id === request.get('X-Dev-User')) || null : null,
  });
  app.use('/api', labs.router);
  if (serveDist) {
    app.use(express.static(dist));
    app.get('/{*path}', (request, response) => response.sendFile(join(dist, 'index.html')));
  }
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Labs module listening on http://127.0.0.1:${port}${development ? ' with development identities' : ''}.`);
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => labs.close());
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.once('error', (error) => { labs.close(); console.error(error.message); process.exitCode = 1; });
  return { server, close };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) startServer();
