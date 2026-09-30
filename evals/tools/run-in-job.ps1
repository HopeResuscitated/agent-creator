# Run one agent command inside a Windows Job Object and prove its whole process tree is dead before returning.
# Used by evals/run.ts (jcode agent runs).
#
#   -Command  program name, resolved on PATH (first Application match, same order Node uses)
#   -ArgsB64  base64(UTF-8 JSON array of string arguments)
#   -TimeoutMs  how long to wait for the agent's root process
#   -WritableRoot  if set, the agent is launched under an AppContainer identity (Windows access control)
#                  that has Modify on this root and on nothing else; every other location is denied by the
#                  OS, including absolute paths and .. traversal. Fail-closed: if the container cannot be
#                  created/resolved or the ACL cannot be applied, this script exits 4 without starting the
#                  agent — it never falls back to the ordinary user token.
#   -AppContainerName  optional explicit container name; derived from -WritableRoot when empty, so separate
#                  runs get separate identities and cannot share writable state.
#
# How the tree is contained: this script puts ITSELF into a new job, with KILL_ON_JOB_CLOSE and no
# breakaway allowed, before starting the agent. Every process the agent starts is then a job member, and
# stays one even after its parent exits. Nothing is matched by name, path or PID guess.
#
# Job Object = process containment; AppContainer + ACL = filesystem containment. They solve different
# problems and both are in force when -WritableRoot is supplied. The AppContainer process is created with
# CreateProcess + PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES (no capabilities granted, so it also has no
# network access) and inherits this script's stdio, so run.ts still sees the agent's output. The sandbox
# DACL is read before the grant and written back afterwards, and the container profile is deleted on
# every exit path.
param([Parameter(Mandatory = $true)][string]$Command, [string]$ArgsB64 = '', [int]$TimeoutMs = 900000, [string]$WritableRoot = '', [string]$AppContainerName = '')
$ErrorActionPreference = 'Stop'
function Note($m) { [Console]::Error.WriteLine("[run-in-job $([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())] $m") }
# ABS-2: write a DACL back from its exact SDDL form (access section only), so a grant can be undone precisely.
function Restore-Sddl($path, $sddl) {
  $sec = New-Object System.Security.AccessControl.DirectorySecurity
  $sec.SetSecurityDescriptorSddlForm($sddl, [System.Security.AccessControl.AccessControlSections]::Access)
  $di = New-Object System.IO.DirectoryInfo $path
  $di.SetAccessControl($sec)
}
# The sorted set of ACEs in an SDDL string, for comparing DACLs independently of control flags.
function Aces($sddl) { if (-not $sddl) { return '' } return ((([regex]::Matches($sddl, '\([^)]*\)') | ForEach-Object { $_.Value }) | Sort-Object) -join '') }
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
    IntPtr buf = Marshal.AllocHGlobal(48);
    try { if (!QueryInformationJobObject(Job, 1, buf, 48, IntPtr.Zero)) throw Err("Query(Accounting)"); return Marshal.ReadInt32(buf, 40); }
    finally { Marshal.FreeHGlobal(buf); }
  }
  public static string Drain(out bool ok) {
    limits.Basic.LimitFlags = KILL_ON_JOB_CLOSE | ACTIVE_PROCESS; limits.Basic.ActiveProcessLimit = 1; Set();
    uint self = GetCurrentProcessId(); var killed = new List<string>(); ok = false;
    for (int round = 0; round < 20; round++) {
      var others = new List<uint>(); foreach (uint p in Members()) if (p != self) others.Add(p);
      if (others.Count == 0) { ok = ActiveCount() == 1; break; }
      foreach (uint pid in others) {
        IntPtr h = OpenProcess(0x0001 | 0x00100000 | 0x1000, false, pid);
        if (h == IntPtr.Zero) continue;
        try {
          bool inJob; if (!IsProcessInJob(h, Job, out inJob) || !inJob) continue;
          TerminateProcess(h, 1); if (WaitForSingleObject(h, 10000) == 0) killed.Add(pid.ToString());
        } finally { CloseHandle(h); }
      }
    }
    return killed.Count == 0 ? "none" : string.Join(",", killed.ToArray());
  }
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

  // ---------- ABS-2: AppContainer identity + restricted-token launch ----------
  [DllImport("userenv.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string desc, IntPtr caps, uint capCount, out IntPtr sid);
  [DllImport("userenv.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name, out IntPtr sid);
  [DllImport("userenv.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr str);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attr, IntPtr value, IntPtr size, IntPtr prev, IntPtr ret);
  [DllImport("kernel32.dll", SetLastError = true)] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string exe, string cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFOEX si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);

  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public IntPtr lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_CAPABILITIES { public IntPtr AppContainerSid; public IntPtr Capabilities; public uint CapabilityCount; public uint Reserved; }
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  static readonly IntPtr PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES = (IntPtr)0x00020009; // ProcThreadAttributeValue(9, FALSE, TRUE, FALSE) — verified by diag.ps1
  static IntPtr containerSid = IntPtr.Zero;

  // Create the AppContainer profile (idempotent) and return its SID string. Throws on failure.
  public static string EnsureContainer(string name) {
    IntPtr sid;
    int hr = CreateAppContainerProfile(name, name, "eval agent sandbox " + name, IntPtr.Zero, 0, out sid);
    if (hr != 0) {
      if ((uint)hr == 0x800700B7u) {   // ERROR_ALREADY_EXISTS: profile already present, just resolve it
        hr = DeriveAppContainerSidFromAppContainerName(name, out sid);
        if (hr != 0) throw new Exception("DeriveAppContainerSidFromAppContainerName failed, hr=0x" + hr.ToString("X8"));
      } else throw new Exception("CreateAppContainerProfile failed, hr=0x" + hr.ToString("X8"));
    }
    IntPtr str;
    if (!ConvertSidToStringSid(sid, out str)) throw Err("ConvertSidToStringSid");
    string s = Marshal.PtrToStringUni(str); LocalFree(str);
    containerSid = sid;
    return s;
  }
  public static bool DeleteContainer(string name) { return DeleteAppContainerProfile(name) == 0; }
  public static string ContainerSidString() { if (containerSid == IntPtr.Zero) return ""; IntPtr str; if (!ConvertSidToStringSid(containerSid, out str)) return ""; string s = Marshal.PtrToStringUni(str); LocalFree(str); return s; }
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);

  // Launch exe under the AppContainer identity in the current job. Returns exit code.
  public static uint Launch(string exe, string args, string cwd, int timeoutMs, out uint pid, out bool timedOut) {
    timedOut = false;
    var si = new STARTUPINFOEX();
    si.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));   // verified by diag2.ps1: 104 -> ERROR_INVALID_PARAMETER(87), 112 works
    IntPtr size = IntPtr.Zero;
    InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);   // expected to fail: returns needed size
    IntPtr list = Marshal.AllocHGlobal(size);
    try {
      if (!InitializeProcThreadAttributeList(list, 1, 0, ref size)) throw Err("InitializeProcThreadAttributeList");
      var caps = new SECURITY_CAPABILITIES();
      caps.AppContainerSid = containerSid; caps.Capabilities = IntPtr.Zero; caps.CapabilityCount = 0; caps.Reserved = 0;
      IntPtr capsPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)));
      try {
        Marshal.StructureToPtr(caps, capsPtr, false);
        if (!UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, capsPtr, (IntPtr)Marshal.SizeOf(typeof(SECURITY_CAPABILITIES)), IntPtr.Zero, IntPtr.Zero)) throw Err("UpdateProcThreadAttribute");
        si.lpAttributeList = list;
        // let the agent inherit this script's stdio so run.ts still sees its output
        foreach (int s in new[] { -10, -11, -12 }) { IntPtr h = GetStdHandle(s); if (h != IntPtr.Zero && h != (IntPtr)(-1)) SetHandleInformation(h, 1, 1); }
        PROCESS_INFORMATION pi;
        string cmdline = Quote(exe) + (args.Length > 0 ? " " + args : "");
        if (!CreateProcess(exe, cmdline, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, cwd, ref si, out pi)) throw Err("CreateProcess(AppContainer)");
        CloseHandle(pi.hThread);
        pid = pi.dwProcessId;
        uint w = WaitForSingleObject(pi.hProcess, (uint)timeoutMs);
        timedOut = (w == 0x00000102);   // WAIT_TIMEOUT
        uint code; if (!GetExitCodeProcess(pi.hProcess, out code)) throw Err("GetExitCodeProcess");
        CloseHandle(pi.hProcess);
        return code;
      } finally { Marshal.FreeHGlobal(capsPtr); }
    } finally { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); }
  }
}
'@
  $exe = @(Get-Command -Name $Command -CommandType Application -ErrorAction Stop)[0].Source
  $argv = if ($ArgsB64) { @(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgsB64)))) } else { @() }
  [EvalJob]::Enter()
} catch { Note "setup failed, agent not started: $($_.Exception.Message)"; exit 4 }

