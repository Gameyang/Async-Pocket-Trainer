[CmdletBinding()]
param(
  [ValidateSet("SessionStart", "Stop")]
  [string]$Phase = "Stop",

  [string]$Repo = "",

  [switch]$RequireCurrentRepo
)

$ErrorActionPreference = "Stop"

function Write-HookLog {
  param([string]$Message)
  Write-Host "[codex-autopush] $Message"
}

function Normalize-Path {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return ""
  }

  return [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/')).ToLowerInvariant()
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments,

    [switch]$AllowFailure
  )

  $output = & git @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $text = $output -join [Environment]::NewLine

  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "git $($Arguments -join ' ') failed with exit code $exitCode. $text"
  }

  [pscustomobject]@{
    ExitCode = $exitCode
    Output = $text
  }
}

try {
  if ([string]::IsNullOrWhiteSpace($Repo)) {
    $Repo = (Get-Location).Path
  }

  $repoRoot = (Resolve-Path -LiteralPath $Repo).Path

  if ($RequireCurrentRepo) {
    $cwdPath = (Get-Location).Path
    $cwdRootOutput = & git -C $cwdPath rev-parse --show-toplevel 2>$null
    $cwdRootExitCode = $LASTEXITCODE
    $cwdRoot = $cwdRootOutput | Select-Object -First 1

    if ($cwdRootExitCode -ne 0 -or (Normalize-Path $cwdRoot) -ne (Normalize-Path $repoRoot)) {
      exit 0
    }
  }

  Set-Location -LiteralPath $repoRoot

  $actualRoot = Invoke-Git -Arguments @("rev-parse", "--show-toplevel") -AllowFailure
  if ($actualRoot.ExitCode -ne 0 -or (Normalize-Path $actualRoot.Output.Trim()) -ne (Normalize-Path $repoRoot)) {
    Write-HookLog "skip: not a git repository."
    exit 0
  }

  $gitDirResult = Invoke-Git -Arguments @("rev-parse", "--git-dir")
  $gitDir = $gitDirResult.Output.Trim()
  if (-not [System.IO.Path]::IsPathRooted($gitDir)) {
    $gitDir = Join-Path $repoRoot $gitDir
  }

  $stateDir = Join-Path $gitDir "codex-autopush"
  $startStatusPath = Join-Path $stateDir "start-status.txt"
  $startHeadPath = Join-Path $stateDir "start-head.txt"
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)

  if ($Phase -eq "SessionStart") {
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

    $status = Invoke-Git -Arguments @("status", "--porcelain=v1", "--untracked-files=all")
    $head = Invoke-Git -Arguments @("rev-parse", "HEAD") -AllowFailure

    [System.IO.File]::WriteAllText($startStatusPath, $status.Output, $utf8NoBom)
    [System.IO.File]::WriteAllText($startHeadPath, $head.Output.Trim(), $utf8NoBom)

    Write-HookLog "recorded session start state."
    exit 0
  }

  if (-not (Test-Path -LiteralPath $startStatusPath)) {
    Write-HookLog "skip: no session start snapshot."
    exit 0
  }

  $startStatus = [System.IO.File]::ReadAllText($startStatusPath)
  if (-not [string]::IsNullOrWhiteSpace($startStatus)) {
    Write-HookLog "skip: worktree was dirty when this Codex session started."
    exit 0
  }

  if (
    (Test-Path -LiteralPath (Join-Path $gitDir "MERGE_HEAD")) -or
    (Test-Path -LiteralPath (Join-Path $gitDir "rebase-merge")) -or
    (Test-Path -LiteralPath (Join-Path $gitDir "rebase-apply"))
  ) {
    Write-HookLog "skip: merge or rebase is in progress."
    exit 0
  }

  $currentStatus = Invoke-Git -Arguments @("status", "--porcelain=v1", "--untracked-files=all")
  if ([string]::IsNullOrWhiteSpace($currentStatus.Output)) {
    Write-HookLog "skip: no changes to commit."
    exit 0
  }

  $branch = (Invoke-Git -Arguments @("branch", "--show-current")).Output.Trim()
  if ([string]::IsNullOrWhiteSpace($branch)) {
    Write-HookLog "skip: detached HEAD."
    exit 0
  }

  $remotes = (Invoke-Git -Arguments @("remote")).Output
  if ([string]::IsNullOrWhiteSpace($remotes)) {
    Write-HookLog "skip: no git remote configured."
    exit 0
  }

  Invoke-Git -Arguments @("add", "-A") | Out-Null

  $cachedDiff = Invoke-Git -Arguments @("diff", "--cached", "--quiet") -AllowFailure
  if ($cachedDiff.ExitCode -eq 0) {
    Write-HookLog "skip: no staged changes."
    exit 0
  }

  if ($cachedDiff.ExitCode -ne 1) {
    throw "git diff --cached --quiet failed with exit code $($cachedDiff.ExitCode)."
  }

  $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss 'UTC'")
  Invoke-Git -Arguments @(
    "commit",
    "-m",
    "codex: auto commit",
    "-m",
    "Created automatically by Codex Stop hook at $timestamp."
  ) | Out-Null

  $upstream = Invoke-Git -Arguments @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") -AllowFailure
  if ($upstream.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($upstream.Output)) {
    Invoke-Git -Arguments @("push") | Out-Null
  } else {
    Invoke-Git -Arguments @("push", "-u", "origin", $branch) | Out-Null
  }

  Write-HookLog "committed and pushed changes from branch '$branch'."
} catch {
  Write-HookLog "failed: $($_.Exception.Message)"
  exit 0
}
