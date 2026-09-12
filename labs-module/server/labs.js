import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}
const fail = (status, code, message, fields) => { throw new ApiError(status, code, message, fields); };
const invalid = (field, message) => fail(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', { [field]: message });
const has = (value, key) => Object.hasOwn(value, key);
const now = () => new Date().toISOString();
function object(value, field = 'body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field, 'Must be an object.');
  return value;
}
function text(value, field, max = 10000) {
  if (typeof value !== 'string' || value.length > max) invalid(field, `Must be text of at most ${max} characters.`);
  return value.trim();
}
function integer(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(field, `Must be an integer from ${min} to ${max}.`);
  return value;
}
function boolean(value, field) {
  if (typeof value !== 'boolean') invalid(field, 'Must be true or false.');
  return value;
}
function strings(value, field) {
  if (!Array.isArray(value) || value.length > 50) invalid(field, 'Must be a list of at most 50 items.');
  return value.map((item, index) => text(item, `${field}.${index}`, 2000)).filter(Boolean);
}
function choice(value, values, field) {
  if (!values.includes(value)) invalid(field, `Choose ${values.join(', ')}.`);
  return value;
}
const hash = (answer, salt) => scryptSync(answer, salt, 32).toString('hex');
function matches(answer, secret, caseSensitive = true) {
  if (!secret?.hash) return false;
  const value = caseSensitive ? answer : answer.toLowerCase();
  const expected = caseSensitive ? secret.hash : secret.foldedHash;
  return timingSafeEqual(Buffer.from(hash(value, secret.salt), 'hex'), Buffer.from(expected, 'hex'));
}
function secretFor(answer) {
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hash(answer, salt), foldedHash: hash(answer.toLowerCase(), salt) };
}
const labFields = ['name', 'slug', 'description', 'difficulty', 'estimatedDuration', 'category', 'requiredTools', 'learningObjectives', 'instructions', 'enabled', 'published'];
const taskFields = ['title', 'description', 'score', 'hints', 'validationType', 'completionRequirements', 'requiresPrevious', 'caseSensitive'];

