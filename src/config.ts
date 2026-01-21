import path from "node:path";

export type AppConfig = {
  dataDir: string;
  dbPath: string;
  promptsDir: string;
};

export const getDefaultConfig = (): AppConfig => {
  const home = process.env.HOME ?? ".";
  const dataDir = path.join(home, ".config", "opencode", "makiso");
  return {
    dataDir,
    dbPath: path.join(dataDir, "events.db"),
    promptsDir: path.join(dataDir, "prompts")
  };
};
