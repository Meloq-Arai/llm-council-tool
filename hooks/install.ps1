param(
  [Parameter(Mandatory=$true)][string]$Repo,
  [string]$Tool = "C:\CORE\Projects\Code\Tools\LLM_Council_Tool",
  [ValidateSet('pre-commit','pre-push')][string]$Hook = 'pre-commit'
)

# Installs a git hook that runs a LOCAL council review on staged changes.
# Safety:
# - does not modify repo content
# - does not block commits by default (hook always exits 0)

$hooksDir = Join-Path $Repo ".git\hooks"
if (!(Test-Path $hooksDir)) {
  throw "No .git/hooks found at $hooksDir (is this a git repo?)"
}

$hookPath = Join-Path $hooksDir $Hook

$script = @"
#!/bin/sh
# LLM Council Tool hook ($Hook)
# NOTE: This hook is non-blocking; it always exits 0.

TOOL=\"$Tool\"

cd \"$Tool\" || exit 0

if [ -z \"$OPENAI_API_KEY\" ]; then
  echo \"[LLM Council] OPENAI_API_KEY not set; skipping\" 1>&2
  exit 0
fi

npm run build >/dev/null 2>&1 || true

node dist/cli/council.js --repo \"$Repo\" --base origin/main --head HEAD --out \"$Tool/out\" >/dev/null 2>&1 || true

echo \"[LLM Council] Review written to $Tool/out\" 1>&2
exit 0
"@

Set-Content -Path $hookPath -Value $script -NoNewline

# Make executable-ish (Windows Git honors it; also write .cmd wrapper for convenience)
$cmdPath = "$hookPath.cmd"
$cmd = "@echo off\r\n" +
       "set TOOL=$Tool\r\n" +
       "cd /d %TOOL%\r\n" +
       "if \"%OPENAI_API_KEY%\"==\"\" exit /b 0\r\n" +
       "npm run build >nul 2>nul\r\n" +
       "node dist\\cli\\council.js --repo \"$Repo\" --base origin/main --head HEAD --out \"$Tool\\out\" >nul 2>nul\r\n" +
       "exit /b 0\r\n"
Set-Content -Path $cmdPath -Value $cmd -NoNewline

Write-Host "Installed $Hook hook at: $hookPath" -ForegroundColor Green
Write-Host "(Non-blocking; uses OPENAI_API_KEY env var)"
