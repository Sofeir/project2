param()

# Автокоммит и push в main после каждого ответа Claude.
#
# Репозитории берём двумя путями и обходим оба (без повторов):
#  1. корень проекта, в котором лежит сам скрипт ($PSScriptRoot): Windows
#     PowerShell 5.1 портит кириллицу в выводе git ("Рабочий стол"), поэтому
#     путь считаем от скрипта, а не спрашиваем у git;
#  2. рабочая папка сессии из stdin хука (`cwd`). Хук берётся из проекта, где
#     сессию открыли, а правки могут идти в соседнем репозитории (сессия из
#     kassa project правит website) — без этого пункта они не коммитились.
# Журнал: %TEMP%\claude-auto-push.log

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'claude-auto-push.log'

function Write-Log($text) {
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $text"
}

function Find-RepoRoot($path) {
    if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $null }
    $dir = (Resolve-Path -LiteralPath $path).Path
    while ($dir) {
        if (Test-Path -LiteralPath (Join-Path $dir '.git')) { return $dir }
        $dir = Split-Path -Parent $dir
    }
    return $null
}

function Publish-Repo($root) {
    Set-Location -LiteralPath $root
    if (-not (git status --porcelain)) {
        Write-Log "clean: $root"
        return
    }

    # In repos with the auto-merge workflow never commit straight to main: use a fresh branch,
    # the workflow checks it and merges it into main by itself.
    $current = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($current -eq 'main' -and (Test-Path -LiteralPath (Join-Path $root '.github\workflows\auto-merge.yml'))) {
        $newBranch = "auto/session-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        git checkout -b $newBranch
        if ($LASTEXITCODE -ne 0) { throw "git checkout -b failed in $root" }
        Write-Log "main protected, new branch: $newBranch in $root"
    }

    git add -A
    if ($LASTEXITCODE -ne 0) { throw "git add failed in $root" }

    git commit -m "auto: session changes $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    if ($LASTEXITCODE -ne 0) { throw "git commit failed in $root" }

    # Пушим текущую ветку, а не жёстко main: работа может идти в feature-ветке (правило проекта: в main только через PR).
    $branch = (git rev-parse --abbrev-ref HEAD).Trim()
    if (-not $branch -or $branch -eq 'HEAD') { throw "detached HEAD in $root, push skipped" }
    git push -u origin $branch
    if ($LASTEXITCODE -ne 0) { throw "git push failed in $root" }
    Write-Log "pushed: $root"
}

try {
    $stdinRaw = [Console]::In.ReadToEnd()
    $data = $null
    if ($stdinRaw) {
        try { $data = $stdinRaw | ConvertFrom-Json } catch { $data = $null }
    }

    if ($data -and $data.stop_hook_active) {
        exit 0
    }

    $roots = @()
    # Третий путь: отдельный клон сайта, куда сессия из kassa project тоже вносит правки.
    foreach ($candidate in @((Join-Path $PSScriptRoot '..\..'), $data.cwd, 'C:\projects\website-for-semen')) {
        $root = Find-RepoRoot $candidate
        if ($root -and ($roots -notcontains $root)) { $roots += $root }
    }
    Write-Log "start: $($roots -join ' | ') (cwd=$($data.cwd))"

    $failed = $false
    foreach ($root in $roots) {
        try { Publish-Repo $root }
        catch {
            $failed = $true
            Write-Log "ERROR: $($_.Exception.Message)"
            [Console]::Error.WriteLine($_.Exception.Message)
        }
    }
    if ($failed) { exit 1 }
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
