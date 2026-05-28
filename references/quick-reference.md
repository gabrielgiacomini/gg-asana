---
title: Asana MCP — Quick Reference
---

# Asana MCP — Quick Reference

One-page cheat sheet for the most common Asana MCP operations. For full parameter shapes and gotchas, see `tools-cheatsheet.md`. For multi-task workflows, see `operations-catalog.md`.

## Tool surface (typical)

Both servers expose roughly the same surface. Tool names are namespaced by the MCP server's identifier, e.g. `mcp__<server>__get_task`.

| Operation | Tool |
|---|---|
| Confirm auth + capture workspace GID | `get_me` |
| List projects in a workspace | `get_projects` |
| Inspect a project's sections, custom fields, members | `get_project` (param: `project_id`) |
| List tasks in a project (top-level) | `get_tasks` (param: `project`) |
| Fetch a task with subtasks | `get_task` (param: `task_id`) |
| Update one or many tasks | `update_tasks` (batch up to 50) |
| Create one or many tasks | `create_tasks` (batch up to 50) |
| Delete a task | `delete_task` (one at a time, irreversible) |
| Search across the workspace | `search_tasks` / `search_objects` |
| Add a comment | `add_comment` |
| Get my assigned tasks | `get_my_tasks` |

## Load tools

```text
ToolSearch select:mcp__<server>__get_task,mcp__<server>__update_tasks
```

Both Asana servers (often a primary one and a `http-bridge` fallback) are loaded with `ToolSearch` `select:`. Always load the minimum kit; bulk-loading wastes round-trips.

## Discover a project

```text
get_me()                                  # → workspace GID
get_projects(limit=100)                   # → project GIDs
get_project(
  project_id="<GID>",
  include_sections=true
)                                         # → sections, custom-field schema, members

get_tasks(
  project="<GID>",
  limit=100,
  opt_fields="name,completed,due_on,assignee.name"
)                                         # → top-level tasks; SKIP notes to avoid overflow
```

## Read a task tree

```text
get_task(
  task_id="<GID>",
  include_subtasks=true,
  include_comments=false,
  opt_fields="name,notes,due_on,assignee.name,custom_fields.gid,custom_fields.text_value,custom_fields.enum_value.name,subtasks.gid,subtasks.name,subtasks.notes,subtasks.custom_fields.gid,subtasks.custom_fields.text_value,subtasks.custom_fields.enum_value.name"
)
```

For full-fidelity custom-field text values across many subtasks, fetch subtasks individually rather than via the `subtasks.custom_fields.text_value` projection (the projection has shown lossy behavior in deep fetches).

## Batched update

```text
update_tasks(tasks=[
  {"task": "<GID>", "notes": "...", "custom_fields": {"<field-GID>": "..."}},
  {"task": "<GID>", "name": "..."},
  ...                                     # up to 50 entries per call
])
```

## Batched create

```text
create_tasks(tasks=[
  {
    "name": "...",
    "workspace": "<workspace-GID>",
    "projects": [{"project_id": "<project-GID>", "section_id": "<optional>"}],
    "notes": "...",
    "custom_fields": {"<field-GID>": "..."}
  },
  ...
])

# For subtasks
create_tasks(tasks=[
  {
    "name": "...",
    "parent": "<parent-GID>",
    "workspace": "<workspace-GID>",
    "notes": "...",
    "custom_fields": {"<field-GID>": "..."}
  }
])
```

## Move task to a section

```text
update_tasks(tasks=[{
  "task": "<GID>",
  "add_projects": [{"project_id": "<project-GID>", "section_id": "<section-GID>"}]
}])
```

This re-places the task in the new section even if it's already in the project. Sections are 1-per-project per task.

## Delete a task

```text
delete_task(task="<GID>")     # irreversible at the API layer
```

No batch API; loop through GIDs. Always snapshot before running.

## URL formats

| Surface | URL |
|---|---|
| Task | `https://app.asana.com/0/<project-GID>/<task-GID>` |
| Project | `https://app.asana.com/1/<workspace-GID>/project/<project-GID>` (also returned as `permalink_url`) |

## Custom-field GIDs

- `Status`, `Priority`, `Content Type`, `Artifact` are typically **enum** fields → value is an enum-option GID, not display name
- `Task summary`, `IN`, `OUT` are typically **text** fields → value is a string

Discover the exact field GIDs + enum options per project via:

```text
get_project(project_id="<GID>", include_sections=false)
# inspect: custom_field_settings[].custom_field
```

## Common opt_fields recipes

| Goal | opt_fields |
|---|---|
| List names only | `"name"` |
| Names + completion + due | `"name,completed,due_on,assignee.name"` |
| Full task content | `"name,notes,due_on,completed,assignee.name,permalink_url,custom_fields.gid,custom_fields.name,custom_fields.text_value,custom_fields.enum_value.name"` |
| Parent + subtask names | `"name,subtasks.name"` |
| Parent + subtask GIDs and names | `"name,subtasks.gid,subtasks.name"` |
| Section membership | `"memberships.project.gid,memberships.section.gid,memberships.section.name"` |

## Stale-response check

```text
response = get_task(task_id="<X>")
assert response.data.gid == "<X>"
# If mismatch: retry. If repeats: switch to http-bridge MCP variant.
```

## Working-folder skeleton

```
.tmp/<YYYY-MM-DD-HHMM>-<topic>/
├── asana-mcp-playbook.md          ← tool-layer notes
├── asana-operations-runbook.md    ← operation-layer playbook
├── agent-output/                  ← JSON outputs from author agents
│   ├── SPEC.md                    ← shared agent contract
│   └── <unit>.json
├── backup/
│   └── <YYYY-MM-DD>-snapshot/
│       ├── INDEX.md
│       └── <task-GID>.md          ← one MD per task
└── audit-reports/
    ├── AUDIT-SPEC.md
    └── <slice>.md
```
