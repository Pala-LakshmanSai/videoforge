$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'This command requires 64-bit Windows.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$work = Join-Path $env:TEMP ('videoforge-connect-' + [Guid]::NewGuid().ToString('N'))
$executable = Join-Path $env:LOCALAPPDATA 'Programs\VideoForge Worker\VideoForge Worker.exe'
New-Item -ItemType Directory -Path $work | Out-Null
$acl = Get-Acl $work
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl $work $acl
try {
  $tokenFile = Join-Path $work 'connect-token'
  [IO.File]::WriteAllText($tokenFile, '@@TOKEN@@')
  $running = @(Get-Process -Name 'VideoForge Worker' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    if (-not (Test-Path -LiteralPath $executable)) { throw 'A worker is running from another location. Let current work finish and close it before connecting.' }
    Write-Host 'Checking the running VideoForge Worker…'
    $connect = Start-Process -FilePath $executable -ArgumentList ('--connect-file "' + $tokenFile + '"') -Wait -PassThru
    if ($connect.ExitCode -ne 0) { throw 'Connection was not changed. Check the account in Settings and copy a fresh command. If an update is required, let current work finish and reopen the worker.' }
    Write-Host 'Connected. Your existing worker is running; current work was preserved.'
    return
  }
  Write-Host 'Downloading VideoForge Worker @@VERSION@@…'
  $installer = Join-Path $work 'worker.exe'
  Invoke-WebRequest -UseBasicParsing -Uri '@@URL@@' -OutFile $installer
  if ((Get-Item $installer).Length -ne @@SIZE@@ -or (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne '@@HASH@@') { throw 'Worker download failed verification. Get a fresh command and try again.' }
  $install = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-' -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw 'Worker installation failed.' }
  $connect = Start-Process -FilePath $executable -ArgumentList ('--connect-file "' + $tokenFile + '"') -Wait -PassThru
  if ($connect.ExitCode -ne 0) { throw 'Connection failed. Get a fresh command from VideoForge Settings and try again.' }
  Start-Process -FilePath $executable -ArgumentList '--background'
  Write-Host 'Connected. VideoForge Worker starts at login and runs in the background.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
