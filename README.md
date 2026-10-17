# ADAPTIX AI — Adaptive Learning & Assessment Portal

A full-stack hackathon prototype for an explainable adaptive-learning experience. It uses **React + Vite**, **Node.js + Express**, and **MySQL from XAMPP**. Student activity, diagnostic answers, per-concept mastery, coding attempts, editor events, code snapshots, viva answers, and trainer review decisions are persisted in MySQL.

> The Java assessment path compiles and runs code only in an isolated Docker container, not in the Express process. Execution remains deliberately disabled until an administrator builds the sandbox image, enables it in the backend environment, and starts Docker Desktop.

## Features included

- Student registration, login, logout, role checks, password hashing, and HTTP-only session cookies.
- XAMPP/MySQL persistence and demo seed data.
- Interactive prerequisite-aware Java knowledge map.
- Diagnostic quiz that updates concept mastery and informs the next-action recommendation.
- Explainable, rule-based “Next Best Action” selection.
- Java coding workspace with public sample runs, hidden-test submissions, execution limits, and private submission history.
- Timed Java contests with trainer-authored question sets, server-enforced deadlines, submissions, and scoreboards.
- Challenge discussions with learner replies and trainer moderation.
- App-wide browser clipboard and context-menu restrictions for copy, cut, and paste shortcuts. This is a client-side deterrent, not a security boundary.
- Code Time Machine with recorded editor events and code checkpoints.
- Code Twin Viva generated from a student's own saved submission; current evaluation uses a small visible keyword rubric.
- What-if learning-path simulation kept separate from actual student mastery.
- Trainer overview, learner gaps, concept-level aggregate signals, and a human review queue.
- Trainer authoring for Java questions, private hidden tests, public samples, concepts, prerequisites, hints, resource limits, draft/publish status, editing, and deletion.
- Proof-of-mastery workspace with topic-level evidence labels, explainable next-practice selection, a rule-based Socratic tutor fallback, hint tracking, diagnosis feedback, and independent verification challenge selection.
- Predict-before-submit reflection: students record expected behaviour and self-rated confidence before submitting, with a visible reflection receipt.
- Mutation challenge prompt: students can try changing an input or boundary condition and checkpoint the changed solution.
- Synthetic demo profiles that illustrate different learning paths.

## 1. Requirements

- Windows 10/11 (or macOS/Linux with equivalent commands)
- Node.js 20+ and npm
- XAMPP with MySQL/MariaDB enabled
- Docker Desktop configured for Linux containers (required to run Java securely)
- Java 17 is included in the sandbox image; a host JDK is not used to execute student programs
- A modern browser

## 2. Start XAMPP and create the database

1. Open the **XAMPP Control Panel**.
2. Start **MySQL**. Apache is not required for this application unless you want to use phpMyAdmin.
3. Open `http://localhost/phpmyadmin`.
4. Choose **Import**.
5. Select `backend/sql/schema.sql` from this project folder and click **Import** / **Go**.
6. Import `backend/sql/migrations/001_java_assessment.sql`.
7. Import `backend/sql/migrations/002_contests_discussions.sql`.
8. Import `backend/sql/migrations/003_adaptix_mastery_engine.sql` after migrations 001 and 002.
9. Confirm that a database named `adaptix_ai` and its tables exist.

The database script creates the database if it does not already exist. The default connection assumes XAMPP MySQL is on `127.0.0.1:3306`, with user `root` and an empty password. If your XAMPP setup has a different port or password, adjust the backend `.env` file.
The migrations are additive. Import `001_java_assessment.sql` first for Java questions, test cases, submissions, and concept evidence, then `002_contests_discussions.sql` for contests and discussion posts, then `003_adaptix_mastery_engine.sql` for hint tracking, mastery verification records, diagnosis feedback, and recommendation events. Import each once after `schema.sql` and before running the seed script.

## 3. Configure the backend

In a terminal opened at the project root:

**Windows PowerShell:**

