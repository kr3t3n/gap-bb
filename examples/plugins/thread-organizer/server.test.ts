import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKFLOW_CONFIG,
  editableWorkflowConfig,
  type WorkflowConfig,
} from "./core.js";
import plugin from "./server.js";

type TestThread = ReturnType<typeof makeThreadResponse>;

interface TestSection {
  createdAt: number;
  experimental_icon: string | null;
  id: string;
  name: string;
  updatedAt: number;
}

function agentContext() {
  return {
    thread: {
      id: "thr_test",
      title: "Current work",
      parentThreadId: null,
      sourceThreadId: null,
    },
    project: {
      id: "proj_test",
      kind: "standard" as const,
      name: "Test project",
      gitRemoteUrl: null,
    },
    environment: {
      id: "env_test",
      name: "Test",
      path: process.cwd(),
      workspaceProvisionType: "managed-worktree" as const,
      branchName: "test",
    },
    host: { id: "host_test", name: "Test host" },
    provider: {
      id: "codex",
      model: "test",
      capabilities: { supportsNativeUserQuestion: true },
    },
    origin: { kind: null, pluginId: null },
  };
}

function createHarness(options: { legacyPlanning?: boolean } = {}) {
  let thread = makeThreadResponse({
    id: "thr_test",
    projectId: "proj_test",
    status: "starting",
    lastReadAt: 0,
    latestAttentionAt: 10,
  });
  let sectionCounter = 0;
  let sections: TestSection[] = options.legacyPlanning
    ? [
        {
          id: "sec_legacy_planning",
          name: "📋 Planning",
          experimental_icon: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]
    : [];
  const changedCallbacks: Array<() => void> = [];

  const create = vi.fn(
    async ({
      name,
      experimental_icon,
    }: {
      name: string;
      experimental_icon?: string | null;
    }) => {
      const section: TestSection = {
        id: `sec_${++sectionCounter}`,
        name,
        experimental_icon: experimental_icon ?? null,
        createdAt: sectionCounter + 10,
        updatedAt: sectionCounter + 10,
      };
      sections.push(section);
      const { experimental_icon: _icon, ...stable } = section;
      return stable;
    },
  );
  const updateSection = vi.fn(
    async ({
      id,
      name,
      experimental_icon,
    }: {
      id: string;
      name: string;
      experimental_icon?: string | null;
    }) => {
      const section = sections.find((candidate) => candidate.id === id)!;
      section.name = name;
      if (experimental_icon !== undefined) {
        section.experimental_icon = experimental_icon;
      }
      section.updatedAt += 1;
      return { id, name, updatedThreadCount: 0 };
    },
  );
  const deleteSection = vi.fn(async ({ id }: { id: string }) => {
    const section = sections.find((candidate) => candidate.id === id)!;
    if (thread.sectionId === id)
      thread = makeThreadResponse({ ...thread, sectionId: null });
    sections = sections.filter((candidate) => candidate.id !== id);
    return { id, name: section.name, updatedThreadCount: 0 };
  });
  const updateThread = vi.fn(
    async ({
      threadId,
      sectionId,
    }: {
      threadId: string;
      sectionId?: string | null;
    }) => {
      if (threadId !== thread.id) throw new Error("unknown test thread");
      thread = makeThreadResponse({
        ...thread,
        ...(sectionId !== undefined ? { sectionId } : {}),
        updatedAt: thread.updatedAt + 1,
      });
      return thread;
    },
  );

  const host = createFakePluginHost({
    pluginId: "thread-organizer",
    agentSkillIds: ["thread-phase-organizer"],
    sdk: {
      subscribe: (args) => {
        const callback = args.callback as unknown as (event: {
          changes: ["read-state-changed"];
          entity: "thread";
          id: string;
          type: "changed";
        }) => void;
        changedCallbacks.push(() =>
          callback({
            entity: "thread",
            type: "changed",
            id: thread.id,
            changes: ["read-state-changed"],
          }),
        );
        return () => undefined;
      },
      threadSections: {
        create,
        delete: deleteSection,
        experimental_listWithIcons: async () =>
          sections.map((section) => ({ ...section })),
        update: updateSection,
      },
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          if (threadId !== thread.id) throw new Error("unknown test thread");
          return thread;
        },
        list: async () => [thread],
        update: updateThread,
      },
    },
  });

  return {
    ...host,
    create,
    deleteSection,
    updateSection,
    updateThread,
    current: () => thread,
    sections: () => sections.map((section) => ({ ...section })),
    setThread(changes: Partial<TestThread>) {
      thread = makeThreadResponse({ ...thread, ...changes });
    },
    emitChanged() {
      for (const callback of changedCallbacks) callback();
    },
  };
}

