export function createLabsApi({ baseUrl = '/api', devUserId, getRequestHeaders } = {}) {
  const base = baseUrl.replace(/\/$/, '')
  async function request(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(devUserId ? { 'X-Dev-User': devUserId } : {}),
        ...(getRequestHeaders ? await getRequestHeaders() : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await response.json().catch(() => {
      throw new Error('The server returned an unreadable response. Please try again.')
    })
    if (!response.ok) {
      const error = new Error(data.error?.message || 'The request could not be completed.')
      error.code = data.error?.code
      error.fields = data.error?.fields
      error.status = response.status
      throw error
    }
    return data
  }
  const labPath = (id) => `/labs/${encodeURIComponent(id)}`
  return {
    developmentUsers: () => request('/dev/users'),
    listLabs: () => request('/labs'),
    getLab: (id) => request(labPath(id)),
    saveLab: (id, body) => request(id ? labPath(id) : '/labs', { method: id ? 'PATCH' : 'POST', body }),
    deleteLab: (id) => request(labPath(id), { method: 'DELETE' }),
    labAction: (id, action) => request(`${labPath(id)}/${action}`, { method: 'POST', body: {} }),
    startLab: (id) => request(`${labPath(id)}/start`, { method: 'POST', body: {}, timeoutMs: 600000 }),
    getAttempt: (id) => request(`/attempts/${encodeURIComponent(id)}`),
    submit: (attemptId, taskId, body) => request(`/attempts/${encodeURIComponent(attemptId)}/tasks/${encodeURIComponent(taskId)}/submissions`, { method: 'POST', body }),
  }
}

export function createRuntimeApi({ baseUrl = '/api/runtime', getRequestHeaders } = {}) {
  const base = baseUrl.replace(/\/$/, '')
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(getRequestHeaders ? await getRequestHeaders() : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    })
    const data = await response.json().catch(() => {
      throw new Error('The runtime service returned an unreadable response. Please try again.')
    })
    if (!response.ok) {
      const error = new Error(data.error?.message || data.message || 'The runtime service could not complete the request.')
      error.code = data.error?.code || data.code
      error.fields = data.error?.fields
      error.status = response.status
      throw error
    }
    return data
  }
  return {
    startSession: (body) => request('/sessions', { method: 'POST', body }),
    getSession: (id) => request(`/sessions/${encodeURIComponent(id)}`),
    getSessionByAttempt: (attemptId) => request(`/sessions?attemptId=${encodeURIComponent(attemptId)}`),
    stopSession: (id) => request(`/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST', body: {} }),
    deleteSession: (id) => request(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  }
}
