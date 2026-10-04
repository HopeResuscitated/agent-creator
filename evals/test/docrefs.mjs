// docrefs.mjs - check the eval documentation against the real tree (read-only).
//
//   "$NODE_BIN" evals/test/docrefs.mjs [--json]
//
// For evals/{PLAN.yaml,HANDOFF.md,REPIN.md,README.md,RESUME.md,INVALIDATIONS.md,AUDIT.md}:
//   - repo-relative paths (evals/..., packages/..., apps/..., scripts/...) and bare evals file names in `code`
//     must exist in the working tree (or be marked as removed/historical on the same line)
//   - absolute Windows paths under C:\Users\cierra must exist (machine-local evidence/binaries); %LOCALAPPDATA% too
//   - git hashes (7-40 hex, at least one digit and one letter) must resolve in this repo or in the jcode-evalpin
//     checkout, unless they are known non-commit hex (sha256 prefixes, digests: preceded by sha256/digest/fp words)
//   - npm/node commands `node evals/<x>` / `bash evals/<x>` must point at existing files
// Lines containing "historical", "removed", "deleted", "superseded", "was ", "old " are reported as INFO, not FAIL,
// so historical evidence is never "corrected". Exit 0 when no FAIL.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const JREPO = 'C:/Users/cierra/jcode-evalpin';
const DOCS = ['PLAN.yaml', 'HANDOFF.md', 'REPIN.md', 'README.md', 'RESUME.md', 'INVALIDATIONS.md', 'AUDIT.md'].map((f) => path.join(REPO, 'evals', f)).filter((f) => fs.existsSync(f));
const HIST = /historical|removed|deleted|superseded|\bwas\b|\bold\b|archive|formerly|renamed|no longer|pre-|before /i;
const gitOk = (repo, h) => { try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${h}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; } };
const expandEnv = (p) => p.replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA ?? '%LOCALAPPDATA%').replace(/%USERPROFILE%/gi, process.env.USERPROFILE ?? '%USERPROFILE%');

export function extractRefs(line) {
  const refs = [];
  for (const m of line.matchAll(/`([^`]+)`/g)) {
    const c = m[1].trim();
    for (const p of c.matchAll(/(?:^|[\s"'(=])((?:evals|packages|apps|scripts)\/[\w./*{}<>-]+)/g)) refs.push({ kind: 'path', v: p[1] });
    // a code span that IS a Windows path (may contain spaces): the whole span; otherwise space-free path tokens
    if (/^(?:[A-Za-z]:[\\/](?!\/)|%LOCALAPPDATA%|%USERPROFILE%)[^|;"']*$/.test(c)) refs.push({ kind: 'abs', v: c });
    else for (const p of c.matchAll(/(?<![A-Za-z])((?:[A-Za-z]:[\\/](?!\/)|%LOCALAPPDATA%[\\/]|%USERPROFILE%[\\/])[^\s`"'|;,)]+)/g)) refs.push({ kind: 'abs', v: p[1] });
  }
  for (const m of line.matchAll(/(?<![\w/.-])([0-9a-f]{7,40})(?![\w-])/g)) {
    const h = m[1]; if (!/[a-f]/.test(h) || !/\d/.test(h)) continue;
    // commits are written as 7 (this repo) or 9 (jcode) hex chars, or in full; 8-hex and '...'-truncated values are
    // sha256/fingerprint/digest prefixes, not commits
    if (line.slice(m.index + h.length, m.index + h.length + 3) === '...' || h.length === 8 || (h.length > 9 && h.length < 40)) continue;
    const before = line.slice(Math.max(0, m.index - 24), m.index);
    if (/sha256|digest|fp[ =:]|fingerprint|tree|sha |hash|parent_model|=\s*$/i.test(before) || h.length === 64) continue;
    refs.push({ kind: 'hash', v: h });
  }
  return refs;
}
const clean = (p) => p.replace(/[.,:;)]+$/, '');
const hasGlob = (p) => /[*{}<>]/.test(p);
/** exists, where a path segment written as "<prefix>..." (an elided hash dir) matches any entry starting with <prefix> */
function existsElided(p) {
  if (!p.includes('...')) return fs.existsSync(p);
  const segs = p.split(/[\\/]/); let cur = segs.shift() + path.sep;
  for (const s of segs) {
    if (!s) continue;
    if (s.endsWith('...')) { let hit; try { hit = fs.readdirSync(cur).find((e) => e.startsWith(s.slice(0, -3))); } catch { return false; } if (!hit) return false; cur = path.join(cur, hit); }
    else cur = path.join(cur, s);
  }
  return fs.existsSync(cur);
}

export let checked = 0;
export function check() {
  const out = []; checked = 0;
  for (const doc of DOCS) {
    const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const r of extractRefs(line)) {
        let ok = true, what = r.v; checked++;
        if (r.kind === 'path') { const p = clean(r.v); if (hasGlob(p)) continue; ok = fs.existsSync(path.join(REPO, p)); what = p; }
        else if (r.kind === 'abs') { const p = clean(expandEnv(r.v)); if (hasGlob(p) || /\.\.\.$/.test(p)) continue; ok = existsElided(p); what = p; }
        else if (r.kind === 'hash') { ok = gitOk(REPO, r.v) || (fs.existsSync(JREPO) && gitOk(JREPO, r.v)); }
        if (!ok) out.push({ doc: path.relative(REPO, doc).replace(/\\/g, '/'), line: i + 1, kind: r.kind, ref: what, level: HIST.test(line) ? 'INFO' : 'FAIL', text: line.trim().slice(0, 160) });
      }
    });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = check();
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else for (const r of res) console.log(`${r.level} ${r.doc}:${r.line} ${r.kind} ${r.ref}\n     ${r.text}`);
  const f = res.filter((r) => r.level === 'FAIL').length;
  console.log(`DOCREFS ${f ? `FAIL (${f})` : 'PASS'} docs=${DOCS.length} refs_checked=${checked} unresolved=${res.length} (INFO=${res.length - f})`);
  process.exit(f ? 1 : 0);
}
