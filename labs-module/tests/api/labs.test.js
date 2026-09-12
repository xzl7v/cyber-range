import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLabsModule } from '../../server/labs.js';

const FLAG = 'CYBERPOD{training-fixture-only}';
const users = { teacher: { id: 'teacher', role: 'instructor' }, alice: { id: 'alice', role: 'student' }, bob: { id: 'bob', role: 'student' } };
const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const definition = (overrides = {}) => ({
  name: 'Network fundamentals', description: 'Practice a small training exercise.', instructions: 'Read each task and submit its answer.',
  category: 'Networking', requiredTools: ['Browser'], learningObjectives: ['Recognize a protocol'], published: true,
  tasks: [
    { title: 'Find the training flag', validationType: 'flag', expectedAnswer: FLAG, score: 40, hints: ['Use the exercise material.'] },
    { title: 'Confirm your review', validationType: 'acknowledgement', requiresPrevious: true, score: 20 },
    { title: 'Name the protocol', validationType: 'answer', expectedAnswer: 'HTTPS', caseSensitive: false, score: 40 },
  ], ...overrides,
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'cyberpod-labs-api-'));
  const databasePath = join(directory, 'labs.sqlite');
  let labs;
  let server;
  let origin;
  async function open() {
    labs = createLabsModule({ databasePath, resolveUser: async (request) => users[request.get('X-Test-User')] || null });
    const app = express();
    app.use('/module-api', labs.router);
    server = await new Promise((done) => { const listening = app.listen(0, '127.0.0.1', () => done(listening)); });
    origin = `http://127.0.0.1:${server.address().port}/module-api`;
  }
  async function close() {
    if (!server) return;
    const closing = server;
    server = null;
    await new Promise((done, reject) => { closing.close((error) => error ? reject(error) : done()); closing.closeAllConnections(); });
    labs.close();
  }
  await open();
  t.after(async () => {
    await close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cyberpod-labs-api-'));
    await rm(directory, { recursive: true, force: true });
  });
  async function request(method, path, body, user = 'teacher', expected = 200) {
    const response = await fetch(origin + path, { method, headers: {
      ...(user ? { 'X-Test-User': user } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return data;
  }
  return { request, databasePath, get origin() { return origin; }, restart: async () => { await close(); await open(); } };
}

function assertSafe(value, student = false) {
  assert.ok(!JSON.stringify(value).includes(FLAG));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['expectedAnswer', 'secret', 'hash', 'foldedHash', 'salt', ...(student ? ['hasAnswer'] : [])].includes(key), `Unexpected response field ${key}`);
    assertSafe(child, student);
  }
}

test('empty database, draft defaults, atomic publish and current student-safe catalog', async (t) => {
  const { request } = await fixture(t);
  assert.deepEqual(await request('GET', '/labs'), { labs: [] });
  await request('GET', '/labs', undefined, null, 401);
  let { lab } = await request('POST', '/labs', {}, 'teacher', 201);
  assert.equal(lab.difficulty, 'Easy');
  assert.equal(lab.estimatedDuration, 30);
  assert.equal(lab.enabled, true);
  assert.equal(lab.published, false);
  assert.deepEqual((await request('GET', '/labs', undefined, 'alice')).labs, []);
  await request('GET', `/labs/${lab.id}`, undefined, 'alice', 404);
  await request('POST', `/labs/${lab.id}/publish`, {}, 'teacher', 400);
  lab = (await request('PATCH', `/labs/${lab.id}`, { ...definition(), revision: lab.revision })).lab;
  assert.equal(lab.revision, 2);
  assert.equal(lab.totalScore, 100);
  assert.equal(lab.tasks[0].hasAnswer, true);
  assertSafe(lab);
  const detail = await request('GET', `/labs/${lab.id}`, undefined, 'alice');
  assertSafe(detail, true);
  assert.equal(detail.lab.tasks[0].hints[0], 'Use the exercise material.');
  assert.equal((await request('GET', '/labs', undefined, 'alice')).labs.length, 1);
  await request('PATCH', `/labs/${lab.id}`, { name: 'Updated instantly', revision: lab.revision });
  assert.equal((await request('GET', `/labs/${lab.id}`, undefined, 'alice')).lab.name, 'Updated instantly');
});

test('all instructor mutations enforce roles and attempts belong to their authenticated student', async (t) => {
  const { request } = await fixture(t);
  const { lab } = await request('POST', '/labs', definition(), 'teacher', 201);
  const taskPath = `/labs/${lab.id}/tasks/${lab.tasks[0].id}`;
  const blocked = [
    ['POST', '/labs'], ['PATCH', `/labs/${lab.id}`], ['DELETE', `/labs/${lab.id}`],
    ...['duplicate', 'publish', 'unpublish', 'enable', 'disable'].map((action) => ['POST', `/labs/${lab.id}/${action}`]),
    ['POST', `/labs/${lab.id}/tasks`], ['PATCH', taskPath], ['DELETE', taskPath], ['PUT', `/labs/${lab.id}/tasks/order`],
  ];
  for (const [method, path] of blocked) await request(method, path, {}, 'alice', 403);
  const { attempt } = await request('POST', `/labs/${lab.id}/start`, { userId: 'bob', earnedScore: 10000 }, 'alice');
  assert.equal(attempt.userId, 'alice');
  const other = (await request('POST', `/labs/${lab.id}/start`, {}, 'bob')).attempt;
  assert.notEqual(other.id, attempt.id);
  await request('GET', `/attempts/${attempt.id}`, undefined, 'bob', 404);
  await request('POST', `/attempts/${attempt.id}/tasks/${lab.tasks[0].id}/submissions`, { answer: FLAG }, 'bob', 404);
  await request('GET', `/attempts/${attempt.id}`, undefined, 'teacher', 403);
  await request('POST', `/labs/${lab.id}/start`, {}, 'teacher', 403);
  assert.equal((await request('POST', `/labs/${lab.id}/start`, {}, 'alice')).attempt.id, attempt.id);
});

test('real submissions validate prerequisites and case matching without duplicate points', async (t) => {
  const { request } = await fixture(t);
  const { lab } = await request('POST', '/labs', definition(), 'teacher', 201);
  const { attempt } = await request('POST', `/labs/${lab.id}/start`, {}, 'alice');
  const submit = (index, body, status = 200) => request('POST', `/attempts/${attempt.id}/tasks/${lab.tasks[index].id}/submissions`, body, 'alice', status);
  await submit(1, { completed: true }, 409);
  assert.equal((await submit(0, { answer: 'wrong' })).correct, false);
  assert.equal((await submit(0, { answer: FLAG.toLowerCase() })).correct, false);
  assert.equal((await submit(0, { answer: FLAG })).attempt.progress.earnedScore, 40);
  const duplicate = await submit(0, { answer: FLAG });
  assert.equal(duplicate.alreadyCompleted, true);
  assert.equal(duplicate.attempt.progress.earnedScore, 40);
  await submit(1, { completed: false }, 400);
  await submit(1, { completed: true });
  const result = await submit(2, { answer: 'https' });
  assert.equal(result.correct, true);
  assert.deepEqual(result.attempt.progress, { completedTaskIds: lab.tasks.map((task) => task.id), completedTasks: 3, totalTasks: 3, earnedScore: 100, totalScore: 100, percent: 100, completed: true });
  assertSafe(result, true);
  await submit(2, { answer: 'https', earnedScore: 9999 }, 400);
});

test('builder validation, stale revisions, foreign IDs and duplicate slugs roll back', async (t) => {
  const { request } = await fixture(t);
  const { lab } = await request('POST', '/labs', definition(), 'teacher', 201);
  await request('PATCH', `/labs/${lab.id}`, { revision: lab.revision + 1, name: 'Stale write' }, 'teacher', 409);
  const cases = [
    { name: 'Partial write', tasks: [{ ...lab.tasks[0], expectedAnswer: 'Changed secret' }, { id: 'unknown-task' }] },
    { tasks: [lab.tasks[0], lab.tasks[0]] },
    { tasks: [] }, { tasks: [{ ...lab.tasks[0], expectedAnswer: '' }] },
    { difficulty: 'beginner' }, { estimatedDuration: 0 }, { enabled: 'yes' },
    { tasks: [{ ...lab.tasks[0], score: -1 }] }, { userId: 'alice' },
  ];
  for (const input of cases) {
    const error = await request('PATCH', `/labs/${lab.id}`, input, 'teacher', 400);
    assertSafe(error);
    assert.deepEqual((await request('GET', `/labs/${lab.id}`)).lab, lab);
  }
  await request('POST', '/labs', { ...definition(), slug: lab.slug }, 'teacher', 409);
  await request('PUT', `/labs/${lab.id}/tasks/order`, { taskIds: [lab.tasks[0].id, lab.tasks[0].id, lab.tasks[2].id] }, 'teacher', 400);
  assert.deepEqual((await request('GET', `/labs/${lab.id}`)).lab, lab);
  const { attempt } = await request('POST', `/labs/${lab.id}/start`, {}, 'alice');
  assert.equal((await request('POST', `/attempts/${attempt.id}/tasks/${lab.tasks[0].id}/submissions`, { answer: FLAG }, 'alice')).correct, true);
});

test('task CRUD and ordering preserve IDs, duplicate preserves answer configuration, deletion cascades', async (t) => {
  const { request } = await fixture(t);
  let { lab } = await request('POST', '/labs', definition({ published: false }), 'teacher', 201);
  const added = await request('POST', `/labs/${lab.id}/tasks`, { title: 'Extra check', validationType: 'acknowledgement', score: 5 }, 'teacher', 201);
  assert.equal(added.task.order, 3);
  lab = (await request('PATCH', `/labs/${lab.id}/tasks/${added.task.id}`, { title: 'Renamed check', score: 10 })).lab;
  const order = lab.tasks.map((task) => task.id).reverse();
  lab = (await request('PUT', `/labs/${lab.id}/tasks/order`, { taskIds: order })).lab;
  assert.deepEqual(lab.tasks.map((task) => task.id), order);
  assert.deepEqual(lab.tasks.map((task) => task.order), [0, 1, 2, 3]);
  await request('PATCH', `/labs/${lab.id}/tasks/not-owned`, {}, 'teacher', 404);
  lab = (await request('DELETE', `/labs/${lab.id}/tasks/${added.task.id}`)).lab;
  assert.equal(lab.taskCount, 3);
  const copy = (await request('POST', `/labs/${lab.id}/duplicate`, {}, 'teacher', 201)).lab;
  assert.equal(copy.published, false);
  assert.notEqual(copy.id, lab.id);
  assert.notEqual(copy.slug, lab.slug);
  assert.ok(copy.tasks.every((task) => !lab.tasks.some((old) => old.id === task.id)));
  assertSafe(copy);
  await request('POST', `/labs/${copy.id}/publish`, {});
  const { attempt } = await request('POST', `/labs/${copy.id}/start`, {}, 'alice');
  const flagTask = copy.tasks.find((task) => task.validationType === 'flag');
  assert.equal((await request('POST', `/attempts/${attempt.id}/tasks/${flagTask.id}/submissions`, { answer: FLAG }, 'alice')).correct, true);
  await request('DELETE', `/labs/${copy.id}`);
  await request('GET', `/attempts/${attempt.id}`, undefined, 'alice', 404);
  await request('GET', `/labs/${copy.id}`, undefined, 'teacher', 404);
});

test('current edits recalculate scores and invalidate changed validation plus dependent tasks', async (t) => {
  const { request } = await fixture(t);
  let { lab } = await request('POST', '/labs', definition(), 'teacher', 201);
  const { attempt } = await request('POST', `/labs/${lab.id}/start`, {}, 'alice');
  for (const [index, body] of [[0, { answer: FLAG }], [1, { completed: true }], [2, { answer: 'https' }]]) {
    await request('POST', `/attempts/${attempt.id}/tasks/${lab.tasks[index].id}/submissions`, body, 'alice');
  }
  lab = (await request('PATCH', `/labs/${lab.id}`, { tasks: lab.tasks.map((task, index) => index ? task : { ...task, title: 'Clearer wording', description: 'Expanded explanation', hints: ['New hint'], score: 60 }) })).lab;
  let current = (await request('GET', `/attempts/${attempt.id}`, undefined, 'alice')).attempt;
  assert.equal(current.progress.earnedScore, 120);
  assert.equal(current.progress.completed, true);
  await request('PATCH', `/labs/${lab.id}/tasks/${lab.tasks[0].id}`, { expectedAnswer: 'New correct answer' });
  current = (await request('GET', `/attempts/${attempt.id}`, undefined, 'alice')).attempt;
  assert.deepEqual(current.progress.completedTaskIds, [lab.tasks[2].id]);
  assert.equal(current.progress.earnedScore, 40);
  await request('PATCH', `/labs/${lab.id}/tasks/${lab.tasks[2].id}`, { caseSensitive: true });
  assert.equal((await request('GET', `/attempts/${attempt.id}`, undefined, 'alice')).attempt.progress.completedTasks, 0);
  const path = `/attempts/${attempt.id}/tasks/${lab.tasks[2].id}/submissions`;
  assert.equal((await request('POST', path, { answer: 'https' }, 'alice')).correct, false);
  assert.equal((await request('POST', path, { answer: 'HTTPS' }, 'alice')).correct, true);
  await request('PATCH', `/labs/${lab.id}/tasks/${lab.tasks[2].id}`, { completionRequirements: 'Check the documented requirement.' });
  assert.equal((await request('GET', `/attempts/${attempt.id}`, undefined, 'alice')).attempt.progress.completedTasks, 0);
  await request('POST', path, { answer: 'HTTPS' }, 'alice');
  await request('DELETE', `/labs/${lab.id}/tasks/${lab.tasks[2].id}`);
  current = (await request('GET', `/attempts/${attempt.id}`, undefined, 'alice')).attempt;
  assert.equal(current.progress.totalTasks, 2);
  assert.equal(current.progress.totalScore, 80);
  assert.equal(current.progress.earnedScore, 0);
});

test('visibility changes revoke existing read and submit access and drafts can clear answers', async (t) => {
  const { request } = await fixture(t);
  const { lab } = await request('POST', '/labs', definition(), 'teacher', 201);
  const { attempt } = await request('POST', `/labs/${lab.id}/start`, {}, 'alice');
  for (const [hide, show] of [['disable', 'enable'], ['unpublish', 'publish']]) {
    await request('POST', `/labs/${lab.id}/${hide}`, {});
    assert.equal((await request('GET', '/labs', undefined, 'alice')).labs.length, 0);
    await request('GET', `/labs/${lab.id}`, undefined, 'alice', 404);
    await request('POST', `/labs/${lab.id}/start`, {}, 'alice', 404);
    await request('GET', `/attempts/${attempt.id}`, undefined, 'alice', 404);
    await request('POST', `/attempts/${attempt.id}/tasks/${lab.tasks[0].id}/submissions`, { answer: FLAG }, 'alice', 404);
    await request('POST', `/labs/${lab.id}/${show}`, {});
    assert.equal((await request('POST', `/labs/${lab.id}/start`, {}, 'alice')).attempt.id, attempt.id);
  }
  await request('POST', `/labs/${lab.id}/unpublish`, {});
  assert.equal((await request('PATCH', `/labs/${lab.id}/tasks/${lab.tasks[0].id}`, { expectedAnswer: '' })).task.hasAnswer, false);
  await request('POST', `/labs/${lab.id}/publish`, {}, 'teacher', 400);
});

test('SQLite content and progress survive restart without storing plaintext answers', async (t) => {
  const fixtureApi = await fixture(t);
  const { request } = fixtureApi;
  const { lab } = await request('POST', '/labs', definition(), 'teacher', 201);
  const { attempt } = await request('POST', `/labs/${lab.id}/start`, {}, 'alice');
  await request('POST', `/attempts/${attempt.id}/tasks/${lab.tasks[0].id}/submissions`, { answer: FLAG }, 'alice');
  await fixtureApi.restart();
  assert.equal((await request('GET', `/labs/${lab.id}`)).lab.name, lab.name);
  assert.equal((await request('GET', `/attempts/${attempt.id}`, undefined, 'alice')).attempt.progress.earnedScore, 40);
  assert.equal((await request('POST', `/labs/${lab.id}/start`, {}, 'alice')).attempt.id, attempt.id);
  const stored = await readFile(fixtureApi.databasePath);
  assert.equal(stored.includes(Buffer.from(FLAG)), false);
});

test('invalid and oversized JSON returns safe API errors', async (t) => {
  const fixtureApi = await fixture(t);
  for (const body of ['{', JSON.stringify({ description: 'x'.repeat(1024 * 1024 + 1) })]) {
    const response = await fetch(fixtureApi.origin + '/labs', { method: 'POST', headers: { 'X-Test-User': 'teacher', 'Content-Type': 'application/json' }, body });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
  }
});

test('standalone server refuses development identities in production', () => {
  const child = spawnSync(process.execPath, ['server/index.js', '--dev'], { cwd: moduleRoot, env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Development identities are disabled in production/);
});
