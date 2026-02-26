import path from "node:path";

export type AppConfig = {
  dataDir: string;
  dbPath: string;
  promptsDir: string;
  defaultOrg: string;
  defaultWorkspace: string | null;
  defaultProject: string | null;
  defaultRepo: string | null;
};

export const getDefaultConfig = (): AppConfig => {
  const home = process.env.HOME ?? ".";
  const dataDir = path.join(home, ".config", "opencode", "makiso");
  const defaultWorkspace = process.env.OC_EVENTS_DEFAULT_WORKSPACE ?? null;
  const defaultProject = process.env.OC_EVENTS_DEFAULT_PROJECT ?? null;
  const defaultRepo = process.env.OC_EVENTS_DEFAULT_REPO ?? null;
  return {
    dataDir,
    dbPath: path.join(dataDir, "events.db"),
    promptsDir: path.join(dataDir, "prompts"),
    defaultOrg: process.env.OC_EVENTS_DEFAULT_ORG ?? "default",
    defaultWorkspace,
    defaultProject,
    defaultRepo
  };
};
