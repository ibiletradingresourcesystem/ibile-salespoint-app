; Ibile POS installer additions (electron-builder nsis.include)
;
; The local database (mongod.exe) needs the Microsoft Visual C++ 2015-2022 Redistributable (x64).
; Windows does not always have it, so the bundled Microsoft installer is run when the runtime is
; missing or older than the bundled one. Microsoft's installer asks Windows for permission itself.

!macro customInstall
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  Push $R7

  StrCpy $R7 "$INSTDIR\resources\redist\vc_redist.x64.exe"
  IfFileExists "$R7" 0 ibile_vcredist_done

  ; Installed runtime (Microsoft's documented registry entry)
  ClearErrors
  ReadRegDWORD $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $R1 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Minor"
  ReadRegDWORD $R2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"

  ; Bundled runtime version, e.g. 14.44.35211.0 -> minor 44, build 35211
  GetDLLVersion "$R7" $R3 $R4
  IntOp $R5 $R3 & 0xFFFF
  IntOp $R6 $R4 >> 16
  IntOp $R6 $R6 & 0xFFFF

  StrCmp $R0 "1" 0 ibile_vcredist_install
  IntCmp $R1 $R5 0 ibile_vcredist_install ibile_vcredist_done
  IntCmp $R2 $R6 ibile_vcredist_done ibile_vcredist_install ibile_vcredist_done

  ibile_vcredist_install:
    DetailPrint "Installing Microsoft Visual C++ Runtime (x64)..."
    ExecWait '"$R7" /install /quiet /norestart' $R0
    ; 0 installed, 3010 installed (restart pending), 1638 newer version already installed
    DetailPrint "Microsoft Visual C++ Runtime installer finished (code $R0)"

  ibile_vcredist_done:
  Pop $R7
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
