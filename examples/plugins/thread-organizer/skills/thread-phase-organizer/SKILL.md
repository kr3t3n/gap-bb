---
name: thread-phase-organizer
description: Keep the current root bb thread in the configured workflow stage matching its present work. Use when an agent starts work or clearly changes its primary kind of work.
---

# Thread Phase Organizer

Keep this root thread in the workflow stage matching the work you are doing.
Thread Organizer fills the generated workflow below from the user’s current
saved settings whenever this agent session starts or resumes.

## Current workflow

<!-- bb:skill-slot workflow:start -->

**Inbox** is the protected Inbox section. Idle unread threads go there automatically. This routing behavior can’t be customized; never choose Inbox yourself.

| Key            | Section          | What belongs here                                                                |
| -------------- | ---------------- | -------------------------------------------------------------------------------- |
| planning       | Planning         | Defining scope, requirements, or approach before a reviewable spec exists.       |
| spec-review    | Spec Review      | A spec or implementation plan is ready for, awaiting, or undergoing user review. |
| building       | Building         | Implementing or changing approved work.                                          |
| testing-deploy | Testing / Deploy | Validating, packaging, releasing, or deploying completed work.                   |
| handoff        | Handoff          | Packaging work and context so a colleague can continue it.                       |
| on-hold        | On Hold          | Work intentionally paused until a later time or external condition.              |

<!-- bb:skill-slot workflow:end -->

## Move the thread

When the thread’s primary work changes, move the current thread before starting
that work:

```bash
bb organizer phase <stage-key>
```

Choose only a key from the current workflow table when the current work clearly
matches that stage’s rule. Use the work you are actually doing and the context
available in this thread; do not classify from isolated keywords in a title,
old message, or quoted text. Inbox is system-managed and can’t be selected.

If several stages seem relevant, use the one describing the next concrete
action. If you lack sufficient context, leave the remembered stage unchanged
rather than inventing a transition. Do not create, rename, or delete native
sections; the plugin reconciles them from the user’s settings.
