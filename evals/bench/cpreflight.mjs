// cpreflight.mjs - may Phase C start? Prints one line per check, then "READY FOR C" (exit 0) or
// "BLOCKED: <reason>; <reason>..." (exit 1). Fails closed: a check that cannot be evaluated is BLOCKED.
// Read-only, except --warm (one 1-token request so the loaded model's placement can be read, as suite.sh's warm-up).
//
//   "$NODE_BIN" evals/bench/cpreflight.mjs --repin <repin archive dir> [--warm] [--skip-tests]
//
// Requirements (from PLAN.yaml C_rebaseline.preconditions_left and REPIN.md; no new acceptance criteria):
//   repin      <repin dir>/repin-record.json from repin.mjs: stages 1-12 PASS, not failed, its pins == baseline-env.json
//   pins       baseline-env.json no longer pins A2 / the CPU model (a re-pin happened); committed (tree clean)
//   plan       PLAN.yaml: H_hardware not BLOCKED; A3 no longer "NOT YET AUTHORITATIVE"; C_rebaseline status NOT STARTED;
//              C pre-registered: C_rebaseline.preregistration with tasks, reps, order, timeouts, decision_rule, quant
//   live       pinned jcode binary (record's jcode_bin) hash == pin; Ollama version == pin; model digest == pin;
//              model placement 100% GPU (model must be loaded: --warm loads it); Ollama server settings == the
//              settings recorded at the re-pin (ollamaenv); Ollama auto-update OFF (db.sqlite, read-only)
//   machine    on AC; no jcode.exe running; meter port 127.0.0.2:11439 free; no other client connected to Ollama
//   tests      offline suite (node --test evals/test/*.test.mjs) and lint.sh pass (--skip-tests: BLOCKED, never READY)
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import http from 'node:http';
import { execFileSync, spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
export const A2_SHA = 'f76eff118ae42e9876727095c100420f485e7ea7a8904d3dd62e93f55beaf8e3';
export const CPU_MODEL_DIGEST = '1ef2c71ed2065896b080104a0499a15b320f9ea3f9049bacdadc42e71630b60f';
export const PREREG_KEYS = ['tasks', 'reps', 'order', 'timeouts', 'decision_rule', 'quant'];
export const REPIN_STAGES = ['1', '2', '3', '4', '5-6', '7-10', '11', '12'];

/** Pure part: everything that can be decided from files/records. Returns [{ name, ok, why }]. */
export function staticChecks({ plan, env, record, gitClean, branch }) {
  const out = []; const c = (name, ok, why) => out.push({ name, ok: !!ok, why: ok ? '' : why });
  c('git-clean', gitClean === true, 'working tree has uncommitted changes');
  c('branch', !plan?.branch || plan.branch === branch, `checked-out branch ${branch} != PLAN.yaml branch ${plan?.branch}`);
  c('repin-record', !!record, 'no repin-record.json (run evals/bench/repin.mjs through stage 12)');
  if (record) {
    c('repin-not-failed', record.failed !== true, `re-pin record is marked FAILED at stage ${record.failed_stage}: restart the re-pin from step 1`);
    const missing = REPIN_STAGES.filter((s) => record.stages?.[s]?.status !== 'PASS');
    c('repin-stages-pass', missing.length === 0, `re-pin stages not PASS: ${missing.join(', ')}`);
    c('repin-pins-current', record.pins && record.pins.jcode_sha256 === env.jcode_sha256 && JSON.stringify(record.pins.models) === JSON.stringify(env.model_server?.models) && record.pins.ollama_version === env.model_server?.ollama_version,
      'baseline-env.json pins differ from the pins the re-pin validated (re-run the re-pin)');
  }
  c('pin-not-a2', env.jcode_sha256 !== A2_SHA, 'baseline-env.json still pins the A2 jcode (re-pin not done)');
  c('pin-not-cpu-model', env.model_server?.models?.['hermes-local-32k'] !== CPU_MODEL_DIGEST, 'baseline-env.json still pins the CPU-only model digest (num_gpu 0)');
  const ph = plan?.phases ?? {};
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

async function liveChecks({ env, record, warm }) {
  const out = []; const c = (name, ok, why) => out.push({ name, ok: !!ok, why: ok ? '' : why });
  const bin = record?.jcode_bin;
  c('live-jcode', bin && sha256(bin) === env.jcode_sha256, `pinned jcode binary ${bin ?? '(unknown: no re-pin record)'} missing or hash != pin`);
  const ver = await req('GET', '/api/version');
  c('live-ollama-version', ver?.version === env.model_server?.ollama_version, `Ollama ${ver?.version ?? 'unreachable'} != pin ${env.model_server?.ollama_version}`);
  const tags = await req('GET', '/api/tags');
  const want = env.model_server?.models?.['hermes-local-32k'];
  const have = tags?.models?.find((m) => m.name === 'hermes-local-32k:latest')?.digest;
  c('live-model-digest', have && have === want, `hermes-local-32k digest ${String(have).slice(0, 16)} != pin ${String(want).slice(0, 16)}`);
  if (warm) await req('POST', '/api/generate', JSON.stringify({ model: 'hermes-local-32k', prompt: 'ok', stream: false, options: { num_predict: 1 } }));
  const psj = await req('GET', '/api/ps');
  const m = psj?.models?.find((x) => x.name === 'hermes-local-32k:latest');
  c('live-placement-100-gpu', m && m.size > 0 && m.size_vram >= m.size, m ? `model placement is not 100% GPU (size_vram ${m.size_vram} of ${m.size})` : 'model not loaded: placement cannot be verified (use --warm)');
  const oe = spawnSync(process.execPath, [path.join(HERE, 'ollamaenv.mjs'), '--json'], { encoding: 'utf8' });
  let cur = null; try { cur = JSON.parse(oe.stdout).material; } catch { /* */ }
  c('live-ollama-env', cur && record?.ollama_env && JSON.stringify(cur) === JSON.stringify(record.ollama_env), 'Ollama server settings differ from those recorded at the re-pin (or could not be read)');
  let au = null; try { const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(path.join(process.env.LOCALAPPDATA ?? '', 'Ollama', 'db.sqlite'), { readOnly: true }); au = db.prepare('select auto_update_enabled as a from settings').get()?.a; db.close(); } catch { /* */ }
  c('ollama-auto-update-off', au === 0, au === null ? 'cannot read Ollama auto_update_enabled (db.sqlite)' : 'Ollama automatic updates are ON (tray icon > Settings > off)');
  const bat = ps1('$b=@(Get-CimInstance Win32_Battery); if (-not $b.Count) { "none" } else { $b[0].BatteryStatus }');
  c('machine-ac', bat === 'none' || bat === '2', `not on AC (BatteryStatus=${bat})`);
  const j = ps1("@(Get-Process -Name jcode -ErrorAction SilentlyContinue).Count");
  c('machine-no-jcode', j === '0', `${j ?? '?'} jcode.exe process(es) running`);
  const mp = ps1("@(Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort 11439 -State Listen -ErrorAction SilentlyContinue).Count");
  c('machine-meter-port-free', mp === '0', 'meter port 127.0.0.2:11439 in use');
  const oc = ps1("@(Get-NetTCPConnection -RemotePort 11434 -State Established -ErrorAction SilentlyContinue).Count");
  c('machine-ollama-exclusive', oc === '0', `${oc ?? '?'} connection(s) to Ollama from other clients`);
  return out;
}

function testChecks(skip) {
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
    ...(await liveChecks({ env, record, warm: argv.includes('--warm') })), ...testChecks(argv.includes('--skip-tests'))];
  for (const r of res) console.log(r.ok ? `ok      ${r.name}` : `BLOCKED ${r.name}: ${r.why}`);
  const bad = res.filter((r) => !r.ok);
  console.log(bad.length ? `BLOCKED: ${bad.map((r) => r.why).join('; ')}` : 'READY FOR C');
  process.exit(bad.length ? 1 : 0);
}
