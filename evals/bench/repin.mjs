// repin.mjs - executable form of evals/REPIN.md (steps 1-12; step 13 = cpreflight.mjs). Fails closed.
//
//   "$NODE_BIN" evals/bench/repin.mjs --out <R dir> --dry-run              read-only: what each stage would check NOW
//   "$NODE_BIN" evals/bench/repin.mjs --out <R dir> --stage <id> [--apply] run one stage (in order; see below)
//   "$NODE_BIN" evals/bench/repin.mjs --out <R dir> --status               print the record
//   "$NODE_BIN" evals/bench/repin.mjs --out <R dir> --restart              archive a FAILED record and start again at 1
// Stage ids: 1 2 3 4 5-6 7-10 11 12  (REPIN.md numbering). Options for the stages:
//   --a3-bin <jcode.exe>      default C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe
//   --a3-sha <sha256>         expected A3 hash (default 42ed4012...0bab7; a rebuilt binary needs its own value + unit run)
//   --ollama-version <v>      the version that will be pinned (default: the current pin 0.34.4)
//   --quant <name>            stage 12: the chosen quant as recorded in PLAN.yaml (e.g. Q4_K_M)
//
// Rules (REPIN.md "A FAIL stops the procedure ... restart from step 1"):
//   - stage N runs only if every earlier stage is PASS in <R>/repin-record.json; a FAIL marks the record failed and
//     every later invocation refuses until --restart (which archives the record and begins again at stage 1)
//   - stages 7-10 and later run only if baseline-env.json still has the hash stage 5-6 committed
//   - only stage 5-6 with --apply writes anything in the repo (baseline-env.json + one commit of that file); the
//     model rebuild in stage 3 is MANUAL (printed), the stage verifies its result
//   - --dry-run never writes the record, never runs the long tests (gates.sh, t01x4.ps1, editstring, a3offline) and
//     never edits/commits; it reports for each stage what it checks and whether that check passes right now. Its only
//     side effect is stage 3's 1-token request to read the model placement (the same request as suite.sh's warm-up),
//     which loads the model if it is not loaded
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process'; import { jcodeHomeFingerprint } from './fakeprov.mjs'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const ENVF = path.join(REPO, 'evals', 'baseline-env.json');
export const STAGES = ['1', '2', '3', '4', '5-6', '7-10', '11', '12'];
export const DEFAULTS = {
  a3Bin: 'C:/Users/cierra/jcode-evalpin-a3cand-bin/jcode.exe', a3Sha: '42ed4012e129cc36e9d3f3c299b3015fbde5c8cb95cab36ed41f0d526fd0bab7',
  a3Commit: '710560f91154f5fed6f1ec9a34b9852a471d8b5f', a2Bin: 'C:/Users/cierra/jcode-evalpin-a2-bin/jcode.exe', oldBin: 'C:/Users/cierra/jcode-evalpin-bin/jcode.exe',
  jrepo: 'C:/Users/cierra/jcode-evalpin', prevT01: 'df1332d786b0ee3b57f58eb6e7eff90a69e366e5998efe8f9d3b6b5319d60e64',
  cpuDigest: '1ef2c71ed2065896b080104a0499a15b320f9ea3f9049bacdadc42e71630b60f', cpuBackup: 'hermes-local-32k-cpu-1ef2c71e',
};

/** May stage `id` run given the record? Returns null if yes, else the reason. Pure. */
export function gate(record, id, envSha) {
  if (!STAGES.includes(id)) return `unknown stage ${id}`;
  if (record.failed) return `record FAILED at stage ${record.failed_stage}: run --restart, then start again at stage 1`;
  for (const s of STAGES.slice(0, STAGES.indexOf(id))) if (record.stages[s]?.status !== 'PASS') return `stage ${s} is not PASS (stages run in order)`;
  // a recorded stage is never re-run in place: its evidence (digest, sha, fingerprint) feeds the later stages
  const done = STAGES.slice(STAGES.indexOf(id)).filter((s) => record.stages[s]);
  if (done.length) return `stage(s) ${done.join(', ')} already recorded: re-running would overwrite that evidence (use --restart, which archives this attempt)`;
  if (STAGES.indexOf(id) > STAGES.indexOf('5-6') && record.stages['5-6']?.env_sha !== envSha) return 'baseline-env.json changed since stage 5-6 committed the pins';
  return null;
}
/** Parse a record file: missing -> a new record; present but unreadable/invalid -> throws (fail closed: a damaged
 *  record must never be replaced by an empty one, which would let stage 1 start again over existing evidence). */
