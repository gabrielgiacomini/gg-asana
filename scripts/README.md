# asana — REST scripts

Thin TypeScript wrappers around Asana REST endpoints that the primary Asana
MCP server does not expose (notably **section CRUD**), plus a few batched
operations that are awkward to drive through MCP one call at a time.

These scripts are agnostic — no project-specific naming, no real GIDs in
examples. Drop the skill into any host repo, populate
`skills/asana/.env`, and the scripts work as-is.

## Layout

```
scripts/
├── README.md
├── package.json                  # Node 20.6+, native fetch, tsx only
├── tsconfig.json                 # strict ES2022 / ESM
├── _lib/
│   ├── env.ts                    # getEnv + loadAsanaEnv()
│   ├── client.ts                 # asanaFetch + typed helpers + AsanaApiError
│   ├── cli.ts                    # parseArgs / requireFlag / optionalFlag
│   └── log.ts                    # info / warn / error / success (ANSI)
├── create-section.ts             # POST /projects/{gid}/sections
├── list-sections.ts              # GET  /projects/{gid}/sections
├── move-tasks-to-section.ts      # POST /tasks/{gid}/addProject (looped)
├── get-project-inventory.ts      # sections + tasks + subtasks → markdown
├── set-task-dependencies.ts      # Research/Visuals/Video/Deliverable DAG
├── list-attachments.ts           # GET    /tasks/{gid}/attachments
├── upload-attachment.ts          # POST   /tasks/{gid}/attachments (multipart)
└── delete-attachment.ts          # DELETE /attachments/{gid} (looped)
```

## Environment

All scripts read three env vars (loaded via Node's `--env-file` flag, no
dotenv library required):

| Variable                     | Required | Purpose                                       |
| ---------------------------- | -------- | --------------------------------------------- |
| `ASANA_PAT`                  | yes      | Bearer credential for every REST call.        |
| `ASANA_DEFAULT_PROJECT_GID`  | yes\*    | Default `--project` when the flag is omitted. |
| `ASANA_DEFAULT_WORKSPACE_GID`| yes\*    | Reserved; loaded by `loadAsanaEnv()`.         |

\* required by `loadAsanaEnv()`. Most scripts only actively need the PAT and
the project GID; the workspace GID is loaded for completeness and used by
future scripts that create top-level tasks.

Populate `skills/asana/.env` (gitignored) using
`.env.example` as a template.

## Running

From this directory (`scripts/`):

```bash
# One-off install (devDeps: tsx, typescript, @types/node)
npm install

# Type-check
npm run typecheck

# Convenience aliases (use the npm scripts in package.json):
npm run dev:create-section -- "<section-name>"
npm run dev:list-sections
npm run dev:move-tasks -- --section <section-GID> <task-GID-1> <task-GID-2>
npm run dev:project-inventory -- --output /tmp/inventory.md
npm run dev:set-deps -- --parent <parent-GID> --dry-run
npm run dev:list-attachments -- --task <task-GID> --json
npm run dev:upload-attachment -- --task <task-GID> --skip-if-exists /tmp/report.json
npm run dev:delete-attachment -- <attachment-GID-1> <attachment-GID-2>
```

Or call any script directly:

```bash
npx tsx --env-file=../.env create-section.ts "Triage"
```

Every script supports `--quiet` to mute non-error log lines.

## Scripts

### `create-section.ts`

Create a new section in a project.

```bash
# Append a section to the default project
npx tsx --env-file=../.env create-section.ts "Backlog"

# Insert a section before an existing one in an explicit project
npx tsx --env-file=../.env create-section.ts "Triage" \
    --project 1209876543210987 \
    --insert-before 1209111122223333
```

Prints a JSON record with `section_gid`, `name`, `project_gid`, and a
permalink-style URL.

### `list-sections.ts`

List sections of a project. Pipe-friendly table; pass `--json` for raw output.

```bash
npx tsx --env-file=../.env list-sections.ts
npx tsx --env-file=../.env list-sections.ts --project 1209876543210987 --json
```

### `move-tasks-to-section.ts`

Move N tasks into a section. Loops one POST per task (REST has no batch).
Reports per-task success / failure as JSON on stdout; exits non-zero if any
move fails.

```bash
npx tsx --env-file=../.env move-tasks-to-section.ts \
    --section 1209555566667777 \
    1209111122223333 1209111122224444 1209111122225555
```

### `get-project-inventory.ts`

Walk a project's sections → top-level tasks → subtasks (recursive up to
`--max-depth`, default 2) and write a markdown checklist.

```bash
# stdout
npx tsx --env-file=../.env get-project-inventory.ts

# file
npx tsx --env-file=../.env get-project-inventory.ts \
    --project 1209876543210987 \
    --output /tmp/inventory.md \
    --max-depth 3
```

