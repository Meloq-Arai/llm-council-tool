# Phase 4 — Advanced (safe, opt-in)

## Git hooks (optional)

A helper script exists to install a non-blocking git hook that runs a council review and writes results to the tool's `out/` folder.

Install (PowerShell):
```powershell
# Example:
# .\hooks\install.ps1 -Repo "C:\path\to\repo"

powershell -ExecutionPolicy Bypass -File .\hooks\install.ps1 -Repo "C:\path\to\repo" -Hook pre-commit
```

Safety:
- Hook always exits 0 (won't block your commit)
- Does nothing if `OPENAI_API_KEY` is not set
- Does not modify repo content

## VS Code extension / fine-tune
Out of scope for now; documented in `docs/ROADMAP.md`.
