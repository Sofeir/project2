param()

$ErrorActionPreference = 'Stop'

try {
    $stdinRaw = [Console]::In.ReadToEnd()
    $data = $null
    if ($stdinRaw) {
        try { $data = $stdinRaw | ConvertFrom-Json } catch { $data = $null }
    }

    if ($data -and $data.stop_hook_active) {
        exit 0
    }

    $repoRoot = git rev-parse --show-toplevel 2>$null
    if (-not $repoRoot) {
        exit 0
    }

    Set-Location $repoRoot

    $statusOutput = git status --porcelain
    if (-not $statusOutput) {
        exit 0
    }

    git add -A
    if (-not $?) { exit 1 }

    $commitMessage = "auto: session changes $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    git commit -m $commitMessage
    if (-not $?) { exit 1 }

    git push origin main
    if (-not $?) { exit 1 }

    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
