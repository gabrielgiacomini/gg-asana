/**
 * @fileoverview Environment-variable loader for the Asana REST scripts.
 *
 * This file owns typed reads of Asana-related `process.env` keys consumed by the asana CLI
 * scripts.
 *
 * - `getEnv(name, defaultValue?)` reads a single env var. Throws a descriptive
 *   error if the variable is missing AND no default value was supplied.
 * - `loadAsanaEnv()` returns the typed bundle the scripts need:
 *   `{pat, defaultProjectGid, defaultWorkspaceGid}`.
 *
 * The scripts expect to be launched with Node's `--env-file=../.env` flag
 * (Node 20.6+), so this file does not own any dotenv-parsing logic — it just
 * reads `process.env`.
 *
 * @example
 * ```typescript
 * import { loadAsanaEnv } from "./_lib/env";
 *
 * const { pat, defaultProjectGid } = loadAsanaEnv();
 * ```
 *
 * @testing CLI: from repo root run npm run lint:root-repo-only to exercise root ESLint over skills TypeScript including this helper.
 * @testing CLI: from repo root run npm run check:typescript-file-overview-errors to validate audited file-overview tags after editing this module.
 *
 * @see skills/asana/.env.example - Lists ASANA_* variable names that getEnv and loadAsanaEnv read before scripts can authenticate.
 * @see skills/asana/SKILL.md - Skill routing for Asana MCP work that assumes the same credential keys this module materializes from the environment.
 * @see skills/asana/scripts/list-sections.ts - Representative script that imports loadAsanaEnv after Node injects ../.env via --env-file.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

/**
 * Reads a single process environment variable, honoring an optional default when the value is empty.
 *
 * @remarks
 * I/O: reads `process.env` only; callers preload `.env` via Node `--env-file` or the host shell.
 * Throws when the variable is unset or blank and no default was supplied.
 *
 * @param name - Key to read from `process.env`.
 * @param defaultValue - Returned when the key is missing or blank.
 */
export function getEnv(name: string, defaultValue?: string): string {
  const raw = process.env[name];
  if (raw !== undefined && raw !== "") {
    return raw;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  throw new Error(
    `Missing required environment variable: ${name}. ` +
      `Populate it in skills/asana/.env (see .env.example), ` +
      `then re-run with \`tsx --env-file=../.env ...\`.`,
  );
}

/**
 * Typed bundle of Asana PAT and default workspace/project GIDs for REST scripts.
 *
 * @remarks
 * Populated by `loadAsanaEnv()` from ASANA_* keys documented alongside `.env.example`.
 */
export interface AsanaEnv {
  /** Asana Personal Access Token (Bearer credential). */
  pat: string;
  /** Default project GID used when a script's --project flag is absent. */
  defaultProjectGid: string;
  /** Default workspace GID used when a script's --workspace flag is absent. */
  defaultWorkspaceGid: string;
}

/**
 * Collects required Asana credentials from fixed environment variable names.
 *
 * @remarks
 * Calls `getEnv` for ASANA_PAT, ASANA_DEFAULT_PROJECT_GID, and ASANA_DEFAULT_WORKSPACE_GID without defaults.
 */
export function loadAsanaEnv(): AsanaEnv {
  return {
    pat: getEnv("ASANA_PAT"),
    defaultProjectGid: getEnv("ASANA_DEFAULT_PROJECT_GID"),
    defaultWorkspaceGid: getEnv("ASANA_DEFAULT_WORKSPACE_GID"),
  };
}
