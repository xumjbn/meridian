; NSIS installer hooks for wjw.
;
; Why this file exists:
;   Tauri's NSIS template only shuts down the main executable (wjw-desktop.exe).
;   Our Go backend runs as a sidecar process (wjw-backend.exe). The app kills it
;   from WindowEvent::Destroyed, but the installer terminates wjw-desktop.exe
;   outright, so that event never fires and the sidecar is orphaned. The orphan
;   keeps an open handle on wjw-backend.exe, so the installer cannot overwrite it:
;   in GUI mode NSIS raises "Error opening file for writing" (the install failure
;   users reported), and in silent mode it skips the file and still exits 0 --
;   leaving a new frontend running against a stale backend.
;
;   Reproduced 2026-07-28: with the sidecar running, an overwrite install left
;   wjw-backend.exe at the previous day's build; with it stopped, the same
;   installer updated the file correctly.
;
; So: stop the sidecar before touching files, on both install and uninstall.

!macro wjwKillSidecar
  DetailPrint "Stopping wjw backend service..."
  nsExec::Exec 'cmd.exe /c taskkill /F /T /IM wjw-backend.exe'
  Pop $0
  ; Also kill the pre-rename sidecar name. Upgrading from a build that shipped
  ; lynx-backend.exe leaves that process running and holding files in the install
  ; directory -- exactly the overwrite failure this hook exists to prevent.
  ; Keep this line even after the rename settles; a stale name costs nothing.
  nsExec::Exec 'cmd.exe /c taskkill /F /T /IM lynx-backend.exe'
  Pop $0

  ; The MAIN binary was renamed too: meridian-desktop.exe -> lynx-desktop.exe ->
  ; wjw-desktop.exe. Tauri's own "is the app running?" check only knows the
  ; CURRENT name, so when a user is running the old build the installer neither
  ; warns them nor manages to replace the locked files.
  ;
  ; Observed on this machine 2026-07-30: install dir was AppData\Local\wjw but
  ; still held lynx-desktop.exe / lynx-backend.exe from the 1.0.0 build, and the
  ; Start Menu shortcut still pointed at lynx-desktop.exe -- so every launch ran
  ; the OLD app (console-subsystem sidecar => the cmd window; stale identifier =>
  ; "backend exited"), and upgrade installs failed because that old process held
  ; the files. Killing only the sidecar was not enough.
  nsExec::Exec 'cmd.exe /c taskkill /F /T /IM lynx-desktop.exe'
  Pop $0
  nsExec::Exec 'cmd.exe /c taskkill /F /T /IM meridian-desktop.exe'
  Pop $0
  ; Give Windows a moment to release the file handles before we copy over them.
  Sleep 800
!macroend

; Pre-rename leftovers must be deleted, not just stopped. Tauri's uninstaller
; only knows the file list of the build that produced it, so binaries carrying an
; older name survive every upgrade and sit in the install dir forever. A stale
; lynx-desktop.exe is worse than clutter: any old shortcut still pointing at it
; silently launches the previous version.
!macro wjwRemoveLegacyBinaries
  Delete "$INSTDIR\lynx-desktop.exe"
  Delete "$INSTDIR\lynx-backend.exe"
  Delete "$INSTDIR\meridian-desktop.exe"
  Delete "$INSTDIR\meridian-backend.exe"
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro wjwKillSidecar
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro wjwRemoveLegacyBinaries
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro wjwKillSidecar
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro wjwRemoveLegacyBinaries
!macroend
