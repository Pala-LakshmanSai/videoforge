[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(Mandatory = $true)]
    [string]$ReleaseManifestPath,

    [string]$PreviousInstallerPath = "",

    [string]$PreviousReleaseManifestPath = "",

    [ValidateRange(60, 1800)]
    [int]$TimeoutSeconds = 900,

    [string]$ReportPath = "",

    [switch]$RunHostedPairing,

    [switch]$KeepInstallation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$runId = [guid]::NewGuid().ToString("N")
$startedAt = [DateTime]::UtcNow
$deadline = $startedAt.AddSeconds($TimeoutSeconds)
$phases = [System.Collections.Generic.List[object]]::new()
$workerProcess = $null
$uninstallerPath = $null
$installRoot = $null
$cleanupAttempted = $false
$cleanupSucceeded = $false
$pairingWasRequested = [bool]$RunHostedPairing

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path (Get-Location) "videoforge-windows-native-acceptance-$runId.json"
}

$report = [ordered]@{
    schema_version = "videoforge-windows-native-acceptance/v1"
    status = "RUNNING"
    run_id = $runId
    started_at = $startedAt.ToString("o")
    timeout_seconds = $TimeoutSeconds
    hosted_pairing_requested = $pairingWasRequested
    credential_values_read = $false
    network_mode = if ($pairingWasRequested) { "worker_opt_in" } else { "none" }
    provider_mutation_by_harness = $false
    phases = $phases
    manual_steps = @(
        "On the target Windows x64 device, review any SmartScreen warning for this unsigned beta and record the observed choice.",
        "If pairing is requested, approve exactly one Connect this computer browser confirmation in the authenticated VideoForge session; never paste a device token into the terminal.",
        "For sleep/reconnect proof, manually suspend and resume the device and record the worker process and hosted UI state.",
        "After a paired run, use authenticated VideoForge Settings to revoke the test device; this harness never performs remote revocation."
    )
}

function Add-Phase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    $phaseStarted = [DateTime]::UtcNow
    try {
        $details = & $Action
        if ($null -eq $details) {
            $details = [ordered]@{}
        }
        $phases.Add([ordered]@{
                name = $Name
                status = "PASS"
                started_at = $phaseStarted.ToString("o")
                finished_at = [DateTime]::UtcNow.ToString("o")
                details = $details
            })
        return $details
    }
    catch {
        $phases.Add([ordered]@{
                name = $Name
                status = "FAIL"
                started_at = $phaseStarted.ToString("o")
                finished_at = [DateTime]::UtcNow.ToString("o")
                error = $_.Exception.Message
            })
        throw
    }
}

function Add-SkippedPhase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Reason
    )

    $phases.Add([ordered]@{
            name = $Name
            status = "SKIPPED"
            reason = $Reason
        })
}

function Resolve-InputFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Value -PathType Leaf)) {
        throw "$Label does not exist: $Value"
    }
    return (Resolve-Path -LiteralPath $Value).Path
}

