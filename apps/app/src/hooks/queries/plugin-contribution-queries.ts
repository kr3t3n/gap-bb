import { useQuery } from "@tanstack/react-query";
import {
  normalizePluginMentionTriggers,
  type PluginMentionTrigger,
} from "@bb/client-core";
import { pluginContributionsQueryKey } from "./query-keys";

/**
 * Host-rendered plugin contributions (plugin design §4.9), served by
 * GET /api/v1/plugins/contributions. Not in the typed server contract — the
 * plugin routes are server-policy glue — so fetched directly and typed
 * locally. One query covers every contribution kind; later kinds extend
 * {@link PluginContributions}.
 */
/** One mention provider contributed by a plugin (design §4.9). */
interface PluginMentionProviderContribution {
  pluginId: string;
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
}

interface PluginContributions {
  mentionProviders: PluginMentionProviderContribution[];
}

const EMPTY_CONTRIBUTIONS: PluginContributions = {
  mentionProviders: [],
};

function toMentionProviderContribution(
  value: unknown,
): PluginMentionProviderContribution | null {
  if (typeof value !== "object" || value === null) return null;
  const provider = value as Record<string, unknown>;
  const triggers = normalizePluginMentionTriggers(provider.triggers);
  if (triggers === null) return null;
  if (
    typeof provider.pluginId !== "string" ||
    typeof provider.id !== "string" ||
    typeof provider.label !== "string"
  ) {
    return null;
  }
  return {
    pluginId: provider.pluginId,
    id: provider.id,
    label: provider.label,
    triggers,
  };
}

async function fetchPluginContributions(
  signal: AbortSignal,
): Promise<PluginContributions> {
  const response = await fetch("/api/v1/plugins/contributions", { signal });
  // Nothing to surface rather than an error: an older server (no plugin
  // routes) or a disabled experiment both mean "no contributions".
  if (!response.ok) return EMPTY_CONTRIBUTIONS;
  const body = (await response.json()) as {
    mentionProviders?: unknown;
  };
  return {
    mentionProviders: Array.isArray(body.mentionProviders)
      ? body.mentionProviders
          .map(toMentionProviderContribution)
          .filter(
            (provider): provider is PluginMentionProviderContribution =>
              provider !== null,
          )
      : [],
  };
}

/**
 * All host-rendered plugin contributions. Consumers read their kind from the
 * shared result so the app makes one contributions request total.
 */
export function usePluginContributions() {
  return useQuery({
    queryKey: pluginContributionsQueryKey(),
    queryFn: ({ signal }) => fetchPluginContributions(signal),
    staleTime: 30_000,
  });
}
interface PluginMentionSearchItem {
  /** Opaque server-composed item reference; rides the mention resource. */
  itemId: string;
  title: string;
  searchAliases: readonly string[];
  subtitle: string | null;
  icon: string | null;
}

/** One provider's mention search results, grouped under its label. */
export interface PluginMentionSearchGroup {
  pluginId: string;
  providerId: string;
  label: string;
  items: PluginMentionSearchItem[];
}

function toMentionSearchItem(value: unknown): PluginMentionSearchItem | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const searchAliases = item.searchAliases ?? [];
  if (
    typeof item.itemId !== "string" ||
    typeof item.title !== "string" ||
    !Array.isArray(searchAliases) ||
    !searchAliases.every((alias) => typeof alias === "string") ||
    (item.subtitle !== null && typeof item.subtitle !== "string") ||
    (item.icon !== null && typeof item.icon !== "string")
  ) {
    return null;
  }
  return {
    itemId: item.itemId,
    title: item.title,
    searchAliases,
    subtitle: item.subtitle,
    icon: item.icon,
  };
}

function toMentionSearchGroup(value: unknown): PluginMentionSearchGroup | null {
  if (typeof value !== "object" || value === null) return null;
  const group = value as Record<string, unknown>;
  if (
    typeof group.pluginId !== "string" ||
    typeof group.providerId !== "string" ||
    typeof group.label !== "string" ||
    !Array.isArray(group.items)
  ) {
    return null;
  }
  const items = group.items.map(toMentionSearchItem);
  if (items.some((item) => item === null)) return null;
  return {
    pluginId: group.pluginId,
    providerId: group.providerId,
    label: group.label,
    items: items.filter(
      (item): item is PluginMentionSearchItem => item !== null,
    ),
  };
}

interface PluginMentionSearchArgs {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

async function fetchPluginMentionSearch(
  args: PluginMentionSearchArgs,
  signal: AbortSignal,
): Promise<PluginMentionSearchGroup[]> {
  const params = new URLSearchParams({
    q: args.query,
    trigger: args.trigger,
  });
  if (args.projectId !== null) params.set("projectId", args.projectId);
  if (args.threadId !== null) params.set("threadId", args.threadId);
  const response = await fetch(
    `/api/v1/plugins/mentions/search?${params.toString()}`,
    { signal },
  );
  // Nothing to surface rather than an error: a disabled experiment or an
  // older server both mean "no plugin mention results".
  if (!response.ok) return [];
  const body = (await response.json()) as { groups?: unknown };
  return Array.isArray(body.groups)
    ? body.groups
        .map(toMentionSearchGroup)
        .filter((group): group is PluginMentionSearchGroup => group !== null)
    : [];
}

/**
 * Plugin mention-provider search for the composer's `@` menu (design §4.9).
 * Callers gate `enabled` on a non-empty (debounced) query plus at least one
 * registered mention provider so idle composers never poll the server.
 */
export function usePluginMentionSearch(
  args: PluginMentionSearchArgs,
  options: { enabled: boolean },
) {
  return useQuery({
    queryKey: [
      "plugin-mention-search",
      args.trigger,
      args.query,
      args.projectId,
      args.threadId,
    ],
    queryFn: ({ signal }) => fetchPluginMentionSearch(args, signal),
    enabled: options.enabled,
    staleTime: 15_000,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === args.trigger ? previous : undefined,
  });
}
