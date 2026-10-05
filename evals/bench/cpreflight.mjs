// cpreflight.mjs - may Phase C start? Prints one line per check, then "READY FOR C" (exit 0) or
// "BLOCKED: <reason>; <reason>..." (exit 1). Fails closed: a check that cannot be evaluated is BLOCKED.
// Read-only, except --warm (one 1-token request so the loaded model's placement can be read, as suite.sh's warm-up).
//
//   "$NODE_BIN" evals/bench/cpreflight.mjs --repin <repin archive dir> [--warm] [--skip-tests]
//
// Requirements (from PLAN.yaml C_rebaseline.preconditions_left and REPIN.md; no new acceptance criteria):
//   repin      <repin dir>/repin-record.json from repin.mjs: stages 1-12 PASS, not failed, its pins == baseline-env.json
//   target     PLAN.yaml phases.H_hardware.target_environment.placement = CPU | GPU (bench/target.mjs); the re-pin record
//              was made for that target. CPU (decided 2026-10-04): the existing machine, model unchanged, 100% CPU
//   pins       baseline-env.json no longer pins A2 (the A3 re-pin happened); model pin fits the target (CPU: the validated
//              CPU model digest; GPU: a rebuilt model); committed (tree clean)
//   plan       PLAN.yaml: H_hardware not BLOCKED; A3 no longer "NOT YET AUTHORITATIVE"; C_rebaseline status NOT STARTED;
//              C pre-registered: C_rebaseline.preregistration with tasks, reps, order, timeouts, decision_rule, quant
//   live       pinned jcode binary (record's jcode_bin) hash == pin; Ollama version == pin; model digest == pin;
//              model placement = the target's (CPU: size_vram 0; GPU: 100% GPU; model must be loaded: --warm loads it); Ollama server settings == the
//              settings recorded at the re-pin (ollamaenv); Ollama auto-update OFF (db.sqlite, read-only)
//   machine    on AC; no jcode.exe running; meter port 127.0.0.2:11439 free; no other client connected to Ollama
//   tests      offline suite (node --test evals/test/*.test.mjs) and lint.sh pass (--skip-tests: BLOCKED, never READY)
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
import { targetOf, placementOk, requiredModelDigest, CPU_MODEL_DIGEST } from './target.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
export const A2_SHA = 'f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3';
export { CPU_MODEL_DIGEST };
export const PREREG_KEYS = ['tasks', 'reps', 'order', 'timeouts', 'decision_rule', 'quant'];
export const REPIN_STAGES = ['1', '2', '3', '4', '5-6', '7-10', '11', '12'];

