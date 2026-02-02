# Safety / Non-destructive defaults

- This tool **does not apply code changes** by default.
- Output is written to report files under the tool folder (or a chosen output folder), not into target repos.
- Any future "apply" capability must be:
  1) explicitly invoked, and
  2) operate on a patch file, and
  3) require confirmation.
