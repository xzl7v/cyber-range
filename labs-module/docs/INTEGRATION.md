# Integration guide

CyberPod Labs is a separately mountable module. Its database stores lab content, tasks, attempts, and completion. Authentication remains the host application's responsibility.

## Backend

The public factory is `createLabsModule({ databasePath, resolveUser })` from `server/labs.js`. It returns an Express router and a database `close` function. Mount it under the API prefix chosen by the host:

```js
import { createLabsModule } from './labs-module/server/labs.js'

const labs = createLabsModule({
  databasePath: './data/labs.sqlite',
  resolveUser: (request) => {
    const user = request.user
    if (!user) return null
    return {
      id: String(user.id),
      role: user.role,
      displayName: user.displayName,
    }
  },
})

// Existing authentication middleware must run before this mount.
app.use('/api/labs-module', labs.router)
// Call labs.close() during the host's normal shutdown after requests finish.
```

The returned role must be `instructor` or `student`; map the host's role names inside `resolveUser`. Only return an instructor identity when the host has already authorized that role. A null identity produces 401. The router independently enforces instructor writes and student attempt ownership, regardless of what controls the frontend shows.

Do not reuse the development `X-Dev-User` resolver in the integrated application. Keep the host's existing cookie/token verification, CSRF middleware, origin rules, request logging, and deployment policy. No second login system is needed.

The chosen example mount exposes `/api/labs-module/labs` and `/api/labs-module/attempts/...`. Endpoint suffixes and payloads are specified in [API.md](API.md). The database can remain a separate SQLite file owned by the module. The persistence code is confined to `server/` if the team later chooses to map these entities into its shared database.

### Database structure

| Table | Stored data |
| --- | --- |
| `labs` | UUID primary key, unique slug, and validated lab metadata as JSON |
| `tasks` | UUID primary key, lab foreign key, position, validated task JSON, and private salted answer hashes |
| `attempts` | UUID primary key, lab foreign key, host user ID, start/update timestamps; unique per lab and user |
| `completions` | Attempt/task foreign keys and completion timestamp; unique per attempt and task |

SQLite foreign keys cascade deletions to dependent records. Authoring operations use transactions, and current scores are calculated from completed tasks rather than accepting a client-supplied score. The database contains no passwords or user account table.

## Frontend

The named `LabsModule` export from `src/App.jsx` accepts a trusted current-user object and API base URL:

```jsx
import { LabsModule } from './labs-module/src/App.jsx'
import './labs-module/src/styles.css'

export function LabsPage({ currentUser }) {
  return <LabsModule user={currentUser} apiBase="/api/labs-module" />
}
```

`currentUser` contains `id`, `role`, and `displayName`. The frontend uses normal same-origin credentialed requests. Pass `getRequestHeaders={() => ({ 'X-CSRF-Token': csrfToken })}` when the host requires additional headers. This callback supplies headers from the host's existing authentication contract; the module does not acquire tokens or authenticate users.

The standalone default export is a development wrapper. It fetches development identities and renders a clearly marked selector. The named export does not call the development identity endpoint when mounted with a host user; leave `devUserId`, `developmentUsers`, and `onIdentityChange` unset.

Set `VITE_LABS_API_BASE` to choose another API prefix for the standalone frontend. Keep the deployed frontend and API on one origin or configure the host's existing cross-origin policy deliberately.

The module owns its local hash navigation and its own styles. For a host that also uses hash routing, mount Labs at a dedicated route or adapt the module's navigation boundary to the host router. No platform navigation or dashboard is included.

## Runtime extension boundary

Starting a lab creates or resumes a persistent learning attempt. It does not provision infrastructure. Later integration can use the returned `attempt.id`, `labId`, and authenticated student ID to associate a runtime session. Keep container lifecycle, terminal access, networking, and external event validators in their own services; task content and progress do not depend on a specific cybersecurity tool.

## Editing and progress

Every read projects current database content. Saved task IDs are stable. Instructor updates are atomic, and a supplied `revision` prevents a stale editor from overwriting newer lab changes. The full task array represents the intended saved order and membership; dedicated task CRUD/reorder endpoints provide the same capabilities to other clients.

Expected answers are write-only and are never present in API responses. Scores are derived by the backend from completed tasks and current task scores. Students cannot supply an identity, completion list, or earned score to override server decisions. See the API contract for validation types, publication requirements, and completion invalidation rules.
