import { useCallback, useMemo, useState } from "react";
import type {
  PluginSidebarSectionActionContext,
  PluginSidebarSectionActionPresentation,
} from "@get-bb/plugin-sdk";
import { Button } from "@bb/shared-ui/button";
import { DropdownMenuItem } from "@bb/shared-ui/dropdown-menu";
import { Icon, isIconName, type IconName } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  usePluginSlots,
  type PluginSidebarSectionActionSlot,
} from "@/lib/plugin-slots";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ResolvedPluginSidebarSectionAction {
  key: string;
  icon: IconName;
  presentation: PluginSidebarSectionActionPresentation;
  context: PluginSidebarSectionActionContext;
  slot: PluginSidebarSectionActionSlot;
}

export interface PluginSidebarSectionActionResolution {
  hasPressed: boolean;
  hasPressedOverflow: boolean;
  inlineAction: ResolvedPluginSidebarSectionAction | null;
  overflowActions: readonly ResolvedPluginSidebarSectionAction[];
  run(action: ResolvedPluginSidebarSectionAction): void;
}

function resolvePresentation(
  slot: PluginSidebarSectionActionSlot,
  context: PluginSidebarSectionActionContext,
): ResolvedPluginSidebarSectionAction | null {
  let presentation: PluginSidebarSectionActionPresentation | null;
  try {
    presentation = slot.presentation(context);
  } catch (error) {
    console.error(
      `[plugin:${slot.pluginId}] experimental_sidebarSectionAction "${slot.id}" presentation failed: ${describeError(error)}`,
    );
    return null;
  }
  if (presentation === null) return null;
  if (
    typeof presentation !== "object" ||
    typeof presentation.title !== "string" ||
    presentation.title.trim().length === 0 ||
    typeof presentation.icon !== "string" ||
    !isIconName(presentation.icon) ||
    (presentation.pressed !== undefined &&
      typeof presentation.pressed !== "boolean") ||
    (presentation.disabled !== undefined &&
      typeof presentation.disabled !== "boolean")
  ) {
    console.error(
      `[plugin:${slot.pluginId}] experimental_sidebarSectionAction "${slot.id}" returned an invalid presentation`,
    );
    return null;
  }
  return {
    key: `${slot.pluginId}:${slot.id}`,
    icon: presentation.icon,
    presentation: { ...presentation, title: presentation.title.trim() },
    context,
    slot,
  };
}

export function usePluginSidebarSectionActions(
  context: PluginSidebarSectionActionContext,
  enabled = true,
): PluginSidebarSectionActionResolution {
  const { sidebarSectionActions } = usePluginSlots();
  const [lastActivatedKey, setLastActivatedKey] = useState<string | null>(null);
  const actions = useMemo(() => {
    if (!enabled) return [];
    return sidebarSectionActions.flatMap((slot) => {
      const resolved = resolvePresentation(slot, context);
      return resolved ? [resolved] : [];
    });
  }, [context, enabled, sidebarSectionActions]);
  const pressedActions = actions.filter(
    (action) => action.presentation.pressed === true,
  );
  const inlineAction =
    pressedActions.find((action) => action.key === lastActivatedKey) ??
    pressedActions[0] ??
    actions.find((action) => action.slot.placement === "inline-preferred") ??
    null;
  const overflowActions = actions.filter((action) => action !== inlineAction);
  const run = useCallback((action: ResolvedPluginSidebarSectionAction) => {
    setLastActivatedKey(action.key);
    try {
      void Promise.resolve(action.slot.run(action.context)).catch((error) => {
        console.error(
          `[plugin:${action.slot.pluginId}] experimental_sidebarSectionAction "${action.slot.id}" failed: ${describeError(error)}`,
        );
      });
    } catch (error) {
      console.error(
        `[plugin:${action.slot.pluginId}] experimental_sidebarSectionAction "${action.slot.id}" failed: ${describeError(error)}`,
      );
    }
  }, []);
  return {
    hasPressed: pressedActions.length > 0,
    hasPressedOverflow: overflowActions.some(
      (action) => action.presentation.pressed === true,
    ),
    inlineAction,
    overflowActions,
    run,
  };
}

export function PluginSidebarSectionInlineAction({
  action,
  onRun,
}: {
  action: ResolvedPluginSidebarSectionAction;
  onRun: (action: ResolvedPluginSidebarSectionAction) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={action.presentation.title}
          aria-pressed={action.presentation.pressed}
          disabled={action.presentation.disabled}
          onClick={(event) => {
            event.stopPropagation();
            onRun(action);
          }}
          className={cn(
            "rounded-md p-0 text-subtle-foreground hover:bg-transparent hover:text-foreground",
            COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
            action.presentation.pressed && "text-foreground",
          )}
        >
          <Icon
            name={action.icon}
            className={COARSE_POINTER_ICON_SIZE_CLASS}
            aria-hidden="true"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{action.presentation.title}</TooltipContent>
    </Tooltip>
  );
}

export function PluginSidebarSectionOverflowItems({
  actions,
  onRun,
}: {
  actions: readonly ResolvedPluginSidebarSectionAction[];
  onRun: (action: ResolvedPluginSidebarSectionAction) => void;
}) {
  return actions.map((action) => (
    <DropdownMenuItem
      key={action.key}
      disabled={action.presentation.disabled}
      onSelect={() => onRun(action)}
    >
      <Icon name={action.icon} aria-hidden="true" />
      {action.presentation.title}
    </DropdownMenuItem>
  ));
}
