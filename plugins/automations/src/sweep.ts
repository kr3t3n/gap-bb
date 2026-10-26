import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  claimAutomationScheduledRun,
  closeAutomationRun,
  listDueAutomations,
  parseAutomationExecution,
  parseAutomationTrigger,
  type AutomationRow,
  type AutomationRunRow,
  type Db,
} from "./data.js";
import { publishAutomationChange } from "./realtime.js";
import { computeNextScheduledTime } from "./schedule-helpers.js";
import { executeAgentRun, executeScriptRun } from "./run.js";

const DUE_AUTOMATION_BATCH_SIZE = 100;
export const SWEEP_INTERVAL_MS = 10_000;

const hostListSchema = z.array(
  z.object({ status: z.enum(["connected", "disconnected"]) }).passthrough(),
);
type SweepApi = Pick<BbPluginApi, "realtime" | "log"> & {
  sdk: {
    hosts: { list(): Promise<unknown> };
    threads: {
      get(
        args: Parameters<BbPluginApi["sdk"]["threads"]["get"]>[0],
      ): Promise<unknown>;
      send(
        args: Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0],
      ): Promise<unknown>;
      spawn(
        args: Parameters<BbPluginApi["sdk"]["threads"]["spawn"]>[0],
      ): Promise<unknown>;
    };
  };
};

function buildScheduleFailureHandler(
  db: Db,
  args: {
    run: AutomationRunRow;
  },
): (error: unknown) => void {
  return (error) => {
    closeAutomationRun(db, {
      runId: args.run.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      now: Date.now(),
    });
  };
}

