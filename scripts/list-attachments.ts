#!/usr/bin/env -S npx tsx
/**
 * @fileoverview List attachments on a task via REST.
 *
 * Why: while the primary Asana MCP server exposes `get_attachments`, having a
 * standalone REST CLI is useful (a) for piping into `jq` from shell scripts,
 * (b) as an idempotency check before uploads (compare name + size), and (c)
 * for parity with the other attachment scripts in this folder (upload /
 * delete) which have NO MCP equivalents.
 *
 * Endpoint: `GET /tasks/{task_gid}/attachments`
 *
 * Usage:
 *   tsx --env-file=../.env list-attachments.ts --task <task-GID> [--json] [--quiet]
 *
 * Examples:
 *   # Human-readable table:
 *   tsx --env-file=../.env list-attachments.ts --task 1209876543210987
 *
 *   # JSON (for piping into jq):
 *   tsx --env-file=../.env list-attachments.ts --task 1209876543210987 --json | jq 'length'
 *
 * Env vars consumed:
 *   ASANA_PAT (required)
 *
 * Exit codes:
 *   0  success (empty list also exits 0)
 *   1  validation / API error
 *
 * @testing ESLint: npm run lint:root-repo-only from repo root (skills TypeScript + JSDoc).
 * @testing Repo audit: npm run check:typescript-file-overview-errors from repo root for overview tags.
 * @see skills/asana/scripts/_lib/client.ts - listAttachments GET paging and opt_fields contract after argv parsing.
 * @see skills/asana/scripts/README.md - Operator runbook for PAT, task GID sourcing, and sibling upload/delete scripts.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - JSDoc contract aligned with root ESLint rules on this file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { parseArgs, requireFlag, booleanFlag } from "./_lib/cli";
import { listAttachments } from "./_lib/client";
import { info, error, setQuiet } from "./_lib/log";

/**
 * CLI orchestration for argv parsing, REST-backed attachment listing for one task, and stdout emission.
 *
 * @remarks
 * On success writes JSON (with `--json`) or a column-aligned table to stdout; an empty attachment
 * list still exits 0 with a short human-readable line. On validation or API failure prints via
 * `error` and exits with code 1. Honors `--quiet` via `setQuiet` before other logging. PAT and
 * base URL resolution live inside `listAttachments` / shared fetch helpers, not in this function.
 */
async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const taskGid = requireFlag(flags, "task");
  const asJson = booleanFlag(flags, "json");

  info(`Listing attachments on task ${taskGid}…`);
  const attachments = await listAttachments(taskGid);

  if (asJson) {
    process.stdout.write(JSON.stringify(attachments, null, 2) + "\n");
    return;
  }

  if (attachments.length === 0) {
    process.stdout.write("(no attachments)\n");
    return;
  }

  // Plain-text table. Columns: gid | size | created_at | name
  const widthGid = Math.max(3, ...attachments.map((a) => a.gid.length));
  const widthSize = Math.max(
    4,
    ...attachments.map((a) =>
      a.size === undefined || a.size === null ? 1 : String(a.size).length,
    ),
  );
  const widthCreated = Math.max(
    10,
    ...attachments.map((a) => (a.created_at ?? "").length),
  );

  const header = `${"gid".padEnd(widthGid)}  ${"size".padStart(widthSize)}  ${"created_at".padEnd(widthCreated)}  name`;
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${"-".repeat(header.length)}\n`);
  for (const a of attachments) {
    const size =
      a.size === undefined || a.size === null ? "-" : String(a.size);
    const created = a.created_at ?? "-";
    process.stdout.write(
      `${a.gid.padEnd(widthGid)}  ${size.padStart(widthSize)}  ${created.padEnd(widthCreated)}  ${a.name}\n`,
    );
  }
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
