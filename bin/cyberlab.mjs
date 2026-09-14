#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const baseUrl = (process.env.CYBERPOD_URL || 'http://127.0.0.1:8080').replace(/\/$/, '')
const username = process.env.CYBERLAB_USERNAME || process.env.DEMO_USERNAME
const password = process.env.CYBERLAB_PASSWORD || process.env.DEMO_PASSWORD
const stateFile = process.env.CYBERLAB_STATE_FILE || join(homedir(), '.cyberpod', 'cyberlab-session.json')
let cookie = ''

async function jsonResponse(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) },
  })
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';', 1)[0]
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error?.message || `${response.status} ${response.statusText}`)
  return data
}

async function authenticate() {
  if (!username || !password) throw new Error('Set CYBERLAB_USERNAME and CYBERLAB_PASSWORD (or DEMO_USERNAME and DEMO_PASSWORD).')
  await jsonResponse('/login', { method: 'POST', body: JSON.stringify({ username, password }) })
  await jsonResponse('/api/session/role', { method: 'POST', body: JSON.stringify({ role: 'student' }) })
}

async function labs() {
  return (await jsonResponse('/api/labs-module/labs')).labs || []
}

async function resolveLab(value) {
  const available = await labs()
  const normalized = String(value || '').toLowerCase()
  const byCode = available.find((lab) => String(lab.code || '').toLowerCase() === normalized)
  if (byCode) return byCode
  const bySlug = available.find((lab) => lab.slug.toLowerCase() === normalized)
  if (bySlug) return bySlug
  const index = Number.parseInt(normalized, 10)
  if (Number.isInteger(index) && index > 0) {
    const ordered = [...available].sort((left, right) => String(left.code || '').localeCompare(String(right.code || ''), undefined, { numeric: true }) || left.slug.localeCompare(right.slug))
    if (ordered[index - 1]) return ordered[index - 1]
  }
  throw new Error(`Lab '${value}' was not found.`)
}

async function readState() {
  try { return JSON.parse(await readFile(stateFile, 'utf8')) } catch { return {} }
}

async function saveState(state) {
  await mkdir(dirname(stateFile), { recursive: true })
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

async function start(value) {
  const lab = await resolveLab(value)
  const data = await jsonResponse(`/api/labs-module/labs/${encodeURIComponent(lab.id)}/start`, { method: 'POST', body: '{}' })
  await saveState({ labId: lab.id, labSlug: lab.slug, labName: lab.name, attemptId: data.attempt.id, sessionId: data.session?.id || null })
  console.log(`Lab ${lab.slug} is ${data.session?.status || 'READY'}.`)
  console.log(`Attempt: ${data.attempt.id}`)
}

async function status() {
  const state = await readState()
  if (!state.attemptId) { console.log('No active lab session.'); return }
  try {
    const data = await jsonResponse(`/api/runtime/sessions?attemptId=${encodeURIComponent(state.attemptId)}`)
    console.log(JSON.stringify(data.session || null, null, 2))
  } catch (error) {
      if (error.message === 'Runtime session not found.') {
        await saveState({ ...state, sessionId: null })
        console.log('No active lab session.')
        return
      }
    throw error
  }
}

async function stop() {
  const state = await readState()
  if (!state.sessionId) { console.log('No active lab session.'); return }
    try {
      await jsonResponse(`/api/runtime/sessions/${encodeURIComponent(state.sessionId)}/stop`, { method: 'POST', body: '{}' })
    } catch (error) {
      if (error.message !== 'Runtime session not found.') throw error
    }
  await saveState({ ...state, sessionId: null })
  console.log('Lab session stopped.')
}

async function info(value) {
  const lab = await resolveLab(value)
  console.log(JSON.stringify((await jsonResponse(`/api/labs-module/labs/${encodeURIComponent(lab.id)}`)).lab, null, 2))
}

async function main() {
  const [command = 'help', value] = process.argv.slice(2)
  await authenticate()
  if (command === 'list') console.log(JSON.stringify(await labs(), null, 2))
  else if (command === 'info') await info(value)
  else if (command === 'start') await start(value)
  else if (command === 'status') await status()
  else if (command === 'stop') await stop()
  else if (command === 'restart') { await stop(); await start(value || (await readState()).labSlug) }
  else console.log('Usage: cyberlab {list|info ID|start ID|status|stop|restart [ID]}')
}

main().catch((error) => { console.error(`cyberlab: ${error.message}`); process.exitCode = 1 })
