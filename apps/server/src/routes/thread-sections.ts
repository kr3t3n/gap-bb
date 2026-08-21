import {
  createThreadSection,
  deleteThreadSection,
  listThreadSections,
  normalizeThreadSectionName,
  renameThreadSection,
  type ThreadSectionRow,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type ExperimentalThreadSectionWithIconResponse,
  type PublicApiSchema,
  type ThreadSectionResponse,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";

function requireSectionName(name: string): string {
  const normalized = normalizeThreadSectionName(name);
  if (!normalized) {
    throw new ApiError(400, "invalid_request", "Section name cannot be empty");
  }
  return normalized;
}

function throwDuplicateSectionName(): never {
  throw new ApiError(
    409,
    "section_name_conflict",
    "Section name already exists",
  );
}

function toThreadSectionResponse(
  section: ThreadSectionRow,
): ThreadSectionResponse {
  return {
    id: section.id,
    name: section.name,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
  };
}

function toExperimentalThreadSectionResponse(
  section: ThreadSectionRow,
): ExperimentalThreadSectionWithIconResponse {
  return {
    ...toThreadSectionResponse(section),
    experimental_icon: section.icon,
  };
}

export function registerThreadSectionRoutes(app: Hono, deps: AppDeps): void {
  const { del, get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threadSections;

  get(routes.experimental_listWithIcons, (context) =>
    context.json(
      listThreadSections(deps.db).map(toExperimentalThreadSectionResponse),
    ),
  );

  post(routes.create, (context, payload) => {
    const result = createThreadSection(deps.db, deps.hub, {
      icon: payload.experimental_icon,
      name: requireSectionName(payload.name),
    });
    if (result.status === "duplicate") {
      throwDuplicateSectionName();
    }
    return context.json(toThreadSectionResponse(result.section), 201);
  });

  patch(routes.update, (context, payload) => {
    const result = renameThreadSection(deps.db, deps.hub, {
      icon: payload.experimental_icon,
      id: payload.id,
      name: requireSectionName(payload.name),
    });
    if (result.status === "not_found") {
      throw new ApiError(404, "section_not_found", "Section not found");
    }
    if (result.status === "duplicate") {
      throwDuplicateSectionName();
    }
    return context.json(result.result);
  });

  del(routes.delete, (context, payload) => {
    const result = deleteThreadSection(deps.db, deps.hub, { id: payload.id });
    if (!result) {
      throw new ApiError(404, "section_not_found", "Section not found");
    }
    return context.json(result);
  });
}
