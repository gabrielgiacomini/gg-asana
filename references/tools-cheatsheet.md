---
title: Asana MCP — Tools Cheat Sheet
---

# Asana MCP — Tools Cheat Sheet

Exhaustive reference for the Asana MCP tool surface. Parameter shapes, opt_fields recipes, return shapes, and gotchas. Tool names below use `<server>` as a placeholder for the MCP server identifier.

## Loading tools

Tools are **deferred** — schemas must be loaded before use:

```text
ToolSearch select:mcp__<server>__<tool-name>,mcp__<server>__<tool-name>,...
```

Bulk-loading wastes round-trips. Load only what the current operation needs.

When two Asana MCP servers are available (primary + `http-bridge`), load both for fallback purposes; prefer primary, fail over to bridge on stale responses.

---

## `get_me`

Zero-param. Returns `{gid, email, name, workspaces[]}`.

Use to confirm auth and capture the workspace GID.

---

## `get_projects`

List projects in a workspace.

**Params:**
- `limit: number` (1-100, default 20)
- `team: string` (team GID — optional filter)
- `archived: boolean` (default false)
- `offset: string` (pagination token)
- `opt_fields: string` (comma-separated, dot-notation supported)

**Returns:** `{data: [{gid, name, task_counts, ...}], next_page: null | string}`

A `null` `task_counts` means "could not retrieve" — do not interpret as zero.

---

## `get_project`

Fetch a project's details.

**Params:**
- `project_id: string` — **NOT `project`** (this is inconsistent with `get_tasks`!)
- `include_sections: boolean` (default false; up to 50 sections returned)
- `opt_fields: string`

**Returns:** `{data: {gid, name, custom_field_settings[], sections[], members[], owner, ...}}`

`custom_field_settings[].custom_field.enum_options[]` is where you discover enum option GIDs.

---

## `get_tasks`

List tasks filtered by context.

**Params (one context required):**
- `project: string` — **NOT `project_id`**
- `section: string`
- `tag: string`
- `user_task_list: string`

**Common params:**
- `limit: number` (1-100; MUST be number, not string)
- `assignee: string` (`"me"`, email, or GID)
- `completed_since: string` (ISO datetime)
- `modified_since: string` (ISO datetime)
- `offset: string`
- `opt_fields: string`

**Gotcha:** if `opt_fields` includes `notes`, the response can exceed the token budget and get spilled to a file. Skip `notes` when listing.

---

## `get_task`

Fetch a single task's full content, optionally with subtasks.

**Params:**
- `task_id: string` — **NOT `gid`**
- `include_subtasks: boolean` (default true)
- `include_comments: boolean` (default true; `comment_limit` defaults to 10)
- `opt_fields: string` — dot-notation supported

**Useful `opt_fields` recipes:**

```text
# Name only
"name"

# Lightweight
"name,completed,due_on,assignee.name"

# Full content
"name,notes,due_on,completed,assignee.name,permalink_url,parent.gid,parent.name,
 custom_fields.gid,custom_fields.name,custom_fields.type,
 custom_fields.text_value,custom_fields.display_value,custom_fields.enum_value.gid,custom_fields.enum_value.name"

# With subtasks (one level deep)
"name,notes,subtasks.gid,subtasks.name,subtasks.notes,subtasks.due_on,subtasks.completed,
 subtasks.assignee.name,subtasks.permalink_url,
 subtasks.custom_fields.gid,subtasks.custom_fields.name,subtasks.custom_fields.text_value,
 subtasks.custom_fields.enum_value.name"

# Section memberships
"name,memberships.project.gid,memberships.section.gid,memberships.section.name"
```

**Subtask projection caveat:** `subtasks.custom_fields.text_value` has shown lossy behavior in deep fetches when the parent response is large. For full-fidelity text values across many subtasks, fetch each subtask individually with `get_task`.

**Stale-response check:** verify `response.data.gid == task_id` before trusting payload contents. If mismatch, retry; if persistent, switch to the http-bridge MCP variant.

---

## `update_tasks`

Bulk update one or more tasks in a single call.

**Params:**
- `tasks: array` — 1-50 entries

**Each entry shape:**
```json
{
  "task": "<GID>",                       // required
  "name": "<new name>",                  // optional
  "notes": "<plain-text notes>",         // optional; use html_notes for HTML
  "html_notes": "<HTML body>",           // optional; restricted tag set
  "due_on": "YYYY-MM-DD" | null,
  "start_on": "YYYY-MM-DD" | null,
  "completed": true | false,
  "assignee": "<user-GID>" | "me" | "<email>" | null,
  "parent": "<task-GID>" | null,
  "add_projects": [{"project_id": "<GID>", "section_id": "<GID>"}],
  "remove_projects": ["<GID>", ...],
  "add_followers": ["<GID>" | "<email>", ...],
  "remove_followers": ["<GID>" | "<email>", ...],
  "add_dependencies": ["<GID>", ...],
  "remove_dependencies": ["<GID>", ...],
  "custom_fields": {
    "<field-GID>": "<value>"            // string for text, option-GID for enum, etc.
  }
}
```