export function parseRecord(text) {
  if (text === null) return { schema: 'repin-record/1', created: new Date().toISOString(), stages: {} };
  const r = JSON.parse(text);
  if (r?.schema !== 'repin-record/1' || typeof r.stages !== 'object' || r.stages === null) throw new Error('not a repin-record/1');
  return r;
}
/** Files a stage writes under <R>; --restart moves them (with the record) into <R>/attempt-<ts>/ so nothing is overwritten. */
export const STAGE_OUTPUTS = ['hwprofile.json', 'Modelfile.cpu', 'Modelfile.new', 'gates', 't01x4'];
/** The pin edit of stage 5-6 (pure): new file text, keeping CRLF and every other byte. */
export function editPins(text, { jcodeSha, digest, ollamaVersion }) {
  let t = text; const once = (re, rep, what) => { const m = t.match(re); if (!m || t.match(new RegExp(re.source, 'g')).length !== 1) throw new Error(`baseline-env.json: ${what} not found exactly once`); t = t.replace(re, rep); };
  once(/("jcode_sha256":\s*")[0-9a-f]{64}(")/, `$1${jcodeSha}$2`, 'jcode_sha256');
  once(/("hermes-local-32k":\s*")[0-9a-f]{64}(")/, `$1${digest}$2`, 'hermes-local-32k digest');
  if (ollamaVersion) once(/("ollama_version":\s*")[^"]+(")/, `$1${ollamaVersion}$2`, 'ollama_version');
  return t;
}
/** Stage 3 check (pure): the GPU modelfile must equal the CPU one minus `PARAMETER num_gpu 0`. With allowFrom (a different
 *  quant declared via --quant), the FROM blob may differ; every PARAMETER/TEMPLATE line must still be identical. */
export function modelfileDiff(cpu, gpu, { allowFrom = false } = {}) {
  const norm = (s) => s.replace(/\r\n/g, '\n').split('\n').filter((l) => !/^#/.test(l) && l.trim() !== '').map((l) => l.trimEnd());
  const a = norm(cpu).filter((l) => !/^FROM /.test(l)), b = norm(gpu).filter((l) => !/^FROM /.test(l));
  const removed = a.filter((l) => !b.includes(l)), added = b.filter((l) => !a.includes(l));
  const fromA = norm(cpu).find((l) => /^FROM /.test(l)), fromB = norm(gpu).find((l) => /^FROM /.test(l));
  return { removed, added, sameFrom: fromA === fromB, ok: added.length === 0 && removed.length === 1 && /^PARAMETER num_gpu 0$/.test(removed[0]) && (fromA === fromB || (allowFrom && !!fromB)) };
}

const sha256 = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const api = (method, p, body) => new Promise((resolve) => { const q = http.request({ host: '127.0.0.1', port: 11434, path: p, method, agent: false, timeout: 600000, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); }); q.on('error', () => resolve(null)); q.on('timeout', () => { q.destroy(); resolve(null); }); q.end(body); });
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: REPO, maxBuffer: 64 << 20, ...opts }); return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; };
const git = (...a) => run('git', ['-C', REPO, ...a]);
const win = (p) => p.replace(/\//g, '\\');

/** Each stage returns { status: PASS|FAIL, checks: [{ name, ok, detail }], data? }. dry => read-only subset. */
const STAGE_IMPL = {
  async '1'({ R, dry }) {
    const out = path.join(dry ? fs.mkdtempSync(path.join(process.env.TEMP ?? REPO, 'repin-dry-')) : R, 'hwprofile.json');
    run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', win(path.join(HERE, 'hwprofile.ps1')), '-Out', win(out)]);
    let h = null; try { h = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, '')); } catch { /* */ }
    const oe = run(process.execPath, [path.join(HERE, 'ollamaenv.mjs'), '--json']); let ollamaEnv = null; try { ollamaEnv = JSON.parse(oe.out).material; } catch { /* */ }
    const gpus = h?.nvidia?.gpus ?? [];
    const rocm = !!(h?.rocm?.rocm_smi || h?.rocm?.hipinfo);
    return { checks: [
      { name: 'hwprofile-written', ok: !!h, detail: out },
      { name: 'gpu-visible (discrete: nvidia-smi or ROCm)', ok: gpus.length > 0 || rocm, detail: gpus.length ? gpus.map((g) => `${g.name} ${g.memory_total_mib} MiB driver ${g.driver}`).join('; ') : rocm ? 'ROCm tools present' : 'no nvidia-smi GPU, no ROCm (integrated Vulkan iGPU only is not the hardware change)' },
      { name: 'on-AC', ok: /^(AC|no battery)/.test(String(h?.power?.source)), detail: String(h?.power?.source) },
      { name: 'ollama-server-env-recorded', ok: !!ollamaEnv, detail: ollamaEnv ? `KV ${ollamaEnv.OLLAMA_KV_CACHE_TYPE}, FA ${ollamaEnv.OLLAMA_FLASH_ATTENTION}, ctx ${ollamaEnv.OLLAMA_CONTEXT_LENGTH}` : 'unreadable' },
    ], data: { hwprofile: dry ? null : out, ollama_env: ollamaEnv }, cleanup: dry ? path.dirname(out) : null };
  },
  async '2'({ opts, env }) {
    const v = (await api('GET', '/api/version'))?.version; const want = opts.ollamaVersion ?? env.model_server.ollama_version;
    return { checks: [{ name: 'ollama-version', ok: v === want, detail: `running ${v ?? 'unreachable'}, will pin ${want}${v && v !== env.model_server.ollama_version && !opts.ollamaVersion ? ' (auto-update ran? reinstall or pass --ollama-version deliberately)' : ''}` }], data: { ollama_version: want } };
  },
  async '3'({ R, dry, opts }) {
    const otherQuant = !!opts.quant && opts.quant !== 'Q4_K_M';   // a deliberate quant switch (REPIN step 12): FROM may differ
    const tags = await api('GET', '/api/tags'); const find = (n) => tags?.models?.find((m) => m.name === `${n}:latest` || m.name === n);
    const backup = find(DEFAULTS.cpuBackup), cur = find('hermes-local-32k');
    const showB = backup ? await api('POST', '/api/show', JSON.stringify({ model: DEFAULTS.cpuBackup })) : null;
    const showC = cur ? await api('POST', '/api/show', JSON.stringify({ model: 'hermes-local-32k' })) : null;
    const d = showB && showC ? modelfileDiff(showB.modelfile ?? '', showC.modelfile ?? '', { allowFrom: otherQuant }) : null;
    if (!dry && showB && showC) { fs.writeFileSync(path.join(R, 'Modelfile.cpu'), showB.modelfile ?? ''); fs.writeFileSync(path.join(R, 'Modelfile.new'), showC.modelfile ?? ''); }
    if (cur) await api('POST', '/api/generate', JSON.stringify({ model: 'hermes-local-32k', prompt: 'ok', stream: false, options: { num_predict: 1 } }));
    const p = (await api('GET', '/api/ps'))?.models?.find((m) => m.name === 'hermes-local-32k:latest');
    return { checks: [
      { name: 'cpu-model-kept', ok: backup?.digest === DEFAULTS.cpuDigest, detail: backup ? `${DEFAULTS.cpuBackup} digest ${backup.digest.slice(0, 16)}` : `missing: ollama cp hermes-local-32k ${DEFAULTS.cpuBackup}` },
      { name: 'new-digest', ok: !!cur && cur.digest !== DEFAULTS.cpuDigest, detail: cur ? `hermes-local-32k ${cur.digest.slice(0, 16)}${cur.digest === DEFAULTS.cpuDigest ? ' (still the CPU model)' : ''}` : 'hermes-local-32k missing' },
      { name: 'modelfile-only-num_gpu-removed', ok: !!d?.ok, detail: d ? `removed ${JSON.stringify(d.removed)} added ${JSON.stringify(d.added)} sameFrom=${d.sameFrom}` : 'needs both models (manual: ollama show --modelfile, delete PARAMETER num_gpu 0, ollama create)' },
      ...(otherQuant ? [{ name: 'quant-is-declared', ok: showC?.details?.quantization_level === opts.quant, detail: `hermes-local-32k is ${showC?.details?.quantization_level ?? '?'}, --quant ${opts.quant}` }] : []),
      // without --quant the FROM blob must be the CPU model's, i.e. Q4_K_M; say so if the loaded quant is something else
      ...(!otherQuant ? [{ name: 'quant-unchanged', ok: !showC || !showB || showC?.details?.quantization_level === showB?.details?.quantization_level, detail: `hermes-local-32k ${showC?.details?.quantization_level ?? '?'}, CPU model ${showB?.details?.quantization_level ?? '?'} (a different quant needs --quant)` }] : []),
      { name: 'placement-100-gpu', ok: !!p && p.size > 0 && p.size_vram >= p.size, detail: p ? `size_vram ${p.size_vram} of ${p.size}` : 'not loaded' },
    ], data: { model_digest: cur?.digest ?? null, quantization_level: showC?.details?.quantization_level ?? null, from_differs: d ? !d.sameFrom : null, size: p?.size ?? null, size_vram: p?.size_vram ?? null } };
  },
  async '4'({ opts, dry }) {
    const sha = sha256(opts.a3Bin); const ver = run(opts.a3Bin, ['--version']).out.trim();
    const rev = run('git', ['-C', DEFAULTS.jrepo, 'rev-parse', 'eval-pin-a3-candidate']).out.trim();
    const checks = [
      { name: 'a3-sha256', ok: sha === opts.a3Sha, detail: `${String(sha).slice(0, 16)} vs ${opts.a3Sha.slice(0, 16)}` },
      { name: 'a3-version', ok: /\(710560f91\)/.test(ver), detail: ver },
      { name: 'a3-branch-commit', ok: rev === DEFAULTS.a3Commit, detail: rev },
    ];
    if (!dry) {
      const evBefore = jcodeHomeFingerprint();
      const ef = run(process.execPath, [path.join(HERE, 'editstring.mjs'), opts.a3Bin, 'A3', '--expect', 'fixed']);
      const eu = run(process.execPath, [path.join(HERE, 'editstring.mjs'), DEFAULTS.a2Bin, 'A2', '--expect', 'unfixed']);
      const ao = run(process.execPath, [path.join(HERE, 'a3offline.mjs'), '--a', DEFAULTS.a2Bin, '--b', opts.a3Bin]);
      checks.push({ name: 'editstring-a3-fixed', ok: ef.code === 0 && /EDITSTRING PASS/.test(ef.out), detail: ef.out.trim().split('\n').pop() },
        { name: 'editstring-a2-unfixed', ok: eu.code === 0 && /EDITSTRING PASS/.test(eu.out), detail: eu.out.trim().split('\n').pop() },
        { name: 'a3offline', ok: ao.code === 0 && /A3OFFLINE PASS/.test(ao.out), detail: ao.out.trim().split('\n').pop() });
      const evAfter = jcodeHomeFingerprint();
      checks.push({ name: 'jcode-home-unchanged', ok: !!evBefore && evBefore === evAfter, detail: evAfter ?? 'unreadable' });
    } else checks.push({ name: 'editstring + a3offline', ok: true, detail: 'not run in --dry-run (offline, ~4 min); last result 2026-10-04: PASS' });
    return { checks, data: { jcode_bin: opts.a3Bin, jcode_sha256: sha, jcode_version: ver, jcode_commit: rev } };
  },
  async '5-6'({ record, opts, dry, apply }) {
    const text = fs.readFileSync(ENVF, 'utf8');
    const want = { jcodeSha: record.stages['4']?.data?.jcode_sha256 ?? opts.a3Sha, digest: record.stages['3']?.data?.model_digest, ollamaVersion: record.stages['2']?.data?.ollama_version };
    let next = null, err = null; try { if (!want.digest) throw new Error('no stage-3 model digest'); next = editPins(text, want); } catch (e) { err = e.message; }
    const clean = git('status', '--porcelain').out.trim() === '';
    const checks = [{ name: 'pin-edit-computable', ok: !!next, detail: err ?? `jcode ${want.jcodeSha.slice(0, 16)}, model ${want.digest.slice(0, 16)}, ollama ${want.ollamaVersion}` }, { name: 'tree-clean-before-commit', ok: clean, detail: clean ? 'clean' : 'uncommitted changes' }];
    if (dry) { checks.push({ name: 'apply', ok: true, detail: 'dry-run: no edit' }); return { checks }; }
    if (!next || !clean) return { checks };
    const pins = { jcode_sha256: want.jcodeSha, models: { 'hermes-local-32k': want.digest }, ollama_version: want.ollamaVersion };
    // after a --restart, the pin commit from the previous attempt may already be in place: same values, nothing to commit
    if (next === text) {
      checks.push({ name: 'pin-already-committed', ok: true, detail: `baseline-env.json already holds these pins at ${git('rev-parse', '--short', 'HEAD').out.trim()} (${git('log', '-1', '--format=%h %s', '--', 'evals/baseline-env.json').out.trim()})` });
      return { checks, data: { env_sha: sha256(ENVF), pins } };
    }
    fs.writeFileSync(ENVF, next);
    const dc = git('diff', '--check'); const add = git('add', 'evals/baseline-env.json');
    const msg = `pin: jcode A3 710560f91 (${want.jcodeSha.slice(0, 12)}), hermes-local-32k GPU ${want.digest.slice(0, 12)}${want.ollamaVersion ? `, Ollama ${want.ollamaVersion}` : ''}`;
    const cm = dc.code === 0 && add.code === 0 ? git('commit', '-q', '-m', msg, '--', 'evals/baseline-env.json') : { code: 1, out: dc.out };
    checks.push({ name: 'pin-committed', ok: cm.code === 0, detail: cm.code === 0 ? `${git('rev-parse', '--short', 'HEAD').out.trim()} ${msg}` : cm.out.slice(0, 200) });
    return { checks, data: { env_sha: sha256(ENVF), pins, pin_commit: cm.code === 0 ? git('rev-parse', 'HEAD').out.trim() : null } };
  },
  async '7-10'({ R, record, dry }) {
    const bin = record.stages['4']?.data?.jcode_bin ?? DEFAULTS.a3Bin;
    const cmd = ['evals/bench/gates.sh', '--out', `${R}/gates`, '--refuse', DEFAULTS.a2Bin, '--refuse', DEFAULTS.oldBin];
    if (dry) return { checks: [{ name: 'gates.sh (not run in --dry-run)', ok: fs.existsSync(path.join(HERE, 'gates.sh')) && fs.existsSync(DEFAULTS.a2Bin) && fs.existsSync(DEFAULTS.oldBin), detail: `JCODE_BIN=${bin} bash ${cmd.join(' ')}` }] };
    const g = run('bash', cmd, { env: { ...process.env, JCODE_BIN: bin } });
    return { checks: [{ name: 'gates', ok: g.code === 0 && /^GATES PASS/m.test(g.out), detail: (g.out.match(/^GATES .*$/m) ?? ['no GATES line'])[0] }] };
  },
  async '11'({ R, record, dry }) {
    const bin = record.stages['4']?.data?.jcode_bin ?? DEFAULTS.a3Bin;
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', win(path.join(HERE, 't01x4.ps1')), '-JcodeBin', win(bin), '-Out', win(`${R}/t01x4`), '-Previous', DEFAULTS.prevT01];
    if (dry) return { checks: [{ name: 't01x4 (not run in --dry-run)', ok: fs.existsSync(path.join(HERE, 't01x4.ps1')), detail: `powershell ${args.join(' ')}` }] };
    const t = run('powershell.exe', args);
    const fp = (t.out.match(/T01X4 PASS distinct_fingerprints=1 ([0-9a-f]{64})/) ?? [])[1];
    return { checks: [
      { name: 't01x4-pass', ok: t.code === 0 && !!fp, detail: (t.out.match(/^T01X4 .*$/m) ?? ['no T01X4 line'])[0] },
      { name: 'previous-fingerprint-DIFFERENT', ok: /previous baseline fingerprint [0-9a-f]+: DIFFERENT/.test(t.out), detail: (t.out.match(/^previous baseline fingerprint.*$/m) ?? ['no comparison line'])[0] },
    ], data: { t01_fingerprint: fp ?? null } };
  },
  async '12'({ opts, record }) {
    const require = createRequire(path.join(REPO, 'package.json'));
    const plan = require('js-yaml').load(fs.readFileSync(path.join(REPO, 'evals', 'PLAN.yaml'), 'utf8'));
    const dec = plan.phases?.H_hardware?.quant_decision;
    const loaded = (await api('POST', '/api/show', JSON.stringify({ model: 'hermes-local-32k' })))?.details?.quantization_level;
    const live = (await api('GET', '/api/tags'))?.models?.find((m) => m.name === 'hermes-local-32k:latest')?.digest;
    const pinned = record?.pins?.models?.['hermes-local-32k'] ?? record?.stages?.['5-6']?.data?.pins?.models?.['hermes-local-32k'];
    const s3q = record?.stages?.['3']?.data?.quantization_level;
    return { checks: [
      { name: 'quant-decision-recorded', ok: !!dec && !!dec.quant && !!dec.numbers, detail: dec ? JSON.stringify(dec).slice(0, 160) : 'PLAN.yaml H_hardware.quant_decision { quant, numbers } missing (run quanttrial.mjs per quant, then record)' },
      { name: 'pinned-model-is-chosen-quant', ok: !!dec?.quant && loaded === dec.quant && (!opts.quant || opts.quant === dec.quant), detail: `hermes-local-32k is ${loaded ?? '?'}, decision ${dec?.quant ?? 'none'}` },
      // the model that passed stages 3-11 is the one in use: same digest as pinned, same quant as stage 3 measured
      { name: 'live-digest-is-pinned', ok: !!live && live === pinned, detail: `live ${String(live).slice(0, 16)}, pinned at 5-6 ${String(pinned).slice(0, 16)}` },
      { name: 'stage3-quant-is-chosen', ok: !!dec?.quant && s3q === dec.quant, detail: `stage 3 measured ${s3q ?? '?'}, decision ${dec?.quant ?? 'none'} (a different pick: build it as hermes-local-32k, --restart, all stages with --quant)` },
    ], data: { quant: dec?.quant ?? null, model_digest: live ?? null } };
  },
};

