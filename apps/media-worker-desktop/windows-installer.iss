#define WorkerVersion "0.1.7"
#define WorkerExe "VideoForge Worker.exe"

[Setup]
AppId={{8ED2FC8D-2D79-4EA0-9D61-C0DF2408CD45}
AppName=VideoForge Worker
AppVersion={#WorkerVersion}
DefaultDirName={localappdata}\Programs\VideoForge Worker
DisableProgramGroupPage=yes
OutputBaseFilename=VideoForge-Worker-{#WorkerVersion}-Setup
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
CloseApplications=yes
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\{#WorkerExe}

[Files]
Source: "..\..\dist\{#WorkerExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userstartup}\VideoForge Worker"; Filename: "{app}\{#WorkerExe}"; Parameters: "--background"; WorkingDir: "{app}"
Name: "{userprograms}\VideoForge Worker"; Filename: "{app}\{#WorkerExe}"; WorkingDir: "{app}"

[Run]
Filename: "{app}\{#WorkerExe}"; Description: "Connect this computer to VideoForge"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM ""{#WorkerExe}"" /T /F"; Flags: runhidden waituntilterminated; RunOnceId: "StopWorker"
Filename: "{app}\{#WorkerExe}"; Parameters: "--uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveLocalState"; Check: FileExists(ExpandConstant('{app}\{#WorkerExe}'))
