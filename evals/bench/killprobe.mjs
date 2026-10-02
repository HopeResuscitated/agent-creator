// killprobe.mjs — does taskkill /T /F work inside the measured environment? Mirrors packages/agent/tools/shell.ts.
import cp from 'node:child_process';
const ms = (t) => Math.round(Number(process.hrtime.bigint() - t) / 1e6);
function run(label, killer) {
  return new Promise((resolve) => {
    const t = process.hrtime.bigint();
    const child = cp.spawn('node -e "setTimeout(()=>{},10000)"', { shell: true, windowsHide: true });
    child.stdout.resume(); child.stderr.resume();
    setTimeout(() => {
      const k = killer(child);
      console.log(`KILL ${label.padEnd(22)} at=${ms(t)}ms ${k}`);
    }, 500);
    child.on('close', (code, sig) => { console.log(`DONE ${label.padEnd(22)} closed_after=${ms(t)}ms code=${code} sig=${sig}`); resolve(); });
  });
}
const tk = (c) => { const r = cp.spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' }); return `taskkill rc=${r.status} err=${r.error?.code ?? ''} out=${JSON.stringify(((r.stdout || '') + (r.stderr || '')).trim().slice(0, 160))}`; };
const tkNoTree = (c) => { const r = cp.spawnSync('taskkill', ['/PID', String(c.pid), '/F'], { windowsHide: true, encoding: 'utf8' }); return `taskkill(no /T) rc=${r.status} out=${JSON.stringify(((r.stdout || '') + (r.stderr || '')).trim().slice(0, 160))}`; };
const pk = (c) => { try { return `child.kill()=${c.kill()}`; } catch (e) { return `child.kill threw ${e.code}`; } };
await run('taskkill /T /F', tk);
await run('taskkill /F (no tree)', tkNoTree);
await run('child.kill()', pk);