function Assert-Sha256 {
    param(
        [AllowNull()]
        [object]$Value,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    $text = if ($null -eq $Value) { "" } else { [string]$Value }
    if ($text -notmatch '^sha256:[0-9a-fA-F]{64}$') {
        throw "$Label must be a prefixed 64-hex SHA-256"
    }
    return $text.ToLowerInvariant()
}

function Read-ReleaseManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$ExpectedVersion
    )

    $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    try {
        $manifest = $raw | ConvertFrom-Json
    }
    catch {
        throw "release manifest is not valid JSON"
    }
    if ($manifest.schema_version -ne "videoforge-media-worker-release/v1") {
        throw "release manifest schema is not videoforge-media-worker-release/v1"
    }
    if ([string]::IsNullOrWhiteSpace([string]$manifest.version) -or
        [string]$manifest.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
        throw "release manifest version is not semantic version text"
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion) -and [string]$manifest.version -ne $ExpectedVersion) {
        throw "release manifest version is $($manifest.version), expected $ExpectedVersion"
    }
    if ([int]$manifest.minimum_protocol_version -ne 1) {
        throw "release manifest minimum protocol version is not 1"
    }
    if ($null -eq $manifest.windows) {
        throw "release manifest has no Windows artifact"
    }
    if ($manifest.windows.trust -ne "UNSIGNED_BETA") {
        throw "release manifest Windows trust must be UNSIGNED_BETA"
    }
    $artifactSha256 = Assert-Sha256 $manifest.windows.sha256 "Windows artifact SHA-256"
    $executionSha256 = Assert-Sha256 $manifest.execution_bundle_sha256 "execution bundle SHA-256"
    $modelSha256 = Assert-Sha256 $manifest.whisper_model_sha256 "Whisper model SHA-256"
    $artifactSize = [int64]$manifest.windows.size_bytes
    if ($artifactSize -le 0) {
        throw "Windows artifact size must be positive"
    }

    try {
        $uri = [Uri]$manifest.windows.url
    }
    catch {
        throw "Windows artifact URL is invalid"
    }
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or
        -not [string]::IsNullOrEmpty($uri.UserInfo) -or
        -not [string]::IsNullOrEmpty($uri.Query) -or
        -not [string]::IsNullOrEmpty($uri.Fragment)) {
        throw "Windows artifact URL must be credential-free HTTPS without query or fragment"
    }
    $fileName = [IO.Path]::GetFileName($uri.AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($fileName) -or $fileName -notmatch '^VideoForge-Worker-[0-9]+\.[0-9]+\.[0-9]+-Setup\.exe$') {
        throw "Windows artifact URL does not name an immutable setup executable"
    }
    $fileVersion = [regex]::Match($fileName, '^VideoForge-Worker-(?<version>[0-9]+\.[0-9]+\.[0-9]+)-Setup\.exe$').Groups["version"].Value
    if ($fileVersion -ne [string]$manifest.version) {
        throw "Windows artifact filename version $fileVersion does not match manifest version $($manifest.version)"
    }

    return [pscustomobject]@{
        path = $Path
        manifest_sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        version = [string]$manifest.version
        artifact_name = $fileName
        artifact_sha256 = $artifactSha256
        artifact_size_bytes = $artifactSize
        execution_bundle_sha256 = $executionSha256
        whisper_model_sha256 = $modelSha256
    }
}

function Verify-Installer {
    param(
        [Parameter(Mandatory = $true)]
        [psobject]$Manifest,

        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $name = [IO.Path]::GetFileName($Path)
    if (-not $name.Equals($Manifest.artifact_name, [StringComparison]::OrdinalIgnoreCase)) {
        throw "installer filename $name does not match the immutable manifest artifact name $($Manifest.artifact_name)"
    }
    $file = Get-Item -LiteralPath $Path
    $actualSha256 = "sha256:" + (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $Manifest.artifact_sha256) {
        throw "installer SHA-256 does not match the immutable release manifest"
    }
    if ([int64]$file.Length -ne $Manifest.artifact_size_bytes) {
        throw "installer byte length does not match the immutable release manifest"
    }
    $signature = Get-AuthenticodeSignature -FilePath $Path
    if ([string]$signature.Status -ne "NotSigned") {
        throw "0.1.12 Windows artifact trust drifted: expected NotSigned, got $($signature.Status)"
    }
    return [ordered]@{
        file_name = $name
        sha256 = $actualSha256
        size_bytes = [int64]$file.Length
        authenticode_status = [string]$signature.Status
        trust = "UNSIGNED_BETA"
    }
}

function Assert-WindowsX64 {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "this acceptance runner must run on Windows"
    }
    if (-not [Environment]::Is64BitOperatingSystem) {
        throw "the target operating system must be 64-bit Windows"
    }
    $architecture = $env:PROCESSOR_ARCHITEW6432
    if ([string]::IsNullOrWhiteSpace($architecture)) {
        $architecture = $env:PROCESSOR_ARCHITECTURE
    }
    if ($architecture -notin @("AMD64", "x86_64")) {
        throw "the target device must be Windows x64; detected $architecture"
    }
    return [ordered]@{
        os = [Environment]::OSVersion.VersionString
        architecture = $architecture
        powershell = $PSVersionTable.PSVersion.ToString()
    }
}