/** Pure part: everything that can be decided from files/records. Returns [{ name, ok, why }]. */
export function staticChecks({ plan, env, record, gitClean, branch }) {
  const out = []; const c = (name, ok, why) => out.push({ name, ok: !!ok, why: ok ? '' : why });
  c('git-clean', gitClean === true, 'working tree has uncommitted changes');
  c('branch', !plan?.branch || plan.branch === branch, `checked-out branch ${branch} != PLAN.yaml branch ${plan?.branch}`);
  const target = targetOf(plan);
  c('plan-target-declared', !!target, 'PLAN.yaml phases.H_hardware.target_environment.placement is not CPU or GPU');
  c('repin-record', !!record, 'no repin-record.json (run evals/bench/repin.mjs through stage 12)');
  if (record) {
    c('repin-not-failed', record.failed !== true, `re-pin record is marked FAILED at stage ${record.failed_stage}: restart the re-pin from step 1`);
    const missing = REPIN_STAGES.filter((s) => record.stages?.[s]?.status !== 'PASS');
    c('repin-stages-pass', missing.length === 0, `re-pin stages not PASS: ${missing.join(', ')}`);
    c('repin-pins-current', record.pins && record.pins.jcode_sha256 === env.jcode_sha256 && JSON.stringify(record.pins.models) === JSON.stringify(env.model_server?.models) && record.pins.ollama_version === env.model_server?.ollama_version,
      'baseline-env.json pins differ from the pins the re-pin validated (re-run the re-pin)');
  }
  c('pin-not-a2', env.jcode_sha256 !== A2_SHA, 'baseline-env.json still pins the A2 jcode (re-pin not done)');
  const pinnedModel = env.model_server?.models?.['hermes-local-32k'];
  c('pin-model-fits-target', target === 'CPU' ? pinnedModel === requiredModelDigest('CPU') : target === 'GPU' ? !!pinnedModel && pinnedModel !== CPU_MODEL_DIGEST : false,
    target === 'CPU' ? `CPU target: baseline-env.json must pin the validated CPU model ${CPU_MODEL_DIGEST.slice(0, 16)} (pinned ${String(pinnedModel).slice(0, 16)})`
      : target === 'GPU' ? 'GPU target: baseline-env.json still pins the CPU-only model digest (num_gpu 0)' : 'no target: the model pin cannot be judged');
  const ph = plan?.phases ?? {};
  if (record) {
    // what the re-pin measured must be what PLAN.yaml now states (REPIN.md steps 1, 11, 12, 13)
    const s1 = record.stages?.['1']?.checks ?? [];
    c('repin-target-matches', !!target && record.target === target, `re-pin record target ${record.target ?? 'none'} != PLAN target ${target ?? 'none'}`);
    c('repin-target-hardware', s1.some((x) => /^target-hardware/.test(x.name) && x.ok), 're-pin stage 1 did not record the target hardware check as passing');
    c('repin-ollama-env-recorded', !!record.ollama_env && typeof record.ollama_env === 'object' && Object.keys(record.ollama_env).length > 0, 're-pin record has no Ollama server settings (stage 1)');
    const fp = record.stages?.['11']?.data?.t01_fingerprint;
    c('repin-t01-fingerprint-in-plan', /^[0-9a-f]{64}$/.test(String(fp)) && String(plan?.pins?.t01_fingerprint ?? '').startsWith(fp), `PLAN.yaml pins.t01_fingerprint is not the re-pin's T01x4 value ${String(fp).slice(0, 16)} (REPIN step 11)`);
    const q = ph.H_hardware?.quant_decision?.quant, pq = ph.C_rebaseline?.preregistration?.quant;
    c('repin-quant-consistent', !!q && record.stages?.['12']?.data?.quant === q && pq === q, `quant: decision ${q ?? 'none'}, re-pin stage 12 ${record.stages?.['12']?.data?.quant ?? 'none'}, C pre-registration ${pq ?? 'none'} must all be equal`);
  }
  c('plan-h-decided', ph.H_hardware && !/^BLOCKED/.test(String(ph.H_hardware.status)), 'PLAN.yaml H_hardware is still BLOCKED (hardware decision)');
  c('plan-a3-authoritative', ph.A3_edit_string_args && !/NOT YET AUTHORITATIVE/.test(String(ph.A3_edit_string_args.status)), 'PLAN.yaml still marks A3 NOT YET AUTHORITATIVE (re-pin not recorded in PLAN)');
  c('plan-c-not-started', /^NOT STARTED/.test(String(ph.C_rebaseline?.status ?? '')), `C_rebaseline status is "${String(ph.C_rebaseline?.status ?? '').slice(0, 60)}" (a started C needs its own resume decision, not this preflight)`);
  const pre = ph.C_rebaseline?.preregistration;
  const preMissing = PREREG_KEYS.filter((k) => pre?.[k] === undefined || pre?.[k] === null || pre?.[k] === '');
  c('plan-c-preregistered', !preMissing.length, `C not pre-registered in PLAN.yaml C_rebaseline.preregistration (missing: ${preMissing.join(', ')})`);
  return out;
}

const sha256 = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const req = (method, p, body) => new Promise((resolve) => { const q = http.request({ host: '127.0.0.1', port: 11434, path: p, method, agent: false, timeout: 600000, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } }); }); q.on('error', () => resolve(null)); q.on('timeout', () => { q.destroy(); resolve(null); }); q.end(body); });
const ps1 = (cmd) => { const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };

/** The live probes, injectable so the decision logic can be tested with fixtures (evals/test/cpreflight.test.mjs). */
export const realIO = {
  sha256,
  version: async () => (await req('GET', '/api/version'))?.version ?? null,
  tags: async () => (await req('GET', '/api/tags'))?.models ?? null,
  warm: async () => req('POST', '/api/generate', JSON.stringify({ model: 'hermes-local-32k', prompt: 'ok', stream: false, options: { num_predict: 1 } })),
  ps: async () => (await req('GET', '/api/ps'))?.models ?? null,
  ollamaEnv: () => { const oe = spawnSync(process.execPath, [path.join(HERE, 'ollamaenv.mjs'), '--json'], { encoding: 'utf8' }); try { return JSON.parse(oe.stdout).material; } catch { return null; } },
  autoUpdate: () => { try { const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(process.env.LOCALAPPDATA ?? '', 'Ollama', 'db.sqlite'), { readOnly: true }); const a = db.prepare('select auto_update_enabled as a from settings').get()?.a; db.close(); return a ?? null; } catch { return null; } },
  battery: () => ps1('$b=@(Get-CimInstance Win32_Battery); if (-not $b.Count) { "none" } else { $b[0].BatteryStatus }'),
  jcodeCount: () => ps1('@(Get-Process -Name jcode -ErrorAction SilentlyContinue).Count'),
  meterPort: () => ps1('@(Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort 11439 -State Listen -ErrorAction SilentlyContinue).Count'),
  ollamaConns: () => ps1('@(Get-NetTCPConnection -RemotePort 11434 -State Established -ErrorAction SilentlyContinue).Count'),
};

