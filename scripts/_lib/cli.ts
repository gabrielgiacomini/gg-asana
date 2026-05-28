/**
 * @fileoverview Owns a dependency-free long-flag argv parser and small flag readers shared by
 * asana CLI scripts.
 *
 * Supports:
 *  - `--flag value` and `--flag=value` (string flags)
 *  - `--flag` with no value (boolean true)
 *  - bare positional arguments
 *
 * Does NOT support short flags like `-f`. Scripts in this folder always use long form so the call
 * sites read top-to-bottom.
 *
 * Helpers:
 *  - `parseArgs(argv)` → `{positional, flags}`
 *  - `requireFlag(flags, name)` → string; throws if absent or boolean-only
 *  - `optionalFlag(flags, name)` → string | undefined
 *  - `booleanFlag(flags, name)` → boolean
 *
 * @example
 * ```typescript
 * import { parseArgs, requireFlag, booleanFlag } from "./_lib/cli";
 * const { positional, flags } = parseArgs(["--token", "secret", "--dry-run", "positional"]);
 * const token = requireFlag(flags, "token");
 * const dryRun = booleanFlag(flags, "dry-run");
 * ```
 *
 * @testing ESLint: npm run lint:root-repo-only at repo root (skills TypeScript + JSDoc).
 * @testing Repo audit: npm run check:typescript-file-overview-errors (repo root).
 * @see skills/asana/scripts/list-attachments.ts - Imports parseArgs before client.
 * @see skills/asana/scripts/README.md - Runbook for scripts using these flags.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - JSDoc standard paired with ESLint here.
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

/**
 * Parsed argv split into positional tokens and a long-flag map.
 *
 * @remarks
 * Flag values are either strings (including empty string from `--flag=`) or boolean `true` when
 * the flag appears without a following non-flag token; absent keys mean the flag was not passed.
 */
export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parses `argv` into positional arguments and `--long-flag` entries without external parsers.
 *
 * @remarks
 * Mutates iteration only via the returned objects; treats the next argv token as a string value
 * when it does not start with `--`, otherwise records a boolean true for presence-only flags.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        const name = body.slice(0, eq);
        const value = body.slice(eq + 1);
        flags[name] = value;
        continue;
      }
      // Look ahead: if next token exists and is not another flag, treat as value.
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
      continue;
    }

    positional.push(arg);
  }

  return { positional, flags };
}

/**
 * String value for a required `--name` flag; throws when missing or boolean-only.
 *
 * @remarks
 * Call after parseArgs; use when the script cannot proceed without an explicit string payload for
 * the named flag.
 * @throws Error when the flag is absent or stored as a boolean instead of a string.
 */
export function requireFlag(
  flags: Record<string, string | boolean>,
  name: string,
): string {
  const value = flags[name];
  if (value === undefined || value === true || value === false) {
    throw new Error(
      `Missing required flag: --${name} <value>. Pass it on the command line.`,
    );
  }
  return value;
}

/**
 * Returns the string value for an optional `--name` flag, or undefined when unset or non-string.
 *
 * @remarks
 * Ignores boolean-only presence so optional string flags do not coerce `true` into a value; callers
 * that need on/off semantics should pair this with booleanFlag on a separate flag name.
 */
export function optionalFlag(
  flags: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = flags[name];
  if (typeof value === "string") return value;
  return undefined;
}

/**
 * Interprets a flag as truthy when it is present as boolean true or the string `"true"`.
 *
 * @remarks
 * Any other stored shape (including other strings or false) is treated as false; combine with
 * optionalFlag when scripts need a three-state optional string plus explicit boolean toggle.
 */
export function booleanFlag(
  flags: Record<string, string | boolean>,
  name: string,
): boolean {
  const value = flags[name];
  return value === true || value === "true";
}