function Get-WorkerDataRoot {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        throw "LOCALAPPDATA is unavailable"
    }
    return Join-Path $env:LOCALAPPDATA "VideoForge Worker"
}

function Get-StartupShortcutPath {
    if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
        throw "APPDATA is unavailable"
    }
    return Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\VideoForge Worker.lnk"
}

function Get-WorkerProcesses {
    return @(Get-Process -Name "VideoForge Worker" -ErrorAction SilentlyContinue)
}

function Assert-FreshUserState {
    $existingProcesses = @(Get-WorkerProcesses)
    if ($existingProcesses.Count -gt 0) {
        throw "a VideoForge Worker process is already running; use a fresh Windows user or remove it manually"
    }
    $dataRoot = Get-WorkerDataRoot
    if (Test-Path -LiteralPath $dataRoot) {
        throw "VideoForge Worker local state already exists at $dataRoot; this run requires a clean user state"
    }
    $shortcut = Get-StartupShortcutPath
    if (Test-Path -LiteralPath $shortcut) {
        throw "VideoForge Worker Startup shortcut already exists; this run requires a clean user state"
    }
    return [ordered]@{
        data_root_absent = $true
        startup_shortcut_absent = $true
        worker_processes = 0
    }
}

function Invoke-BoundedProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [string[]]$Arguments = @(),

        [string]$RedirectStandardOutput = "",

        [string]$RedirectStandardError = "",

        [switch]$Hidden
    )

    $parameters = @{
        FilePath = $Path
        ArgumentList = $Arguments
        PassThru = $true
    }
    if (-not [string]::IsNullOrWhiteSpace($RedirectStandardOutput)) {
        $parameters.RedirectStandardOutput = $RedirectStandardOutput
    }
    if (-not [string]::IsNullOrWhiteSpace($RedirectStandardError)) {
        $parameters.RedirectStandardError = $RedirectStandardError
    }
    if ($Hidden) {
        $parameters.WindowStyle = "Hidden"
    }
    $process = Start-Process @parameters
    $remainingMilliseconds = [int][Math]::Max(1, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    if (-not $process.WaitForExit($remainingMilliseconds)) {
        try {
            $process.Kill()
            [void]$process.WaitForExit(5000)
        }
        catch {
            # Preserve the bounded-timeout failure below; cleanup will retry the exact installer.
        }
        throw "process exceeded the $TimeoutSeconds-second acceptance bound: $Path"
    }
    return [int]$process.ExitCode
}

function Invoke-Installer {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $logPath = Join-Path $env:TEMP "videoforge-worker-installer-$runId.log"
    $arguments = @(
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/SP-",
        "/LOG=`"$logPath`"",
        "/DIR=`"$Root`""
    )
    $exitCode = Invoke-BoundedProcess $Path $arguments
    if ($exitCode -ne 0) {
        throw "Inno Setup returned exit code $exitCode"
    }
    $worker = Join-Path $Root "VideoForge Worker.exe"
    if (-not (Test-Path -LiteralPath $worker -PathType Leaf)) {
        throw "installed worker executable is missing"
    }
    $uninstaller = @(Get-ChildItem -LiteralPath $Root -Filter "unins*.exe" -File)
    if ($uninstaller.Count -ne 1) {
        throw "expected exactly one Inno Setup uninstaller, found $($uninstaller.Count)"
    }
    $script:uninstallerPath = $uninstaller[0].FullName
    return [ordered]@{
        installer_exit_code = $exitCode
        worker_path = $worker
        uninstaller_path = [IO.Path]::GetFileName($script:uninstallerPath)
    }
}

