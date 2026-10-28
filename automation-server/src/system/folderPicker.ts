import { execFile } from 'node:child_process';
import fs from 'node:fs';

/**
 * Opens the operating system's native folder picker from the local service. An extension's
 * showDirectoryPicker() only returns a sandboxed handle, never a path, and the service is the one
 * that reads the files. Only the paired extension (token + localhost) can trigger this.
 */
export function pickFolder(initial?: string, title = 'Select a folder'): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const done = (err: Error | null, stdout: string) => {
      if (err && (err as NodeJS.ErrnoException).code !== undefined && !stdout) return reject(err);
      const p = stdout.trim();
      resolve(p && fs.existsSync(p) ? p : null);
    };
    const start = initial && fs.existsSync(initial) ? initial : '';
    if (process.platform === 'win32') {
      // TopMost owner form so the dialog appears above Chrome.
      const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true; ShowInTaskbar = $false; WindowState = 'Minimized'}
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:TP_TITLE
$d.ShowNewFolderButton = $false
if ($env:TP_START) { $d.SelectedPath = $env:TP_START }
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
$owner.Dispose()`;
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { env: { ...process.env, TP_START: start, TP_TITLE: title }, windowsHide: true, timeout: 10 * 60_000 },
        (err, stdout) => done(err, stdout),
      );
    } else if (process.platform === 'darwin') {
      execFile('osascript', ['-e', `POSIX path of (choose folder with prompt ${JSON.stringify(title)})`], (err, stdout) =>
        err ? resolve(null) : done(null, stdout.replace(/\/$/, '')),
      );
    } else {
      execFile('zenity', ['--file-selection', '--directory', `--title=${title}`], (err, stdout) => (err ? resolve(null) : done(null, stdout)));
    }
  });
}