This is a discovery snapshot — not a backup. For per-task backups (notes +
custom fields), use the snapshot operation pattern in
`references/operations-catalog.md` → "Backup project to disk".

### `set-task-dependencies.ts`

Apply the Research → Documentation/Infographic/Mind-Map → Video Script →
Deliverable dependency graph documented in
`references/operations-catalog.md` (entry #17). Classifies subtasks by
name prefix, computes target deps, then sends `addDependencies` only for
missing edges (idempotent).

```bash
# Preview without writing
npx tsx --env-file=../.env set-task-dependencies.ts \
    --parent 1209876543210987 --dry-run

# Apply
npx tsx --env-file=../.env set-task-dependencies.ts \
    --parent 1209876543210987
```

Prints a per-subtask report table with `target` / `missing` / `action`
columns plus an applied/skipped/ignored summary.

### `list-attachments.ts`

List attachments on a task. Default output is a pipe-friendly table (gid,
size, created_at, name); pass `--json` for raw output suitable for `jq`.

```bash
# Table:
npx tsx --env-file=../.env list-attachments.ts --task 1209876543210987

# JSON for piping:
npx tsx --env-file=../.env list-attachments.ts --task 1209876543210987 --json \
    | jq '.[] | {gid, name, size}'
```

The MCP `get_attachments` tool covers the same surface; this script exists
for parity with the upload/delete scripts (which have no MCP equivalents)
and for clean stdout piping from shell scripts.

### `upload-attachment.ts`

Upload a local file as a task attachment via `multipart/form-data` POST.

```bash
# Simple upload (display name = on-disk filename):
npx tsx --env-file=../.env upload-attachment.ts \
    --task 1209876543210987 \
    /tmp/report.json

# Override display name + MIME, with idempotent skip-if-exists:
npx tsx --env-file=../.env upload-attachment.ts \
    --task 1209876543210987 \
    --name "Q3 audit (2026-05-13).json" \
    --type application/json \
    --skip-if-exists \
    /tmp/q3-audit.json
```

`--skip-if-exists` first GETs the task's attachments, then compares `name`
+ `size`; if a match is found, the script logs the skip and exits 0
without re-uploading. This avoids the curl-pipe duplication gotcha (see
the script's header comment) when re-running the same operation.

Prints a JSON record on stdout with `skipped` (boolean), `attachment_gid`,
`name`, `size`, and `view_url`.

### `delete-attachment.ts`

Delete one or more attachments by GID. Loops one DELETE per GID (Asana
has no batch endpoint) and reports per-attachment success / failure as
JSON on stdout; exits non-zero if any delete fails.

```bash
npx tsx --env-file=../.env delete-attachment.ts 1211112222333344 1211112222333345
```

Useful when undoing a duplicate upload — list first to discover the
duplicate GIDs, then pass them here.

## Library API (for embedding in larger scripts)

`_lib/client.ts` exports typed helpers you can import from sibling files:

```ts
import {
  asanaFetch,             // raw call: asanaFetch<T>(path, {method, body, ...})
  AsanaApiError,          // structured error with status + Asana message
  createSection,
  listSections,
  moveTaskToSection,
  listTopLevelTasks,
  listSubtasks,
  getTaskWithSubtaskDeps,
  addDependencies,
  listAttachments,        // GET /tasks/{gid}/attachments (paginated)
  uploadAttachment,       // POST /tasks/{gid}/attachments (multipart)
  deleteAttachment,       // DELETE /attachments/{gid}
} from "./_lib/client.ts";
```

All helpers honor the `ASANA_PAT` env var via `loadAsanaEnv()` and retry on
429 with `Retry-After`. Single-resource reads (`get_task`-style) can pass
`expectedGid` to guard against the cross-wired-payload bug.

## Adding a new script

1. Create `<verb>-<noun>.ts` next to the others.
2. Start with a `@fileoverview` JSDoc block: what it does, when to use it,
   the REST endpoint(s) used, params consumed.
3. Import `parseArgs` / flag helpers from `_lib/cli.ts`.
4. Use `asanaFetch` or a typed helper from `_lib/client.ts`.
5. Add a `dev:<short-name>` entry in `package.json`.
6. Document the script in this README under "Scripts".

## Why these endpoints (not MCP)

The primary Asana MCP server in this codebase does **not** expose:

- `create_section` / `update_section` / `delete_section` / `list_sections`
- Attachment **writes**: upload (`POST /tasks/{gid}/attachments`) and delete
  (`DELETE /attachments/{gid}`). Reads (`get_attachments`) ARE covered, but
  for any write you must drop to REST.
- Some project-template surfaces
- A few project-membership edges

REST is the only path for those. See `references/operations-catalog.md`
entries "Create / inspect / move sections (REST, since MCP lacks section
tools)" and "Manage task attachments (upload / list / delete via REST)"
for the gotcha catalog.
