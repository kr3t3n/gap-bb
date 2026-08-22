---
name: gap-bb-sync
description: Synchronize the gap-bb overlay with get-bb/bb. Use for weekly upstream syncs, rebasing the gap branch, or checking the permanent fork diff.
---

# Sync gap-bb

Keep gap-bb as a small overlay on `upstream/main`.

## Before syncing

1. Run `git status --short --branch`.
2. Stop if the worktree has changes that the user did not authorize you to move.
3. Confirm that `upstream` points to `https://github.com/get-bb/bb.git`.
4. Confirm that `origin` points to `https://github.com/kr3t3n/gap-bb.git`.

## Sync

Run:

```bash
git fetch upstream
git switch gap
git rebase upstream/main
pnpm install
pnpm exec turbo run typecheck test lint
git push --force-with-lease origin gap
```

Use Turbo for builds, typechecks, and tests. Save slow test output to a file.

## Safety

- Treat `upstream/main` as read-only.
- Do not push or force-push `origin/main`.
- Use only `--force-with-lease` when a rebase requires updating `origin/gap`.
- Do not change package names, the `bb` CLI name, protocol versions, database migrations, or plugin contracts during a sync.
- Inspect `git diff --stat upstream/main...gap` after the rebase. Investigate growth beyond ten files.

## Report

Report the old and new upstream commits, the overlay file count, validation commands, push result, and unresolved conflicts.
