# Labs API contract

All endpoints are relative to `/api`. This is a standalone content and progress module; it does not implement authentication or provision runtime environments. All names and content created by the module are in English.

## Identity boundary

The exported `createLabsModule({ databasePath, resolveUser })` factory returns `{ router, close }`. Mount `router` in an existing Express application. `resolveUser(request)` returns an authenticated `{ id, role, displayName }` identity with role `instructor` or `student`, or null. The host owns authentication. Every modifying instructor endpoint enforces the role on the server. Students own their attempts.

The local development server runs with an explicit `--dev` flag, binds to loopback, and maps `X-Dev-User` to `instructor`, `student-a`, or `student-b`. These are temporary development identities, not authentication. `GET /api/dev/users` returns `{ users: [{ id, role, displayName }] }` only in development mode. The frontend prominently identifies this mode. The standalone server must reject development mode with `NODE_ENV=production`.

## Payloads

Lab fields: `id`, `code`, `slug`, `name`, `description`, `difficulty` (`Easy`, `Medium`, `Hard`), `estimatedDuration` (minutes), `category`, `requiredTools` (string array), `learningObjectives` (string array), `instructions`, `enabled`, `published`, `createdAt`, `updatedAt`, `revision`, `taskCount`, `totalScore`.

Lab detail includes `tasks` ordered by `order`. Task fields: `id`, `labId`, `title`, `description`, `order`, `score`, `hints` (string array), `validationType` (`flag`, `answer`, `acknowledgement`), `completionRequirements` (instructional text), `requiresPrevious` (boolean), `caseSensitive` (boolean). Instructor responses additionally include `hasAnswer`. Student responses never include `hasAnswer`, `expectedAnswer`, answer hashes, or answer salts. `expectedAnswer` is a write-only instructor input; omission preserves the current answer and an empty value clears it. Expected answers must never be returned by any endpoint. A published flag/answer task cannot lose its required answer; acknowledgement tasks do not require an answer. Lab total score is the sum of task scores.

Create lab accepts the editable lab fields and optional `tasks`. Update lab accepts partial editable lab fields and optional `tasks`. When present, `tasks` is the full ordered task list: existing task IDs remain stable, missing IDs create tasks, omitted existing tasks are deleted. This allows an atomic Save operation from the builder. Optional `revision` on updates protects against stale saves; a mismatch returns 409. Dedicated task endpoints are also available.

Task order is zero-based and is controlled by the full task array or the dedicated reorder endpoint. Creating a task through the task endpoint appends it to the lab.

Publishing requires a name, description, instructions, at least one task, and an expected answer for every flag/answer task. Published labs must continue to meet these requirements when edited. New labs default to enabled, unpublished, Easy difficulty, and a 30-minute duration. Duplicate creates an unpublished copy with new lab/task IDs and preserved answer configuration.

## Endpoints

| Method | Path | Access | Response |
| --- | --- | --- | --- |
| GET | `/labs` | Instructor: all. Student: published and enabled only. | `{ labs }` |
| GET | `/labs/:labId` | Instructor, or student if visible. | `{ lab }` |
| POST | `/labs` | Instructor | 201 `{ lab }` |
| PATCH | `/labs/:labId` | Instructor | `{ lab }` |
| DELETE | `/labs/:labId` | Instructor | `{ deleted: true }` |
| POST | `/labs/:labId/duplicate` | Instructor | 201 `{ lab }` |
| POST | `/labs/:labId/publish` | Instructor | `{ lab }` |
| POST | `/labs/:labId/unpublish` | Instructor | `{ lab }` |
| POST | `/labs/:labId/enable` | Instructor | `{ lab }` |
| POST | `/labs/:labId/disable` | Instructor | `{ lab }` |
| POST | `/labs/:labId/tasks` | Instructor | 201 `{ lab, task }` |
| PATCH | `/labs/:labId/tasks/:taskId` | Instructor | `{ lab, task }` |
| DELETE | `/labs/:labId/tasks/:taskId` | Instructor | `{ lab, deleted: true }` |
| PUT | `/labs/:labId/tasks/order` | Instructor; body `{ taskIds: [] }` | `{ lab }` |
| POST | `/labs/:labId/start` | Student; published and enabled | `{ attempt }` |
| GET | `/attempts/:attemptId` | Owning student; lab still visible | `{ attempt }` |
| POST | `/attempts/:attemptId/tasks/:taskId/submissions` | Owning student; body `{ answer }` or `{ completed: true }` | `{ correct, alreadyCompleted, message, attempt }` |

An attempt contains `id`, `labId`, `userId`, `startedAt`, `updatedAt`, `lab` (current student-safe lab detail), and `progress: { completedTaskIds, completedTasks, totalTasks, earnedScore, totalScore, percent, completed }`. Start resumes the student's existing attempt rather than creating duplicate progress. Task requirements are validated on the server. A `requiresPrevious` task requires all preceding tasks to be completed.

Progress survives a server restart. Current lab content is read from the database on every request. Text, hints, order and score edits appear on refresh; the frontend also refreshes on focus and polls student views. Changing answer or validation requirements invalidates affected task completion and dependent tasks; deleting a task removes its completion. Editing wording alone preserves completion. Scores are calculated from current tasks, so repeat submissions do not award points twice. Unpublishing or disabling a lab revokes student read/start/submit access.

Errors use `{ error: { code, message, fields? } }`, with 400 validation, 401 missing identity, 403 forbidden role, 404 unavailable/not-owned resource, and 409 conflict or unmet task prerequisite. JSON input is size-limited. No endpoint accepts client-supplied earned scores or user IDs as identity.
