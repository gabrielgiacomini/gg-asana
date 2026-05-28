#!/usr/bin/env -S npx tsx
/**
 * @fileoverview List sections of an Asana project via REST.
 *
 * Why: the primary Asana MCP server does NOT expose `list_sections`. This
 * script wraps `GET /projects/{project_gid}/sections` and prints a pipe-able
 * table (GID, position order, name).
 *
 * Usage:
 *   tsx --env-file=../.env list-sections.ts [--project <project-GID>] [--json] [--quiet]
 *
 * Examples:
 *   # Default project, human-readable table:
 *   tsx --env-file=../.env list-sections.ts
 *
 *   # Specific project, JSON for piping into `jq`:
 *   tsx --env-file=../.env list-sections.ts --project 1209876543210987 --json
 *
 * Env vars consumed:
 *   ASANA_PAT                  (required)
 *   ASANA_DEFAULT_PROJECT_GID  (used when --project is omitted)
 *
 * @testing ESLint: npm run lint:root-repo-only from the repo root to apply root eslint.config.ts rules (including JSDoc) to skills TypeScript such as this script.
 * @testing Repo audit: npm run check:typescript-file-overview-errors from the repo root to validate required file-overview tags on this path.
 * @see skills/asana/scripts/_lib/client.ts exposes `listSections`, which performs the `GET /projects/{project_gid}/sections` request this CLI prints.
 * @see skills/asana/scripts/_lib/env.ts loads `ASANA_PAT` and default project GID consumed when `--project` is omitted.
 * @see skills/asana/scripts/README.md indexes this folder's tsx CLIs and env prerequisites for operators wiring shell automation.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

import { parseArgs, optionalFlag, booleanFlag } from "./_lib/cli";
import { listSections } from "./_lib/client";
import { loadAsanaEnv } from "./_lib/env";
import { info, error, setQuiet } from "./_lib/log";

/**
 * Parses CLI flags, loads Asana credentials, lists project sections, and prints JSON or a plain-text table.
 *
 * @remarks
 * `--quiet` routes log output through `_lib/log`; failures propagate to the module-level `main().catch` handler for stderr and exit code 1.
 */
async function main(): Promise<void> {
  const { flags } = parseArgs(process.argv.slice(2));
  if (booleanFlag(flags, "quiet")) setQuiet(true);

  const env = loadAsanaEnv();
  const projectGid = optionalFlag(flags, "project") ?? env.defaultProjectGid;
  const asJson = booleanFlag(flags, "json");

  info(`Listing sections of project ${projectGid}…`);
  const sections = await listSections(projectGid);

  if (asJson) {
    process.stdout.write(JSON.stringify(sections, null, 2) + "\n");
    return;
  }

  // Plain-text table. Columns: order | gid | name
  const widthOrder = 5;
  const widthGid = Math.max(
    3,
    ...sections.map((s) => s.gid.length),
  );
  const header = `${"order".padEnd(widthOrder)}  ${"gid".padEnd(widthGid)}  name`;
  process.stdout.write(`${header}\n`);
  process.stdout.write(`${"-".repeat(header.length)}\n`);
  sections.forEach((s, i) => {
    process.stdout.write(
      `${String(i + 1).padEnd(widthOrder)}  ${s.gid.padEnd(widthGid)}  ${s.name}\n`,
    );
  });
}

main().catch((err: unknown) => {
  error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
