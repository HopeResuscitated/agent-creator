// classify.mjs — per-task classification of the agent's bash tool calls, from the run transcripts.
//
//   node evals/bench/classify.mjs --run <evals/results/<runId>> [--out <file>]
//
// For every "[bash] $ <cmd>" in <task>.transcript.txt, the result is the next "  → <first line>" the agent
// printed. Counts: bash calls, node --test, npm/npx/tsx/tsc, "is not recognized", dir/vol/cd-to-absolute-path,
// "Access is denied", and calls whose result line was empty (no output / hung). Up to 5 notable calls per task
// are listed (node --test, npm-family, not recognized, denied, no output).
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const runDir = flag('run');
if (!runDir) { console.error('usage: classify.mjs --run <results dir> [--out <file>]'); process.exit(2); }
const run = JSON.parse(fs.readFileSync(path.join(runDir, 'results.json'), 'utf8'));
const out = [];
const short = (s) => (s.length > 60 ? `${s.slice(0, 60)}...` : s);
for (const r of run) {
  let tr = ''; try { tr = fs.readFileSync(path.join(runDir, `${r.id}.transcript.txt`), 'utf8'); } catch { /* none */ }
  const lines = tr.split(/\r?\n/);
  const calls = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\[bash\] \$ (.*)$/.exec(lines[i]);
    if (!m) continue;
    let result = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\[[a-z_]+\] /.test(lines[j])) break;          // next tool call: this one showed no result line
      const a = /^ {2}→ ?(.*)$/.exec(lines[j]);
      if (a) { result = a[1]; break; }
    }
    calls.push({ cmd: m[1], result: result ?? '' });
  }
  const c = { bash: calls.length, nodeTest: 0, npm: 0, notRec: 0, dirAbs: 0, denied: 0, noRes: 0 };
  const notable = [];
  for (const x of calls) {
    const nodeTest = /\bnode\s+--test\b/.test(x.cmd);
    const npm = /\b(npm|npx|tsx|tsc)\b/.test(x.cmd);
    const notRec = /is not recognized as an internal or external command/.test(x.result);
    const dirAbs = /(^|&&|\|\||[;&|]|\s)(dir|vol)(\s|$)|\bcd\s+(\/d\s+)?[A-Za-z]:\\/i.test(x.cmd);
    const denied = /Access is denied/.test(x.result);
    const noRes = x.result.trim() === '';
    if (nodeTest) c.nodeTest++; if (npm) c.npm++; if (notRec) c.notRec++; if (dirAbs) c.dirAbs++; if (denied) c.denied++; if (noRes) c.noRes++;
    if (nodeTest || npm || notRec || denied || noRes) notable.push(`     $ ${short(x.cmd)}  ->  ${noRes ? '(no output / hung)' : x.result.slice(0, 88)}`);
  }
  out.push(`${r.id} bash=${c.bash} nodeTest=${c.nodeTest} npm/npx/tsx/tsc=${c.npm} (notRecognized=${c.notRec}) dir/vol/cdAbs=${c.dirAbs} (denied=${c.denied}) noResultShown=${c.noRes}`);
  out.push(...notable.slice(0, 5));
}
const text = out.join('\n') + '\n';
process.stdout.write(text);
if (flag('out')) fs.writeFileSync(flag('out'), text);