async function processDueAutomation(
  bb: SweepApi,
  db: Db,
  args: {
    pluginDataDir: string;
    automation: AutomationRow;
    now: number;
    agentHostsAvailable: boolean;
    serverUrl: string;
  },
): Promise<{ skippedNoHost: boolean }> {
  if (args.automation.nextRunAt === null) return { skippedNoHost: false };
  const expectedNextRunAt = args.automation.nextRunAt;
  let newNextRunAt: number | null;
  let execution;
  try {
    const trigger = parseAutomationTrigger(args.automation.triggerConfig);
    execution = parseAutomationExecution(args.automation.execution);
    newNextRunAt =
      trigger.triggerType === "once"
        ? null
        : computeNextScheduledTime({
            cron: trigger.cron,
            now: args.now,
            timezone: trigger.timezone,
          });
  } catch (error) {
    bb.log.error(
      `Skipping due automation ${args.automation.id} with invalid stored configuration: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { skippedNoHost: false };
  }

  // No connected host: an agent automation cannot run. Reported to the caller
  // rather than swallowed. Returning silently here is what made the 2026-08-24
  // outage invisible: no run row, no log line, no status change, and no
  // nextRunAt advance, so every automation kept reading its last "succeeded"
  // while nothing ran for eight hours. See GAP-5.
  if (execution.mode === "agent" && !args.agentHostsAvailable) {
    return { skippedNoHost: true };
  }

  const claim = claimAutomationScheduledRun(db, {
    automationId: args.automation.id,
    expectedNextRunAt,
    newNextRunAt,
    now: args.now,
  });
  if (!claim.advanced) return { skippedNoHost: false };
  publishAutomationChange(bb, args.automation.projectId, [
    "automations-changed",
    "automation-runs-changed",
  ]);
  const onFailure = buildScheduleFailureHandler(db, {
    run: claim.run,
  });
  if (execution.mode === "agent") {
    await executeAgentRun(bb, db, {
      automation: args.automation,
      run: claim.run,
      execution,
      onFailure,
    });
  } else {
    void executeScriptRun(bb, db, {
      pluginDataDir: args.pluginDataDir,
      automation: args.automation,
      run: claim.run,
      execution,
      onFailure,
      serverUrl: args.serverUrl,
    }).catch((error: unknown) => {
      bb.log.error(
        `Detached script automation ${args.automation.id} failed unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
  return { skippedNoHost: false };
}

async function hasConnectedHost(
  bb: Pick<BbPluginApi, "log"> & {
    sdk: { hosts: { list(): Promise<unknown> } };
  },
): Promise<boolean> {
  try {
    return hostListSchema
      .parse(await bb.sdk.hosts.list())
      .some((host) => host.status === "connected");
  } catch (error) {
    bb.log.warn(
      `Failed to list hosts for automation sweep: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

/**
 * Tracks the "no connected host" condition across sweeps so it can be reported
 * once on entry, periodically while it persists, and once on recovery.
 *
 * The sweep runs every 10 seconds, so logging every pass would produce 6 lines a
 * minute and be ignored. Logging nothing is what happened before, and that cost
 * eight hours of silent downtime on 2026-08-24. Throttled reporting is the
 * middle ground: loud on the transition, quiet but present while it lasts.
 */
const NO_HOST_REPORT_INTERVAL_MS = 5 * 60_000;
let noHostSince: number | null = null;
let noHostLastReportedAt = 0;
let noHostSkipsWhileDown = 0;

/** Exposed for tests, and to let a caller reset between harness runs. */
export function resetNoHostReportingState(): void {
  noHostSince = null;
  noHostLastReportedAt = 0;
  noHostSkipsWhileDown = 0;
}

/**
 * Whether agent automations are currently being skipped for want of a host, and
 * for how long. A health check can read this instead of inferring silence.
 */
export function getNoHostStatus(): {
  down: boolean;
  since: number | null;
  skipped: number;
} {
  return {
    down: noHostSince !== null,
    since: noHostSince,
    skipped: noHostSkipsWhileDown,
  };
}

function reportNoHostState(
  bb: SweepApi,
  args: { skipped: number; now: number },
): void {
  if (args.skipped > 0) {
    const entering = noHostSince === null;
    if (entering) {
      noHostSince = args.now;
      noHostSkipsWhileDown = 0;
    }
    noHostSkipsWhileDown += args.skipped;
    const dueToReport =
      entering || args.now - noHostLastReportedAt >= NO_HOST_REPORT_INTERVAL_MS;
    if (dueToReport) {
      noHostLastReportedAt = args.now;
      const downForMs = args.now - (noHostSince ?? args.now);
      bb.log.warn(
        `AGENT AUTOMATIONS NOT RUNNING: no connected host, so ${args.skipped} agent automation(s) were skipped this sweep. ` +
          `Down for ${Math.round(downForMs / 1000)}s, ${noHostSkipsWhileDown} skip(s) so far. ` +
          `Their schedules did not advance, no run rows exist, and their last recorded status is unchanged — ` +
          `so they will look healthy while doing nothing. Check that the host daemon is connected.`,
      );
    }
    return;
  }

  if (noHostSince !== null) {
    const downForMs = args.now - noHostSince;
    bb.log.warn(
      `Agent automations running again: a host is connected after ${Math.round(
        downForMs / 1000,
      )}s and ${noHostSkipsWhileDown} skipped sweep-automation pair(s).`,
    );
    resetNoHostReportingState();
  }
}

export async function sweepDueAutomations(
  bb: SweepApi,
  db: Db,
  args: {
    pluginDataDir: string;
    serverUrl: string;
    now?: number;
  },
): Promise<void> {
  const now = args.now ?? Date.now();
  const due = listDueAutomations(db, { now, limit: DUE_AUTOMATION_BATCH_SIZE });
  const agentHostsAvailable = await hasConnectedHost(bb);
  let skippedNoHost = 0;
  for (const automation of due) {
    try {
      const outcome = await processDueAutomation(bb, db, {
        pluginDataDir: args.pluginDataDir,
        automation,
        now,
        agentHostsAvailable,
        serverUrl: args.serverUrl,
      });
      if (outcome.skippedNoHost) skippedNoHost += 1;
    } catch (error) {
      bb.log.error(
        `Failed to process due automation ${automation.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  reportNoHostState(bb, { skipped: skippedNoHost, now });
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