/** sha256 of every file under dir (relative paths), for the record. */
function hashTree(dir, base = dir, out = {}) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { const p = path.join(dir, e.name); if (e.isDirectory()) hashTree(p, base, out); else out[path.relative(base, p).replace(/\\/g, '/')] = sha256(p); }
  return out;
}

export async function main(argv, { impl = STAGE_IMPL, envFile = ENVF } = {}) {
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const R = flag('out'); if (!R) { console.error('usage: repin.mjs --out <R dir> (--dry-run | --stage <id> [--apply] | --status | --restart)'); return 2; }
  const opts = { a3Bin: flag('a3-bin') ?? DEFAULTS.a3Bin, a3Sha: flag('a3-sha') ?? DEFAULTS.a3Sha, ollamaVersion: flag('ollama-version'), quant: flag('quant') };
  const env = JSON.parse(fs.readFileSync(envFile, 'utf8'));
  const recF = path.join(R, 'repin-record.json');
  const load = () => parseRecord(fs.existsSync(recF) ? fs.readFileSync(recF, 'utf8') : null);
  if (argv.includes('--status')) { try { console.log(JSON.stringify(load(), null, 1)); return 0; } catch (e) { console.log(`REFUSED: ${recF} is unreadable (${e.message})`); return 1; } }
  if (argv.includes('--restart')) {
    // archive this attempt: the record (even a damaged one) and every stage output, never deleted or overwritten
    const arch = path.join(R, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    const moving = ['repin-record.json', ...STAGE_OUTPUTS].filter((f) => fs.existsSync(path.join(R, f)));
    if (!moving.length) { console.log('nothing to archive; start at stage 1'); return 0; }
    fs.mkdirSync(arch);
    for (const f of moving) fs.renameSync(path.join(R, f), path.join(arch, f));
    console.log(`archived ${moving.join(', ')} -> ${arch}; start again at stage 1`); return 0;
  }
  if (argv.includes('--dry-run')) {
    console.log(`REPIN DRY RUN ${new Date().toISOString()} (read-only; nothing recorded, edited or committed)`);
    const fake = { stages: {} }; let any = false;
    for (const id of STAGES) {
      const r = await impl[id]({ R, opts, env, record: fake, dry: true });
      if (r.cleanup) fs.rmSync(r.cleanup, { recursive: true, force: true });   // dry-run temp profile (our own mkdtemp)
      for (const c of r.checks) { console.log(`  ${id.padEnd(5)} ${c.ok ? 'ok   ' : 'WOULD FAIL'} ${c.name}: ${c.detail}`); if (!c.ok) any = true; }
      fake.stages[id] = { status: 'PASS', data: r.data };
    }
    console.log(any ? 'REPIN DRY RUN: NOT READY (expected before the hardware change)' : 'REPIN DRY RUN: every read-only check passes');
    return 0;
  }
  const id = flag('stage'); if (!id) { console.error('give --stage <id>, --dry-run, --status or --restart'); return 2; }
  // 5-6 edits and commits baseline-env.json: it needs --apply, and without it nothing is recorded (no FAIL lock)
  if (id === '5-6' && !argv.includes('--apply')) { console.log('REFUSED stage 5-6: it edits and commits evals/baseline-env.json; rerun with --apply (nothing recorded)'); return 2; }
  fs.mkdirSync(R, { recursive: true });
  let record; try { record = load(); } catch (e) { console.log(`REFUSED stage ${id}: ${recF} is unreadable (${e.message}); inspect it, then --restart (archives it)`); return 1; }
  const why = gate(record, id, sha256(envFile)); if (why) { console.log(`REFUSED stage ${id}: ${why}`); return 1; }
  const own = { '1': ['hwprofile.json'], '3': ['Modelfile.cpu', 'Modelfile.new'], '7-10': ['gates'], '11': ['t01x4'] }[id] ?? [];
  const stale = own.filter((f) => fs.existsSync(path.join(R, f)));
  if (stale.length) { console.log(`REFUSED stage ${id}: ${stale.join(', ')} already exist in ${R} from an unrecorded run (use --restart to archive, or a new --out)`); return 1; }
  const r = await impl[id]({ R, opts, env, record, dry: false, apply: true });
  const ok = r.checks.length > 0 && r.checks.every((c) => c.ok);
  for (const c of r.checks) console.log(`  ${id.padEnd(5)} ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`);
  const artifacts = {}; for (const f of own) { const p = path.join(R, f); if (fs.existsSync(p)) Object.assign(artifacts, fs.statSync(p).isDirectory() ? Object.fromEntries(Object.entries(hashTree(p)).map(([k, v]) => [`${f}/${k}`, v])) : { [f]: sha256(p) }); }
  record.stages[id] = { status: ok ? 'PASS' : 'FAIL', at: new Date().toISOString(), head: git('rev-parse', 'HEAD').out.trim(), checks: r.checks, data: r.data ?? null, artifacts, env_sha: sha256(envFile) };
  if (!ok) { record.failed = true; record.failed_stage = id; }
  if (ok && id === '1') record.ollama_env = r.data?.ollama_env ?? null;
  if (ok && id === '4') record.jcode_bin = r.data?.jcode_bin;
  if (ok && id === '5-6') record.pins = r.data?.pins;
  if (ok && id === '12') record.completed = new Date().toISOString();
  fs.writeFileSync(`${recF}.tmp`, JSON.stringify(record, null, 1) + '\n'); fs.renameSync(`${recF}.tmp`, recF);   // atomic: never a half-written record
  console.log(`STAGE ${id} ${ok ? 'PASS' : 'FAIL'}${ok ? '' : ' - the re-pin stops here (REPIN.md: investigate, fix, --restart, begin at stage 1)'}`);
  return ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
