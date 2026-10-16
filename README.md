# AdaptiveLearn — PS2 Adaptive Learning and Assessment Portal

This implementation delivers the User & Authentication and Concept Map & Syllabus modules. It uses React/Vite/TypeScript/Tailwind on the client and Express/TypeScript/MySQL on the server.

## Quick start

1. Install Node.js 22+ and MySQL 8+.
2. Create the database schema: `mysql -u root -p < backend/migrations/001_initial.sql`, then apply `mysql -u root -p adaptivelearn < backend/migrations/002_learning_assessment.sql`.
3. Copy `.env.example` to `backend/.env`, then set the database connection and long random JWT secrets.
4. Run `npm install` in the repository root.
5. Seed the Java demonstration course: `npm run seed -w backend`.
6. Start both apps: `npm run dev`.
7. Open `http://localhost:5173`.

Seeded trainer account: `trainer@adaptivelearn.dev` / `Trainer@123`. Change or remove this development-only account before deployment. Public registration always creates a student account.

## Validation and tests

Run `npm test` for prerequisite DAG validation, and `npm run build` to type-check and produce production bundles. The API has backend authorization for all protected resources; the UI checks are only a navigation convenience.

## API

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public | Creates a student account |
| POST | `/api/auth/login`, `/refresh`, `/logout` | Public/session | Session lifecycle |
| GET | `/api/auth/me` | Signed in | Current user |
| GET, POST | `/api/courses` | Signed in / trainer | List or create courses |
| GET | `/api/courses/:courseId/concepts` | Signed in | Graph, concepts and own progress |
| POST | `/api/courses/:courseId/concepts` | Trainer | Add a concept and prerequisites |
| PUT, DELETE | `/api/courses/:courseId/concepts/:id` | Trainer | Update/delete a concept |
| GET | `/api/users` and `/api/users/:id` | Trainer | Student management |
| PUT | `/api/progress/:conceptId` | Student | Update self-reported completion |

Errors consistently use `{ "error": { "message": "..." } }`. The server uses httpOnly cookies: a 15-minute access cookie and a server-recorded seven-day refresh session.

## Implemented behavior

- Student-only public registration, password hashing, persistent cookie sessions, logout, protected routes, and server-side role authorization.
- Responsive student and trainer dashboards, profiles, courses, student listing, loading/error states.
- Java prerequisite graph with click-through details, pan/zoom/minimap/reset controls, search, category filter, graph/list views, and status visibility.
- Transactional concept creation/editing with missing-reference, self-reference, duplicate (database key), and circular-dependency protection.
- Separate per-student self-reported progress. A student cannot mark a concept complete while required prerequisites remain incomplete. This is explicitly not mastery evidence.
- MySQL foreign keys, uniqueness, indexes, migration, and seed data.

## Current placeholders / known limitations

- Coding Arena is deliberately a **development/predefined evaluation**: it never executes student code. Its checks are deterministic pattern checks against a reviewed boundary exercise. An isolated container runner with CPU, memory, filesystem, process, and network restrictions is required before arbitrary Java/Python/C++ execution can be enabled.
- Knowledge Gap Radar uses a transparent weighted evidence score (60% existing score, 40% latest assessment) and prerequisite edges; it is not Bayesian Knowledge Tracing or a trained ML model.
- Code Twin Viva uses a deterministic keyword fallback and clearly labels its rationale. No external AI provider is configured or claimed.
- Time Machine captures only explicit assessment-editor events and exposes contextual review signals without alleging misconduct.
- The trainer syllabus editor is represented by fully implemented REST endpoints; a dedicated visual editing form and preview screen is the remaining UI enhancement.
- Recommended learning resources, personalized recommendations, assessment-derived mastery, coding assessments, code replay, AI viva, and analytics are intentionally out of scope for this phase.
- The client displays API/network/validation failures inline, provides loading and disabled states during requests, validates empty submissions, handles missing courses/exercises/replay events, and includes a not-found route.
