; NSIS installer hooks for wjw.
;
; Why this file exists:
;   Tauri's NSIS template only shuts down the main executable (lynx-desktop.exe).
;   Our Go backend runs as a sidecar process (lynx-backend.exe). The app kills it
;   from WindowEvent::Destroyed, but the installer terminates lynx-desktop.exe
;   outright, so that event never fires and the sidecar is orphaned. The orphan
;   keeps an open handle on lynx-backend.exe, so the installer cannot overwrite it:
;   in GUI mode NSIS raises "Error opening file for writing" (the install failure
;   users reported), and in silent mode it skips the file and still exits 0 --
;   leaving a new frontend running against a stale backend.
;
;   Reproduced 2026-07-28: with the sidecar running, an overwrite install left
;   lynx-backend.exe at the previous day's build; with it stopped, the same
;   installer updated the file correctly.
;
; So: stop the sidecar before touching files, on both install and uninstall.

!macro LynxKillSidecar
  DetailPrint "Stopping wjw backend service..."
  nsExec::Exec 'cmd.exe /c taskkill /F /T /IM lynx-backend.exe'
  Pop $0
  ; Give Windows a moment to release the file handle before we copy over it.
  Sleep 500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro LynxKillSidecar
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro LynxKillSidecar
!macroend