**Custom-field value rules:**
- **Text field**: pass a string. Empty string clears.
- **Enum field**: pass the **option GID**, not the display name.
- **Number field**: pass a number.
- **Multi-select**: pass an array of option GIDs.
- **Date field**: pass `{"date": "YYYY-MM-DD"}` or `{"date_time": "ISO-datetime"}`.

**Section placement:** to move a task to a different section within an existing project, pass `add_projects: [{project_id, section_id}]`. Asana re-places it (sections are 1-per-project per task).

**Returns:**
```json
{
  "succeeded": [{"gid": "...", "name": "..."}, ...],
  "failed": [{"gid": "...", "errors": [...]}, ...],
  "summary": "Updated N of M tasks."
}
```

**Stale-response caveat:** the `data` field in the response can sometimes contain unrelated task records (cross-wired payload bug). `failed: []` + `summary: "Updated N of M tasks"` are trustworthy signals. Re-fetch one of the updated GIDs to confirm.

---

## `create_tasks`

Bulk-create tasks (top-level or subtask).

**Params:**
- `tasks: array` — 1-50 entries

**Top-level task entry:**
```json
{
  "name": "...",                         // required
  "workspace": "<workspace-GID>",        // required
  "projects": [
    {"project_id": "<GID>", "section_id": "<optional-section-GID>"}
  ],
  "notes": "...",                        // optional
  "html_notes": "...",                   // optional
  "assignee": "...",
  "due_on": "YYYY-MM-DD",
  "custom_fields": {"<field-GID>": "..."}
}
```

**Subtask entry:**
```json
{
  "name": "...",
  "parent": "<parent-task-GID>",         // makes this a subtask
  "workspace": "<workspace-GID>",
  "notes": "...",
  "custom_fields": {"<field-GID>": "..."}
}
```

**Key rules:**
- Subtasks inherit project membership from the parent. **Do not pass `projects`** on subtask entries; pass `parent` only.
- Subtasks are **not sectioned independently** — do not pass `section_id` on subtask entries.
- `custom_fields` works at create time. Some agents incorrectly assume it doesn't; verify by re-fetching one created task.

**Returns:** `{succeeded: [...], failed: [...], summary: "..."}`

**Stale-response retry:** if a `create_tasks` call returns task data from a prior unrelated operation (cross-wired payload), the writes themselves may have succeeded — retry the same call; the second often returns real data. Verify by fetching one returned GID.

---

## `delete_task`

Permanently delete a task. **No batch API. Irreversible at the API layer.**

**Params:**
- `task: string` (GID)

**Returns:** `{"data": {}}` on success.

**Rules:**
- One call per task. Loop for bulk deletes.
- Subtasks of the deleted task are also deleted unless they're shared with another project.
- Asana web UI trash retention exists but is finite (~30 days typically) and not API-recoverable.
- **Always snapshot before deletion.** Keep the GID list as a revert manifest.

---

## `search_tasks` / `search_objects`

Workspace-wide search. Useful when you don't have a project context or when finding tasks across projects.

**`search_tasks` params (notable):**
- `workspace: string`
- `text: string` (search query)
- `assignee_any: string` (comma-separated user GIDs)
- `projects_any: string` (comma-separated project GIDs)
- `completed: boolean`
- `opt_fields: string`

**`search_objects`** is the broader cross-resource search.

Not commonly needed for project-scoped work, but valuable for "find every task across projects X and Y that mentions Z."

**Pagination gotcha — NOT exhaustive for large result sets.** `search_tasks` caps at `limit: 100` per call and exposes **no cursor / offset** in the response. There is no way to ask for "the next 100." Two-pass dedupe tricks (e.g. `sort_by=modified_at desc` + `sort_by=created_at asc`) help but are not guaranteed to recover everything when the result set exceeds ~150. Symptom: every call returns 100 results, dedup yields N < expected total, and you can't tell what was dropped.

