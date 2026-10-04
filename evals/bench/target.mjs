// target.mjs - the evaluation target environment, read from PLAN.yaml phases.H_hardware.target_environment.placement.
// Used by repin.mjs and cpreflight.mjs so both check the SAME target. Pure; no live state.
//   CPU  the existing machine, model unchanged (hermes-local-32k = the validated CPU model, num_gpu 0, 100% CPU).
//        Decided 2026-10-04 by the user: no dedicated GPU is planned.
//   GPU  the former plan (dedicated GPU, model rebuilt without num_gpu 0, 100% GPU). Kept for completeness only.
// A missing or unknown target is never a default: callers must fail closed.
export const CPU_MODEL_DIGEST = '1ef2c71ed2065896b080104a0499a15b320f9ea3f9049bacdadc42e71630b60f';
export const TARGETS = ['CPU', 'GPU'];

/** 'CPU' | 'GPU' | null (missing/unknown). */
export function targetOf(plan) {
  const t = String(plan?.phases?.H_hardware?.target_environment?.placement ?? '').toUpperCase();
  return TARGETS.includes(t) ? t : null;
}

/** Does a loaded model (an /api/ps entry) have the target's placement? */
export function placementOk(target, m) {
  if (!m || !(m.size > 0) || typeof m.size_vram !== 'number') return false;
  if (target === 'CPU') return m.size_vram === 0;
  if (target === 'GPU') return m.size_vram >= m.size;
  return false;
}

/** The pinned model digest the target requires, or null when the target accepts a new digest (GPU rebuild). */
export function requiredModelDigest(target) { return target === 'CPU' ? CPU_MODEL_DIGEST : null; }

/** Stage-1 hardware check (pure): CPU target = same CPU model and RAM (+-0.5 GiB) as the recorded CPU baseline profile;
 *  GPU target = a discrete GPU visible (nvidia-smi or ROCm). Returns { ok, detail }. */
export function hardwareCheck(target, h, baseline) {
  if (!h) return { ok: false, detail: 'no hardware profile' };
  if (target === 'CPU') {
    const cpu = h.cpu?.[0]?.name?.trim(), bcpu = baseline?.cpu?.[0]?.name?.trim();
    const ram = Number(h.ram?.total_gib), bram = Number(baseline?.ram?.total_gib);
    const ok = !!cpu && cpu === bcpu && Number.isFinite(ram) && Math.abs(ram - bram) <= 0.5;
    return { ok, detail: `${cpu ?? '?'} ${ram} GiB vs CPU baseline ${bcpu ?? '?'} ${bram} GiB` };
  }
  if (target === 'GPU') {
    const gpus = h.nvidia?.gpus ?? []; const rocm = !!(h.rocm?.rocm_smi || h.rocm?.hipinfo);
    return { ok: gpus.length > 0 || rocm, detail: gpus.length ? gpus.map((g) => `${g.name} ${g.memory_total_mib} MiB driver ${g.driver}`).join('; ') : rocm ? 'ROCm tools present' : 'no discrete GPU (nvidia-smi / ROCm)' };
  }
  return { ok: false, detail: `unknown target ${target}` };
}