```powershell
Copy-Item backend/.env.example backend/.env
```

Edit `backend/.env` if needed. Default development values:

```env
PORT=4000
NODE_ENV=development
SESSION_SECRET=replace-this-with-a-long-random-secret
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=adaptix_ai
CLIENT_ORIGIN=http://localhost:5173
JAVA_EXECUTION_ENABLED=false
JAVA_EXECUTION_IMAGE=adaptix-java-sandbox:17
DOCKER_CLI=docker
```

Do not commit your real `.env` or production secrets.

## 4. Build and enable the isolated Java sandbox

1. Start Docker Desktop and use **Linux containers**.
2. From the project root, build the small Java 17 runner image:

   ```powershell
   docker build -t adaptix-java-sandbox:17 -f .\backend\executor\Dockerfile .\backend\executor
   ```

3. Verify the Docker engine and image are ready:

   ```powershell
   docker info
   docker image inspect adaptix-java-sandbox:17
   ```

4. Edit `backend/.env` and change `JAVA_EXECUTION_ENABLED=true`. Keep the image name aligned with the image built above.
5. Restart the backend. `/api/health` reports `javaExecution.operational`; execution endpoints return a clear 503 until Docker and the image are ready.

The API starts a new container for each test. Containers run as UID 10001, with no network, a read-only root filesystem, a read-only source mount, bounded writable tmpfs mounts, dropped Linux capabilities, no-new-privileges, a 0.5 CPU limit, a 256–512 MB memory limit, a PID limit, output caps, per-test timeouts, and cleanup after execution. Do not mount application directories, credentials, Docker sockets, or database files into the executor. The API does not expose Docker credentials or an internal execution endpoint to the browser.

This Docker setup is a local development isolation boundary, not a guarantee against kernel or Docker runtime vulnerabilities. Keep Docker Desktop patched and do not expose the Docker daemon to untrusted users.

## 5. Install packages

From the project root:

```powershell
npm install
npm install --prefix backend
npm install --prefix frontend
```

## 6. Add the demo users and sample data

Make sure MySQL is running and the schema was imported. Then run:

```powershell
npm run seed
```

The seed script is designed to be re-runnable. It creates the demo users, Java concept/prerequisite graph, diagnostic questions, coding challenges, two synthetic learning profiles, and sample review data.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Student A | `student@adaptix.dev` | `Student@123` |
| Student B | `student2@adaptix.dev` | `Student2@123` |
| Trainer | `trainer@adaptix.dev` | `Trainer@123` |

These are **demo credentials only**. Do not deploy or reuse these passwords for real accounts.

## 7. Start the website

In the project root:

```powershell
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/api/health`

The frontend proxies `/api` calls to Express, so normal browser API calls use the Vite origin and the session cookie.

If you prefer two terminals:

```powershell
npm run dev:backend
```

and, in another terminal:

```powershell
npm run dev:frontend
```

## 8. Suggested demo flow for a judge

1. Sign in as Student A and open the Overview.
2. Note the current Next Best Action recommendation.
3. Open the Knowledge Map and inspect prerequisite states.
4. Complete the Learning DNA diagnostic and verify mastery changes.
5. Select a challenge in Coding Arena, edit code, run public samples, save a checkpoint, and submit against public plus hidden tests.
6. From the Trainer cockpit, publish a Java question with public and hidden cases, then create a timed contest using it. As a student, open Contests, start the clock, submit a solution, and inspect the leaderboard.
7. Open a challenge discussion, post a question, and reply to a learner or trainer.
8. Open Code Time Machine to view events and the saved code snapshot.
9. Before submitting, enter a prediction and self-rated confidence; optionally expand the mutation challenge and checkpoint your changes.
10. Generate a Code Twin Viva from your saved submission and record explanations.
11. Open What-if Lab and run a hypothetical mastery scenario. Confirm actual mastery remains unchanged.
12. Sign out and sign in as Student B; the recommendation should differ because the synthetic mastery profile is different.
13. Sign in as the Trainer and review learner evidence and the sample context signal.