**When you need an exhaustive enumeration** (e.g. "every subtask of every parent that matches pattern X"):
- Don't use `search_tasks`. Instead, walk parents directly with `GET /tasks/{parent_gid}/subtasks?opt_fields=...&limit=100` per parent. The subtasks endpoint paginates by `offset` if a single parent has >100 subtasks.
- For project-wide top-level tasks, use `get_tasks(project=<GID>, limit=100, offset=<cursor>)` with the cursor returned in `next_page.offset`.
- Save the result to disk before further processing — re-walking is expensive.

---

## `add_comment`

Post a comment on a task.

**Params:**
- `task: string` (GID)
- `text: string` (plain text) OR `html_text: string` (HTML body)

**Use case:** running commentary during long operations, machine-readable audit trail, or sharing operation reports.

---

## `get_my_tasks`

Returns the current user's "My Tasks" list. Quick way to scope work to a user without listing projects.

---

## `get_portfolios` / `get_portfolio` / `get_items_for_portfolio`

Portfolio-level rollups. Useful when a project is part of a portfolio and you need cross-project visibility.

---

## `get_attachments`

List attachments on a parent (task, project, or project_brief).

**Params:**
- `parent: string` (GID)

**Returns:** array of `{gid, name, size, resource_subtype, created_at, view_url, download_url, permanent_url, ...}`. For a freshly-uploaded attachment the `size` and `*_url` fields may be `null` until Asana finishes server-side processing — re-list a few seconds later to confirm.

**Write surfaces (upload / delete) are NOT covered by MCP.** Use the REST
endpoints `POST /tasks/{task_gid}/attachments` (multipart) and
`DELETE /attachments/{attachment_gid}`, or the wrapper scripts
`../scripts/upload-attachment.ts` and `../scripts/delete-attachment.ts`.
See operation #19 in `operations-catalog.md` for the full pattern.

---

## Two-server failover

Many setups expose two Asana MCP servers:

| Server | Notable behavior |
|---|---|
| Primary (often UUID-prefixed) | Full tool surface. **Has shown stale/cross-wired response bug** — `get_task` sometimes returns data for a different GID than requested |
| http-bridge | Same tool surface. More reliable; preferred fallback when primary returns stale data |

**Failover pattern:**

```text
1. Load primary tools via ToolSearch select:mcp__<primary>__get_task,...
2. Call primary first
3. If response.data.gid != requested_task_id → retry
4. If still mismatched → load bridge tool, call bridge variant
5. Use bridge result
```

The stale-response bug is **cosmetic for writes** (`update_tasks`, `create_tasks`, `delete_task` succeed even when the response data field is wrong) but **content-corrupting for reads** (a misread payload sent into agent context can contaminate subsequent work).

---

## Common parameter mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| `project: "..."` on `get_project` | `Not a Long: undefined` | Use `project_id` |
| `project_id: "..."` on `get_tasks` | Param ignored, returns workspace-wide | Use `project` |
| `limit: "100"` | `Invalid arguments` | Use `limit: 100` (number) |
| Custom-field GID as `task_id` | `Not a recognized ID` | Custom-field GIDs go inside `custom_fields: {...}` |
| `gid: "..."` on `get_task` | Param ignored | Use `task_id` |
| `assignee_section: "<section-GID>"` to move within project | This sets the user's My Tasks section, not the project section | Use `add_projects: [{project_id, section_id}]` |

---

## Workspace / project / section / task GID hierarchy

```
Workspace
└── Team
    └── Project
        ├── Section (per project)
        │   └── Task (top-level)
        │       └── Subtask (recursive)
        └── Custom field schema (per project)
            └── Field
                └── Enum option (for enum fields)
```

GIDs are opaque numeric strings (~16 digits, e.g. `1209876543210987`). They're stable across the API surface; the same task GID works in `get_task`, `update_tasks`, `delete_task`, and as a value in `parent`.

---

## REST fallback for missing MCP coverage

The primary Asana MCP server omits a handful of operations. When you need any of these, drop to direct REST.

### Operations the MCP does NOT cover

| Operation | REST verb + path | MCP coverage |
|---|---|---|
| Create section | `POST /projects/{project_gid}/sections` | **none** |
| List sections | `GET /projects/{project_gid}/sections` | **none** (but `get_project` with `include_sections=true` returns up to 50) |
| Update section name | `PUT /sections/{section_gid}` | **none** |
| Delete section | `DELETE /sections/{section_gid}` | **none** |
| Move task to a section | `POST /tasks/{task_gid}/addProject` body `{project, section}` | partial — `update_tasks` accepts `add_projects: [{project_id, section_id}]` but only after the section already exists |
| Add a dependency (raw form) | `POST /tasks/{task_gid}/addDependencies` body `{dependencies: [...]}` | covered by `update_tasks` with `add_dependencies` |
| Remove a dependency (raw form) | `POST /tasks/{task_gid}/removeDependencies` body `{dependencies: [...]}` | covered by `update_tasks` with `remove_dependencies` |
| List attachments on a task | `GET /tasks/{task_gid}/attachments` | covered by `get_attachments` |
| Upload an attachment to a task | `POST /tasks/{task_gid}/attachments` (`multipart/form-data`) | **none** |
| Delete an attachment | `DELETE /attachments/{attachment_gid}` | **none** |
| Project-template ops | various under `/project_templates/...` | **none** |
| Workspace-level memberships | various under `/workspace_memberships/...` | partial / inconsistent |

