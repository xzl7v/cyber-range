# CyberPod Labs

A standalone, database-backed Labs module for instructors and students. Lab content is managed in the browser and shared through a reusable API. The module contains no platform authentication, main dashboard, or container orchestration.

## Run locally

Requirements: Node.js 24 or newer and npm. Docker and a separate database installation are not required.

From this `labs-module` directory:

```sh
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs at `http://127.0.0.1:4300/api`.

The **Development identity** selector switches between an instructor and two independent students. These temporary identities exist only to exercise the module locally; they are not a login system. The development server binds to loopback and refuses development identity mode under `NODE_ENV=production`.

The database is created automatically at `.data/labs.sqlite`. It persists between restarts and is excluded from version control. Set `LABS_DATABASE` to use another SQLite file and `PORT` to change the API port. Vite uses the same `PORT` value for its API proxy.

## Instructor workflow

1. Select the instructor development identity and choose **Create lab**.
2. Enter the name, description, difficulty, duration, category, tools, objectives, and instructions.
3. Add tasks. Each task has its own description, score, hints, validation method, and completion requirements.
4. Use the task movement controls to change the order. Task IDs remain stable after a saved edit.
5. Save the draft. Reopen it at any time to continue editing.
6. Publish it when ready. A lab becomes visible to students only when it is both published and enabled.

Management actions include editing, duplication, publishing/unpublishing, enabling/disabling, and confirmed deletion. A duplicate is always an unpublished copy with independent tasks and progress.

Each task uses one of three completion methods:

| Method | Student action | Server check |
| --- | --- | --- |
| Flag | Submit a flag | Match the instructor-configured value |
| Answer | Submit an answer | Match the instructor-configured value |
| Acknowledgement | Mark the task complete | Require explicit acknowledgement |

Case sensitivity is configurable. A task can require every preceding task to be complete before submission. Free-text completion requirements describe the expected work; automatic enforcement covers the selected validation method and the preceding-task requirement.

Expected flags and answers are write-only: the API returns whether an instructor has configured an answer, but never returns the answer itself. To change an answer, enter a replacement. Keeping the answer field untouched preserves the existing value. Published flag/answer tasks must have a configured answer.

## Student workflow

1. Select a student development identity.
2. Browse available labs and open a lab's details.
3. Review the tools, objectives, duration, instructions, and task count.
4. Start the lab to enter its workspace. Starting again resumes that student's progress.
5. Read each task, reveal hints as needed, and submit answers or flags.
6. Track completed tasks, earned points, and overall progress.

The two development students have separate progress. Repeated successful submissions do not award duplicate points. Student API responses contain no expected answers or stored answer hashes.

Instructor edits are read from the database without rebuilding or restarting the application. Student views refresh periodically and on focus. Content and score changes use the current lab configuration; changes to answer or completion requirements invalidate affected completion and dependent tasks. Deleting a task removes its completion. Disabling or unpublishing a lab revokes student access to it.

## Build and verify

```sh
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

API tests use temporary SQLite databases. Browser tests run the real frontend and API against `.data/browser-tests.sqlite`, separate from the normal development database. Stop the development server before browser tests so the test runner can own ports 5173 and 4300.

To serve the built frontend and API together for a local demonstration:

```sh
npm run build
npm start
```

Open [http://127.0.0.1:4300](http://127.0.0.1:4300). This command explicitly enables the same temporary development identities.

## Module structure

| Path | Purpose |
| --- | --- |
| `src/` | React lab management, builder, catalog, details, and workspace |
| `server/` | Express router, SQLite persistence, validation, and development server |
| `tests/api/` | Real HTTP API and persistence tests |
| `tests/browser/` | Browser workflows with the real API |
| `docs/API.md` | Payloads, endpoints, permissions, and progress behavior |
| `docs/INTEGRATION.md` | Backend identity and frontend mounting interfaces |
| `docs/VERIFICATION.md` | Executed checks and their scope |

## Integration

The host application supplies authenticated identities to the backend and its current user to the React module. Replace the development wrapper, not the Labs business logic. See [the integration guide](docs/INTEGRATION.md) and [API contract](docs/API.md).

Lab content and progress are independent of Hydra, Nmap, Kali, and Docker. A future runtime service can associate an environment with an attempt ID; this module does not claim to create a virtual machine, execute terminal commands, or verify external runtime events.
