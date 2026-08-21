// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_WORKFLOW_CONFIG,
  cloneWorkflowConfig,
  type WorkflowConfig,
} from "./core.js";
import {
  cacheWorkflowConfig,
  mountThreadOrganizerSidebar,
} from "./sidebar-controller.js";

function workflow(): WorkflowConfig {
  const config = cloneWorkflowConfig(DEFAULT_WORKFLOW_CONFIG);
  config.stages.forEach((stage) => {
    stage.sectionId = `sec_${stage.key}`;
  });
  return config;
}

function section(
  id: string,
  label: string,
  expanded: boolean,
  threadIds: string[] = [],
): HTMLElement {
  const group = document.createElement("div");
  group.dataset.sidebarStickyGroup = "";
  group.dataset.sidebarSectionId = id;
  const button = document.createElement("button");
  const rowToggle = document.createElement("button");
  rowToggle.setAttribute("aria-hidden", "true");
  rowToggle.tabIndex = -1;
  const setExpanded = (next: boolean) => {
    button.setAttribute("aria-expanded", String(next));
    button.setAttribute(
      "aria-label",
      `${next ? "Collapse" : "Expand"} ${label} section`,
    );
  };
  const toggle = () =>
    setExpanded(button.getAttribute("aria-expanded") !== "true");
  setExpanded(expanded);
  button.addEventListener("click", toggle);
  rowToggle.addEventListener("click", toggle);
  group.append(button, rowToggle);
  for (const threadId of threadIds) {
    const row = document.createElement("a");
    row.dataset.sidebarThreadId = threadId;
    group.append(row);
  }
  return group;
}

function sidebar(...groups: HTMLElement[]): HTMLElement {
  const root = document.createElement("aside");
  root.dataset.sidebar = "sidebar";
  root.append(...groups);
  document.body.append(root);
  return root;
}

function toggle(group: Element): HTMLButtonElement {
  return group.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
}

function order(...ids: string[]): string[] {
  return ids.map((id) => `section:${id}`);
}

function mount(config = workflow()) {
  const controller = new AbortController();
  mountThreadOrganizerSidebar({
    document,
    pluginId: "thread-organizer-example",
    signal: controller.signal,
    loadConfig: async () => config,
  });
  return controller;
}

afterEach(() => {
  document.body.replaceChildren();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("workflow sidebar controller", () => {
  it("starts with Inbox expanded and other configured sections collapsed", async () => {
    const pinned = section("pinned", "Pinned", true, ["thr_one"]);
    const inbox = section("sec_inbox", "Inbox", false);
    const planning = section("sec_planning", "Planning", true);
    const custom = section("custom", "Personal", true);
    sidebar(pinned, inbox, planning, custom);
    const controller = mount();

    await vi.waitFor(() =>
      expect(toggle(inbox).getAttribute("aria-expanded")).toBe("true"),
    );
    expect(toggle(planning).getAttribute("aria-expanded")).toBe("false");
    expect(toggle(pinned).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(custom).getAttribute("aria-expanded")).toBe("true");
    controller.abort();
  });

  it("restores configured order while preserving unrelated positions", async () => {
    const personal = section("personal", "Personal", false);
    const testing = section("sec_testing-deploy", "Testing / Deploy", false);
    const planning = section("sec_planning", "Planning", false);
    const design = section("design", "Design", false);
    const inbox = section("sec_inbox", "Inbox", false);
    const building = section("sec_building", "Building", false);
    sidebar(personal, testing, planning, design, inbox, building);
    window.localStorage.setItem(
      "bb.sidebar.manualSectionOrder",
      JSON.stringify(
        order(
          "personal",
          "sec_testing-deploy",
          "sec_planning",
          "design",
          "sec_inbox",
          "sec_building",
        ),
      ),
    );
    const controller = mount();

    await vi.waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem("bb.sidebar.manualSectionOrder")!,
        ),
      ).toEqual(
        order(
          "personal",
          "sec_inbox",
          "sec_planning",
          "design",
          "sec_building",
          "sec_testing-deploy",
        ),
      ),
    );
    controller.abort();
  });

  it("re-collapses a host-expanded destination unless the user opened it", async () => {
    const planning = section("sec_planning", "Planning", true);
    sidebar(planning);
    const controller = mount();
    await vi.waitFor(() =>
      expect(toggle(planning).getAttribute("aria-expanded")).toBe("false"),
    );

    toggle(planning).setAttribute("aria-expanded", "true");
    toggle(planning).setAttribute("aria-label", "Collapse Planning section");
    planning.append(document.createElement("a"));
    await vi.waitFor(() =>
      expect(toggle(planning).getAttribute("aria-expanded")).toBe("false"),
    );
    controller.abort();
  });

  it("honors a deliberate user expansion across later mutations", async () => {
    const planning = section("sec_planning", "Planning", true);
    sidebar(planning);
    const controller = mount();
    await vi.waitFor(() =>
      expect(toggle(planning).getAttribute("aria-expanded")).toBe("false"),
    );

    toggle(planning).click();
    await vi.waitFor(() =>
      expect(toggle(planning).getAttribute("aria-expanded")).toBe("true"),
    );
    planning.append(document.createElement("span"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toggle(planning).getAttribute("aria-expanded")).toBe("true");
    controller.abort();
  });

  it("applies a saved configuration event without remounting", async () => {
    const inbox = section("sec_inbox", "Inbox", false);
    const planning = section("sec_planning", "Planning", true);
    const onHold = section("sec_on-hold", "On Hold", true);
    sidebar(inbox, planning, onHold);
    const config = workflow();
    const controller = mount(config);
    await vi.waitFor(() =>
      expect(toggle(onHold).getAttribute("aria-expanded")).toBe("false"),
    );

    const edited = cloneWorkflowConfig(config);
    edited.stages = edited.stages.filter((stage) => stage.key !== "on-hold");
    toggle(onHold).setAttribute("aria-expanded", "true");
    toggle(onHold).setAttribute("aria-label", "Collapse On Hold section");
    cacheWorkflowConfig(edited);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(toggle(onHold).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(inbox).getAttribute("aria-expanded")).toBe("true");
    expect(toggle(planning).getAttribute("aria-expanded")).toBe("false");
    controller.abort();
  });
});
