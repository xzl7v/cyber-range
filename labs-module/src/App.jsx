import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLabsApi } from './api.js'
import { Icon } from './icons.jsx'

const API_BASE = import.meta.env.VITE_LABS_API_BASE || '/api'
const PERSONA_KEY = 'cyberpod-labs-development-identity'
const THEME_KEY = 'cyberpod-labs-theme'
const labRoute = (id, edit = false) => `#labs/${encodeURIComponent(id)}${edit ? '/edit' : ''}`

function readRoute() {
  try {
    const parts = window.location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent)
    if (parts[0] === 'attempts' && parts[1]) return { type: 'attempt', id: parts[1] }
    if (parts[0] === 'labs' && parts[1] === 'new') return { type: 'editor', id: null }
    if (parts[0] === 'labs' && parts[1]) return { type: parts[2] === 'edit' ? 'editor' : 'detail', id: parts[1] }
  } catch { /* Invalid links return to the catalog. */ }
  return { type: 'catalog' }
}

function useResource(loader, key, poll = false) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const loaderRef = useRef(loader)
  const refreshRef = useRef(null)
  const sequence = useRef(0)
  loaderRef.current = loader
  useEffect(() => {
    let active = true
    setData(null)
    setLoading(true)
    setError(null)
    async function refresh() {
      const request = ++sequence.current
      try {
        const result = await loaderRef.current()
        if (active && request === sequence.current) { setData(result); setError(null) }
      } catch (err) {
        if (active && request === sequence.current) { setError(err); if ([401, 403, 404].includes(err.status)) setData(null) }
      } finally {
        if (active && request === sequence.current) setLoading(false)
      }
    }
    refreshRef.current = refresh
    refresh()
    const refreshVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const timer = poll ? setInterval(refreshVisible, 4000) : null
    if (poll) {
      window.addEventListener('focus', refreshVisible)
      document.addEventListener('visibilitychange', refreshVisible)
    }
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [key, poll])
  return {
    data, loading, error,
    refresh: () => refreshRef.current?.(),
    update: (value) => { ++sequence.current; setData(value); setError(null); setLoading(false) },
  }
}

function describeFields(fields) {
  const labels = { name: 'Lab name', slug: 'URL slug', description: 'Description', difficulty: 'Difficulty', estimatedDuration: 'Estimated duration', category: 'Category', requiredTools: 'Required tools', learningObjectives: 'Learning objectives', instructions: 'Instructions', title: 'Task title', score: 'Score', hints: 'Hints', validationType: 'Validation type', completionRequirements: 'Completion requirements', expectedAnswer: 'Expected answer', requiresPrevious: 'Require previous tasks', caseSensitive: 'Case-sensitive answer', tasks: 'Tasks', revision: 'Saved version' }
  if (Array.isArray(fields)) return fields.join(' · ')
  return Object.entries(fields).map(([path, value]) => {
    const task = path.match(/^tasks\.(\d+)\.(.+)$/)
    const field = task ? task[2] : path
    const label = `${task ? `Task ${Number(task[1]) + 1} · ` : ''}${labels[field] || field.replace(/([a-z])([A-Z])/g, '$1 $2')}`
    return `${label}: ${Array.isArray(value) ? value.join(', ') : value}`
  }).join(' · ')
}

function Alert({ error, onRetry }) {
  if (!error) return null
  return <div className="notice notice-error" role="alert"><Icon name="alert"/><div><strong>{error.status === 404 ? 'This lab is no longer available.' : 'Something needs attention.'}</strong><p>{error.fields ? 'Review the following fields and try again.' : error.message}</p>{error.fields && <p className="field-errors">{describeFields(error.fields)}</p>}{onRetry && <button className="text-button" onClick={onRetry}>Try again</button>}</div></div>
}

function Loading({ label = 'Loading labs…' }) {
  return <div className="loading-state" role="status"><span className="spinner"/>{label}</div>
}

function Status({ lab }) {
  return <div className="chips"><span className={`chip ${lab.published ? 'chip-green' : 'chip-amber'}`}><i/>{lab.published ? 'Published' : 'Draft'}</span>{!lab.enabled && <span className="chip chip-gray">Disabled</span>}</div>
}

function Difficulty({ value }) {
  return <span className={`difficulty difficulty-${String(value).toLowerCase()}`}><i/><i/><i/>{value}</span>
}

function LabMeta({ lab }) {
  return <div className="lab-meta"><Difficulty value={lab.difficulty}/><span><Icon name="clock" size={15}/>{lab.estimatedDuration} min</span><span><Icon name="list" size={15}/>{lab.taskCount ?? lab.tasks?.length ?? 0} tasks</span></div>
}

function EmptyState({ icon = 'labs', title, children, action }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={30}/></div><h2>{title}</h2><p>{children}</p>{action}</div>
}

function ThemeToggle({ theme, onThemeChange }) {
  return <button className="theme-toggle" onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} title={`${theme === 'light' ? 'Dark' : 'Light'} mode`}><Icon name={theme === 'light' ? 'moon' : 'sun'} size={16}/></button>
}

