import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { getVaultDir } from './vault.js';

// ── Source Resolution ──────────────────────────────────────────────────────────
//
// Sources come in two flavors:
//   1. Local paths   — must exist on disk (a file resolves to its parent dir)
//   2. Git sources   — https/ssh/git/file URLs, scp-like git@host:path,
//                      npm-style git+https://…, and github:user/repo shorthand.
//                      These are cloned/refreshed in the vault's .git-cache and
//                      the checkout directory is returned, so MODULE.json can
//                      store a remote URL that stays resolvable forever
//                      (no more dead /tmp paths breaking `update`).

/** True when `from` should be treated as a git remote rather than a local path. */
export function isGitSource(from: string): boolean {
  const s = from.trim();
  if (s.startsWith('github:')) return true;            // github:user/repo shorthand
  if (s.startsWith('git+')) return true;               // npm-style git+https://…
  if (/^git@[^:\s]+:\S/.test(s)) return true;          // scp-like git@host:user/repo.git
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true; // any URL scheme (https, ssh, git, file, …)
  return false;
}

/** Normalize supported git source formats to a URL `git clone` understands. */
export function normalizeGitUrl(from: string): string {
  let s = from.trim();
  if (s.startsWith('github:')) {
    s = `https://github.com/${s.slice('github:'.length)}`;
  } else if (s.startsWith('git+')) {
    s = s.slice('git+'.length);
  }
  if (s.endsWith('.git/')) s = s.slice(0, -1);
  return s;
}

function runGit(args: string[], cwd?: string): { ok: boolean; error?: string } {
  let res;
  try {
    res = spawnSync('git', args, { cwd, stdio: 'pipe', timeout: 120_000, encoding: 'utf8' });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (res.error) return { ok: false, error: res.error.message };
  if (res.status !== 0) {
    const detail = (res.stderr || res.stdout || `git ${args[0]} exited with status ${res.status}`).trim();
    return { ok: false, error: detail };
  }
  return { ok: true };
}

function cloneInto(url: string, dir: string, version?: string): { ok: boolean; error?: string } {
  const args = ['clone', '--depth', '1'];
  if (version) args.push('--branch', version);
  args.push('--', url, dir);
  return runGit(args);
}

/**
 * Clone (first use) or refresh (subsequent uses) a git source in the vault's
 * `.git-cache` and return the checkout directory.
 *
 * - no `version`   → fast-forward the default branch; self-heals (re-clones)
 *   on non-fast-forward / detached-HEAD pull failures
 * - `version`      → clone that ref, or fetch + force-checkout the pinned
 *   ref (branch or tag) on later updates
 *
 * Returns null on any git failure so callers surface a resolution error.
 */
export function resolveGitSource(from: string, version?: string): string | null {
  const url = normalizeGitUrl(from);
  const cacheRoot = path.join(getVaultDir(), '.git-cache');
  const key = createHash('sha256').update(url).digest('hex').slice(0, 16);
  const dir = path.join(cacheRoot, key);
  const hasClone = fs.existsSync(path.join(dir, '.git'));

  try {
    fs.mkdirSync(cacheRoot, { recursive: true });

    if (!hasClone) {
      fs.rmSync(dir, { recursive: true, force: true }); // drop any partial clone
      const res = cloneInto(url, dir, version);
      return res.ok ? dir : null;
    }

    if (version) {
      // Pinned ref: fetch it and check out the fetched head (tag or branch)
      const fetch = runGit(['fetch', '--depth', '1', 'origin', version], dir);
      if (!fetch.ok) return null;
      const co = runGit(['checkout', '--force', '--quiet', 'FETCH_HEAD'], dir);
      return co.ok ? dir : null;
    }

    // Default: fast-forward to the remote's default branch
    const pull = runGit(['pull', '--ff-only'], dir);
    if (pull.ok) return dir;

    // Detached/pinned clone, force-push, or broken cache — self-heal with a
    // fresh clone instead of failing the update forever.
    fs.rmSync(dir, { recursive: true, force: true });
    const res = cloneInto(url, dir);
    return res.ok ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Resolve an install/update source to a local directory.
 * Local paths must exist; git sources are cloned/refreshed in the vault cache.
 */
export function resolveSourceToDir(from: string, projectDir?: string, version?: string): string | null {
  const trimmed = from.trim();

  // Path source — direct local path (URLs never resolve as paths anyway)
  if (!isGitSource(trimmed) && fs.existsSync(trimmed)) {
    const stat = fs.statSync(trimmed);
    if (stat.isDirectory()) return trimmed;
    // If it's a file, check if parent directory is a module
    return path.dirname(trimmed);
  }

  // Git source — clone/update in the vault's .git-cache
  if (isGitSource(trimmed)) return resolveGitSource(trimmed, version);

  return null;
}