function Assert-StartupShortcut {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkerPath
    )

    $shortcutPath = Get-StartupShortcutPath
    if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
        throw "Windows Startup shortcut is missing"
    }
    $shell = New-Object -ComObject WScript.Shell
    try {
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $targetPath = [IO.Path]::GetFullPath([string]$shortcut.TargetPath)
        $arguments = ([string]$shortcut.Arguments).Trim()
        $workingDirectory = [IO.Path]::GetFullPath([string]$shortcut.WorkingDirectory)
    }
    finally {
        if ($null -ne $shell) {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
        }
    }
    if (-not $targetPath.Equals([IO.Path]::GetFullPath($WorkerPath), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Windows Startup shortcut targets an unexpected worker executable"
    }
    if ($arguments -ne "--background") {
        throw "Windows Startup shortcut must launch the worker with --background"
    }
    if (-not $workingDirectory.Equals([IO.Path]::GetFullPath((Split-Path -Parent $WorkerPath)), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Windows Startup shortcut has an unexpected working directory"
    }
    return [ordered]@{
        shortcut = [IO.Path]::GetFileName($shortcutPath)
        target = [IO.Path]::GetFileName($WorkerPath)
        arguments = $arguments
    }
}

function Start-Worker {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [string[]]$Arguments = @()
    )

    $process = Start-Process -FilePath $Path -ArgumentList $Arguments -PassThru
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) {
        throw "worker exited before the bounded lifecycle check (exit code $($process.ExitCode))"
    }
    return $process
}

function Stop-Worker {
    param(
        [AllowNull()]
        [System.Diagnostics.Process]$Process
    )

    if ($null -eq $Process) {
        return
    }
    try {
        if (-not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction Stop
            [void]$Process.WaitForExit(10000)
        }
    }
    catch [System.Management.Automation.ItemNotFoundException] {
        # The worker already exited during an expected update handoff.
    }
}

