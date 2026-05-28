/**
 * @fileoverview ANSI-colored stderr logger for asana CLI scripts, with optional quiet mode.
 *
 * `info` / `warn` / `error` / `success` write to stderr so stdout stays clean for piped JSON or
 * tables. Call `setQuiet(true)` when `--quiet` is passed; only `error` still prints in that mode.
 *
 * @example
 * ```typescript
 * import { info, error, setQuiet } from "./_lib/log";
 *
 * setQuiet(process.argv.includes("--quiet"));
 * info("Fetching tasks…");
 * error("Asana token missing.");
 * ```
 *
 * @testing Root ESLint: npm run lint:root-repo-only
 * @testing Root file-overview gate: npm run check:typescript-file-overview-errors
 *
 * @see skills/asana/scripts/get-project-inventory.ts - Representative CLI that composes setQuiet with info, success, and error for operator-facing stderr output.
 * @see docs/TYPESCRIPT_STANDARDS_DOCUMENTATION_JSDOC.md - Repository contract for symbol-level JSDoc enforced on skills TypeScript by root ESLint.
 *
 * @documentation reviewed=2026-05-13 standard=FILE_OVERVIEW_STANDARDS_TYPESCRIPT@3
 */

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

let quiet = false;

/**
 * Toggles whether non-error log levels emit to stderr.
 *
 * @remarks
 * When `true`, `info`, `warn`, and `success` return without writing; `error` still prints.
 * `dim` only wraps text in ANSI codes and does not consult this flag.
 */
export function setQuiet(value: boolean): void {
  quiet = value;
}

/**
 * Writes one colored line to stderr with a stable prefix and trailing reset.
 *
 * @remarks
 * Always appends a newline after `msg`. Used by the exported level helpers and by `error` in
 * quiet mode.
 */
function write(prefix: string, msg: string): void {
  process.stderr.write(`${prefix} ${msg}${RESET}\n`);
}

/**
 * Emits a cyan `info` line to stderr when not in quiet mode.
 *
 * @remarks
 * Prefer for progress narration; keep stdout reserved for machine-readable payloads.
 */
export function info(msg: string): void {
  if (quiet) return;
  write(`${CYAN}info${RESET}`, msg);
}

/**
 * Emits a yellow `warn` line to stderr when not in quiet mode.
 */
export function warn(msg: string): void {
  if (quiet) return;
  write(`${YELLOW}warn${RESET}`, msg);
}

/**
 * Emits a red `error` line to stderr.
 *
 * @remarks
 * Ignores quiet mode so operators still see fatal or configuration problems.
 */
export function error(msg: string): void {
  // Errors always print, even in quiet mode.
  write(`${RED}error${RESET}`, msg);
}

/**
 * Emits a green success line to stderr when not in quiet mode.
 *
 * @remarks
 * Prefix label is `ok` in the ANSI prefix while the level reads as success in script usage.
 */
export function success(msg: string): void {
  if (quiet) return;
  write(`${GREEN}ok${RESET}`, msg);
}

/**
 * Wraps plain text with dim styling resets for embedding in other stderr lines.
 *
 * @remarks
 * Does not write to stderr by itself; compose the return value into larger messages or templates.
 */
export function dim(msg: string): string {
  return `${DIM}${msg}${RESET}`;
}