Copy, cut, paste keyboard shortcuts, clipboard events, and context menus are blocked in the app UI. Browser extensions, developer tools, automation, and other external means can bypass client-side restrictions; never treat this as protection for secrets or assessment integrity.

## 9. Validate setup

- Check `http://localhost:4000/api/health` and confirm the JSON response contains `"database": "connected"`.
- Run `npm run seed` after the schema is imported.
- Check the backend terminal for MySQL errors.
- Run a production frontend build:

```powershell
npm run build
```

Run the backend unit tests with:

```powershell
npm run test --prefix backend
```

## 10. Verify Java assessment behavior

Run these only after the Docker image is operational and the migration and seed have completed:

1. Submit a correct Java program and confirm all public and hidden tests pass.
2. Submit malformed Java and confirm `Compilation Error` plus compiler details from public samples.
3. Submit a compiling but incorrect answer and confirm `Wrong Answer`, with no hidden expected output in the response.
4. Submit a program that throws an exception and confirm `Runtime Error`.
5. Submit a non-terminating program and confirm `Time Limit Exceeded` within the configured limits.
6. Author a question with multiple public and hidden cases; confirm the UI shows only public inputs/outputs and aggregate submission totals.
7. While signed in as a student, request another unpublished question and trainer-only question-management routes; both must be denied/not found.
8. Attempt trainer-only create, edit, publish, and delete actions as a student; each must return 403.
9. Send an empty code string; it must be rejected with 400 before execution.
10. Send source over 30,000 characters; it must be rejected with 413 before execution.

Inspect student responses and browser network payloads during these checks; hidden inputs and expected outputs must not appear. This environment currently has no running Docker daemon, so the end-to-end cases above have not been verified here.

Key endpoints follow the existing session-authenticated `/api` conventions: `GET /api/challenges`, `GET /api/challenges/:id`, `POST /api/challenges/:id/run`, `POST /api/challenges/:id/submit`, `GET /api/submissions/history`, and `GET /api/submissions/:id`. Trainer-only routes are `GET /api/trainer/coding-questions`, `GET /api/trainer/challenges/:id`, `POST /api/trainer/challenges`, `PUT /api/trainer/challenges/:id`, and `DELETE /api/trainer/challenges/:id`.

## Scope mapped to the PS2 solution catalog

| Catalog capability | Prototype implementation |
|---|---|
| LearnGraph AI / ConceptPulse | Prerequisite-aware Java concept map and per-concept mastery estimates |
| CodeDNA | Editor event logging, code snapshots, and Code Time Machine |
| VivaTrace / Proof of Understanding | Code-linked viva questions with a transparent keyword rubric and feedback |
| TrustCompile | Java 17 compile/run in constrained Docker containers; hidden test data stays in the backend |
| Concept DNA feedback loop | Diagnostic evidence + coding attempt/test evidence; coding results are recorded separately and do not invent mastery scores |
| Learning Time Machine / Explainability Receipt | What-if simulation is explicitly labelled; recommendation explains the supporting evidence |
| Code Mutation / Predict Before Run / Confidence vs Competence | Reflection input, confidence rating, and mutation challenge prompt; calibration is not statistically validated |
| Trainer dashboard | Learner gaps, concept signals, contextual review queue, and trainer-authored content |
| Extensions | Repository viva, DevOps labs, and a formal Proof-of-Skill Passport are not included in this MVP |

## Data and privacy notes

