import { useEffect, useMemo, useState } from 'react'
import { LabsModule } from './App.jsx'
import { createRuntimeApi } from './api.js'

export default function HostApp() {
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(0)
  const runtimeApi = useMemo(() => createRuntimeApi({ baseUrl: '/api/runtime' }), [])

  useEffect(() => {
    let active = true
    setError(null)
    fetch('/api/me', { credentials: 'include', cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error?.message || data?.message || 'Sign in to continue.')
        if (!active) return
        if (!data.user || !['student', 'instructor'].includes(data.user.role)) throw new Error('Your account does not have an authorized role.')
        setUser(data.user)
      })
      .catch((err) => {
        if (!active) return
        setError(err)
        if (err.status === 401) window.location.assign('/login')
      })
    return () => { active = false }
  }, [retry])

  if (error && !user) {
    return <div className="startup"><div className="startup-brand"><strong>Cyber Range</strong></div><div className="notice notice-error" role="alert">{error.message}<button className="text-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div></div>
  }
  if (!user) return <div className="startup"><div className="startup-brand"><strong>Cyber Range</strong></div><p>Loading your workspace…</p></div>
  return <LabsModule user={user} apiBase="/api/labs-module" runtimeApi={runtimeApi} />
}
