; Original DSH Remote installer definition. MIT licensed; see ../LICENSE.
#ifndef AppVersion
  #error AppVersion must be supplied by the build script
#endif
#ifndef AppSource
  #error AppSource must be supplied by the build script
#endif
#ifndef AppOutput
  #error AppOutput must be supplied by the build script
#endif

[Setup]
AppId=org.dsh.appserver.client
AppName=DSH Remote
AppVersion={#AppVersion}
AppPublisher=DSH App Server contributors
AppPublisherURL=https://github.com/lisp19/dsh-app-server
AppSupportURL=https://github.com/lisp19/dsh-app-server/issues
DefaultDirName={localappdata}\Programs\DSH Remote
DefaultGroupName=DSH Remote
AllowNoIcons=yes
DisableProgramGroupPage=yes
DisableDirPage=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
UninstallDisplayIcon={app}\DSH Remote.exe
OutputDir={#AppOutput}
OutputBaseFilename=dsh-remote-{#AppVersion}-win-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UsePreviousTasks=yes

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\DSH Remote"; Filename: "{app}\DSH Remote.exe"; AppUserModelID: "org.dsh.appserver.client"
Name: "{autodesktop}\DSH Remote"; Filename: "{app}\DSH Remote.exe"; Tasks: desktopicon; AppUserModelID: "org.dsh.appserver.client"

[Run]
Filename: "{app}\DSH Remote.exe"; Description: "Launch DSH Remote"; Flags: nowait postinstall skipifsilent