async function configFor(
  organizer: ReturnType<typeof createHarness>,
): Promise<WorkflowConfig> {
  return (await organizer.harness.behavior.callRpc(
    "getConfig",
    {},
  )) as WorkflowConfig;
}

describe("Thread Organizer server", () => {
  it("registers its workflow surfaces and creates every default native section", async () => {
    const organizer = createHarness();
    plugin(organizer.bb);
    const config = await configFor(organizer);

    expect(organizer.harness.inspection.registrations.cli?.name).toBe(
      "organizer",
    );
    expect(organizer.harness.inspection.registrations.rpcMethods).toEqual([
      "getConfig",
      "saveConfig",
    ]);
    expect(
      organizer.harness.inspection.registrations.agentConfigurationProvider,
    ).not.toBeNull();
    expect(config.stages.every((stage) => stage.sectionId !== null)).toBe(true);
    expect(
      organizer.sections().map(({ name, experimental_icon }) => ({
        name,
        icon: experimental_icon,
      })),
    ).toEqual(
      DEFAULT_WORKFLOW_CONFIG.stages.map(({ title, icon }) => ({
        name: title,
        icon,
      })),
    );
    await organizer.harness.lifecycle.dispose();
  });

  it("migrates an emoji-prefixed default in place and preserves its id", async () => {
    const organizer = createHarness({ legacyPlanning: true });
    plugin(organizer.bb);
    const config = await configFor(organizer);
    const planning = config.stages.find((stage) => stage.key === "planning")!;

    expect(planning.sectionId).toBe("sec_legacy_planning");
    expect(organizer.sections()).toContainEqual(
      expect.objectContaining({
        id: "sec_legacy_planning",
        name: "Planning",
        experimental_icon: "ListTodo",
      }),
    );
    await organizer.harness.lifecycle.dispose();
  });

  it("applies running, unread, and read precedence without classifying text", async () => {
    const organizer = createHarness();
    plugin(organizer.bb);
    const config = await configFor(organizer);
    const sectionId = (key: string) =>
      config.stages.find((stage) => stage.key === key)!.sectionId;

    await organizer.harness.behavior.emitThreadEvent("thread.created", {
      thread: organizer.current(),
    });
    expect(organizer.current().sectionId).toBe(sectionId("planning"));

    organizer.setThread({
      status: "idle",
      lastReadAt: 0,
      latestAttentionAt: 20,
    });
    await organizer.harness.behavior.emitThreadEvent("thread.idle", {
      thread: organizer.current(),
      lastAssistantText: null,
    });
    expect(organizer.current().sectionId).toBe(sectionId("inbox"));

    organizer.setThread({ lastReadAt: 20 });
    await organizer.harness.behavior.emitThreadEvent("thread.idle", {
      thread: organizer.current(),
      lastAssistantText: null,
    });
    expect(organizer.current().sectionId).toBe(sectionId("planning"));
    expect(
      organizer.harness.inspection.sdk.callsTo("threads.promptHistory"),
    ).toHaveLength(0);
    await organizer.harness.lifecycle.dispose();
  });

  it("remembers a user move made while unread, but keeps the row in Inbox", async () => {
    const organizer = createHarness();
    plugin(organizer.bb);
    const config = await configFor(organizer);
    const sectionId = (key: string) =>
      config.stages.find((stage) => stage.key === key)!.sectionId;

    organizer.setThread({
      status: "idle",
      lastReadAt: 10,
      latestAttentionAt: 10,
      sectionId: sectionId("planning"),
    });
    await organizer.harness.behavior.emitThreadEvent("thread.idle", {
      thread: organizer.current(),
      lastAssistantText: null,
    });

    organizer.setThread({
      lastReadAt: 0,
      latestAttentionAt: 20,
      sectionId: sectionId("on-hold"),
    });
    await organizer.harness.behavior.emitThreadEvent("thread.idle", {
      thread: organizer.current(),
      lastAssistantText: null,
    });
    expect(organizer.current().sectionId).toBe(sectionId("inbox"));

    organizer.setThread({ lastReadAt: 20 });
    await organizer.harness.behavior.emitThreadEvent("thread.idle", {
      thread: organizer.current(),
      lastAssistantText: null,
    });
    expect(organizer.current().sectionId).toBe(sectionId("on-hold"));
    await organizer.harness.lifecycle.dispose();
  });

  it("moves explicitly with dynamic CLI keys and never accepts Inbox", async () => {
    const organizer = createHarness();
    plugin(organizer.bb);
    const config = await configFor(organizer);
    organizer.setThread({ status: "active" });

    await expect(
      organizer.harness.behavior.runCli(["phase", "on-hold"], {
        threadId: "thr_test",
      }),
    ).resolves.toMatchObject({
      exitCode: 0,
      stdout: expect.stringContaining("On Hold"),
    });
    expect(organizer.current().sectionId).toBe(
      config.stages.find((stage) => stage.key === "on-hold")!.sectionId,
    );
    await expect(
      organizer.harness.behavior.runCli(["phase", "inbox"], {
        threadId: "thr_test",
      }),
    ).resolves.toMatchObject({ exitCode: 2 });
    await organizer.harness.lifecycle.dispose();
  });

  it("saves Inbox presentation and custom rules into the next agent session", async () => {
    const organizer = createHarness();
    plugin(organizer.bb);
    const current = await configFor(organizer);
    const edited = editableWorkflowConfig(current);
    edited.stages[0] = {
      ...edited.stages[0]!,
      title: "Needs Me",
      icon: "MailOpen",
    };
    edited.stages[1] = {
      ...edited.stages[1]!,
      title: "Shaping",
      rule: "Clarifying the outcome and constraints.",
    };

    const saved = (await organizer.harness.behavior.callRpc(
      "saveConfig",
      edited,
    )) as WorkflowConfig;
    const configuration =
      await organizer.harness.behavior.resolveAgentConfiguration(
        agentContext(),
      );

    expect(saved.stages[0]).toMatchObject({
      title: "Needs Me",
      icon: "MailOpen",
    });
    expect(configuration.skills).toEqual(["thread-phase-organizer"]);
    expect(configuration.instructions).toBeNull();
    expect(
      configuration.skillSlots["thread-phase-organizer"]?.workflow,
    ).toContain(
      "| planning | Shaping | Clarifying the outcome and constraints. |",
    );
    expect(
      configuration.skillSlots["thread-phase-organizer"]?.workflow,
    ).toContain("**Needs Me** is the protected Inbox section");
    await organizer.harness.lifecycle.dispose();
  });

  it("migrates remembered work before deleting a removed stage", async () => {
    const organizer = createHarness();
    plugin(organizer.bb);
    const current = await configFor(organizer);
    organizer.setThread({ status: "active" });
    await organizer.harness.behavior.runCli(["phase", "handoff"], {
      threadId: "thr_test",
    });
    const handoff = current.stages.find((stage) => stage.key === "handoff")!;
    expect(organizer.current().sectionId).toBe(handoff.sectionId);

    const edited = editableWorkflowConfig(current);
    edited.stages = edited.stages.filter((stage) => stage.key !== "handoff");
    await organizer.harness.behavior.callRpc("saveConfig", edited);

    expect(organizer.current().sectionId).toBe(
      current.stages.find((stage) => stage.key === "planning")!.sectionId,
    );
    expect(organizer.deleteSection).toHaveBeenCalledWith({
      id: handoff.sectionId,
    });
    await organizer.harness.lifecycle.dispose();
  });
});
