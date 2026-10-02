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
#   -JcodeHome     optional agent home (JCODE_HOME/JCODE_RUNTIME_DIR/TEMP/TMP). Must be granted to the
#                  container: it may be inside -WritableRoot or a separate directory, in which case it gets
#                  its own Modify grant and its own restore. Its runtime subdirectories are pre-created
#                  here, from the trusted side, because jcode hardens every directory it creates itself with
#                  a PROTECTED DACL naming only the user SID — which would lock the container out of its own
#                  runtime directory.
#   -ToolsRoot     optional directory the agent must be able to run tools from (the runner stages node.exe
#                  and the relay script there). It is granted RX (never write) to the container and is the
#                  first entry of the agent's PATH, because an AppContainer cannot execute a path-qualified
#                  image — only a PATH-resolved or cwd-relative one. Granted separately and restored like the
#                  others. The rest of the agent's PATH is a fixed system list, never the caller's PATH.
#   -ModelUpstream  host:port of the ONE loopback model endpoint this run is allowed to use. When set, a
#                  broker is created on the trusted side (named pipe, DACL = this user + exactly this run's
#                  AppContainer SID, Low integrity label) whose upstream is fixed to this address, and a
#                  relay process is started INSIDE the container that listens on 127.0.0.1:-RelayPort and
#                  pumps to that pipe. The contained agent can therefore reach only this one endpoint, and
#                  only through the broker; a non-loopback upstream is refused before the pipe exists.
#   -RelayPort     TCP port of the in-container relay (default 18437).
#   -ModelPipe     optional pipe name; derived from -WritableRoot when empty.
#   -UncontainedControl  CONTROL ONLY (evals/run.ts --no-contain-unsafe): apply the SAME agent home, profile
#                  variables, fixed PATH, NODE_OPTIONS and deterministic environment as a contained run, but
#                  with no AppContainer, no ACL grants and no broker (the agent dials its endpoint directly).
#                  Makes containment the only experimental variable. Refuses -WritableRoot and -ModelUpstream.
#
# Before launching, the wrapper prints the agent's effective environment once as
#   [run-in-job ...] effective-env-b64=<base64 UTF-8 JSON {name: value}>
# so the runner can fingerprint it. Windows itself further overrides TEMP/TMP inside an AppContainer.

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
param([Parameter(Mandatory = $true)][string]$Command, [string]$ArgsB64 = '', [int]$TimeoutMs = 900000, [string]$WritableRoot = '', [string]$AppContainerName = '', [string]$JcodeHome = '', [string]$ToolsRoot = '', [string]$ModelUpstream = '', [string]$ModelPipe = '', [int]$RelayPort = 18437, [switch]$UncontainedControl)
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

  // NOTE: no custom environment block is built here. CreateProcess on this host rejects a block that was
    // marshalled from a managed string (ERROR_ENVVAR_NOT_FOUND, 203), so the wrapper instead REDUCES its own
    // process environment to an explicit allow-list (Remove-InheritedEnvironment) and lets the child inherit
    // that. See the header for why the agent must never see the caller's environment.
    // Start exe under the AppContainer identity in the current job. Returns the pid, does not wait.
    public static uint Start(string exe, string args, string cwd, IntPtr env, out IntPtr process) {
      process = IntPtr.Zero;
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
                                if (!CreateProcess(exe, cmdline, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT, env, cwd, ref si, out pi)) throw Err("CreateProcess(AppContainer)");
                CloseHandle(pi.hThread);
                process = pi.hProcess;
                return pi.dwProcessId;
              } finally { Marshal.FreeHGlobal(capsPtr); }
            } finally { DeleteProcThreadAttributeList(list); Marshal.FreeHGlobal(list); }
          }
          // Wait for a process started with Start(); returns its exit code and closes the handle.
          public static uint WaitExit(IntPtr h, int timeoutMs, out bool timedOut) {
            uint w = WaitForSingleObject(h, (uint)timeoutMs);
            timedOut = (w == 0x00000102);   // WAIT_TIMEOUT
            uint code; if (!GetExitCodeProcess(h, out code)) throw Err("GetExitCodeProcess");
            CloseHandle(h);
            return code;
          }
          // Launch = Start + WaitExit (the ordinary single-agent path).
            public static uint Launch(string exe, string args, string cwd, IntPtr env, int timeoutMs, out uint pid, out bool timedOut) {
              IntPtr h; pid = Start(exe, args, cwd, env, out h);
              return WaitExit(h, timeoutMs, out timedOut);
            }
          // True when a process started with Start() has already exited (non-blocking).
          public static bool HasExited(IntPtr h) { return WaitForSingleObject(h, 0) == 0; }
          // Terminate a process this script started (the in-container relay) and close its handle.
          public static bool Kill(IntPtr h) {
            bool ok = TerminateProcess(h, 1);
            WaitForSingleObject(h, 5000);
            CloseHandle(h);
            return ok;
          }
}
'@
  # Model broker (trusted side): ONE named pipe whose DACL names exactly this run's AppContainer SID, Low
  # integrity label, every connection forwarded to ONE fixed loopback upstream chosen here. The client
  # cannot choose a destination, and a non-loopback upstream is refused before the pipe exists.
  Add-Type -TypeDefinition @'
