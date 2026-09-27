$raw = [Console]::In.ReadToEnd()
Write-Output "RAWLEN=$($raw.Length)"
Write-Output "RAW=[$raw]"
try {
    $d = $raw | ConvertFrom-Json
    Write-Output "TYPE=$($d.stop_hook_active.GetType().Name)"
    Write-Output "VAL=$($d.stop_hook_active)"
    if ($d.stop_hook_active) { Write-Output "TRUTHY" } else { Write-Output "FALSY" }
} catch {
    Write-Output "ERR=$_"
}
