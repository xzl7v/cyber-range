# Verification

Verification is being executed for the standalone Labs module. Results will be recorded here after the API, browser, lint, and build checks finish.

## Acceptance coverage

| Area | Verification |
| --- | --- |
| Instructor management | View, create, edit, duplicate, and delete labs through API and browser |
| Visibility | Publish/unpublish and enable/disable; students see only published, enabled labs |
| Task builder | Add, edit, delete, reorder, configure hints/requirements/answers/scores, and reload saved changes |
| Student experience | Catalog, details, start/resume, correct current tasks, hints, submissions, and progress |
| Permissions | Every instructor write rejects students; one student cannot read another's attempt |
| Answer privacy | Expected answers, hashes, and salts stay out of public and instructor responses |
| Progress integrity | Incorrect answers earn no credit; repeated success earns no duplicate credit; prerequisites are enforced |
| Live content | Instructor saves reach an already open student workspace |
| Persistence | SQLite content and student completion survive reopening the module database |
| Validation | Invalid edits fail atomically; stale revisions and invalid task ordering are rejected |
| Responsive UI | Mobile-sized builder, catalog, details, and workspace remain usable without horizontal overflow |
| Delivery | Lint and production build succeed |

## Scope

These checks exercise the module's own frontend, real API, and SQLite storage. Development identities are a local testing interface. Host authentication integration and future Docker/Kali/target provisioning are separate integration work and are not claimed by this module.
