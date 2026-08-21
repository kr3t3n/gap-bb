# Thread Organizer example

Thread Organizer is the reference consumer for plugin-owned thread workflows.
It demonstrates the experimental section-icon, section-action, and runtime
skill-slot APIs introduced by the lower layers of this PR stack.

This example intentionally declares `engines.bbPluginSdk >=0.4.11`, the first
planned SDK release that can contain all three capabilities. It consumes the
workspace SDK directly and does not vendor or relabel the released 0.4.10
package.

## Behavior

- Running threads appear in their remembered workflow stage.
- Idle unread threads appear in Inbox.
- Reading an idle thread restores its remembered stage.
- A user move or `bb organizer phase <stage-key>` changes the remembered stage.
- Inbox keeps that system behavior even when its visible title or icon changes.
- Inbox starts expanded. Other configured sections start collapsed until the
  user changes their collapse state.
- Reordering a non-Inbox stage in the native sidebar saves the same workflow
  order used by plugin settings and future agent instructions.
- Every native section header gets a direct Full Screen Section action whose
  pressed state stays visible until the user exits it.

The plugin does not classify prompts, titles, history, or quoted text. Its
bundled skill tells agents to move their own thread only when the work clearly
matches a user-configured stage rule.

## Configure

Open Thread Organizer under Extensions → Plugins. Users can rename and re-icon
Inbox while retaining its protected unread routing, and can add, remove,
reorder, rename, re-icon, and describe every other workflow stage.

The defaults are Planning, Spec Review, Building, Testing / Deploy, Handoff,
and On Hold. Whenever an agent session starts or resumes, the plugin fills the
bundled skill's predefined workflow slot from the latest saved configuration.

## Run from this repository

```bash
pnpm exec turbo run typecheck --filter=bb-plugin-thread-organizer-example
pnpm exec turbo run test --filter=bb-plugin-thread-organizer-example
bb plugin install "path:$PWD/examples/plugins/thread-organizer" --yes
```
