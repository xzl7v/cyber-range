import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import express from 'express'
import { createLabsModule } from '../../server/labs.js'

test('module mounts under a host prefix and uses only the injected identity boundary', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'cyberpod-labs-integration-'))
  const app = express()
  const identities = {
    teacher: { id: 'host-teacher', role: 'instructor', displayName: 'Host instructor' },
    learner: { id: 'host-learner', role: 'student', displayName: 'Host student' },
  }
  app.use((request, _response, next) => {
    request.user = identities[request.get('X-Test-Principal')] || null
    next()
  })
  const labs = createLabsModule({
    databasePath: join(directory, 'labs.sqlite'),
    resolveUser: async (request) => request.user,
  })
  app.use('/embedded-labs', labs.router)
  app.get('/host-probe', (_request, response) => response.json({ existingRoute: true }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve))
    labs.close()
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
    assert.ok(directory.startsWith(join(tmpdir(), 'cyberpod-labs-integration-')))
    await rm(directory, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`

  assert.deepEqual(await (await fetch(`${base}/host-probe`)).json(), { existingRoute: true })
  const forgedDevelopmentIdentity = await fetch(`${base}/embedded-labs/labs`, {
    headers: { 'X-Dev-User': 'instructor' },
  })
  assert.equal(forgedDevelopmentIdentity.status, 401)

  const created = await fetch(`${base}/embedded-labs/labs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Test-Principal': 'teacher' },
    body: JSON.stringify({ name: 'Host-integrated lab' }),
  })
  assert.equal(created.status, 201)
  const { lab } = await created.json()
  const denied = await fetch(`${base}/embedded-labs/labs/${lab.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Test-Principal': 'learner', 'X-Dev-User': 'instructor' },
    body: JSON.stringify({ name: 'Unauthorized edit', role: 'instructor' }),
  })
  assert.equal(denied.status, 403)
  const listed = await fetch(`${base}/embedded-labs/labs`, { headers: { 'X-Test-Principal': 'teacher' } })
  assert.equal((await listed.json()).labs[0].name, 'Host-integrated lab')
  assert.equal((await fetch(`${base}/embedded-labs/dev/users`, { headers: { 'X-Test-Principal': 'teacher' } })).status, 404)
})
