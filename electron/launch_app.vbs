Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' VBS dosyasi electron/ klasorunde, proje klasoru 2 ustte
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectRoot = fso.GetParentFolderName(scriptDir)

' run_silent.bat yolunu dogrula
batPath = projectRoot & "\run_silent.bat"
If Not fso.FileExists(batPath) Then
    MsgBox "HATA: run_silent.bat bulunamadi!" & vbCrLf & batPath, 16, "LLM Runner"
    WScript.Quit 1
End If

' ONEMLI: once calisma dizinini ayarla
WshShell.CurrentDirectory = projectRoot

' %comspec% ile batch'i calistir
q = Chr(34)
cmd = "%comspec% /c """ & batPath & """"
WshShell.Run cmd, 0, False
