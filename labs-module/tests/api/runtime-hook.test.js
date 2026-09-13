import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLabsModule } from '../../server/labs.js'

test('start lab delegates to the optional runtime and surfaces startup failures', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cyberpod-runtime-hook-'))
  const users = { teacher: { id: 'teacher', role: 'instructor' }, alice: { id: 'alice', role: 'student' } }
  let runtimeCalls = 0
  let failStart = false
  const labs = createLabsModule({
    databasePath: join(directory, 'labs.sqlite'),
    resolveUser: async (request) => users[request.get('X-Test-User')] || null,
    runtime: {
      startSession: async ({ attemptId, labId, studentId, lab }) => {
        runtimeCalls += 1
        assert.ok(attemptId)
        assert.equal(labId, lab.id)
        assert.equal(studentId, 'alice')
        if (failStart) throw new Error('Kali container could not be created.')
        return { id: `session-${runtimeCalls}`, status: 'RUNNING' }
      },
    },
  })
  const app = express()
  app.use(express.json())
  app.use('/api', labs.router)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    labs.close()
    await rm(directory, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const headers = { 'X-Test-User': 'teacher', 'Content-Type': 'application/json' }
  const created = await fetch(`${base}/labs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Runtime lab', slug: 'runtime-lab', description: 'Runtime test', instructions: 'Test runtime.', published: true,
      tasks: [{ title: 'Submit a flag', validationType: 'flag', expectedAnswer: 'FLAG{runtime}', score: 20 }],
    }),
  })
  assert.equal(created.status, 201)
  const { lab } = await created.json()
  const started = await fetch(`${base}/labs/${lab.id}/start`, { method: 'POST', headers: { 'X-Test-User': 'alice' } })
  assert.equal(started.status, 200)
  const startedBody = await started.json()
  assert.equal(startedBody.session.id, 'session-1')
  assert.equal(startedBody.attempt.labId, lab.id)
  assert.equal(runtimeCalls, 1)

  failStart = true
  const failed = await fetch(`${base}/labs/${lab.id}/start`, { method: 'POST', headers: { 'X-Test-User': 'alice' } })
  assert.equal(failed.status, 502)
  const failedBody = await failed.json()
  assert.equal(failedBody.error.code, 'SESSION_START_FAILED')
  assert.equal(failedBody.error.message, 'Kali container could not be created.')
})