$useAC = $WritableRoot -ne ''
$aclBefore = ''
$containerName = ''
if ($useAC) {
  try {
    if (-not $AppContainerName) {
      $sha = [System.Security.Cryptography.SHA1]::Create()
      $hash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($WritableRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 16).ToLowerInvariant()
      $containerName = "agenteval-$hash"
    } else { $containerName = $AppContainerName }
    $sidString = [EvalJob]::EnsureContainer($containerName)
    Note "appcontainer name=$containerName sid=$sidString"
    if (-not (Test-Path -LiteralPath $WritableRoot)) { throw "writable root does not exist: $WritableRoot" }
    $aclBefore = (Get-Acl -LiteralPath $WritableRoot).Sddl
    & icacls $WritableRoot /grant "*${sidString}:(OI)(CI)M" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls grant failed (exit $LASTEXITCODE)" }
    $aclAfter = (Get-Acl -LiteralPath $WritableRoot).Sddl
    if ($aclAfter -notmatch [regex]::Escape($sidString)) { throw "grant not present in the DACL after icacls" }
    Note "sandbox acl: granted Modify to $sidString on $WritableRoot"
    Note "sandbox acl before=$aclBefore"
    Note "sandbox acl after =$aclAfter"
  } catch {
    Note "appcontainer setup failed, agent not started: $($_.Exception.Message)"
    if ($containerName) { try { [void][EvalJob]::DeleteContainer($containerName) } catch { } }
    exit 4
  }
}