function Test-WorkerCredential {
    $statePath = Join-Path (Get-WorkerDataRoot) "installation.json"
    if (-not (Test-Path -LiteralPath $statePath -PathType Leaf)) {
        return $false
    }
    try {
        $state = [IO.File]::ReadAllText($statePath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $installationId = [string]$state.installation_id
    }
    catch {
        return $false
    }
    if ($installationId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') {
        return $false
    }
    $target = "com.videoforge.personal-media-worker:$installationId"
    $probeOutput = Join-Path $env:TEMP "videoforge-worker-credential-probe-$runId.txt"
    $probeError = "$probeOutput.err"
    try {
        $exitCode = Invoke-BoundedProcess `
            -Path "$env:SystemRoot\System32\cmdkey.exe" `
            -Arguments @("/list:$target") `
            -RedirectStandardOutput $probeOutput `
            -RedirectStandardError $probeError `
            -Hidden
        if ($exitCode -ne 0) {
            return $false
        }
        $listedCredential = [IO.File]::ReadAllText($probeOutput)
        return $listedCredential -notmatch '(?m)^\s*\*\s+NONE\s+\*\s*$'
    }
    finally {
        Remove-Item -LiteralPath $probeOutput, $probeError -Force -ErrorAction SilentlyContinue
    }
}

function Wait-ForPairing {
    param(
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$Process
    )

    while ([DateTime]::UtcNow -lt $script:deadline) {
        if (Test-WorkerCredential) {
            return [ordered]@{
                paired = $true
                credential_value_read = $false
            }
        }
        if ($Process.HasExited) {
            throw "worker exited before the browser pairing was approved (exit code $($Process.ExitCode))"
        }
        Start-Sleep -Seconds 2
    }
    throw "browser pairing did not complete within the bounded timeout"
}

function Invoke-Uninstaller {
    if ([string]::IsNullOrWhiteSpace($script:uninstallerPath) -or
        -not (Test-Path -LiteralPath $script:uninstallerPath -PathType Leaf)) {
        return $false
    }
    $exitCode = Invoke-BoundedProcess $script:uninstallerPath @(
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART"
    )
    if ($exitCode -ne 0) {
        throw "Inno Setup uninstaller returned exit code $exitCode"
    }
    return $true
}

function Assert-Removed {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $dataRoot = Get-WorkerDataRoot
    $shortcut = Get-StartupShortcutPath
    if (Test-Path -LiteralPath $Root) {
        $remainingInstallItems = @(Get-ChildItem -LiteralPath $Root -Force)
        if ($remainingInstallItems.Count -gt 0) {
            throw "isolated install root contains files after uninstall"
        }
        Remove-Item -LiteralPath $Root -Force
        if (Test-Path -LiteralPath $Root) {
            throw "empty isolated install root remains after cleanup"
        }
    }
    if (Test-Path -LiteralPath $shortcut) {
        throw "Windows Startup shortcut remains after uninstall"
    }
    if (Test-Path -LiteralPath $dataRoot) {
        throw "worker local state remains after uninstall"
    }
    if (Test-WorkerCredential) {
        throw "worker credential remains after uninstall"
    }
    return [ordered]@{
        install_root_absent = $true
        startup_shortcut_absent = $true
        data_root_absent = $true
        credential_absent = $true
    }
}

function Write-Report {
    $report.finished_at = [DateTime]::UtcNow.ToString("o")
    $parent = Split-Path -Parent $ReportPath
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}

try {
    Add-Phase "environment" {
        Assert-WindowsX64
    } | Out-Null

    $currentInstaller = Resolve-InputFile $InstallerPath "Windows installer"
    $currentManifestPath = Resolve-InputFile $ReleaseManifestPath "Windows release manifest"
    $currentManifest = $null
    Add-Phase "immutable-release-inputs" {
        $script:currentManifest = Read-ReleaseManifest $currentManifestPath "0.1.12"
        $artifact = Verify-Installer $script:currentManifest $currentInstaller
        [ordered]@{
            version = $script:currentManifest.version
            manifest_sha256 = $script:currentManifest.manifest_sha256
            artifact = $artifact
            execution_bundle_sha256 = $script:currentManifest.execution_bundle_sha256
            whisper_model_sha256 = $script:currentManifest.whisper_model_sha256
        }
    } | Out-Null

    $hasPrevious = -not [string]::IsNullOrWhiteSpace($PreviousInstallerPath) -or
        -not [string]::IsNullOrWhiteSpace($PreviousReleaseManifestPath)
    if ($hasPrevious -and
        ([string]::IsNullOrWhiteSpace($PreviousInstallerPath) -or
        [string]::IsNullOrWhiteSpace($PreviousReleaseManifestPath))) {
        throw "previous installer and previous release manifest must be supplied together"
    }

    $previousInstaller = $null
    $previousManifest = $null
    if ($hasPrevious) {
        $previousInstaller = Resolve-InputFile $PreviousInstallerPath "previous Windows installer"
        $previousManifestPath = Resolve-InputFile $PreviousReleaseManifestPath "previous Windows release manifest"
        Add-Phase "previous-release-inputs" {
            $script:previousManifest = Read-ReleaseManifest $previousManifestPath ""
            if ([version]$script:previousManifest.version -ge [version]$script:currentManifest.version) {
                throw "previous release must have a lower version than 0.1.12"
            }
            $artifact = Verify-Installer $script:previousManifest $previousInstaller
            [ordered]@{
                version = $script:previousManifest.version
                manifest_sha256 = $script:previousManifest.manifest_sha256
                artifact = $artifact
            }
        } | Out-Null
    }

    Add-Phase "fresh-user-state" {
        Assert-FreshUserState
    } | Out-Null

    $installRoot = Join-Path $env:TEMP "VideoForge-Worker-NativeAcceptance-$runId"
    New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

    if ($hasPrevious) {
        Add-Phase "install-previous-release" {
            Invoke-Installer $previousInstaller $installRoot
            $workerPath = Join-Path $installRoot "VideoForge Worker.exe"
            $script:previousInstalledWorkerSha256 = (Get-FileHash -LiteralPath $workerPath -Algorithm SHA256).Hash.ToLowerInvariant()
            Assert-StartupShortcut $workerPath
        } | Out-Null
    }
    else {
        Add-Phase "clean-install-0.1.12" {
            Invoke-Installer $currentInstaller $installRoot
            $workerPath = Join-Path $installRoot "VideoForge Worker.exe"
            Assert-StartupShortcut $workerPath
        } | Out-Null
    }

    if ($RunHostedPairing) {
        $pairingWorkerPath = Join-Path $installRoot "VideoForge Worker.exe"
        Add-Phase "browser-pairing" {
            $script:workerProcess = Start-Worker $pairingWorkerPath
            Write-Host "Complete exactly one 'Connect this computer' confirmation in the authenticated browser window." -ForegroundColor Yellow
            Wait-ForPairing $script:workerProcess
        } | Out-Null
        Stop-Worker $workerProcess
        $workerProcess = $null
    }
    else {
        Add-SkippedPhase "browser-pairing" "RunHostedPairing was not supplied; no network or provider request was started."
    }

    if ($hasPrevious) {
        Add-Phase "replace-with-0.1.12" {
            $workerPath = Join-Path $installRoot "VideoForge Worker.exe"
            Invoke-Installer $currentInstaller $installRoot
            $currentInstalledWorkerSha256 = (Get-FileHash -LiteralPath $workerPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($currentInstalledWorkerSha256 -eq $script:previousInstalledWorkerSha256) {
                throw "0.1.12 installer did not replace the previous worker executable"
            }
            Assert-StartupShortcut $workerPath
            [ordered]@{
                previous_executable_sha256 = "sha256:$($script:previousInstalledWorkerSha256)"
                current_executable_sha256 = "sha256:$currentInstalledWorkerSha256"
                startup_shortcut_preserved = $true
            }
        } | Out-Null
    }

    if ($RunHostedPairing) {
        Add-Phase "background-restart" {
            $workerPath = Join-Path $installRoot "VideoForge Worker.exe"
            $script:workerProcess = Start-Worker $workerPath @("--background")
            [ordered]@{
                process_started = $true
                background_argument = "--background"
            }
        } | Out-Null
        Stop-Worker $workerProcess
        $workerProcess = $null
    }
    else {
        Add-SkippedPhase "background-restart" "Worker execution requires the explicit hosted pairing opt-in."
    }

    Add-Phase "uninstall-and-local-cleanup" {
        Stop-Worker $workerProcess
        $workerProcess = $null
        Invoke-Uninstaller | Out-Null
        Start-Sleep -Milliseconds 500
        Assert-Removed $installRoot
    } | Out-Null

    $report.status = "PASS"
}
catch {
    $report.status = "FAIL"
    $report.error = $_.Exception.Message
    Write-Error $_.Exception.Message
}
finally {
    Stop-Worker $workerProcess
    if (-not $KeepInstallation -and -not $cleanupAttempted -and $null -ne $installRoot) {
        $cleanupAttempted = $true
        try {
            if ($null -ne $uninstallerPath -and (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
                Invoke-Uninstaller | Out-Null
            }
            $cleanupSucceeded = -not (Test-Path -LiteralPath $installRoot)
        }
        catch {
            $cleanupSucceeded = $false
            $report.cleanup_error = $_.Exception.Message
        }
    }
    elseif ($KeepInstallation) {
        $report.keep_installation = $true
    }
    $report.cleanup_attempted = $cleanupAttempted
    $report.cleanup_succeeded = $cleanupSucceeded
    try {
        Write-Report
        Write-Host "Acceptance report: $ReportPath"
    }
    catch {
        Write-Error "could not write acceptance report: $($_.Exception.Message)"
        if ($report.status -eq "PASS") {
            $report.status = "FAIL"
        }
    }
}

if ($report.status -eq "PASS") {
    exit 0
}
exit 1