export async function liveChecks({ env, record, warm, target }, io = realIO) {
  const out = []; const c = (name, ok, why) => out.push({ name, ok: !!ok, why: ok ? '' : why });
  const bin = record?.jcode_bin;
  c('live-jcode', bin && io.sha256(bin) === env.jcode_sha256, `pinned jcode binary ${bin ?? '(unknown: no re-pin record)'} missing or hash != pin`);
  const ver = await io.version();
  c('live-ollama-version', !!ver && ver === env.model_server?.ollama_version, `Ollama ${ver ?? 'unreachable'} != pin ${env.model_server?.ollama_version}`);
  const want = env.model_server?.models?.['hermes-local-32k'];
  const have = (await io.tags())?.find((m) => m.name === 'hermes-local-32k:latest')?.digest;
  c('live-model-digest', have && have === want, `hermes-local-32k digest ${String(have).slice(0, 16)} != pin ${String(want).slice(0, 16)}`);
  if (warm) await io.warm();
  const m = (await io.ps())?.find((x) => x.name === 'hermes-local-32k:latest');
  c('live-placement-target', placementOk(target, m), !target ? 'no target: placement cannot be judged' : m ? `model placement is not the ${target} target's (size_vram ${m.size_vram} of ${m.size})` : 'model not loaded: placement cannot be verified (use --warm)');
  const cur = io.ollamaEnv();
  c('live-ollama-env', cur && record?.ollama_env && JSON.stringify(cur) === JSON.stringify(record.ollama_env), 'Ollama server settings differ from those recorded at the re-pin (or could not be read)');
  const au = io.autoUpdate();
  c('ollama-auto-update-off', au === 0, au === null ? 'cannot read Ollama auto_update_enabled (db.sqlite)' : 'Ollama automatic updates are ON (tray icon > Settings > off)');
  const bat = io.battery();
  c('machine-ac', bat === 'none' || bat === '2', `not on AC (BatteryStatus=${bat})`);
  const j = io.jcodeCount();
  c('machine-no-jcode', j === '0', `${j ?? '?'} jcode.exe process(es) running`);
  const mp = io.meterPort();
  c('machine-meter-port-free', mp === '0', 'meter port 127.0.0.2:11439 in use');
  const oc = io.ollamaConns();
  c('machine-ollama-exclusive', oc === '0', `${oc ?? '?'} connection(s) to Ollama from other clients`);
  return out;
}

/** READY only if there is at least one check and every check passed. Pure. */
export function verdict(res) {
  const bad = res.filter((r) => !r.ok);
  return { ready: res.length > 0 && bad.length === 0, line: bad.length || !res.length ? `BLOCKED: ${bad.map((r) => r.why).join('; ') || 'no checks ran'}` : 'READY FOR C' };
}

export function testChecks(skip) {
  if (skip) return [{ name: 'tests', ok: false, why: '--skip-tests given: never READY without the offline suite' }];
  const t = spawnSync(process.execPath, ['--test', 'evals/test/*.test.mjs'], { cwd: REPO, encoding: 'utf8' });
  const l = spawnSync('bash', ['evals/test/lint.sh'], { cwd: REPO, encoding: 'utf8' });
  return [{ name: 'tests-offline', ok: t.status === 0, why: `node --test evals/test/*.test.mjs exit ${t.status}` }, { name: 'tests-lint', ok: l.status === 0, why: `lint.sh exit ${l.status}` }];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2); const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const yaml = require('js-yaml');
  const plan = yaml.load(fs.readFileSync(path.join(REPO, 'evals', 'PLAN.yaml'), 'utf8'));
  const env = JSON.parse(fs.readFileSync(path.join(REPO, 'evals', 'baseline-env.json'), 'utf8'));
  let record = null; if (flag('repin')) { try { record = JSON.parse(fs.readFileSync(path.join(flag('repin'), 'repin-record.json'), 'utf8')); } catch { record = null; } }
  const g = (...a) => { try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' }).trim(); } catch { return null; } };
  const res = [...staticChecks({ plan, env, record, gitClean: g('status', '--porcelain') === '', branch: g('rev-parse', '--abbrev-ref', 'HEAD') }),
    ...(await liveChecks({ env, record, warm: argv.includes('--warm'), target: targetOf(plan) })), ...testChecks(argv.includes('--skip-tests'))];
  for (const r of res) console.log(r.ok ? `ok      ${r.name}` : `BLOCKED ${r.name}: ${r.why}`);
  const v = verdict(res);
  console.log(v.line);
  process.exit(v.ready ? 0 : 1);
}
