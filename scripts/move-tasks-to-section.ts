#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Move one or more tasks into a specific project section via REST.
 *
 * Why: the MCP `update_tasks` surface accepts `add_projects: [{project_id,
 * section_id}]` which works for section moves, but a thin REST wrapper is
 * useful when scripting from outside the MCP layer or when batching many
 * moves through a single, deterministic Node process.
 *
 * Endpoint: `POST /tasks/{task_gid}/addProject` with body
 *   `{ data: { project: "<project-GID>", section: "<section-GID>" } }`
 *
 * Asana has no batch endpoint for this — the script loops sequentially and
 * reports per-task success / failure.
 *
 * Usage:
 *   tsx --env-file=../.env move-tasks-to-section.ts \
 *       --section <section-GID> \
 *       [--project <project-GID>] \
 *       [--quiet] \
 *       <task-GID-1> <task-GID-2> ...
 *
 * Example:
 *   tsx --env-file=../.env move-tasks-to-section.ts \
 *       --section 1209555566667777 \
 *       1209111122223333 1209111122224444 1209111122225555
 *
 * Env vars consumed:
 *   ASANA_PAT                  (required)
 *   ASANA_DEFAULT_PROJECT_GID  (used when --project is omitted)
 *
 * Exit codes:
 *   0  every task moved successfully
 *   1  at least one task failed; see report on stderr
 *
 * @testing ESLint: npm run lint:root-repo-only from repo root (skills TypeScript + JSDoc).
 * @testing Repo audit: npm run check:typescript-file-overview-errors from repo root for overview tags.
 * @see skills/asana/scripts/_lib/client.ts - moveTaskToSection REST wrapper and AsanaApiError shaping used for per-task failures.
 * @see skills/asana/scripts/README.md - Operator runbook for PAT, default project GID, and sibling script wiring.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - JSDoc contract aligned with root ESLint rules on this file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import {
  parseArgs,
  requireFlag,
  optionalFlag,
  booleanFlag,
} from "./_lib/cli";
import { moveTaskToSection } from "./_lib/client";
import { AsanaApiError } from "./_lib/client";
import { loadAsanaEnv } from "./_lib/env";
import { info, success, warn, error, setQuiet } from "./_lib/log";

/**
 * One task's outcome in the final JSON report written to stdout.
 *
 * @remarks
 * `message` is populated only when `status` is `failed`, using narrowed Asana HTTP errors or a
 * generic string fallback so operators can grep logs while still emitting structured JSON.
 */
interface Result {
  taskGid: string;
  status: "moved" | "failed";
  message?: string;
}

/**
 * CLI orchestration for argv parsing, env loading, sequential per-task moves, JSON report, and exit codes.
 *
 * @remarks
 * Loops tasks in order (no batch API); honors `--quiet` via `setQuiet` before other logging. On
 * partial failure still prints the full `results` array to stdout, then exits 1 after stderr
 * summary via `error`.
 */
async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const sectionGid = requireFlag(flags, "section");
  const env = loadAsanaEnv();
  const projectGid = optionalFlag(flags, "project") ?? env.defaultProjectGid;
  const taskGids = positional;

  if (taskGids.length === 0) {
    error(
      "No task GIDs provided. Usage: move-tasks-to-section --section <GID> <task-GID-1> ...",
    );
    process.exit(1);
  }

  info(
    `Moving ${taskGids.length} task(s) into section ${sectionGid} of project ${projectGid}…`,
  );

  const results: Result[] = [];
  for (const taskGid of taskGids) {
    try {
      await moveTaskToSection({ taskGid, projectGid, sectionGid });
      results.push({ taskGid, status: "moved" });
      success(`moved ${taskGid}`);
    } catch (err) {
      const message =
        err instanceof AsanaApiError
          ? `${err.status} ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      results.push({ taskGid, status: "failed", message });
      warn(`failed ${taskGid}: ${message}`);
    }
  }

  const failed = results.filter((r) => r.status === "failed");
  process.stdout.write(JSON.stringify({ results }, null, 2) + "\n");

  if (failed.length > 0) {
    error(`${failed.length} of ${results.length} moves failed`);
    process.exit(1);
  }
  success(`All ${results.length} task(s) moved`);
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