function Restore-Sandbox {
  if (-not $useAC) { return }
  try {
    $sidString = [EvalJob]::ContainerSidString()
    & icacls $WritableRoot /remove:g "*$sidString" | Out-Null
    $after = (Get-Acl -LiteralPath $WritableRoot).Sddl
    if ($after -ne $aclBefore) {
      # icacls normalizes the DACL (sets SE_DACL_AUTO_INHERITED); write the recorded SDDL back verbatim.
      Restore-Sddl $WritableRoot $aclBefore
      $after = (Get-Acl -LiteralPath $WritableRoot).Sddl
    }
    Note "sandbox acl restore: identical-to-original=$($after -eq $aclBefore) aces-identical=$((Aces $aclBefore) -eq (Aces $after))"
    if ((Aces $aclBefore) -ne (Aces $after)) { Note "sandbox acl ACE SET MISMATCH after=$after" }
    elseif ($after -ne $aclBefore) { Note "sandbox acl restore: residual difference is the DACL control-flag bit only (ACE set identical); raw after=$after" }
  } catch { Note "sandbox acl restore failed: $($_.Exception.Message)" }
  try { Note "appcontainer profile deleted=$([EvalJob]::DeleteContainer($containerName))" } catch { Note "appcontainer profile delete failed: $($_.Exception.Message)" }
}

$agentExit = 'not-started'
if ($useAC) {
  $agentPid = 0; $acTimedOut = $false
  try {
    $argline = (($argv | ForEach-Object { [EvalJob]::Quote([string]$_) }) -join ' ')
    Note "launching under appcontainer: exe=$exe cwd=$WritableRoot"
    $code = [EvalJob]::Launch($exe, $argline, $WritableRoot, $TimeoutMs, [ref]$agentPid, [ref]$acTimedOut)
    $agentExit = if ($acTimedOut) { 'timeout' } else { $code }
    Note "agent pid=$agentPid exe=$exe"
  } catch {
    Note "launch failed, agent not started: $($_.Exception.Message)"
    Restore-Sandbox
    exit 4
  }
} else {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe; $psi.Arguments = (($argv | ForEach-Object { [EvalJob]::Quote([string]$_) }) -join ' ')
    $psi.UseShellExecute = $false
    $proc = [System.Diagnostics.Process]::Start($psi)
  } catch { Note "setup failed, agent not started: $($_.Exception.Message)"; exit 4 }
  Note "agent pid=$($proc.Id) exe=$exe"
}
if (-not $useAC) {
  $timedOut = -not $proc.WaitForExit($TimeoutMs)
  $agentExit = if ($timedOut) { 'timeout' } else { $proc.ExitCode }
} else {
  $timedOut = $acTimedOut
}
# ABS-2: restore the sandbox ACL BEFORE Drain caps this job to one active process — a process-cap job
# cannot start icacls.exe, and the ACL write is synchronous, so this also can't race a member's write.
Restore-Sandbox
try {
  $ok = $false; $killed = [EvalJob]::Drain([ref]$ok)
  $left = [EvalJob]::ActiveCount()
} catch { Note "could not drain job: $($_.Exception.Message)"; exit 3 }
Note "agent exit=$agentExit timedOut=$timedOut killed=$killed members-left=$($left - 1)"
if (-not $ok) { Note 'process tree NOT proven dead'; exit 3 }
Note 'process tree proven dead'
exit 0
