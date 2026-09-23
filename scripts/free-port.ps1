<#
.SYNOPSIS
  Free a TCP port held by a leftover dev server, chain and all.

.DESCRIPTION
  On Windows a dev server started from a script is a chain -
  `cmd.exe -> pnpm -> cmd.exe -> node -> start-server.js` - and only the leaf
  holds the socket. Killing the leaf leaves the wrappers behind; killing the
  script that started it leaves the whole chain behind (see INSIGHTS.md,
  2026-09-20). So: resolve the listener by port, walk *up* to the topmost
  wrapper, and kill that tree.

  The walk only follows ancestors that are themselves shell / package-manager /
  node wrappers, so it stops at the terminal (or app) that launched the stack
  and never kills it. Called by scripts/dev.sh --free-ports; also runnable on
  its own:

      powershell -NoProfile -File scripts/free-port.ps1 -Port 3000
      powershell -NoProfile -File scripts/free-port.ps1 -Port 3000 -WhatIf

  ASCII only on purpose: Windows PowerShell 5.1 decodes a BOM-less .ps1 as
  ANSI, and a stray non-ASCII character there is a parse error, not a mojibake.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port
)

$ErrorActionPreference = 'Stop'

# Only these may be climbed through or killed. Anything else - claude.exe,
# WindowsTerminal.exe, explorer.exe, postgres.exe - ends the walk untouched.
$Wrappers = @(
  'node.exe', 'cmd.exe', 'pnpm.exe', 'npm.exe', 'npx.exe',
  'sh.exe', 'bash.exe', 'tsx.exe', 'next.exe', 'conhost.exe'
)

function Get-ListenerPids {
  param([int]$Port)
  try {
    return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
             Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    # Older hosts / no NetTCPIP module: fall back to netstat.
    return @(netstat -ano |
             Select-String -Pattern "^\s+TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$" |
             ForEach-Object { [int]$_.Matches[0].Groups[1].Value } |
             Select-Object -Unique)
  }
}

$procs = @{}
Get-CimInstance Win32_Process | ForEach-Object { $procs[[int]$_.ProcessId] = $_ }

$listeners = @(Get-ListenerPids -Port $Port | Where-Object { $_ -gt 4 })
if ($listeners.Count -eq 0) {
  Write-Host "port $Port is already free"
  exit 0
}

$roots = New-Object 'System.Collections.Generic.HashSet[int]'

foreach ($listener in $listeners) {
  $proc = $procs[[int]$listener]
  if (-not $proc) { continue }

  Write-Host ("port {0} held by PID {1} ({2})" -f $Port, $proc.ProcessId, $proc.Name)
  if ($proc.CommandLine) {
    $cmd = $proc.CommandLine
    if ($cmd.Length -gt 120) { $cmd = $cmd.Substring(0, 120) + '...' }
    Write-Host "  $cmd"
  }

  # Climb while the parent is a wrapper we are willing to kill. The creation-time
  # check guards against PID reuse: a real parent cannot start after its child.
  $top = $proc
  while ($true) {
    $parent = $procs[[int]$top.ParentProcessId]
    if (-not $parent) { break }
    if ($Wrappers -notcontains $parent.Name) { break }
    if ($parent.CreationDate -gt $top.CreationDate) { break }
    $top = $parent
  }

  if ($Wrappers -notcontains $top.Name) {
    Write-Warning ("refusing to kill PID {0} ({1}): not a dev-server process" -f $top.ProcessId, $top.Name)
    continue
  }

  if ($top.ProcessId -ne $proc.ProcessId) {
    Write-Host ("  chain root: PID {0} ({1})" -f $top.ProcessId, $top.Name)
  }
  [void]$roots.Add([int]$top.ProcessId)
}

if ($roots.Count -eq 0) {
  Write-Warning "nothing safe to kill on port ${Port}: stop it by hand"
  exit 1
}

foreach ($root in $roots) {
  if ($PSCmdlet.ShouldProcess("PID $root and its descendants", "taskkill /T /F")) {
    & taskkill.exe /PID $root /T /F 2>&1 | ForEach-Object { Write-Verbose $_ }
  }
}

if ($WhatIfPreference) { exit 0 }

# taskkill returns before the sockets are reaped; give them a moment.
for ($i = 0; $i -lt 20; $i++) {
  if (@(Get-ListenerPids -Port $Port).Count -eq 0) {
    Write-Host "port $Port freed"
    exit 0
  }
  Start-Sleep -Milliseconds 250
}

Write-Warning "port $Port is still held after taskkill"
exit 1
