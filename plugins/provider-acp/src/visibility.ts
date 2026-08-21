import {
  createProviderVisibilityMetadata,
  getStringProperty,
  isRecord,
  type JsonRpcMessage,
  type ProviderRawEventDescription,
  type ProviderVisibilityMetadata,
} from "@get-bb/plugin-sdk/provider-bridge";
import {
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
} from "./bridge-protocol.js";

const NORMALIZED_ACP_METHODS = new Set<string>([
  "thread/identity",
  "error",
  ACP_TURN_STARTED_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_FS_WRITE_METHOD,
  ACP_WARNING_METHOD,
]);

// Update kinds that carry agent work: streamed text, thoughts, tool calls,
// and plans. Arriving with no prompt in flight they are an agent-initiated
// turn (e.g. OMP's async-job delivery), which the bridge brackets itself.
const AGENT_WORK_ACP_UPDATE_KINDS = new Set<string>([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
]);

const NORMALIZED_ACP_UPDATE_KINDS = new Set<string>([
  ...AGENT_WORK_ACP_UPDATE_KINDS,
  "usage_update",
]);

export function isAgentWorkAcpUpdateKind(updateKind: string): boolean {
  return AGENT_WORK_ACP_UPDATE_KINDS.has(updateKind);
}

// Update kinds the agent may legitimately send but BB intentionally does not
// render: replayed history, agent-side mode/command/config/session metadata.
const NOISE_ACP_UPDATE_KINDS = new Set<string>([
  "user_message_chunk",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
]);

interface AcpMethodRawEvent {
  kind: "method";
  method: string;
}

interface AcpUpdateRawEvent {
  kind: "update";
  updateKind: string;
}

interface AcpUnknownUpdateRawEvent {
  kind: "update/unknown";
}

type AcpRawEvent =
  | AcpMethodRawEvent
  | AcpUpdateRawEvent
  | AcpUnknownUpdateRawEvent;

function parseAcpRawEvent(event: JsonRpcMessage): AcpRawEvent {
  if (event.method !== ACP_UPDATE_METHOD) {
    return { kind: "method", method: event.method };
  }
  if (!isRecord(event.params)) {
    return { kind: "update/unknown" };
  }
  const update = event.params["update"];
  const updateKind = isRecord(update)
    ? getStringProperty(update, "sessionUpdate")
    : undefined;
  if (!updateKind) {
    return { kind: "update/unknown" };
  }
  return { kind: "update", updateKind };
}

function describeParsedAcpRawEvent(
  event: AcpRawEvent,
): ProviderRawEventDescription {
  switch (event.kind) {
    case "method":
      return {
        kind: event.method,
        coverage: NORMALIZED_ACP_METHODS.has(event.method)
          ? "normalized"
          : "unknown",
      };
    case "update":
      if (NORMALIZED_ACP_UPDATE_KINDS.has(event.updateKind)) {
        return {
          kind: `acp/update:${event.updateKind}`,
          coverage: "normalized",
        };
      }
      if (NOISE_ACP_UPDATE_KINDS.has(event.updateKind)) {
        return { kind: `acp/update:${event.updateKind}`, coverage: "noise" };
      }
      return { kind: `acp/update:${event.updateKind}`, coverage: "unknown" };
    case "update/unknown":
      return { kind: "acp/update", coverage: "unknown" };
  }
}

export const acpVisibilityMetadata: ProviderVisibilityMetadata<AcpRawEvent> =
  createProviderVisibilityMetadata({
    parseRawEvent: parseAcpRawEvent,
    describeParsedRawEvent: describeParsedAcpRawEvent,
  });