using System; using System.IO; using System.IO.Pipes; using System.Net; using System.Net.Sockets; using System.Threading; using System.Threading.Tasks;
using System.Runtime.InteropServices; using Microsoft.Win32.SafeHandles; using System.Security.Principal;
public static class ModelBroker {
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint rev, out IntPtr sd, IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafePipeHandle CreateNamedPipe(string name, uint openMode, uint pipeMode, uint max, uint outBuf, uint inBuf, uint timeout, ref SECURITY_ATTRIBUTES sa);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr h);
  const uint PIPE_ACCESS_DUPLEX = 3, FILE_FLAG_OVERLAPPED = 0x40000000, FILE_FLAG_FIRST_PIPE_INSTANCE = 0x00080000, PIPE_REJECT_REMOTE_CLIENTS = 8;
  static readonly string Line = Environment.NewLine;
  static int connections; static string logPath; static volatile bool stop; static Thread worker;
  public static string Sddl = "";
  public static int Connections { get { return connections; } }
  static void Log(string m) {
    string l = "[model-broker " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "] " + m;
    try { Console.Error.WriteLine(l); } catch { }
    if (!string.IsNullOrEmpty(logPath)) lock (typeof(ModelBroker)) { try { File.AppendAllText(logPath, l + Line); } catch { } }
  }
  static readonly System.Collections.Generic.HashSet<IDisposable> active = new System.Collections.Generic.HashSet<IDisposable>();
  static volatile NamedPipeServerStream pending;
  // A named pipe has no half-close, so EOF on the pipe means the relay closed it: the client is gone and both
  // sides are closed. EOF from the upstream means the response is complete: drain the pipe (the relay has read
  // every byte) before closing, so the tail of the response is never discarded.
  static void Pump(NamedPipeServerStream pipe, TcpClient tcp) {
    NetworkStream ns = tcp.GetStream();
    lock (active) { active.Add(pipe); active.Add(tcp); }
    int closed = 0;
    Action closeAll = () => {
      if (Interlocked.Exchange(ref closed, 1) == 1) return;
      lock (active) { active.Remove(pipe); active.Remove(tcp); }
      try { pipe.Dispose(); } catch { } try { tcp.Close(); } catch { }
    };
    pipe.CopyToAsync(ns).ContinueWith(t => closeAll());
    ns.CopyToAsync(pipe).ContinueWith(t => {
      if (!t.IsFaulted && !t.IsCanceled) { try { pipe.Flush(); pipe.WaitForPipeDrain(); } catch { } }
      closeAll();
    });
  }
  static NamedPipeServerStream NewInstance(string pipe, bool first) {
    IntPtr sd; if (!ConvertStringSecurityDescriptorToSecurityDescriptor(Sddl, 1, out sd, IntPtr.Zero)) throw new Exception("SDDL conversion failed: " + Marshal.GetLastWin32Error());
    try {
      var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)), lpSecurityDescriptor = sd, bInheritHandle = false };
      var h = CreateNamedPipe(@"\\.\pipe\" + pipe, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED | (first ? FILE_FLAG_FIRST_PIPE_INSTANCE : 0), PIPE_REJECT_REMOTE_CLIENTS, 255, 65536, 65536, 0, ref sa);
      if (h.IsInvalid) throw new Exception("CreateNamedPipe failed: " + Marshal.GetLastWin32Error());
      return new NamedPipeServerStream(PipeDirection.InOut, true, false, h);
    } finally { LocalFree(sd); }
  }
  public static void Start(string pipe, string acSid, string host, int port, string log) {
    logPath = log;
    var ip = IPAddress.Parse(host);
    if (!IPAddress.IsLoopback(ip)) throw new Exception("non-loopback upstream refused: " + host);
    if (port < 1 || port > 65535) throw new Exception("upstream port out of range: " + port);
    new SecurityIdentifier(acSid);
    string me = WindowsIdentity.GetCurrent().User.Value;
    Sddl = "D:P(A;;GA;;;" + me + ")(A;;0x12019b;;;" + acSid + ")S:(ML;;NW;;;LW)";
    var first = NewInstance(pipe, true);
    Log("listening pipe=\\\\.\\pipe\\" + pipe + " sddl=" + Sddl + " upstream(fixed)=" + host + ":" + port);
    worker = new Thread(() => {
      var srv = first;
      while (!stop) {
        pending = srv;
        try { srv.WaitForConnection(); } catch (Exception e) { if (!stop) Log("wait failed: " + e.Message); break; }
        if (stop) { srv.Dispose(); break; }
        int n = Interlocked.Increment(ref connections);
        var cur = srv;
        try { srv = NewInstance(pipe, false); } catch (Exception e) { Log("next instance failed: " + e.Message); srv = null; }
        // Dial the upstream off the accept thread so a slow or refused connect never delays the next client.
        Task.Run(() => {
          try { var tcp = new TcpClient(); tcp.Connect(ip, port); Log("conn#" + n + " pipe -> " + host + ":" + port); Pump(cur, tcp); }
          catch (Exception e) { Log("conn#" + n + " upstream connect failed: " + e.Message); try { cur.Dispose(); } catch { } }
        });
        if (srv == null) break;
      }
      pending = null;
    });
    worker.IsBackground = true; worker.Start();
  }
  // Really stop: close the instance waiting for a connection (unblocks the accept loop) and every live pump.
  public static void Stop() {
    stop = true;
    var p = pending; if (p != null) { try { p.Dispose(); } catch { } }
    IDisposable[] live; lock (active) { live = new IDisposable[active.Count]; active.CopyTo(live); active.Clear(); }
    foreach (var d in live) { try { d.Dispose(); } catch { } }
    Log("stopped after " + connections + " connection(s), closed " + live.Length / 2 + " live connection(s)");
  }
}
'@
  $exe = @(Get-Command -Name $Command -CommandType Application -ErrorAction Stop)[0].Source
  $argv = if ($ArgsB64) { @(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($ArgsB64)))) } else { @() }
  [EvalJob]::Enter()
} catch { Note "setup failed, agent not started: $($_.Exception.Message)"; exit 4 }

