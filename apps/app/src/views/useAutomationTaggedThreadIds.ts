import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { callPluginRpc } from "@/lib/plugin-sdk-hooks";
import { wsManager } from "@/lib/ws";

const LABELS_PLUGIN_ID = "labels-pro";
const queryKey = ["home-recents", "automation-tagged-thread-ids"] as const;
const assignmentsSchema = z.object({ threadIds: z.array(z.string()) });
const NO_THREAD_IDS: readonly string[] = [];

export function useAutomationTaggedThreadIds(
  enabled: boolean,
): readonly string[] {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey,
    enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await callPluginRpc(
        (input, init) => fetch(input, { ...init, signal }),
        LABELS_PLUGIN_ID,
        "listThreadsByLabel",
        { labelName: "automation" },
      );
      return assignmentsSchema.parse(result).threadIds;
    },
  });

  useEffect(() => {
    if (!enabled) return;
    return wsManager.onPluginSignal((signal) => {
      if (signal.pluginId !== LABELS_PLUGIN_ID || signal.channel !== "labels") {
        return;
      }
      void queryClient
        .cancelQueries({ queryKey })
        .then(() => queryClient.invalidateQueries({ queryKey }));
    });
  }, [enabled, queryClient]);

  return data ?? NO_THREAD_IDS;
}