export function LabsModule({ user, apiBase = '/api', runtimeApi, getRequestHeaders, devUserId, developmentUsers, onIdentityChange }) {
  const headersRef = useRef(getRequestHeaders)
  headersRef.current = getRequestHeaders
  const api = useMemo(() => createLabsApi({ baseUrl: apiBase, devUserId, getRequestHeaders: () => headersRef.current?.() || {} }), [apiBase, devUserId])
  const [route, setRoute] = useState(readRoute)
  const [notice, setNotice] = useState(null)
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState(() => { try { return sessionStorage.getItem(THEME_KEY) || 'light' } catch { return 'light' } })
  const pending = useRef(false)
  const dirty = useRef(false)
  const acceptedHash = useRef(window.location.hash || '#labs')
  const instructor = user?.role === 'instructor'
  const markDirty = useCallback((value) => { dirty.current = value }, [])
  const discardAllowed = () => !dirty.current || window.confirm('You have unsaved changes. Leave without saving?')
  
  useEffect(() => {
    try { sessionStorage.setItem(THEME_KEY, theme) } catch { }
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  
  function navigate(hash, { force = false } = {}) {
    if (!force && !discardAllowed()) return false
    dirty.current = false
    acceptedHash.current = hash
    if (window.location.hash === hash) setRoute(readRoute())
    else window.location.hash = hash
    return true
  }
  useEffect(() => {
    function hashChanged() {
      if (dirty.current && !window.confirm('You have unsaved changes. Leave without saving?')) {
        window.history.replaceState(null, '', acceptedHash.current)
        return
      }
      dirty.current = false
      acceptedHash.current = window.location.hash || '#labs'
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    function beforeUnload(event) {
      if (dirty.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('hashchange', hashChanged)
    window.addEventListener('beforeunload', beforeUnload)
    return () => { window.removeEventListener('hashchange', hashChanged); window.removeEventListener('beforeunload', beforeUnload) }
  }, [])
  async function run(work) {
    if (pending.current) return null
    pending.current = true
    setBusy(true)
    setNotice(null)
    try { return await work() }
    finally { pending.current = false; setBusy(false) }
  }
  async function labAction(lab, action, after) {
    if (action === 'delete' && !window.confirm(`Delete "${lab.name || 'Untitled lab'}"? This also deletes its tasks and student progress. This cannot be undone.`)) return
    try {
      await run(async () => {
        if (action === 'delete') await api.deleteLab(lab.id)
        else await api.labAction(lab.id, action)
        const messages = { delete: 'Lab deleted.', duplicate: 'An unpublished copy has been created.', publish: 'Lab published. Students can now access it when enabled.', unpublish: 'Lab unpublished. It is no longer available to students.', enable: 'Lab enabled.', disable: 'Lab disabled. Student access is paused.' }
        setNotice({ message: messages[action] })
        after?.()
      })
    } catch (error) { setNotice({ error }) }
  }
  if (!user || !['student', 'instructor'].includes(user.role)) return <div className="module-unavailable"><Alert error={new Error('The host application must provide a student or instructor identity.')}/></div>
  const viewProps = { api, runtimeApi, instructor, busy, run, navigate, labAction, setNotice }
  const routeKey = `${user.id}:${route.type}:${route.id || ''}`
  return <div className="labs-app" data-theme={theme}>
    <aside className="side-rail">
      <button className="brand" onClick={() => navigate('#labs')} aria-label="CyberPod labs"><span className="brand-symbol"><Icon name="labs" size={27}/></span><span><strong>CyberPod<span className="brand-dot">.</span></strong><small>LABS MODULE</small></span></button>
      <div className="rail-label">WORKSPACE</div>
      <nav aria-label="Labs navigation"><button className="rail-link active" aria-current="page" onClick={() => navigate('#labs')}><Icon name="grid"/>{instructor ? 'Lab management' : 'Available labs'}</button></nav>
      <div className="rail-note"><span className="rail-note-icon"><Icon name={instructor ? 'book' : 'target'}/></span><strong>{instructor ? 'Built for better learning.' : 'Learn by doing.'}</strong><p>{instructor ? 'Turn your knowledge into focused, hands-on labs.' : 'Explore a lab, work through its tasks, and track your progress.'}</p></div>
      <div className="rail-profile"><span className="avatar">{(user.displayName || user.id).slice(0, 1).toUpperCase()}</span><div><strong>{user.displayName || user.id}</strong><span>{instructor ? 'Instructor workspace' : 'Student workspace'}</span></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{instructor ? 'Lab management' : 'Available labs'}</strong></div><div className="topbar-controls">{developmentUsers && <div className="development-control"><span className="development-badge"><i/>Development mode</span><label className="identity-select"><span className="sr-only">Development identity</span><select aria-label="Development identity" value={user.id} disabled={busy} onChange={(event) => { if (discardAllowed()) { dirty.current = false; navigate('#labs', { force: true }); onIdentityChange(event.target.value) } }}>
        {developmentUsers.map((identity) => <option key={identity.id} value={identity.id}>{identity.displayName}</option>)}
      </select></label></div>}<ThemeToggle theme={theme} onThemeChange={setTheme}/></div></header>
      <main className="main-content" id="labs-content">
        {notice?.error && <Alert error={notice.error}/>}
        {notice?.message && <div className="notice notice-success" role="status"><Icon name="check"/><span>{notice.message}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice(null)}><Icon name="close" size={16}/></button></div>}
        {route.type === 'catalog' && <Catalog key={routeKey} {...viewProps}/>}
        {route.type === 'detail' && <LabDetail key={routeKey} id={route.id} {...viewProps}/>}
        {route.type === 'editor' && (instructor ? <LabEditor key={routeKey} id={route.id} markDirty={markDirty} {...viewProps}/> : <EmptyState icon="lock" title="Instructor access required" action={<button className="button primary" onClick={() => navigate('#labs')}>Back to labs</button>}>Lab editing is available in the instructor workspace.</EmptyState>)}
        {route.type === 'attempt' && (!instructor ? <AttemptWorkspace key={routeKey} id={route.id} {...viewProps}/> : <EmptyState icon="lock" title="Student workspace" action={<button className="button primary" onClick={() => navigate('#labs')}>Back to labs</button>}>Lab attempts belong to the student who starts them.</EmptyState>)}
      </main>
      <footer className="page-footer"><span>CyberPod / Labs</span><span>Knowledge. Practice. Progress.</span></footer>
    </div>
  </div>
}

function Catalog({ api, instructor, busy, navigate, labAction }) {
  const resource = useResource(() => api.listLabs(), 'catalog', !instructor)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const labs = resource.data?.labs || []
  const filtered = labs.filter((lab) => `${lab.name} ${lab.description} ${lab.category}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'published' ? lab.published : filter === 'draft' ? !lab.published : lab.difficulty === filter)))
  return <>
   <div className="page-heading">
  <div>
    <div className="eyebrow">{instructor ? 'CREATE · TEACH · ITERATE' : 'EXPLORE · PRACTICE · GROW'}</div>
    <h1>{instructor ? 'Your learning labs' : 'Find your next challenge'}</h1>
    <p>{instructor ? 'Create purposeful labs and give your students a place to practice.' : 'Build practical skills, one focused lab at a time.'}</p>
  </div>
  {instructor && <button className="button primary" disabled={busy} onClick={() => navigate('#labs/new')}><Icon name="plus" size={18}/>Create lab</button>}
</div>
    {!resource.loading && resource.data && <div className="catalog-summary"><div><strong>{labs.length.toString().padStart(2, '0')}</strong><span>{instructor ? 'Total labs' : 'Available labs'}</span></div><div><strong>{(instructor ? labs.filter((lab) => lab.published && lab.enabled).length : labs.reduce((sum, lab) => sum + (lab.taskCount || 0), 0)).toString().padStart(2, '0')}</strong><span>{instructor ? 'Live for students' : 'Practical tasks'}</span></div><div className="summary-note"><Icon name={instructor ? 'book' : 'target'} size={24}/><p>{instructor ? 'Draft at your own pace. Publish when your lab is ready.' : 'Your progress is saved as you complete each task.'}</p></div></div>}
    <div className="catalog-toolbar"><div className="section-title"><h2>{instructor ? 'Lab library' : 'Available labs'}</h2>{!resource.loading && <span>{filtered.length}</span>}</div><div className="catalog-filters"><label className="search-box"><Icon name="search" size={18}/><input aria-label="Search labs" placeholder="Search labs…" value={search} onChange={(event) => setSearch(event.target.value)}/></label><select aria-label={instructor ? 'Filter by publication status' : 'Filter by difficulty'} value={filter} onChange={(event) => setFilter(event.target.value)}>{instructor ? <><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Drafts</option></> : <><option value="all">All difficulties</option><option>Easy</option><option>Medium</option><option>Hard</option></>}</select></div></div>
    <Alert error={resource.error} onRetry={resource.refresh}/>
    {resource.loading ? <Loading/> : !labs.length && !resource.error ? <EmptyState title={instructor ? 'A good lab starts with an idea.' : 'Your next lab is on its way.'} action={instructor && <button className="button primary" onClick={() => navigate('#labs/new')}><Icon name="plus" size={18}/>Create your first lab</button>}>{instructor ? 'Add a lab, shape its tasks, and publish it when you are ready.' : 'Published labs will appear here when your instructor makes them available.'}</EmptyState> : !filtered.length && !resource.error ? <EmptyState icon="search" title="No matching labs">Try another search or change your filter.</EmptyState> : <div className="lab-grid">{filtered.map((lab, index) => <article className="lab-card" data-testid="lab-card" key={lab.id}>
      <div className="lab-card-top"><span className={`lab-icon lab-icon-${index % 3}`}><Icon name="labs" size={24}/></span>{instructor ? <Status lab={lab}/> : <span className="category-tag">{lab.category || 'General'}</span>}</div>
      {instructor && <div className="card-category">{lab.category || 'General'}</div>}<h3>{lab.name || 'Untitled lab'}</h3><p className="card-description">{lab.description || 'Add a description to introduce this lab.'}</p>
      <LabMeta lab={lab}/><div className="card-score"><span>{lab.totalScore || 0} points</span><span>{instructor ? 'Lab total' : 'Ready to explore'}</span></div>
      <div className="card-actions">{instructor ? <><button className="button primary small" disabled={busy} onClick={() => navigate(labRoute(lab.id, true))}><Icon name="edit" size={15}/>Edit lab</button><button className="button secondary small" onClick={() => navigate(labRoute(lab.id))}>View lab</button><button className="icon-button" aria-label="Duplicate lab" title="Duplicate lab" disabled={busy} onClick={() => labAction(lab, 'duplicate', resource.refresh)}><Icon name="copy" size={17}/></button><button className="icon-button danger-text" aria-label="Delete lab" title="Delete lab" disabled={busy} onClick={() => labAction(lab, 'delete', resource.refresh)}><Icon name="trash" size={17}/></button></> : <button className="button card-open" disabled={busy || Boolean(resource.error)} onClick={() => navigate(labRoute(lab.id))}>View lab<Icon name="arrow" size={18}/></button>}</div>
    </article>)}</div>}
  </>
}

function BackButton({ navigate }) {
  return <button className="back-button" onClick={() => navigate('#labs')}><Icon name="back" size={17}/>Back to labs</button>
}

function LabDetail({ id, api, instructor, busy, run, navigate, labAction, setNotice }) {
  const resource = useResource(() => api.getLab(id), id, !instructor)
  const lab = resource.data?.lab
  async function start() {
    try { await run(async () => { const { attempt } = await api.startLab(id); navigate(`#attempts/${encodeURIComponent(attempt.id)}`) }) }
    catch (error) { setNotice({ error }) }
  }
  return <><BackButton navigate={navigate}/><Alert error={resource.error} onRetry={resource.refresh}/>{resource.loading ? <Loading label="Loading lab…"/> : lab && <>
    <div className="detail-hero"><div className="detail-hero-copy"><div className="eyebrow">{lab.category || 'LEARNING LAB'}</div><h1>{lab.name || 'Untitled lab'}</h1><p>{lab.description || 'This draft has no description yet.'}</p><LabMeta lab={lab}/></div><div className="detail-hero-mark"><Icon name="labs" size={70}/><span>LEARN BY DOING</span></div></div>
    {instructor && <div className="management-bar"><Status lab={lab}/><div className="management-actions"><button className="button primary small" disabled={busy} onClick={() => navigate(labRoute(id, true))}><Icon name="edit" size={15}/>Edit lab</button><button className="button secondary small" disabled={busy} onClick={() => labAction(lab, lab.published ? 'unpublish' : 'publish', resource.refresh)}>{lab.published ? 'Unpublish lab' : 'Publish lab'}</button><button className="button secondary small" disabled={busy} onClick={() => labAction(lab, lab.enabled ? 'disable' : 'enable', resource.refresh)}>{lab.enabled ? 'Disable lab' : 'Enable lab'}</button><button className="icon-button" aria-label="Duplicate lab" title="Duplicate lab" disabled={busy} onClick={() => labAction(lab, 'duplicate', () => navigate('#labs'))}><Icon name="copy" size={18}/></button><button className="icon-button danger-text" aria-label="Delete lab" title="Delete lab" disabled={busy} onClick={() => labAction(lab, 'delete', () => navigate('#labs'))}><Icon name="trash" size={18}/></button></div></div>}
    <div className="detail-layout"><div className="detail-main"><section className="content-panel"><div className="panel-heading"><Icon name="target"/><h2>What you will learn</h2></div>{lab.learningObjectives?.length ? <ul className="objective-list">{lab.learningObjectives.map((objective, i) => <li key={i}><Icon name="check" size={17}/><span>{objective}</span></li>)}</ul> : <p className="muted">No learning objectives added yet.</p>}</section><section className="content-panel"><div className="panel-heading"><Icon name="book"/><h2>Lab instructions</h2></div><p className="preserve-text">{lab.instructions || 'No instructions added yet.'}</p></section><section className="content-panel"><div className="panel-heading"><Icon name="list"/><h2>Your task list</h2><span className="count-pill">{lab.tasks.length}</span></div><div className="task-preview-list">{lab.tasks.map((task, index) => <article key={task.id}><span className="task-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{task.title || 'Untitled task'}</h3><p>{task.description}</p>{task.completionRequirements && <small>{task.completionRequirements}</small>}</div><span className="task-points">{task.score} pts</span></article>)}</div>{!lab.tasks.length && <p className="muted">No tasks added yet.</p>}</section></div>
      <aside className="detail-sidebar"><section className="content-panel start-panel"><span className="eyebrow">YOUR NEXT STEP</span><h2>{instructor ? 'Ready for your students?' : 'Put your knowledge to work.'}</h2><p>{instructor ? 'Preview the content, then publish this lab to make it available.' : 'Start a new attempt or pick up where you left off.'}</p><div className="detail-facts"><div><span>Total score</span><strong>{lab.totalScore} points</strong></div><div><span>Tasks</span><strong>{lab.tasks.length}</strong></div><div><span>Estimated time</span><strong>{lab.estimatedDuration} minutes</strong></div></div>{!instructor && <button className="button primary full" disabled={busy || Boolean(resource.error)} onClick={start}>{busy ? 'Starting…' : 'Start lab'}<Icon name="arrow" size={18}/></button>}<p className="small-note">{instructor ? 'Students see only published, enabled labs.' : 'Your task progress is saved automatically.'}</p></section><section className="content-panel"><h2>Tools you will use</h2><div className="tool-tags">{lab.requiredTools?.length ? lab.requiredTools.map((tool, i) => <span key={i}>{tool}</span>) : <p className="muted">No specific tools required.</p>}</div></section></aside>
    </div></>}</>
}

const newTask = () => ({ title: '', description: '', score: 10, hints: [], validationType: 'acknowledgement', completionRequirements: '', requiresPrevious: false, caseSensitive: true, expectedAnswer: '', hasAnswer: false, editorKey: crypto.randomUUID() })
const initialLab = () => ({ name: '', slug: '', description: '', difficulty: 'Easy', estimatedDuration: 30, category: '', requiredTools: [], learningObjectives: [], instructions: '', enabled: true, published: false, tasks: [] })
function editableLab(lab) {
  return { ...lab, toolsText: (lab.requiredTools || []).join('\n'), objectivesText: (lab.learningObjectives || []).join('\n'), tasks: (lab.tasks || []).map((task) => ({ ...task, editorKey: task.id || crypto.randomUUID(), hintsText: (task.hints || []).join('\n') })) }
}
const linesFrom = (text, commas = false) => text.split(commas ? /[\n,]/ : /\n/).map((line) => line.trim()).filter(Boolean)

function LabEditor({ id, api, busy, run, navigate, markDirty, setNotice }) {
  const [form, setForm] = useState(() => editableLab(initialLab()))
  const [loading, setLoading] = useState(Boolean(id))
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true)
    api.getLab(id).then(({ lab }) => { if (active) { setForm(editableLab(lab)); setError(null) } }).catch((err) => { if (active) setError(err) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, id, retry])
  function change(update) {
    setForm((current) => ({ ...current, ...update }))
    setDirty(true); markDirty(true); setSaveMessage('')
  }
  function changeTask(index, update) { change({ tasks: form.tasks.map((task, i) => i === index ? { ...task, ...update } : task) }) }
  function moveTask(index, direction) {
    const tasks = [...form.tasks]
    const other = index + direction
    if (other < 0 || other >= tasks.length) return
    ;[tasks[index], tasks[other]] = [tasks[other], tasks[index]]
    change({ tasks })
  }
  async function save(publish = false) {
    setError(null); setSaveMessage('')
    try {
      await run(async () => {
        const payload = {
          name: form.name, ...(form.slug.trim() ? { slug: form.slug.trim() } : {}), description: form.description,
          difficulty: form.difficulty, estimatedDuration: Number(form.estimatedDuration), category: form.category,
          requiredTools: linesFrom(form.toolsText, true), learningObjectives: linesFrom(form.objectivesText),
          instructions: form.instructions, enabled: form.enabled,
          ...(form.revision !== undefined ? { revision: form.revision } : {}),
          tasks: form.tasks.map((task, index) => ({
            ...(task.id ? { id: task.id } : {}), title: task.title, description: task.description, order: index,
            score: Number(task.score), hints: linesFrom(task.hintsText || ''), validationType: task.validationType,
            completionRequirements: task.completionRequirements, requiresPrevious: task.requiresPrevious, caseSensitive: task.caseSensitive,
            ...(task.expectedAnswer !== undefined ? { expectedAnswer: task.expectedAnswer } : {}),
          })),
        }
        let { lab } = await api.saveLab(id, payload)
        setForm(editableLab(lab)); setDirty(false); markDirty(false)
        const message = lab.published ? 'Changes saved.' : 'Draft saved.'
        setSaveMessage(message)
        if (publish) {
          try { ({ lab } = await api.labAction(lab.id, 'publish')); setForm(editableLab(lab)); setSaveMessage('Lab published. Students can now access it when enabled.') }
          catch (publishError) {
            if (!id) { setNotice({ error: publishError }); navigate(labRoute(lab.id, true), { force: true }); return }
            throw publishError
          }
        }
        if (!id) { setNotice({ message: publish ? 'Lab published. Students can now access it when enabled.' : message }); navigate(labRoute(lab.id, true), { force: true }) }
      })
    } catch (err) { setError(err) }
  }
  const totalScore = form.tasks.reduce((total, task) => total + (Number(task.score) || 0), 0)
  return <><BackButton navigate={navigate}/><div className="page-heading builder-heading"><div><div className="eyebrow">LAB BUILDER</div><h1>{id ? 'Shape your lab' : 'Create something worth learning'}</h1><p>{id ? 'Refine the content, tasks, and outcomes for your students.' : 'Start with the essentials. Build the experience one task at a time.'}</p></div><span className={`save-indicator ${dirty ? 'unsaved' : ''}`}><i/>{dirty ? 'Unsaved changes' : id ? 'All changes saved' : 'New draft'}</span></div>
    <Alert error={error} onRetry={loading || !id || form.id ? undefined : () => setRetry((value) => value + 1)}/>{saveMessage && <div className="notice notice-success" role="status"><Icon name="check"/>{saveMessage}</div>}
    {loading ? <Loading label="Loading builder…"/> : id && !form.id ? null : <form className="builder-layout" onSubmit={(event) => { event.preventDefault(); save() }}>
      <div className="builder-main"><section className="content-panel builder-section"><div className="builder-section-heading"><span className="section-index">01</span><div><h2>The essentials</h2><p>Give students a clear picture of this lab.</p></div></div><div className="form-grid"><label className="field span-2">Lab name<input aria-label="Lab name" value={form.name} maxLength={200} placeholder="Give your lab a memorable name" disabled={busy} onChange={(event) => change({ name: event.target.value })}/></label><label className="field span-2">Description<textarea aria-label="Description" rows={3} value={form.description} placeholder="What will students practice in this lab?" disabled={busy} onChange={(event) => change({ description: event.target.value })}/></label><label className="field">Category<input aria-label="Category" value={form.category} placeholder="e.g. Network fundamentals" disabled={busy} onChange={(event) => change({ category: event.target.value })}/></label><label className="field">URL slug<input aria-label="URL slug" value={form.slug} placeholder="Generated from the lab name" disabled={busy} onChange={(event) => change({ slug: event.target.value })}/><small>A short, readable identifier.</small></label><label className="field">Difficulty<select aria-label="Difficulty" value={form.difficulty} disabled={busy} onChange={(event) => change({ difficulty: event.target.value })}><option>Easy</option><option>Medium</option><option>Hard</option></select></label><label className="field">Estimated duration (minutes)<input aria-label="Estimated duration (minutes)" type="number" min="1" max="1440" step="1" value={form.estimatedDuration} disabled={busy} onChange={(event) => change({ estimatedDuration: event.target.value })}/></label><label className="field span-2">Required tools<textarea aria-label="Required tools" rows={2} value={form.toolsText} placeholder="One tool per line" disabled={busy} onChange={(event) => change({ toolsText: event.target.value })}/><small>Separate tools with a new line or a comma.</small></label></div></section>
      <section className="content-panel builder-section"><div className="builder-section-heading"><span className="section-index">02</span><div><h2>The learning experience</h2><p>Set clear goals and explain how to get started.</p></div></div><div className="form-grid"><label className="field span-2">Learning objectives<textarea aria-label="Learning objectives" rows={3} value={form.objectivesText} placeholder="One learning objective per line" disabled={busy} onChange={(event) => change({ objectivesText: event.target.value })}/></label><label className="field span-2">Instructions<textarea aria-label="Instructions" rows={6} value={form.instructions} placeholder="Write the setup, context, and instructions students need." disabled={busy} onChange={(event) => change({ instructions: event.target.value })}/><small>Text is displayed exactly as written, with line breaks preserved.</small></label></div></section>
      <section className="tasks-builder"><div className="builder-section-heading"><span className="section-index">03</span><div><h2>Build the task list</h2><p>Define each step, its completion requirements, and its score.</p></div><span className="count-pill">{form.tasks.length}</span></div>
        {!form.tasks.length && <div className="empty-tasks"><Icon name="list" size={28}/><h3>Every lab needs a first step.</h3><p>Add a task to begin shaping the student experience.</p></div>}
        {form.tasks.map((task, index) => <fieldset className="task-editor" data-testid="task-editor" key={task.editorKey} disabled={busy}><legend>Task {index + 1}</legend><div className="task-editor-toolbar"><span className="task-editor-type">{task.validationType === 'acknowledgement' ? 'Acknowledgement' : task.validationType === 'flag' ? 'Flag validation' : 'Answer validation'}</span><div><button type="button" className="icon-button" aria-label="Move task up" title="Move task up" disabled={busy || index === 0} onClick={() => moveTask(index, -1)}><Icon name="up" size={18}/></button><button type="button" className="icon-button" aria-label="Move task down" title="Move task down" disabled={busy || index === form.tasks.length - 1} onClick={() => moveTask(index, 1)}><Icon name="down" size={18}/></button><button type="button" className="icon-button danger-text" aria-label="Delete task" title="Delete task" disabled={busy} onClick={() => { if (window.confirm(`Delete task ${index + 1}? Save the lab to apply this change.`)) change({ tasks: form.tasks.filter((_, i) => i !== index) }) }}><Icon name="trash" size={17}/></button></div></div><div className="form-grid"><label className="field span-2">Task title<input aria-label="Task title" value={task.title} placeholder="What should the student do?" onChange={(event) => changeTask(index, { title: event.target.value })}/></label><label className="field span-2">Task description<textarea aria-label="Task description" rows={3} value={task.description} placeholder="Describe this step in enough detail to get started." onChange={(event) => changeTask(index, { description: event.target.value })}/></label><label className="field">Validation type<select aria-label="Validation type" value={task.validationType} onChange={(event) => changeTask(index, { validationType: event.target.value })}><option value="acknowledgement">Acknowledgement</option><option value="answer">Answer</option><option value="flag">Flag</option></select></label><label className="field">Score<input aria-label="Score" type="number" min="0" max="10000" step="1" value={task.score} onChange={(event) => changeTask(index, { score: event.target.value })}/></label><label className="field span-2">Completion requirements<textarea aria-label="Completion requirements" rows={2} value={task.completionRequirements} placeholder="Explain what counts as completing this task." onChange={(event) => changeTask(index, { completionRequirements: event.target.value })}/></label>{task.validationType !== 'acknowledgement' && <label className="field span-2">Expected answer<input aria-label="Expected answer" type="password" autoComplete="new-password" value={task.expectedAnswer ?? ''} placeholder={task.hasAnswer ? 'Answer saved. Leave unchanged to keep it.' : 'Enter the expected answer or flag'} onChange={(event) => changeTask(index, { expectedAnswer: event.target.value })}/><small>{task.hasAnswer ? 'The saved answer is hidden. Enter a replacement to change it.' : 'This answer is checked by the server and never shown to students.'}</small></label>}<label className="field span-2">Hints<textarea aria-label="Hints" rows={3} value={task.hintsText || ''} placeholder="One hint per line" onChange={(event) => changeTask(index, { hintsText: event.target.value })}/></label><div className="task-options span-2"><label className="check-field"><input type="checkbox" checked={task.requiresPrevious} onChange={(event) => changeTask(index, { requiresPrevious: event.target.checked })}/>Require previous tasks</label>{task.validationType !== 'acknowledgement' && <label className="check-field"><input type="checkbox" checked={task.caseSensitive} onChange={(event) => changeTask(index, { caseSensitive: event.target.checked })}/>Case-sensitive answer</label>}</div></div></fieldset>)}
        <button className="add-task-button" type="button" disabled={busy} onClick={() => change({ tasks: [...form.tasks, { ...newTask(), hintsText: '' }] })}><Icon name="plus" size={20}/>Add task</button>
      </section></div>
      <aside className="builder-sidebar"><section className="content-panel publish-panel"><span className="eyebrow">LAB OVERVIEW</span><h2>{form.name || 'Your new lab'}</h2><Status lab={form}/><div className="detail-facts"><div><span>Tasks</span><strong>{form.tasks.length}</strong></div><div><span>Total score</span><strong>{totalScore} points</strong></div><div><span>Estimated time</span><strong>{form.estimatedDuration || 0} min</strong></div></div><label className="check-field enabled-toggle"><input type="checkbox" checked={form.enabled} disabled={busy} onChange={(event) => change({ enabled: event.target.checked })}/><span>Enable this lab<small>Students can access it when published.</small></span></label><button className="button primary full" type="submit" disabled={busy}>{busy ? 'Saving…' : form.published ? 'Save changes' : 'Save draft'}</button>{!form.published && <button className="button secondary full" type="button" disabled={busy} onClick={() => save(true)}>Publish lab<Icon name="arrow" size={16}/></button>}<p className="small-note">{form.published ? 'Saved changes apply to the live lab and existing student attempts.' : 'Save a draft at any time. Publishing requires instructions and at least one complete task.'}</p></section><div className="builder-tip"><Icon name="hint" size={21}/><div><strong>Make the next step clear.</strong><p>Small, focused tasks help students build confidence as they work.</p></div></div></aside>
    </form>}</>
}

function AttemptWorkspace({ id, api, runtimeApi, busy, run, navigate }) {
  const resource = useResource(() => api.getAttempt(id), id, true)
  const sessionResource = useResource(() => runtimeApi ? runtimeApi.getSessionByAttempt(id) : Promise.resolve({ session: null }), `runtime:${id}:${Boolean(runtimeApi)}`, Boolean(runtimeApi))
  const [answers, setAnswers] = useState({})
  const [hints, setHints] = useState({})
  const [feedback, setFeedback] = useState({})
  const attempt = resource.data?.attempt
  const session = sessionResource.data?.session || null
  const progress = attempt?.progress
  useEffect(() => {
    if (session?.id) {
      document.cookie = `cyber_range_kali_session=${encodeURIComponent(session.id)}; Path=/; SameSite=Lax`
    }
  }, [session?.id])
  async function submit(task) {
    try {
      await run(async () => {
        const result = await api.submit(id, task.id, task.validationType === 'acknowledgement' ? { completed: true } : { answer: answers[task.id] || '' })
        resource.update({ attempt: result.attempt })
        setFeedback((current) => ({ ...current, [task.id]: { correct: result.correct, message: result.message || (result.correct ? 'Task completed.' : 'That answer is not correct. Try again.') } }))
      })
    } catch (error) { setFeedback((current) => ({ ...current, [task.id]: { correct: false, message: error.message } })) }
  }
  async function stopEnvironment() {
    if (!session) return
    try { await run(async () => { await runtimeApi.stopSession(session.id); sessionResource.refresh() }) }
    catch (error) { sessionResource.update({ session: { ...session, runtimeError: error.message } }) }
  }
  async function endLab() {
    if (!session) { navigate('#labs'); return }
    try { await run(async () => { await runtimeApi.deleteSession(session.id); navigate('#labs') }) }
    catch (error) { sessionResource.update({ session: { ...session, runtimeError: error.message } }) }
  }
  const runtimeLoading = sessionResource.loading && Boolean(runtimeApi)
  return <><BackButton navigate={navigate}/><Alert error={resource.error} onRetry={resource.refresh}/><Alert error={sessionResource.error} onRetry={sessionResource.refresh}/>{resource.loading ? <Loading label="Opening your workspace…"/> : attempt && <>
    <div className="page-heading workspace-heading"><div><div className="eyebrow">YOUR LAB WORKSPACE</div><h1>{attempt.lab.name}</h1><p>{attempt.lab.description}</p></div><span className={`chip ${progress.completed ? 'chip-green' : 'chip-teal'}`}><i/>{progress.completed ? 'Completed' : 'In progress'}</span></div>
    <div className="attempt-progress" data-testid="attempt-progress"><div className="progress-stat"><span>Points earned</span><strong>{progress.earnedScore} <small>/ {progress.totalScore}</small></strong></div><div className="progress-stat"><span>Tasks completed</span><strong>{progress.completedTasks} <small>/ {progress.totalTasks}</small></strong></div><div className="progress-meter"><div><span>Progress</span><strong>{progress.percent}%</strong></div><div className="progress-track" role="progressbar" aria-label="Lab progress" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress.percent}%` }}/></div><small>Saved automatically as you complete tasks</small></div></div>
    {progress.completed && <div className="completion-banner" role="status"><span><Icon name="check" size={24}/></span><div><h2>Lab completed</h2><p>You have completed every task and earned {progress.earnedScore} points.</p></div><button className="button secondary" onClick={() => navigate('#labs')}>Explore more labs<Icon name="arrow" size={17}/></button></div>}
    {runtimeApi && <section className="content-panel runtime-panel">
      <div className="panel-heading"><Icon name="target"/><h2>Practice environment</h2>{session && <span className={`chip ${session.status === 'RUNNING' ? 'chip-green' : session.status === 'FAILED' ? 'chip-red' : 'chip-amber'}`}><i/>{session.status || 'Unknown'}</span>}</div>
      {runtimeLoading ? <Loading label="Preparing your isolated environment…"/> : session?.runtimeError ? <div className="notice notice-error" role="alert"><Icon name="alert"/><span>{session.runtimeError}</span><button className="button secondary small" onClick={sessionResource.refresh}>Retry</button></div> : session ? <div className="runtime-body">
        <div className="runtime-actions"><span className="muted">{session.targetName ? `Target: ${session.targetName}` : 'Kali workspace'}</span><div><button className="button secondary small" disabled={busy || session.status === 'STOPPED'} onClick={stopEnvironment}>{session.status === 'STOPPED' ? 'Stopped' : 'Stop environment'}</button><button className="button danger small" disabled={busy} onClick={endLab}>End lab & clean up</button></div></div>
        {session.status === 'RUNNING' && session.kaliUrl && <iframe className="kali-frame" src={session.kaliUrl} title="Kali Linux desktop" allow="clipboard-read; clipboard-write" />}
        {session.status !== 'RUNNING' && <div className="runtime-placeholder"><Icon name="target" size={34}/><p>Your environment is {String(session.status).toLowerCase()}. {session.status === 'STOPPED' ? 'Start the lab again to resume, or end it to remove its containers.' : 'It should become ready shortly.'}</p></div>}
      </div> : <p className="muted">No practice environment has been started yet.</p>}
    </section>}
    <div className="workspace-layout"><div className="workspace-tasks"><div className="section-title"><h2>Work through the tasks</h2><span>{attempt.lab.tasks.length}</span></div>{attempt.lab.tasks.map((task, index) => {
      const completed = progress.completedTaskIds.includes(task.id)
      const locked = task.requiresPrevious && attempt.lab.tasks.slice(0, index).some((previous) => !progress.completedTaskIds.includes(previous.id))
      const disabled = busy || completed || locked || Boolean(resource.error)
      return <article key={task.id} className={`workspace-task ${completed ? 'task-completed' : ''} ${locked ? 'task-locked' : ''}`} data-testid="workspace-task"><header><span className={`task-number ${completed ? 'completed-number' : ''}`}>{completed ? <Icon name="check" size={19}/> : locked ? <Icon name="lock" size={17}/> : String(index + 1).padStart(2, '0')}</span><div><span className="task-kicker">TASK {String(index + 1).padStart(2, '0')}</span><h3>{task.title}</h3></div><span className="task-points">{task.score} pts</span></header><p className="preserve-text">{task.description}</p>{task.completionRequirements && <div className="requirements"><strong>Completion requirements</strong><p className="preserve-text">{task.completionRequirements}</p></div>}{locked && <div className="locked-note"><Icon name="lock" size={15}/>Complete all previous tasks to unlock this step.</div>}{task.hints?.length > 0 && <div className="hints"><button className="text-button" aria-expanded={Boolean(hints[task.id])} onClick={() => setHints((current) => ({ ...current, [task.id]: !current[task.id] }))}><Icon name="hint" size={16}/>{hints[task.id] ? 'Hide hints' : 'Show hints'}<span>{task.hints.length}</span></button>{hints[task.id] && <ol>{task.hints.map((hint, i) => <li key={i}>{hint}</li>)}</ol>}</div>}<form className="task-submission" onSubmit={(event) => { event.preventDefault(); submit(task) }}>{task.validationType !== 'acknowledgement' ? <><label className="field">Your answer<input aria-label="Your answer" value={answers[task.id] || ''} disabled={disabled} placeholder={task.validationType === 'flag' ? 'Enter the flag you found' : 'Enter your answer'} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={4096} onChange={(event) => setAnswers((current) => ({ ...current, [task.id]: event.target.value }))}/></label><button className={`button ${completed ? 'completed-button' : 'primary'}`} disabled={disabled || !answers[task.id]?.trim()} type="submit">{completed ? <><Icon name="check" size={16}/>Completed</> : task.validationType === 'flag' ? 'Submit flag' : 'Submit answer'}</button></> : <button className={`button ${completed ? 'completed-button' : 'primary'}`} type="submit" disabled={disabled}>{completed ? <><Icon name="check" size={16}/>Completed</> : 'Complete task'}</button>}</form>{feedback[task.id] && (!feedback[task.id].correct || completed) && <p className={`submission-feedback ${feedback[task.id].correct ? 'correct' : 'incorrect'}`} role={feedback[task.id].correct ? 'status' : 'alert'}>{feedback[task.id].message}</p>}</article>
    })}</div><aside className="workspace-sidebar"><section className="content-panel"><div className="panel-heading"><Icon name="book"/><h2>Lab guide</h2></div><p className="preserve-text">{attempt.lab.instructions}</p></section>{attempt.lab.learningObjectives?.length > 0 && <section className="content-panel"><h2>Learning objectives</h2><ul className="objective-list compact">{attempt.lab.learningObjectives.map((objective, i) => <li key={i}><Icon name="target" size={16}/><span>{objective}</span></li>)}</ul></section>}<section className="content-panel"><h2>Required tools</h2><div className="tool-tags">{attempt.lab.requiredTools?.length ? attempt.lab.requiredTools.map((tool, i) => <span key={i}>{tool}</span>) : <p className="muted">No specific tools required.</p>}</div></section><p className="workspace-update-note">Lab content stays up to date with your instructor's changes.</p></aside></div>
  </>}</>
}

export default function App() {
  const [users, setUsers] = useState(null)
  const [userId, setUserId] = useState(() => { try { return sessionStorage.getItem(PERSONA_KEY) || 'instructor' } catch { return 'instructor' } })
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(0)
  const [theme, setTheme] = useState(() => { try { return sessionStorage.getItem(THEME_KEY) || 'light' } catch { return 'light' } })
  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  
  useEffect(() => {
    let active = true
    setError(null)
    createLabsApi({ baseUrl: API_BASE }).developmentUsers().then((result) => {
      if (!active) return
      if (!result.users?.length) throw new Error('No development identities are available.')
      setUsers(result.users)
      setUserId((current) => result.users.some((user) => user.id === current) ? current : result.users[0].id)
    }).catch((err) => { if (active) setError(err) })
    return () => { active = false }
  }, [retry])
  function changeIdentity(id) {
    setUserId(id)
    try { sessionStorage.setItem(PERSONA_KEY, id) } catch { /* In-memory selection still works. */ }
  }
  if (!users) return <div className="startup"><div className="startup-brand"><Icon name="labs" size={30}/><strong>CyberPod<span>.</span></strong></div><span className="development-badge">Development mode</span>{error ? <Alert error={error} onRetry={() => setRetry((value) => value + 1)}/> : <Loading label="Opening the labs module…"/>}</div>
  const user = users.find((identity) => identity.id === userId)
  return <LabsModule key={user.id} user={user} apiBase={API_BASE} devUserId={user.id} developmentUsers={users} onIdentityChange={changeIdentity}/>
}