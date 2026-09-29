# Run one agent command inside a Windows Job Object and prove its whole process tree is dead before returning.
# Used by evals/run.ts (jcode agent runs).
#
#   -Command  program name, resolved on PATH (first Application match, same order Node uses)
#   -ArgsB64  base64(UTF-8 JSON array of string arguments)
#   -TimeoutMs  how long to wait for the agent's root process
#
# How the tree is contained: this script puts ITSELF into a new job, with KILL_ON_JOB_CLOSE and no
# breakaway allowed, before starting the agent. Every process the agent starts is then a job member,
# automatically, and stays one even after its parent exits. Nothing is matched by name, path or PID guess.
# After the root exits or times out: the job is capped so no member can start another process, every
# other member is terminated (only after IsProcessInJob confirms, through an open handle, that it is still
# a member), and the kernel's member count must drop to 1 (this script).
#
# stdio is inherited by the agent unchanged. Exit code: 0 = agent ran and its tree is proven dead;
# 3 = members could not be proven dead; 4 = setup failed (agent not started). Only 0 means safe to grade.
param([Parameter(Mandatory = $true)][string]$Command, [string]$ArgsB64 = '', [int]$TimeoutMs = 900000)
$ErrorActionPreference = 'Stop'
function Note($m) { [Console]::Error.WriteLine("[run-in-job $([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())] $m") }
try {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class EvalJob {
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT_LIMIT { public BASIC_LIMIT Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref EXT_LIMIT i, int l);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr j, int c, IntPtr i, int l, IntPtr r);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool r);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr p, uint c);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint GetCurrentProcessId();
  const uint KILL_ON_JOB_CLOSE = 0x2000, ACTIVE_PROCESS = 0x8;
  static Exception Err(string call) { int e = Marshal.GetLastWin32Error(); return new Exception(call + " failed: " + new Win32Exception(e).Message + " (" + e + ")"); }
  public static IntPtr Job;
  static EXT_LIMIT limits;
  static void Set() { if (!SetInformationJobObject(Job, 9, ref limits, Marshal.SizeOf(typeof(EXT_LIMIT)))) throw Err("SetInformationJobObject"); }
  public static void Enter() {
    Job = CreateJobObject(IntPtr.Zero, null); if (Job == IntPtr.Zero) throw new Win32Exception();
    limits.Basic.LimitFlags = KILL_ON_JOB_CLOSE; Set();
    if (!AssignProcessToJobObject(Job, GetCurrentProcess())) throw new Win32Exception();
  }
  // Members still alive, per the kernel. Includes this process.
  public static uint[] Members() {
    int size = 8 + 4 * 8192; IntPtr buf = Marshal.AllocHGlobal(size);
    try {
      if (!QueryInformationJobObject(Job, 3, buf, size, IntPtr.Zero)) throw Err("Query(ProcessIdList)");
      int n = Marshal.ReadInt32(buf, 4); uint[] r = new uint[n];
      for (int i = 0; i < n; i++) r[i] = (uint)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64();
      return r;
    } finally { Marshal.FreeHGlobal(buf); }
  }
  public static int ActiveCount() {
    IntPtr buf = Marshal.AllocHGlobal(48); // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: the length must be exact
    try { if (!QueryInformationJobObject(Job, 1, buf, 48, IntPtr.Zero)) throw Err("Query(Accounting)"); return Marshal.ReadInt32(buf, 40); }
    finally { Marshal.FreeHGlobal(buf); }
  }
  // Freeze the membership (no member may start a process), then kill every member except this one.
  public static string Drain(out bool ok) {
    limits.Basic.LimitFlags = KILL_ON_JOB_CLOSE | ACTIVE_PROCESS; limits.Basic.ActiveProcessLimit = 1; Set();
    uint self = GetCurrentProcessId(); var killed = new List<string>(); ok = false;
    for (int round = 0; round < 20; round++) {
      var others = new List<uint>(); foreach (uint p in Members()) if (p != self) others.Add(p);
      if (others.Count == 0) { ok = ActiveCount() == 1; break; }
      foreach (uint pid in others) {
        IntPtr h = OpenProcess(0x0001 | 0x00100000 | 0x1000, false, pid); // TERMINATE | SYNCHRONIZE | QUERY_LIMITED_INFORMATION
        if (h == IntPtr.Zero) continue; // already gone; re-checked next round
        try {
          bool inJob; if (!IsProcessInJob(h, Job, out inJob) || !inJob) continue; // PID reused by a non-member: never touch it
          TerminateProcess(h, 1); if (WaitForSingleObject(h, 10000) == 0) killed.Add(pid.ToString());
        } finally { CloseHandle(h); }
      }
    }
    return killed.Count == 0 ? "none" : string.Join(",", killed.ToArray());
  }
  // Standard Windows argv quoting (CommandLineToArgvW rules).
  public static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return a;
    var sb = new System.Text.StringBuilder("\""); int bs = 0;
    foreach (char c in a) {
      if (c == '\\') { bs++; continue; }
      if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); } else { sb.Append('\\', bs); sb.Append(c); }
      bs = 0;
    }
    sb.Append('\\', bs * 2); sb.Append('"'); return sb.ToString();
  }
}
'@
  $exe = @(Get-Command -Name $Command -CommandType Application -ErrorAction Stop)[0].Source
  $argv = if ($ArgsB64) { @(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgsB64)))) } else { @() }
  [EvalJob]::Enter()
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $exe; $psi.Arguments = (($argv | ForEach-Object { [EvalJob]::Quote([string]$_) }) -join ' ')
  $psi.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($psi)
} catch { Note "setup failed, agent not started: $($_.Exception.Message)"; exit 4 }

Note "agent pid=$($proc.Id) exe=$exe"
$timedOut = -not $proc.WaitForExit($TimeoutMs)
$agentExit = if ($timedOut) { 'timeout' } else { $proc.ExitCode }
try {
  $ok = $false; $killed = [EvalJob]::Drain([ref]$ok)
  $left = [EvalJob]::ActiveCount()
} catch { Note "could not drain job: $($_.Exception.Message)"; exit 3 }
Note "agent exit=$agentExit timedOut=$timedOut killed=$killed members-left=$($left - 1)"
if (-not $ok) { Note 'process tree NOT proven dead'; exit 3 }
Note 'process tree proven dead'
exit 0
