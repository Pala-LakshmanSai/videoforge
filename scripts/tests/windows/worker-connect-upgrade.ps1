param([string]$OldInstaller, [string]$LatestInstaller)
$ErrorActionPreference = 'Stop'
$OldInstaller = (Resolve-Path $OldInstaller).Path
$LatestInstaller = (Resolve-Path $LatestInstaller).Path
$exe = Join-Path $env:LOCALAPPDATA 'Programs\VideoForge Worker\VideoForge Worker.exe'
$stateFile = Join-Path $env:LOCALAPPDATA 'VideoForge Worker\installation.json'
$installation = [Guid]::NewGuid().ToString()
$credential = 'a' * 64
$commandToken = 'b' * 64
$renewedToken = 'c' * 64
function Assert($value, $message) { if (-not $value) { throw $message } }
function VersionNow {
  (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8ED2FC8D-2D79-4EA0-9D61-C0DF2408CD45}_is1').DisplayVersion
}
function InstallOld {
  $p = Microsoft.PowerShell.Management\Start-Process $OldInstaller -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-' -Wait -PassThru
  Assert ($p.ExitCode -eq 0 -and (VersionNow) -eq '0.1.43') 'Old native installer failed'
}
# Installer execution, registry and Credential Manager are real Windows operations.
# Hosted replies and the final worker enrollment are fixtures; no production/provider calls.
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing)
  $script:downloads++
  if ($script:corrupt) { [IO.File]::WriteAllText($OutFile, 'partial'); return }
  Copy-Item -LiteralPath $LatestInstaller -Destination $OutFile
}
function Invoke-RestMethod {
  param($Method, $Uri, $Headers, $ContentType, $Body)
  Assert ($Headers.Authorization -eq ('Bearer ' + $credential)) 'OS credential was not read correctly'
  $request = $Body | ConvertFrom-Json
  Assert ($request.installed_version -eq (VersionNow)) 'Installed version was not reported'
  $script:requests++
  if ($script:waitOnce -and $script:requests -eq 1) { return @{ action = 'WAIT'; token = $renewedToken } }
  if ($script:waitOnce) { Assert ($request.token -eq $renewedToken) 'Wait did not renew the command' }
  if ((VersionNow) -eq '0.1.44') { return @{ action = 'CONNECTED' } }
  $script:idleApproved = $true
  return @{ action = 'UPGRADE'; token = $renewedToken }
}
function Get-Process {
  param($Name, $ErrorAction)
  if ($script:running) { [pscustomobject]@{ Id = 12345; Path = $exe } }
}
function Stop-Process {
  param([Parameter(ValueFromPipeline=$true)]$InputObject, [switch]$Force)
  process {
    Assert $script:idleApproved 'Stopped a worker before its idle check'
    $script:stops++; $script:running = $false
  }
}
function Start-Sleep { param($Seconds) }
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
  if ($FilePath -eq $exe) {
    Assert ((VersionNow) -eq '0.1.44') 'Attempted to use --connect-file with an old worker'
    if ($ArgumentList -like '--connect-file*') {
      $script:connections++
      $file = $ArgumentList.Substring('--connect-file '.Length).Trim('"')
      Assert ([IO.File]::ReadAllText($file) -eq $renewedToken) 'Wrong final connection token'
      Remove-Item -LiteralPath $file
      return [pscustomobject]@{ ExitCode = 0 }
    }
    $script:running = $true
    return
  }
  Microsoft.PowerShell.Management\Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
}
$source = Get-Content -Raw -Encoding UTF8 'apps/web/src/server/hosted/worker-connect.ps1'
$source = $source.Replace('@@TOKEN@@', $commandToken).Replace('@@ORIGIN@@', 'https://fixture.invalid').Replace('@@VERSION@@', '0.1.44').Replace('@@URL@@', 'https://fixture.invalid/worker.exe').Replace('@@SIZE@@', [string](Get-Item $LatestInstaller).Length).Replace('@@HASH@@', (Get-FileHash $LatestInstaller -Algorithm SHA256).Hash.ToLowerInvariant())
$scriptBlock = [scriptblock]::Create($source)
New-Item -ItemType Directory -Force (Split-Path $stateFile) | Out-Null
[IO.File]::WriteAllText($stateFile, (@{ installation_id = $installation } | ConvertTo-Json))
$originalState = [IO.File]::ReadAllText($stateFile)
& cmdkey.exe "/generic:com.videoforge.personal-media-worker:$installation" "/user:$installation" "/pass:$credential" | Out-Null
try {
  foreach ($wasRunning in @($true, $false)) {
    InstallOld
    $script:running = $wasRunning; $script:waitOnce = $wasRunning; $script:corrupt = $false
    $script:requests = 0; $script:downloads = 0; $script:stops = 0; $script:connections = 0; $script:idleApproved = $false
    & $scriptBlock
    Assert ((VersionNow) -eq '0.1.44' -and $script:connections -eq 1 -and $script:downloads -eq 1) 'Upgrade did not install and connect latest'
    Assert ([IO.File]::ReadAllText($stateFile) -eq $originalState) 'Upgrade changed pairing identity'
    Assert ([VideoForgeConnect.Credentials]::Get($installation) -eq $credential) 'Upgrade changed stored credential'
    Assert ($script:stops -eq [int]$wasRunning) 'Unexpected process stop'
    $script:waitOnce = $false; $script:downloads = 0; $script:connections = 0; $script:stops = 0
    & $scriptBlock
    Assert ($script:downloads -eq 0 -and $script:connections -eq 0 -and $script:stops -eq 0) 'Latest repeat did unnecessary work'
  }
  InstallOld
  $script:running = $false; $script:corrupt = $true; $script:connections = 0
  $rejected = $false
  try { & $scriptBlock } catch { $rejected = $_.Exception.Message -like '*verification*' }
  Assert ($rejected -and (VersionNow) -eq '0.1.43' -and $script:connections -eq 0) 'Partial download was executed'
  Write-Host 'PASS: native Windows old-to-latest installer, Credential Manager, running/stopped upgrade fixtures, wait renewal, pairing retention, fast repeat and partial-download rejection.'
} finally {
  & cmdkey.exe "/delete:com.videoforge.personal-media-worker:$installation" | Out-Null
}
