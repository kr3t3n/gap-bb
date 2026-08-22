# gap-bb

Public GitHub fork of [get-bb/bb](https://github.com/get-bb/bb). Product name in this checkout: **gap-bb**.

## Remotes

| Remote | URL | Role |
| --- | --- | --- |
| `origin` | `https://github.com/kr3t3n/gap-bb.git` | Public fork (`kr3t3n/gap-bb`) |
| `upstream` | `https://github.com/get-bb/bb.git` | Upstream bb; fetch only |

Keep package and CLI names as `bb` / `bb-app` so upstream merges stay clean. Brand as gap-bb in docs and companion apps only until a deliberate rename.

## Branch model

- `upstream/main` is the pristine base.
- `gap` is the gap-bb overlay. Keep all gap-bb changes on this branch.
- `origin/main` is frozen. It contains two historical `GAP.md` commits.

The approved architecture proposed resetting `origin/main` to `upstream/main`. This repository does not rewrite shared history, so Slice 0 preserves and freezes `origin/main`. Use `upstream/main..gap` to inspect the overlay until an owner explicitly approves a separate branch migration.

## Weekly sync

```bash
git fetch upstream
git switch gap
git rebase upstream/main
pnpm install
pnpm exec turbo run typecheck test lint
git push --force-with-lease origin gap
```

Never push to `upstream`. Never force-push `origin/main`.

## Production profile

Source the committed `.env.gap-bb` profile before starting a production instance:

```bash
set -a
source .env.gap-bb
set +a
npx bb-app@latest
```

This profile uses `~/.gap-bb`, ports `38986` and `38987`, and disables upstream telemetry. It contains no secrets.

Development worktrees already use hash-derived data directories and ports. Run `pnpm dev` without this production profile.

## GitHub Actions

GitHub Actions are disabled for this public fork. Upstream workflows require unavailable runners and deployment secrets. Run validation locally.

## Companion apps

Use the maintained Expo client in `apps/mobile`. Do not extend the standalone `kr3t3n/gap-bb-ios` API reimplementation.

## Local layout

- Checkout: `~/Developer/gap-bb`
- Mobile app: `apps/mobile`
