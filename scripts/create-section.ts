#!/usr/bin/env -S npx tsx
/**
 * @fileoverview Create a new section in an Asana project via REST.
 *
 * Why: the primary Asana MCP server does NOT expose `create_section`. REST is
 * the only path. This script wraps `POST /projects/{project_gid}/sections`
 * and prints the new section GID + a permalink-style report.
 *
 * Usage:
 *   tsx --env-file=../.env create-section.ts <name> \
 *       [--project <project-GID>] \
 *       [--insert-after <section-GID>] \
 *       [--insert-before <section-GID>] \
 *       [--quiet]
 *
 * Examples:
 *   # Append to the end of the default project:
 *   tsx --env-file=../.env create-section.ts "Backlog"
 *
 *   # Insert "Triage" before an existing section:
 *   tsx --env-file=../.env create-section.ts "Triage" \
 *       --project 1209876543210987 \
 *       --insert-before 1209111122223333
 *
 * Env vars consumed:
 *   ASANA_PAT                  (required)
 *   ASANA_DEFAULT_PROJECT_GID  (used when --project is omitted)
 *
 * Exit codes:
 *   0  success
 *   1  validation / API error
 *
 * @testing ESLint: npm run lint:root-repo-only from repo root (skills TypeScript + JSDoc).
 * @testing Repo audit: npm run check:typescript-file-overview-errors from repo root for overview tags.
 * @see skills/asana/scripts/_lib/client.ts - createSection REST call and response typing after argv/env validation.
 * @see skills/asana/scripts/README.md - Operator runbook for PAT, default project GID, and sibling script wiring.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - JSDoc contract aligned with root ESLint rules on this file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { parseArgs, optionalFlag, booleanFlag } from "./_lib/cli";
import { createSection } from "./_lib/client";
import { loadAsanaEnv } from "./_lib/env";
import { info, error, success, setQuiet } from "./_lib/log";

/**
 * CLI orchestration for argv parsing, env loading, section creation, and JSON report emission.
 *
 * @remarks
 * On success writes a JSON payload to stdout and uses log helpers for human-readable lines; on
 * validation or API failure prints via `error` and exits with code 1. Honors `--quiet` via
 * `setQuiet` before other logging.
 */
async function main(): Promise<void> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const name = positional[0];
  if (!name) {
    error("Missing section name. Usage: create-section <name> [--project <GID>]");
    process.exit(1);
  }

  const env = loadAsanaEnv();
  const projectGid = optionalFlag(flags, "project") ?? env.defaultProjectGid;
  const insertAfter = optionalFlag(flags, "insert-after");
  const insertBefore = optionalFlag(flags, "insert-before");

  if (insertAfter && insertBefore) {
    error("Pass either --insert-after or --insert-before, not both.");
    process.exit(1);
  }

  info(`Creating section "${name}" in project ${projectGid}…`);
  const section = await createSection({
    projectGid,
    name,
    insertAfter,
    insertBefore,
  });

  success(`Created section ${section.gid} ("${section.name}")`);
  // Report on stdout so callers can pipe it.
  process.stdout.write(
    JSON.stringify(
      {
        section_gid: section.gid,
        name: section.name,
        project_gid: projectGid,
        permalink: `https://app.asana.com/0/${projectGid}/board`,
      },
      null,
      2,
    ) + "\n",
  );
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
