import { execFile, spawn, type ChildProcess } from 'node:child_process';

/**
 * Hide / show the windows of the Chromium instance that uses one account's profile folder
 * (Windows only). Background mode is a normal headed browser — the site sees exactly what it sees
 * in headed mode — whose windows are hidden from the desktop and taskbar.
 *
 * Windows are matched by browser processes whose command line contains that --user-data-dir, so
 * the user's own Chrome windows are never touched.
 */
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class TpWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
}
"@
$profile = $env:TP_PROFILE.ToLowerInvariant()
$pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($profile) } | ForEach-Object { [uint32]$_.ProcessId })
$action = $env:TP_ACTION
$script:count = 0
$cb = [TpWin+EnumProc]{
  param($h, $l)
  $procId = [uint32]0
  [void][TpWin]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($pids -contains $procId) {
    $sb = New-Object System.Text.StringBuilder 64
    [void][TpWin]::GetClassName($h, $sb, 64)
    if ($sb.ToString() -eq 'Chrome_WidgetWin_1') {
      if ($action -eq 'hide' -and [TpWin]::IsWindowVisible($h)) { [void][TpWin]::ShowWindow($h, 0); $script:count++ }
      elseif ($action -eq 'show' -and -not [TpWin]::IsWindowVisible($h)) { [void][TpWin]::ShowWindow($h, 9); [void][TpWin]::SetForegroundWindow($h); $script:count++ }
      elseif ($action -eq 'count' -and [TpWin]::IsWindowVisible($h)) { $script:count++ }
    }
  }
  return $true
}
[void][TpWin]::EnumWindows($cb, [IntPtr]::Zero)
[Console]::Out.Write($script:count)
`;

export const canHideWindows = process.platform === 'win32';

function run(action: 'hide' | 'show' | 'count', profileDir: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { env: { ...process.env, TP_PROFILE: profileDir, TP_ACTION: action }, windowsHide: true, timeout: 20_000 },
      (err, stdout) => resolve(err ? -1 : Number(stdout.trim()) || 0),
    );
  });
}

export async function showBrowserWindows(profileDir: string): Promise<boolean> {
  if (!canHideWindows) return false;
  return (await run('show', profileDir)) > 0;
}

/** Visible browser windows for this profile (diagnostics and tests). */
export function countVisibleBrowserWindows(profileDir: string): Promise<number> {
  return canHideWindows ? run('count', profileDir) : Promise.resolve(0);
}

/**
 * Keeps every window of this profile hidden while the browser runs. Hiding once is not enough:
 * Windows re-shows windows after waking from sleep, and Chromium can open new top-level windows
 * (e.g. "Restore pages?"). A small hidden PowerShell loop re-hides them and exits once the browser
 * is gone.
 */
const WATCH_SCRIPT = SCRIPT.replace(
  /\$action = \$env:TP_ACTION[\s\S]*$/,
  `
$missing = 0
$started = Get-Date
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) {
  $pids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($profile) } | ForEach-Object { [uint32]$_.ProcessId })
  $elapsed = ((Get-Date) - $started).TotalSeconds
  if ($pids.Count -eq 0) { $missing++; if (($elapsed -gt 60) -and ($missing -ge 15)) { break } } else { $missing = 0 }
  $cb = [TpWin+EnumProc]{
    param($h, $l)
    $procId = [uint32]0
    [void][TpWin]::GetWindowThreadProcessId($h, [ref]$procId)
    if ($pids -contains $procId -and [TpWin]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 64
      [void][TpWin]::GetClassName($h, $sb, 64)
      if ($sb.ToString() -eq 'Chrome_WidgetWin_1') { [void][TpWin]::ShowWindow($h, 0) }
    }
    return $true
  }
  [void][TpWin]::EnumWindows($cb, [IntPtr]::Zero)
  if ($elapsed -lt 45) { Start-Sleep -Milliseconds 120 } else { Start-Sleep -Milliseconds 800 }
}
`,
);

/** Start the watcher and resolve once it is scanning, so it runs before the first window appears. */
export async function startHideWatcher(profileDir: string, readyTimeoutMs = 15_000): Promise<() => void> {
  if (!canHideWindows) return () => {};
  let child: ChildProcess | null = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WATCH_SCRIPT], {
    env: { ...process.env, TP_PROFILE: profileDir },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const stop = () => {
    child?.kill();
    child = null;
  };
  await new Promise<void>((resolve) => {
    const c = child!;
    const timer = setTimeout(resolve, readyTimeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    c.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('READY')) done();
    });
    c.on('exit', () => {
      child = null;
      done();
    });
    c.on('error', () => {
      child = null;
      done();
    });
  });
  child?.stdout?.resume();
  return stop;
}
