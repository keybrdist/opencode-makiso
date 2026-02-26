import type { EventScope, ScopeLevel } from "./types.js";

export type ScopeConditionOptions = {
  scope: EventScope;
  scopeLevel?: ScopeLevel;
  includeUnscoped?: boolean;
  tableAlias?: string;
};

const qualify = (column: string, tableAlias?: string): string => {
  if (!tableAlias) {
    return column;
  }
  return `${tableAlias}.${column}`;
};

export const normalizeScopeLevel = (
  scope: EventScope,
  requestedLevel?: ScopeLevel
): ScopeLevel => {
  if (requestedLevel === "repo" && scope.repo_id) {
    return "repo";
  }
  if (requestedLevel === "project" && scope.project_id) {
    return "project";
  }
  if (requestedLevel === "workspace" && scope.workspace_id) {
    return "workspace";
  }
  if (requestedLevel === "org") {
    return "org";
  }

  if (scope.repo_id) {
    return "repo";
  }
  if (scope.project_id) {
    return "project";
  }
  if (scope.workspace_id) {
    return "workspace";
  }
  return "org";
};

export const buildScopeCondition = (
  options: ScopeConditionOptions
): { sql: string; params: string[]; scopeLevel: ScopeLevel } => {
  const scopeLevel = normalizeScopeLevel(options.scope, options.scopeLevel);

  const orgColumn = qualify("org_id", options.tableAlias);
  const workspaceColumn = qualify("workspace_id", options.tableAlias);
  const projectColumn = qualify("project_id", options.tableAlias);
  const repoColumn = qualify("repo_id", options.tableAlias);

  const params: string[] = [options.scope.org_id];
  let scopedSql = `${orgColumn} = ?`;

  if (scopeLevel === "workspace") {
    params.push(options.scope.workspace_id as string);
    scopedSql = `${scopedSql} AND ${workspaceColumn} = ?`;
  } else if (scopeLevel === "project") {
    params.push(options.scope.project_id as string);
    scopedSql = `${scopedSql} AND ${projectColumn} = ?`;
  } else if (scopeLevel === "repo") {
    params.push(options.scope.repo_id as string);
    scopedSql = `${scopedSql} AND ${repoColumn} = ?`;
  }

  if (options.includeUnscoped) {
    return {
      sql: `(${scopedSql} OR ${orgColumn} IS NULL)`,
      params,
      scopeLevel
    };
  }

  return {
    sql: scopedSql,
    params,
    scopeLevel
  };
};