- Diagnostic answers, submissions, editor events, snapshots, viva answers, and review decisions are persisted. Code snapshots and submissions can contain code you type; use synthetic code during public demos.
- Editor event payloads record event metadata and do not store a full code string. Full source is stored only in the explicit submission and checkpoint tables.
- Review signals are contextual; they are not a cheating label or automatic punishment mechanism.
- The app's current session store is Express's in-memory development store. It is not suitable for multi-instance production. Replace it with a maintained persistent session store and add HTTPS, CSRF protections, login rate-limiting, retention/deletion workflows, and audit policy before deployment.
- Existing seeded demo profiles and legacy sample submissions are synthetic. Newly submitted coding work is evaluated by actual Java execution when the sandbox is configured.
- Coding evidence records attempts, hidden tests passed, compilation/runtime failures, and associated concepts. It does not by itself update or claim a mastery score.
- The current session store is Express's in-memory development store. Before deployment, replace it with a maintained persistent store, add CSRF protection and authentication throttling, review retention/deletion workflows, and harden the host/container runtime.

## Project structure

```text
adaptix-ai-xampp/
  backend/
    src/
      db.js
      assessmentResults.js
      codingRoutes.js
      javaSandbox.js
      server.js
      seed.js
      javaSandbox.test.js
    sql/
      schema.sql
      migrations/001_java_assessment.sql
      migrations/002_contests_discussions.sql
    executor/
      Dockerfile
    .env.example
  frontend/
    src/
      App.jsx
      CodingWorkspace.jsx
      ContestHub.jsx
      TrainerCodingStudio.jsx
      TrainerContestStudio.jsx
      coding.css
      main.jsx
      styles.css
    index.html
    vite.config.js
  package.json
  README.md
```

## Common errors

**`database disconnected` / `ECONNREFUSED`:** Start MySQL in XAMPP and verify `DB_PORT`, `DB_USER`, and `DB_PASSWORD` in `backend/.env`.

**`ER_NO_SUCH_TABLE`:** Import `backend/sql/schema.sql`, then migrations `001_java_assessment.sql` and `002_contests_discussions.sql` in order, then run `npm run seed`.

**`javaExecution.status` is `docker_unavailable`:** Start Docker Desktop, confirm `docker info` succeeds, and restart the backend.

**`javaExecution.status` is `sandbox_image_missing`:** Build the image using the command in section 4 and confirm the image name matches `JAVA_EXECUTION_IMAGE`.

**`Java execution is not operational`:** Execution is fail-closed; confirm `JAVA_EXECUTION_ENABLED=true` in `backend/.env` and verify `/api/health`. No local-host Java or fake evaluator fallback is used.

**Port 4000 or 5173 is already in use:** Stop the older process or change the port and keep the Vite proxy/API configuration consistent.

**Demo login fails:** Re-run `npm run seed`; ensure the seed command finishes successfully.

**CSS looks different offline:** Google Fonts are loaded from a web font URL; the app falls back to local sans-serif fonts if unavailable.


## Proof-of-mastery additions

The **Proof of mastery** navigation page uses the existing MySQL records and the additive migration 003. It includes:

- Topic evidence and cautious labels (`Not Assessed`, `Developing`, `Provisional Mastery`, `Verified Mastery`).
- A deterministic next-question recommendation based on existing topic mastery and question attempt history.
- Four tracked progressive hint levels.
- A rule-based Socratic tutor fallback. It is explicitly labelled as rule-based and does not claim to execute code or use an LLM.
- Diagnosis feedback submission endpoint, restricted to the signed-in student's own submission.
- Independent verification selection from a different published question tagged to the same concept. It refuses to start when no unseen candidate exists.

Additional endpoints:
- `GET /api/learning/profile`
- `GET /api/learning/recommendation`
- `POST /api/learning/hints`
- `POST /api/learning/tutor`
- `POST /api/learning/diagnosis-feedback`
- `POST /api/learning/verification/start`
- `GET /api/trainer/learning-summary` (trainer-only)

Verification records are finalized by the existing coding submission path when the selected challenge is submitted. A verification candidate is not a generated variant: it must be a different, published question already in the question bank. AI-provider integration, automatic generated-question validation, delayed retention scheduling, and a comprehensive evidence-calibrated mastery model remain future work; do not represent them as implemented. The current UI uses the platform's existing coding arena and question list to choose the selected verification challenge.
