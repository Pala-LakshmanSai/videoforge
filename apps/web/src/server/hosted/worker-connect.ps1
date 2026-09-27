$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) { throw 'This command requires 64-bit Windows.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$work = Join-Path $env:TEMP ('videoforge-connect-' + [Guid]::NewGuid().ToString('N'))
$executable = Join-Path $env:LOCALAPPDATA 'Programs\VideoForge Worker\VideoForge Worker.exe'
New-Item -ItemType Directory -Path $work | Out-Null
$acl = Get-Acl $work
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule([System.Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
Set-Acl $work $acl
# Read the same per-user Windows Credential Manager entry used by every worker release.
if (-not ('VideoForgeConnect.Credentials' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace VideoForgeConnect {
  public static class Credentials {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct Credential {
      public uint Flags, Type; public string TargetName, Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public uint BlobSize; public IntPtr Blob; public uint Persist, AttributeCount;
      public IntPtr Attributes; public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Read(string target, uint type, uint flags, out IntPtr value);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool Delete(string target, uint type, uint flags);
    public static string Get(string installation) {
      IntPtr value;
      if (!Read("com.videoforge.personal-media-worker:" + installation, 1, 0, out value)) return null;
      try { var c = (Credential)Marshal.PtrToStructure(value, typeof(Credential)); return Marshal.PtrToStringUni(c.Blob, (int)c.BlobSize / 2); }
      finally { CredFree(value); }
    }
    public static void Remove(string installation) { Delete("com.videoforge.personal-media-worker:" + installation, 1, 0); }
  }
}
'@
}
function Get-InstalledVersion {
  $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
  try {
    $key = $registry.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall\{8ED2FC8D-2D79-4EA0-9D61-C0DF2408CD45}_is1')
    if ($key) { try { return [string]$key.GetValue('DisplayVersion') } finally { $key.Dispose() } }
  } finally { $registry.Dispose() }
  return ''
}
function Get-WorkerProcesses {
  return @(Get-Process -Name 'VideoForge Worker' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable })
}
try {
  $tokenFile = Join-Path $work 'connect-token'
  [IO.File]::WriteAllText($tokenFile, '@@TOKEN@@')
  $stateFile = Join-Path $env:LOCALAPPDATA 'VideoForge Worker\installation.json'
  $installedVersion = Get-InstalledVersion
  if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json
    $credential = [VideoForgeConnect.Credentials]::Get($state.installation_id)
    if ($credential) {
      Write-Host 'Connecting this computer…'
      do {
        $body = @{ token = [IO.File]::ReadAllText($tokenFile); running = ((Get-WorkerProcesses).Count -gt 0); installed_version = $installedVersion } | ConvertTo-Json -Compress
        try {
          $prepared = Invoke-RestMethod -Method Post -Uri '@@ORIGIN@@/api/v2/media-worker/connect-prepare' -Headers @{ Authorization = ('Bearer ' + $credential) } -ContentType 'application/json' -Body $body
        } catch { throw 'Connection could not be verified. Refresh the command in Settings and try again.' }
        if ($prepared.action -eq 'CONNECTED') { Write-Host 'VideoForge Worker @@VERSION@@ is connected and Online.'; return }
        if ($prepared.action -notin @('WAIT', 'CONNECT', 'UPGRADE', 'SWITCH') -or $prepared.token -notmatch '^[a-f0-9]{64}$') { throw 'Invalid connection response.' }
        [IO.File]::WriteAllText($tokenFile, $prepared.token)
        if ($prepared.action -eq 'WAIT') { Write-Host 'Waiting for current work to finish; setup will continue automatically…'; Start-Sleep -Seconds 10 }
      } while ($prepared.action -eq 'WAIT')
      if ($prepared.action -in @('UPGRADE', 'SWITCH')) {
        # Only after the server's atomic idle check; old/revoked credentials cannot claim new work.
        Get-WorkerProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
        for ($attempt = 0; $attempt -lt 15 -and (Get-WorkerProcesses).Count -gt 0; $attempt++) { Start-Sleep -Seconds 1 }
        if ((Get-WorkerProcesses).Count -gt 0) { throw 'Windows could not stop the idle worker. Close it and paste a fresh command.' }
        if ($prepared.action -eq 'SWITCH') {
          [VideoForgeConnect.Credentials]::Remove($state.installation_id)
          Remove-Item -LiteralPath $stateFile -Force
        }
      }
    } elseif ($state.revoked -eq 'true' -and (Get-WorkerProcesses).Count -eq 0) {
      Remove-Item -LiteralPath $stateFile -Force
    }
  }
  if (-not (Test-Path -LiteralPath $executable) -or $installedVersion -ne '@@VERSION@@') {
    if ((Get-WorkerProcesses).Count -gt 0) { throw 'Cannot verify the running worker is idle. Let it finish and close it before connecting.' }
  Write-Host 'Downloading VideoForge Worker @@VERSION@@…'
  $installer = Join-Path $work 'worker.exe'
  Invoke-WebRequest -UseBasicParsing -Uri '@@URL@@' -OutFile $installer
  if ((Get-Item $installer).Length -ne @@SIZE@@ -or (Get-FileHash $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne '@@HASH@@') { throw 'Worker download failed verification. Get a fresh command and try again.' }
  $install = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-' -Wait -PassThru
  if ($install.ExitCode -ne 0) { throw 'Worker installation failed.' }
  if ((Get-InstalledVersion) -ne '@@VERSION@@' -or -not (Test-Path -LiteralPath $executable)) { throw 'Latest worker installation could not be verified.' }
  }
  $connect = Start-Process -FilePath $executable -ArgumentList ('--connect-file "' + $tokenFile + '"') -Wait -PassThru
  if ($connect.ExitCode -ne 0) { throw 'Connection failed. Get a fresh command from VideoForge Settings and try again.' }
  if ((Get-WorkerProcesses).Count -eq 0) { Start-Process -FilePath $executable -ArgumentList '--background' }
  Write-Host 'VideoForge Worker @@VERSION@@ is connected and Online. It starts at login.'
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