# Absolute, so ACL grants/restores keep working after the wrapper has replaced its own environment (PATH).
$script:icacls = Join-Path ([Environment]::SystemDirectory) 'icacls.exe'
$useAC = $WritableRoot -ne ''
if ($UncontainedControl -and ($useAC -or $ModelUpstream)) { Note "-UncontainedControl cannot be combined with -WritableRoot or -ModelUpstream, agent not started"; exit 4 }
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
    & $script:icacls $WritableRoot /grant "*${sidString}:(OI)(CI)M" | Out-Null
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
    & $script:icacls $WritableRoot /remove:g "*$sidString" | Out-Null
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

  # ---------- agent home (JCODE_HOME), tool root, and the contained model path ----------
  # Nothing here widens the container's filesystem reach: the agent home gets Modify only because the agent
  # must write its own runtime state there, the tool root gets RX only, and both are restored (and the
  # container profile deleted) on every exit path. The model path is the narrow one: the agent may reach
  # exactly one in-container loopback port, which the relay pumps into a pipe whose DACL names this run's
  # container SID, and the broker dials exactly one fixed loopback upstream.
  $script:homeGranted = $false
  $script:toolsGranted = $false
  $script:aclHomeBefore = ''
  $script:aclToolsBefore = ''
  $script:relayStarted = $false
  $script:relayHandle = [IntPtr]::Zero
  $script:relayPid = 0
  $script:brokerStarted = $false
  function Stop-ModelAccess {
    if ($script:relayStarted) {
      try { $null = [EvalJob]::Kill($script:relayHandle); Note "in-container relay pid=$($script:relayPid) terminated" }
      catch { Note "relay terminate failed: $($_.Exception.Message)" }
      $script:relayStarted = $false
    }
    if ($script:brokerStarted) {
      try { [ModelBroker]::Stop(); Note "model broker stopped after $([ModelBroker]::Connections) connection(s)" } catch { Note "broker stop failed: $($_.Exception.Message)" }
      $script:brokerStarted = $false
    }
  }
  function Restore-ExtraAcls {
    foreach ($g in @(@{ granted = $script:homeGranted; path = $JcodeHome; before = $script:aclHomeBefore; what = 'agent home' },
                     @{ granted = $script:toolsGranted; path = $ToolsRoot; before = $script:aclToolsBefore; what = 'tools root' })) {
      if (-not $g.granted) { continue }
      try {
        $sidString = [EvalJob]::ContainerSidString()
        & $script:icacls $g.path /remove:g "*$sidString" | Out-Null
        $after = (Get-Acl -LiteralPath $g.path).Sddl
        if ($after -ne $g.before) { Restore-Sddl $g.path $g.before; $after = (Get-Acl -LiteralPath $g.path).Sddl }
        Note "$($g.what) acl restore: identical-to-original=$($after -eq $g.before) aces-identical=$((Aces $g.before) -eq (Aces $after))"
        if ((Aces $g.before) -ne (Aces $after)) { Note "$($g.what) acl ACE SET MISMATCH after=$after" }
      } catch { Note "$($g.what) acl restore failed: $($_.Exception.Message)" }
    }
    $script:homeGranted = $false; $script:toolsGranted = $false
  }
  function Grant-ContainerAcl($path, $rights, $what) {
    $sidString = [EvalJob]::ContainerSidString()
    $before = (Get-Acl -LiteralPath $path).Sddl
    & $script:icacls $path /grant "*${sidString}:(OI)(CI)$rights" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls grant failed on $what (exit $LASTEXITCODE)" }
    if ((Get-Acl -LiteralPath $path).Sddl -notmatch [regex]::Escape($sidString)) { throw "grant not present on $what DACL after icacls" }
    Note "$($what) acl: granted $rights to $sidString on $path"
    return $before
  }
  function Within($child, $parent) {
    if (-not $child) { return $false }
    $c = [IO.Path]::GetFullPath($child).TrimEnd('\').ToLowerInvariant()
    $p = [IO.Path]::GetFullPath($parent).TrimEnd('\').ToLowerInvariant()
    return ($c -eq $p -or $c.StartsWith($p + '\'))
  }

  # Deterministic child environment. CreateProcess on this host rejects a custom block marshalled from a managed
  # string (ERROR_ENVVAR_NOT_FOUND, 203), so instead the wrapper REPLACES ITS OWN process environment with a
  # fixed set before starting anything inside the container, and the child inherits exactly that. Nothing is
  # taken from the launching shell: no API key, token or proxy can reach the agent, and the agent's inputs
  # (names, casing and values) are the same whichever shell, terminal or tool started the run.
  #   system values  derived from the OS (folder APIs, machine-scope registry), never from the caller's env
  #   PATH           fixed list: tools root (node, npm, npx, relay), then System32, Windows, Wbem, PowerShell
  #                  (cmd builtins, where/findstr/timeout, powershell). Nothing else, in particular no
  #                  user-profile, Git, Python or package-manager directories from the launching PATH.
  #   wrapper values the agent-home variables this script sets (JCODE_*, TEMP/TMP, profile dirs, NODE_OPTIONS)
  #   dropped        everything else, including LANG/LC_ALL/TMPDIR that some shells (git-bash, Hermes) export
  $wrapperKeys = @('JCODE_HOME', 'JCODE_RUNTIME_DIR', 'JCODE_NO_TELEMETRY', 'DO_NOT_TRACK', 'NODE_OPTIONS',
      'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA')
  function Get-FixedSystemEnvironment {
    $win = [Environment]::GetFolderPath('Windows'); $sys = [Environment]::SystemDirectory
    $machine = { param($n, $d) $v = [Environment]::GetEnvironmentVariable($n, 'Machine'); if ($v) { $v } else { $d } }
    $pathDirs = @()
    if ($script:agentToolsRoot) { $pathDirs += $script:agentToolsRoot }
    $pathDirs += @($sys, $win, (Join-Path $sys 'Wbem'), (Join-Path $sys 'WindowsPowerShell\v1.0'))
    return [ordered]@{
      'PATH' = ($pathDirs -join ';'); 'SystemRoot' = $win; 'windir' = $win; 'SystemDrive' = $win.Substring(0, 2)
      'ComSpec' = (Join-Path $sys 'cmd.exe'); 'PATHEXT' = (& $machine 'PATHEXT' '.COM;.EXE;.BAT;.CMD'); 'OS' = 'Windows_NT'
      'PROCESSOR_ARCHITECTURE' = (& $machine 'PROCESSOR_ARCHITECTURE' 'AMD64'); 'NUMBER_OF_PROCESSORS' = "$([Environment]::ProcessorCount)"
      'ProgramFiles' = [Environment]::GetFolderPath('ProgramFiles'); 'ProgramFiles(x86)' = [Environment]::GetFolderPath('ProgramFilesX86')
      'CommonProgramFiles' = [Environment]::GetFolderPath('CommonProgramFiles')
    }
  }
  $script:envSanitized = $false
  function Remove-InheritedEnvironment {
    if ($script:envSanitized) { return }
    $want = Get-FixedSystemEnvironment
    foreach ($k in $script:wrapperKeys) {
      $v = [Environment]::GetEnvironmentVariable($k, 'Process')
      # Without -JcodeHome the wrapper sets no profile/temp values; then (only then) the caller's are kept.
      if ($null -ne $v) { $want[$k] = $v }
    }
    $inherited = @([Environment]::GetEnvironmentVariables('Process').Keys | ForEach-Object { [string]$_ })
    # Remove EVERY variable first, then set the fixed ones: this also normalizes name casing (Path vs PATH),
    # which otherwise follows whatever the launching process used.
    foreach ($n in $inherited) {
      try { [Environment]::SetEnvironmentVariable($n, $null, 'Process') } catch { Note "could not drop inherited variable $n : $($_.Exception.Message)" }
    }
    # Fail closed: every variable must actually be gone, or the agent would inherit it. Windows keeps some
    # system values (NUMBER_OF_PROCESSORS) whatever the process does; those are overwritten with the fixed
    # value below, so only a survivor that is NOT part of the fixed set is a failure.
    $survivors = @($inherited | Where-Object { $null -ne [Environment]::GetEnvironmentVariable($_, 'Process') -and -not $want.Contains($_) })
    if ($survivors.Count) { throw "inherited environment variables survived sanitization: $($survivors -join ',')" }
    foreach ($k in $want.Keys) { [Environment]::SetEnvironmentVariable($k, $want[$k], 'Process') }
    $left = @([Environment]::GetEnvironmentVariables('Process').Keys | ForEach-Object { [string]$_ })
    $extra = @($left | Where-Object { -not $want.Contains($_) })
    if ($extra.Count) { throw "unexpected variables in the agent environment: $($extra -join ',')" }
    foreach ($k in $want.Keys) { if ([Environment]::GetEnvironmentVariable($k, 'Process') -ne $want[$k]) { throw "fixed variable $k did not survive sanitization" } }
    $dropped = @($inherited | Where-Object { -not $want.Contains($_) })
    $script:envSanitized = $true
    Note "agent environment: replaced with $($left.Count) fixed variables, PATH=$($want['PATH']) (dropped $($dropped.Count) inherited: $(($dropped | Select-Object -First 12) -join ','))"
  }

  if ($JcodeHome -or $ToolsRoot -or $ModelUpstream) {
    try {
      if (-not $useAC -and -not $UncontainedControl) { throw "agent home / tools root / model access require -WritableRoot (contained mode)" }
      if ($JcodeHome) {
            $JcodeHome = [IO.Path]::GetFullPath($JcodeHome)
            # Pre-create the runtime tree from the TRUSTED side: jcode rewrites the DACL of any directory it
            # creates itself to a protected one naming only the user SID, which locks the container out.
            foreach ($d in @('logs', 'sessions', 'active_pids', 'streaming_pids', 'migrations', 'cache', 'config', 'state', 'tmp', 'runtime', 'appdata', 'localappdata')) {
              $p = Join-Path $JcodeHome $d
              if (-not (Test-Path -LiteralPath $p)) { $null = New-Item -ItemType Directory -Force -Path $p }
            }
            if (-not $useAC) { Note "control: agent home used without any grant (no AppContainer): $JcodeHome" }
            elseif (Within $JcodeHome $WritableRoot) { Note "agent home is inside the sandbox root (covered by the sandbox grant): $JcodeHome" }
            else { $script:aclHomeBefore = Grant-ContainerAcl $JcodeHome 'M' 'agent home'; $script:homeGranted = $true }
            $env:JCODE_HOME = $JcodeHome
            $env:JCODE_RUNTIME_DIR = Join-Path $JcodeHome 'runtime'
            $env:TEMP = Join-Path $JcodeHome 'tmp'; $env:TMP = $env:TEMP
            $env:JCODE_NO_TELEMETRY = '1'; $env:DO_NOT_TRACK = '1'
      # The container's token has no read-attributes right on C:\ or on the profile chain, so node's
      # realpathSync-based path resolution (which walks every component from C:\) fails with EPERM for ANY
      # script file. --preserve-symlinks-main skips that walk for the entry script and --preserve-symlinks
      # does the same for module resolution, so node/npm/tsx work inside the sandbox while the sandbox's
      # own node_modules links stay inside it. Without these the contained agent cannot run any node tool.
      $env:NODE_OPTIONS = '--preserve-symlinks --preserve-symlinks-main'
            # The container cannot read the real profile anyway; point the profile variables at the agent home so
            # nothing the agent does even looks like it is addressing the user's real profile.
            $env:USERPROFILE = $JcodeHome; $env:HOME = $JcodeHome
            $env:APPDATA = Join-Path $JcodeHome 'appdata'; $env:LOCALAPPDATA = Join-Path $JcodeHome 'localappdata'
            # Windows replaces TEMP/TMP for every AppContainer process with %LOCALAPPDATA%\Packages\<name>\AC\Temp,
            # resolved against the LOCALAPPDATA above. Nothing creates it there, so os.tmpdir() pointed at a
            # missing directory and every mkdtemp (test fixtures, npm, tsc) failed with ENOENT. Pre-create it from
            # the trusted side, inside the already-granted agent home: no new grant, nothing outside the home.
            if ($containerName) {
              $acTemp = Join-Path $env:LOCALAPPDATA "Packages\$containerName\AC\Temp"
              if (-not (Test-Path -LiteralPath $acTemp)) { $null = New-Item -ItemType Directory -Force -Path $acTemp }
              Note "appcontainer temp pre-created inside agent home: $acTemp"
            }
            Note "agent home env: JCODE_HOME=$($env:JCODE_HOME) JCODE_RUNTIME_DIR=$($env:JCODE_RUNTIME_DIR) TEMP=$($env:TEMP) USERPROFILE=$($env:USERPROFILE)"
          }
      if ($ToolsRoot) {
        $ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
        if (-not (Test-Path -LiteralPath $ToolsRoot)) { throw "tools root does not exist: $ToolsRoot" }
        if (-not $useAC) { Note "control: tools root used without any grant (no AppContainer): $ToolsRoot" }
        elseif (Within $ToolsRoot $WritableRoot) { Note "tools root is inside the sandbox root: $ToolsRoot" }
        else { $script:aclToolsBefore = Grant-ContainerAcl $ToolsRoot 'RX' 'tools root'; $script:toolsGranted = $true }
        # The agent's PATH is built from a fixed list with the tools root first (Remove-InheritedEnvironment).
        $script:agentToolsRoot = $ToolsRoot
        Note "agent PATH will start with the tools root: $ToolsRoot"
      }
      if ($ModelUpstream) {
            Remove-InheritedEnvironment
            if (-not $JcodeHome) { throw "ModelUpstream requires -JcodeHome (broker/relay logs and readiness marker live there)" }
        if (-not $ToolsRoot) { throw "ModelUpstream requires -ToolsRoot (the in-container relay runs from there)" }
        $parts = $ModelUpstream.Split(':')
        if ($parts.Count -ne 2) { throw "ModelUpstream must be host:port, got '$ModelUpstream'" }
        $upHost = $parts[0]; $upPort = [int]$parts[1]
        $relayScript = Join-Path $ToolsRoot 'model-relay.mjs'
        $nodeExe = Join-Path $ToolsRoot 'node.exe'
        foreach ($f in @($relayScript, $nodeExe)) { if (-not (Test-Path -LiteralPath $f)) { throw "missing $f" } }
        if (-not $ModelPipe) {
          $sha = [System.Security.Cryptography.SHA1]::Create()
          $ModelPipe = 'evalmodel-' + ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($WritableRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 12).ToLowerInvariant()
        }
        $brokerLog = Join-Path $JcodeHome 'broker.log'
        $relayLog = Join-Path $JcodeHome 'relay.log'
        [ModelBroker]::Start($ModelPipe, [EvalJob]::ContainerSidString(), $upHost, $upPort, $brokerLog)
        $script:brokerStarted = $true
        Note "model broker: pipe=\\.\pipe\$ModelPipe upstream(fixed)=${upHost}:${upPort} log=$brokerLog"
        # A leftover log from an earlier run in the same home must not count as this relay's readiness.
        if (Test-Path -LiteralPath $relayLog) { Remove-Item -LiteralPath $relayLog -Force }
        $relayArgs = ([EvalJob]::Quote('--preserve-symlinks-main')) + ' ' + ([EvalJob]::Quote($relayScript)) + ' ' + $RelayPort + ' ' + ([EvalJob]::Quote($ModelPipe)) + ' ' + ([EvalJob]::Quote($relayLog))
        $script:relayPid = [EvalJob]::Start($nodeExe, $relayArgs, $WritableRoot, [IntPtr]::Zero, [ref]$script:relayHandle)
        $script:relayStarted = $true
        Note "in-container relay: pid=$($script:relayPid) exe=$nodeExe args=$relayArgs"
        $ready = $false
        for ($i = 0; $i -lt 100; $i++) {
          Start-Sleep -Milliseconds 200
          $relayText = if (Test-Path -LiteralPath $relayLog) { Get-Content -Raw -LiteralPath $relayLog } else { '' }
          if ($relayText -match "listening 127\.0\.0\.1:$RelayPort ") { $ready = $true; break }
          # Fail fast instead of waiting out the full 20 s when the relay has already died (e.g. port in use).
          if ([EvalJob]::HasExited($script:relayHandle)) {
            $why = if ($relayText -match 'listen failed: ([^\r\n]*)') { $Matches[1] } else { 'no reason logged' }
            throw "in-container relay exited before listening on 127.0.0.1:${RelayPort}: $why"
          }
        }
        if (-not $ready) { throw "in-container relay did not report listening on 127.0.0.1:$RelayPort within 20s" }
        Note "in-container relay ready on 127.0.0.1:$RelayPort"
      }
    } catch {
      Note "agent home / model access setup failed, agent not started: $($_.Exception.Message)"
      Stop-ModelAccess
      Restore-ExtraAcls
      # Restore-Sandbox also deletes the container profile; in control mode (no container) it is a no-op.
      Restore-Sandbox
      exit 4
    }
  }

# Sanitized child environment (fallback path: a contained run with no model upstream or agent home still
# gets one, so the agent can never inherit the caller's environment). See Remove-InheritedEnvironment.
if ($useAC -or $UncontainedControl) {
  try { Remove-InheritedEnvironment }
  catch {
    Note "environment sanitization failed, agent not started: $($_.Exception.Message)"
    Stop-ModelAccess
    Restore-ExtraAcls
    Restore-Sandbox
    exit 4
  }
  $effEnv = [ordered]@{}
  foreach ($k in (@([Environment]::GetEnvironmentVariables('Process').Keys) | Sort-Object)) { $effEnv[[string]$k] = [Environment]::GetEnvironmentVariable([string]$k, 'Process') }
  Note "effective-env-b64=$([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($effEnv | ConvertTo-Json -Compress))))"
}

$agentExit = 'not-started'
if ($useAC) {
  $agentPid = 0; $acTimedOut = $false
  try {
    $argline = (($argv | ForEach-Object { [EvalJob]::Quote([string]$_) }) -join ' ')
    Note "launching under appcontainer: exe=$exe cwd=$WritableRoot"
    $code = [EvalJob]::Launch($exe, $argline, $WritableRoot, [IntPtr]::Zero, $TimeoutMs, [ref]$agentPid, [ref]$acTimedOut)
    $agentExit = if ($acTimedOut) { 'timeout' } else { $code }
    Note "agent pid=$agentPid exe=$exe"
  } catch {
      Note "launch failed, agent not started: $($_.Exception.Message)"
      Stop-ModelAccess
      Restore-ExtraAcls
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
# The relay is a job member, so it is stopped first: it must not be reported as a survivor of the agent.
Stop-ModelAccess
Restore-ExtraAcls
Restore-Sandbox
try {
  $ok = $false; $killed = [EvalJob]::Drain([ref]$ok)
  $left = [EvalJob]::ActiveCount()
} catch { Note "could not drain job: $($_.Exception.Message)"; exit 3 }
Note "agent exit=$agentExit timedOut=$timedOut killed=$killed members-left=$($left - 1)"
if (-not $ok) { Note 'process tree NOT proven dead'; exit 3 }
Note 'process tree proven dead'
exit 0