### Base URL and auth

```text
Base:   https://app.asana.com/api/1.0
Auth:   Authorization: Bearer <ASANA_PAT>
Body:   { "data": { ... } }     # Asana wraps both requests and responses
Accept: application/json
```

The PAT is created at `https://app.asana.com/0/my-apps` → "Personal access tokens". Treat it like a password.

### `curl` snippets

Create section:

```bash
curl -sS -X POST "https://app.asana.com/api/1.0/projects/<project-GID>/sections" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d '{"data":{"name":"<section name>","insert_after":"<existing-section-GID>"}}'
```

List sections:

```bash
curl -sS "https://app.asana.com/api/1.0/projects/<project-GID>/sections?opt_fields=name,resource_type" \
  -H "Authorization: Bearer $ASANA_PAT"
```

Delete section:

```bash
curl -sS -X DELETE "https://app.asana.com/api/1.0/sections/<section-GID>" \
  -H "Authorization: Bearer $ASANA_PAT"
```

Move task to section within project:

```bash
curl -sS -X POST "https://app.asana.com/api/1.0/tasks/<task-GID>/addProject" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d '{"data":{"project":"<project-GID>","section":"<section-GID>"}}'
```

Add dependencies (additive):

```bash
curl -sS -X POST "https://app.asana.com/api/1.0/tasks/<task-GID>/addDependencies" \
  -H "Authorization: Bearer $ASANA_PAT" \
  -H "Content-Type: application/json" \
  -d '{"data":{"dependencies":["<dep-GID-1>","<dep-GID-2>"]}}'
```

List attachments on a task:

```bash
curl -sS "https://app.asana.com/api/1.0/tasks/<task-GID>/attachments?opt_fields=name,size,created_at,resource_subtype,view_url" \
  -H "Authorization: Bearer $ASANA_PAT"
```

Upload an attachment (multipart/form-data). The `filename=` inside the form
value sets the attachment **display name** — useful when many files share a
generic on-disk name (`openapi.json`, `report.json`, …) but you want
distinguishable names in Asana:

```bash
curl --fail --request POST \
  --url "https://app.asana.com/api/1.0/tasks/<task-GID>/attachments" \
  --header "Authorization: Bearer $ASANA_PAT" \
  --form "file=@/local/path/to/file.json;type=application/json;filename=display-name.json"
```

**Gotcha — curl-pipe duplication:** if you write `curl -X POST ... | jq ...`
and the jq step fails, the curl call has ALREADY uploaded the file. Naively
retrying creates a duplicate. Mitigations:

- Capture the response to a variable first, then parse separately:
  `RESPONSE=$(curl ...); echo "$RESPONSE" | jq ...`
- Use `--fail` so curl exits non-zero on HTTP errors (does NOT catch
  jq/parsing bugs — those need the capture-then-parse pattern).
- Before retrying, GET the task's attachments and skip if a name + size
  match is already present.

The TypeScript wrapper `scripts/upload-attachment.ts` implements both
mitigations and exposes `--skip-if-exists` for one-shot idempotency.

Delete an attachment:

```bash
curl -sS -X DELETE "https://app.asana.com/api/1.0/attachments/<attachment-GID>" \
  -H "Authorization: Bearer $ASANA_PAT"
# Success: {"data":{}}
```

See also: `scripts/list-attachments.ts`, `scripts/upload-attachment.ts`,
`scripts/delete-attachment.ts`.

### Nicer wrappers

For repeated use, prefer the TypeScript wrappers under `../scripts/`. They handle:

- PAT injection from `.env` (Node `--env-file` flag, no dotenv library)
- 429 retries with `Retry-After` honored
- Stale-response guard for single-resource reads
- Structured `AsanaApiError` (status + Asana error message)
- Per-call JSON reports on stdout for piping

See `../scripts/README.md` for the full list and invocation examples.

### Rate limits

Asana applies per-token rate limits. The wrappers retry on HTTP 429 (max 3 retries, exponential backoff, `Retry-After` honored). Direct `curl` callers should handle 429 themselves.