export function createLabsModule({ databasePath, resolveUser }) {
  if (typeof resolveUser !== 'function') throw new TypeError('resolveUser must be a function.');
  if (typeof databasePath !== 'string' || !databasePath) throw new TypeError('databasePath is required.');
  if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS labs (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, data TEXT NOT NULL, secret TEXT);
    CREATE INDEX IF NOT EXISTS tasks_lab ON tasks(lab_id, position);
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, lab_id TEXT NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(lab_id, user_id));
    CREATE TABLE IF NOT EXISTS completions (
      attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL, PRIMARY KEY(attempt_id, task_id));
  `);
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function readLab(id) {
    const row = db.prepare('SELECT data FROM labs WHERE id = ?').get(id);
    if (!row) fail(404, 'NOT_FOUND', 'Lab not found.');
    const lab = JSON.parse(row.data);
    lab.tasks = db.prepare('SELECT data, secret FROM tasks WHERE lab_id = ? ORDER BY position').all(id)
      .map((task) => ({ ...JSON.parse(task.data), secret: task.secret ? JSON.parse(task.secret) : null }));
    return lab;
  }
  function publicLab(lab, instructor, detail = true) {
    const { tasks, ...fields } = lab;
    const result = { ...fields, taskCount: tasks.length, totalScore: tasks.reduce((sum, task) => sum + task.score, 0) };
    if (detail) result.tasks = tasks.map(({ secret, ...task }) => instructor ? { ...task, hasAnswer: Boolean(secret) } : task);
    return result;
  }
  function visibleLab(id) {
    const lab = readLab(id);
    if (!lab.enabled || !lab.published) fail(404, 'NOT_FOUND', 'Lab not found.');
    return lab;
  }
  function uniqueSlug(base, excludedId) {
    let candidate = base;
    let suffix = 2;
    while (db.prepare('SELECT id FROM labs WHERE slug = ? AND id != ?').get(candidate, excludedId || '')) candidate = `${base.slice(0, 90)}-${suffix++}`;
    return candidate;
  }
  function parseLab(input, existing) {
    object(input);
    for (const key of Object.keys(input)) if (![...labFields, 'tasks', 'revision'].includes(key)) invalid(key, 'This field is not editable.');
    if (has(input, 'revision')) {
      integer(input.revision, 'revision', 1, Number.MAX_SAFE_INTEGER);
      if (existing && input.revision !== existing.revision) fail(409, 'REVISION_CONFLICT', 'This lab changed. Reload it before saving.');
    }
    const timestamp = now();
    const lab = existing ? { ...existing } : {
      id: randomUUID(), name: '', slug: '', description: '', difficulty: 'Easy', estimatedDuration: 30,
      category: '', requiredTools: [], learningObjectives: [], instructions: '', enabled: true,
      published: false, createdAt: timestamp, revision: 0, tasks: [],
    };
    for (const key of labFields) {
      if (!has(input, key)) continue;
      if (['enabled', 'published'].includes(key)) lab[key] = boolean(input[key], key);
      else if (['requiredTools', 'learningObjectives'].includes(key)) lab[key] = strings(input[key], key);
      else if (key === 'difficulty') lab[key] = choice(input[key], ['Easy', 'Medium', 'Hard'], key);
      else if (key === 'estimatedDuration') lab[key] = integer(input[key], key, 1, 1440);
      else lab[key] = text(input[key], key, key === 'instructions' ? 50000 : ['name', 'category'].includes(key) ? 200 : key === 'slug' ? 100 : 10000);
    }
    if (!existing && !lab.slug) {
      const base = lab.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '') || 'lab';
      lab.slug = uniqueSlug(base);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(lab.slug)) invalid('slug', 'Use lowercase letters, numbers and single hyphens.');
    if (db.prepare('SELECT id FROM labs WHERE slug = ? AND id != ?').get(lab.slug, lab.id)) fail(409, 'SLUG_CONFLICT', 'This slug is already in use.');
    lab.revision += 1;
    lab.updatedAt = timestamp;
    if (has(input, 'tasks')) {
      if (!Array.isArray(input.tasks) || input.tasks.length > 200) invalid('tasks', 'Must contain at most 200 tasks.');
      const previous = new Map((existing?.tasks || []).map((task) => [task.id, task]));
      const seen = new Set();
      lab.tasks = input.tasks.map((value, index) => {
        object(value, `tasks.${index}`);
        let old;
        if (has(value, 'id')) {
          if (typeof value.id !== 'string' || !previous.has(value.id) || seen.has(value.id)) invalid(`tasks.${index}.id`, 'Use each existing task ID once, or omit the ID for a new task.');
          seen.add(value.id);
          old = previous.get(value.id);
        }
        return parseTask(value, lab.id, index, old);
      });
    }
    validatePublication(lab);
    return lab;
  }
  function parseTask(input, labId, order, existing) {
    object(input);
    for (const key of Object.keys(input)) if (![...taskFields, 'id', 'labId', 'order', 'hasAnswer', 'expectedAnswer'].includes(key)) invalid(`tasks.${order}.${key}`, 'This field is not editable.');
    if (has(input, 'labId') && input.labId !== labId) invalid(`tasks.${order}.labId`, 'Task belongs to another lab.');
    const task = existing ? { ...existing, order } : {
      id: randomUUID(), labId, title: '', description: '', order, score: 10, hints: [],
      validationType: 'answer', completionRequirements: '', requiresPrevious: false, caseSensitive: true, secret: null,
    };
    for (const key of taskFields) {
      if (!has(input, key)) continue;
      const field = `tasks.${order}.${key}`;
      if (['requiresPrevious', 'caseSensitive'].includes(key)) task[key] = boolean(input[key], field);
      else if (key === 'hints') task[key] = strings(input[key], field);
      else if (key === 'score') task[key] = integer(input[key], field, 0, 10000);
      else if (key === 'validationType') task[key] = choice(input[key], ['flag', 'answer', 'acknowledgement'], field);
      else task[key] = text(input[key], field, key === 'title' ? 200 : 10000);
    }
    if (has(input, 'expectedAnswer')) {
      const answer = text(input.expectedAnswer, `tasks.${order}.expectedAnswer`, 4096);
      task.secret = !answer ? null : matches(answer, existing?.secret) ? existing.secret : secretFor(answer);
    }
    return task;
  }
  function validatePublication(lab) {
    if (!lab.published) return;
    for (const key of ['name', 'description', 'instructions']) if (!lab[key]) invalid(key, 'Required before publishing.');
    if (!lab.tasks.length) invalid('tasks', 'Add at least one task before publishing.');
    for (const task of lab.tasks) {
      if (!task.title) invalid(`tasks.${task.order}.title`, 'A published task needs a title.');
      if (task.validationType !== 'acknowledgement' && !task.secret) invalid(`tasks.${task.order}.expectedAnswer`, 'Configure an answer before publishing.');
    }
  }
  function completionIds(id) {
    return new Set(db.prepare('SELECT task_id FROM completions WHERE attempt_id = ?').all(id).map((row) => row.task_id));
  }
  function saveLab(lab, previous) {
    const { tasks, ...data } = lab;
    db.prepare('INSERT INTO labs(id, slug, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, data=excluded.data').run(lab.id, lab.slug, JSON.stringify(data));
    const ids = new Set(tasks.map((task) => task.id));
    for (const task of previous?.tasks || []) if (!ids.has(task.id)) db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
    const oldTasks = new Map((previous?.tasks || []).map((task) => [task.id, task]));
    const invalidated = new Set();
    for (const task of tasks) {
      const old = oldTasks.get(task.id);
      if (old && (['validationType', 'caseSensitive', 'requiresPrevious', 'completionRequirements'].some((key) => old[key] !== task[key]) || old.secret?.hash !== task.secret?.hash)) invalidated.add(task.id);
      const { secret, ...taskData } = task;
      db.prepare('INSERT INTO tasks(id, lab_id, position, data, secret) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET position=excluded.position, data=excluded.data, secret=excluded.secret')
        .run(task.id, lab.id, task.order, JSON.stringify(taskData), secret ? JSON.stringify(secret) : null);
    }
    for (const attempt of db.prepare('SELECT id FROM attempts WHERE lab_id = ?').all(lab.id)) {
      const completed = completionIds(attempt.id);
      let allPrevious = true;
      for (const task of tasks) {
        if (invalidated.has(task.id) || (task.requiresPrevious && !allPrevious)) {
          db.prepare('DELETE FROM completions WHERE attempt_id = ? AND task_id = ?').run(attempt.id, task.id);
          completed.delete(task.id);
        }
        allPrevious = allPrevious && completed.has(task.id);
      }
      db.prepare('UPDATE attempts SET updated_at = ? WHERE id = ?').run(lab.updatedAt, attempt.id);
    }
    return lab;
  }
  function updateLab(id, input) {
    return transaction(() => { const previous = readLab(id); return saveLab(parseLab(input, previous), previous); });
  }
  function ownedAttempt(id, userId) {
    const row = db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(id, userId);
    if (!row) fail(404, 'NOT_FOUND', 'Attempt not found.');
    return { row, lab: visibleLab(row.lab_id) };
  }
  function attemptView(row, lab) {
    const completed = completionIds(row.id);
    const completedTasks = lab.tasks.filter((task) => completed.has(task.id));
    const count = completedTasks.length;
    return {
      id: row.id, labId: row.lab_id, userId: row.user_id, startedAt: row.started_at, updatedAt: row.updated_at,
      lab: publicLab(lab, false), progress: {
        completedTaskIds: completedTasks.map((task) => task.id), completedTasks: count,
        totalTasks: lab.tasks.length, earnedScore: completedTasks.reduce((sum, task) => sum + task.score, 0),
        totalScore: lab.tasks.reduce((sum, task) => sum + task.score, 0),
        percent: lab.tasks.length ? Math.floor(100 * count / lab.tasks.length) : 0,
        completed: lab.tasks.length > 0 && count === lab.tasks.length,
      },
    };
  }
  const router = express.Router();
  router.use((request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.use(express.json({ limit: '1mb' }));
  router.use(async (request, response, next) => {
    const user = await resolveUser(request);
    if (!user) fail(401, 'AUTH_REQUIRED', 'Sign in through the host application.');
    if (typeof user.id !== 'string' || !user.id.trim() || !['instructor', 'student'].includes(user.role)) fail(403, 'FORBIDDEN', 'A supported user role is required.');
    request.labsUser = { id: user.id, role: user.role, displayName: user.displayName };
    next();
  });
  const role = (required) => (request, response, next) => {
    if (request.labsUser.role !== required) fail(403, 'FORBIDDEN', `${required === 'instructor' ? 'Instructor' : 'Student'} access is required.`);
    next();
  };
  const instructor = role('instructor');
  const student = role('student');
  const labResponse = (response, lab, status = 200) => response.status(status).json({ lab: publicLab(lab, true) });
  router.get('/labs', (request, response) => {
    const isInstructor = request.labsUser.role === 'instructor';
    const labs = db.prepare('SELECT id FROM labs ORDER BY rowid DESC').all().map((row) => readLab(row.id))
      .filter((lab) => isInstructor || (lab.published && lab.enabled)).map((lab) => publicLab(lab, isInstructor, false));
    response.json({ labs });
  });
  router.get('/labs/:labId', (request, response) => {
    const isInstructor = request.labsUser.role === 'instructor';
    response.json({ lab: publicLab(isInstructor ? readLab(request.params.labId) : visibleLab(request.params.labId), isInstructor) });
  });
  router.post('/labs', instructor, (request, response) => labResponse(response, transaction(() => saveLab(parseLab(request.body))), 201));
  router.patch('/labs/:labId', instructor, (request, response) => labResponse(response, updateLab(request.params.labId, request.body)));
  router.delete('/labs/:labId', instructor, (request, response) => {
    transaction(() => { readLab(request.params.labId); db.prepare('DELETE FROM labs WHERE id = ?').run(request.params.labId); });
    response.json({ deleted: true });
  });
  router.post('/labs/:labId/duplicate', instructor, (request, response) => {
    const lab = transaction(() => {
      const source = readLab(request.params.labId);
      const timestamp = now();
      const id = randomUUID();
      return saveLab({ ...source, id, name: `${source.name.slice(0, 193)} (copy)`, slug: uniqueSlug(`${source.slug.slice(0, 90)}-copy`),
        published: false, revision: 1, createdAt: timestamp, updatedAt: timestamp,
        tasks: source.tasks.map((task) => ({ ...task, id: randomUUID(), labId: id })) });
    });
    labResponse(response, lab, 201);
  });
  for (const [action, field, value] of [['publish', 'published', true], ['unpublish', 'published', false], ['enable', 'enabled', true], ['disable', 'enabled', false]]) {
    router.post(`/labs/:labId/${action}`, instructor, (request, response) => {
      const input = { [field]: value };
      if (request.body && has(request.body, 'revision')) input.revision = request.body.revision;
      labResponse(response, updateLab(request.params.labId, input));
    });
  }
  function editTasks(id, change) {
    return transaction(() => {
      const previous = readLab(id);
      const tasks = change(previous.tasks.map((task) => ({ ...task })));
      if (tasks.length > 200) invalid('tasks', 'Must contain at most 200 tasks.');
      const lab = { ...previous, tasks: tasks.map((task, order) => ({ ...task, order })), revision: previous.revision + 1, updatedAt: now() };
      validatePublication(lab);
      return saveLab(lab, previous);
    });
  }
  router.post('/labs/:labId/tasks', instructor, (request, response) => {
    const lab = editTasks(request.params.labId, (tasks) => {
      if (request.body?.id) invalid('id', 'New tasks receive a server-generated ID.');
      return [...tasks, parseTask(request.body, request.params.labId, tasks.length)];
    });
    const result = publicLab(lab, true);
    response.status(201).json({ lab: result, task: result.tasks.at(-1) });
  });
  router.patch('/labs/:labId/tasks/:taskId', instructor, (request, response) => {
    const lab = editTasks(request.params.labId, (tasks) => {
      const index = tasks.findIndex((task) => task.id === request.params.taskId);
      if (index === -1) fail(404, 'NOT_FOUND', 'Task not found.');
      if (request.body?.id && request.body.id !== request.params.taskId) invalid('id', 'Task ID cannot change.');
      tasks[index] = parseTask(request.body, request.params.labId, index, tasks[index]);
      return tasks;
    });
    const result = publicLab(lab, true);
    response.json({ lab: result, task: result.tasks.find((task) => task.id === request.params.taskId) });
  });
  router.delete('/labs/:labId/tasks/:taskId', instructor, (request, response) => {
    const lab = editTasks(request.params.labId, (tasks) => {
      if (!tasks.some((task) => task.id === request.params.taskId)) fail(404, 'NOT_FOUND', 'Task not found.');
      return tasks.filter((task) => task.id !== request.params.taskId);
    });
    response.json({ lab: publicLab(lab, true), deleted: true });
  });
  router.put('/labs/:labId/tasks/order', instructor, (request, response) => {
    const lab = editTasks(request.params.labId, (tasks) => {
      const ids = object(request.body).taskIds;
      if (!Array.isArray(ids) || ids.length !== tasks.length || new Set(ids).size !== tasks.length || ids.some((id) => !tasks.some((task) => task.id === id))) invalid('taskIds', 'Include every task ID exactly once.');
      return ids.map((id) => tasks.find((task) => task.id === id));
    });
    labResponse(response, lab);
  });
  router.post('/labs/:labId/start', student, (request, response) => {
    const attempt = transaction(() => {
      const lab = visibleLab(request.params.labId);
      const timestamp = now();
      db.prepare('INSERT INTO attempts(id, lab_id, user_id, started_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lab_id, user_id) DO NOTHING')
        .run(randomUUID(), lab.id, request.labsUser.id, timestamp, timestamp);
      return attemptView(db.prepare('SELECT * FROM attempts WHERE lab_id = ? AND user_id = ?').get(lab.id, request.labsUser.id), lab);
    });
    response.json({ attempt });
  });
  router.get('/attempts/:attemptId', student, (request, response) => {
    const { row, lab } = ownedAttempt(request.params.attemptId, request.labsUser.id);
    response.json({ attempt: attemptView(row, lab) });
  });
  router.post('/attempts/:attemptId/tasks/:taskId/submissions', student, (request, response) => {
    const result = transaction(() => {
      const { row, lab } = ownedAttempt(request.params.attemptId, request.labsUser.id);
      const task = lab.tasks.find((item) => item.id === request.params.taskId);
      if (!task) fail(404, 'NOT_FOUND', 'Task not found.');
      const input = object(request.body);
      for (const key of Object.keys(input)) if (!['answer', 'completed'].includes(key)) invalid(key, 'This field is not accepted.');
      const completed = completionIds(row.id);
      if (task.requiresPrevious && lab.tasks.slice(0, task.order).some((item) => !completed.has(item.id))) fail(409, 'PREREQUISITE_REQUIRED', 'Complete all preceding tasks first.');
      let correct;
      if (task.validationType === 'acknowledgement') {
        if (input.completed !== true) invalid('completed', 'Confirm completion to continue.');
        correct = true;
      } else {
        const answer = text(input.answer, 'answer', 4096);
        if (!answer) invalid('answer', 'Enter an answer.');
        correct = matches(answer, task.secret, task.caseSensitive);
      }
      const alreadyCompleted = completed.has(task.id);
      if (correct && !alreadyCompleted) {
        const timestamp = now();
        db.prepare('INSERT INTO completions(attempt_id, task_id, completed_at) VALUES (?, ?, ?)').run(row.id, task.id, timestamp);
        db.prepare('UPDATE attempts SET updated_at = ? WHERE id = ?').run(timestamp, row.id);
        row.updated_at = timestamp;
      }
      return { correct, alreadyCompleted, message: alreadyCompleted ? 'This task was already completed.' : correct ? 'Task completed.' : 'That answer is incorrect. Try again.', attempt: attemptView(row, lab) };
    });
    response.json(result);
  });
  router.use((request, response) => response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }));
  router.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error instanceof ApiError) return response.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } });
    if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') return response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Send valid JSON smaller than 1 MB.' } });
    response.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
  });
  return { router, close: () => db.close() };
}
