import { useEffect, useMemo, useState } from 'react'
import { LabsModule } from './App.jsx'
import { createRuntimeApi } from './api.js'

const roleLabels = {
  student: 'Student workspace',
  instructor: 'Instructor workspace',
}

const dashboardButtonStyle = {
  minWidth: 190,
  minHeight: 44,
  padding: '11px 18px',
  borderRadius: 7,
  border: '1px solid #dce4e8',
  background: '#ffffff',
  color: '#445b69',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

export default function HostApp() {
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
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
        setUser(data.user)
      })
      .catch((err) => {
        if (!active) return
        setError(err)
        if (err.status === 401) window.location.assign('/login')
      })
    return () => { active = false }
  }, [retry])

  async function chooseRole(role) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/session/role', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error?.message || data?.message || 'Could not open that workspace.')
      setUser(data.user)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (error && !user) {
    return (
      <div className="startup">
        <div className="startup-brand"><strong>Cyber Range</strong></div>
        <div className="notice notice-error" role="alert">
          {error.message}
          <button className="text-button" onClick={() => setRetry((value) => value + 1)}>Try again</button>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="startup">
        <div className="startup-brand"><strong>Cyber Range</strong></div>
        <p>Loading your workspace…</p>
      </div>
    )
  }

  const activeRole = ['student', 'instructor'].includes(user.role) ? user.role : null
  if (!activeRole) {
    return (
      <div className="startup">
        <div className="startup-brand"><strong>Cyber Range</strong></div>
        <h1 style={{ margin: 0, fontSize: 30 }}>Choose your workspace</h1>
        <p style={{ margin: 0, color: '#61717f', maxWidth: 520, textAlign: 'center' }}>
          You are signed in as <strong>{user.username}</strong>. Select the area you want to open.
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button
            disabled={busy}
            onClick={() => chooseRole('student')}
            style={{ ...dashboardButtonStyle, background: '#098b78', borderColor: '#098b78', color: '#fff' }}
          >
            {roleLabels.student}
          </button>
          <button
            disabled={busy}
            onClick={() => chooseRole('instructor')}
            style={dashboardButtonStyle}
          >
            {roleLabels.instructor}
          </button>
        </div>
        {error && <div className="notice notice-error" role="alert">{error.message}</div>}
      </div>
    )
  }

  async function switchRole() {
    await chooseRole(activeRole === 'student' ? 'instructor' : 'student')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={switchRole}
        disabled={busy}
        style={{
          position: 'fixed',
          top: 16,
          right: 18,
          zIndex: 20,
          border: '1px solid #dce4e8',
          background: '#fff',
          color: '#445b69',
          borderRadius: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Switch to {activeRole === 'student' ? roleLabels.instructor : roleLabels.student}
      </button>
      {error && (
        <div className="notice notice-error" role="alert" style={{ position: 'fixed', top: 70, right: 18, zIndex: 20 }}>
          {error.message}
        </div>
      )}
      <LabsModule key={activeRole} user={user} apiBase="/api/labs-module" runtimeApi={runtimeApi} />
    </div>
  )
}
