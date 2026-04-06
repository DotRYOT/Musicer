type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = ((process.env.LOG_LEVEL || "info").toLowerCase() as Level);

const shouldLog = (level: Level): boolean => {
  return ORDER[level] >= (ORDER[configuredLevel] ?? ORDER.info);
};

const stamp = (): string => new Date().toISOString();

export const logger = {
  debug: (...args: unknown[]): void => {
    if (shouldLog("debug")) {
      console.debug(`[${stamp()}] [DEBUG]`, ...args);
    }
  },
  info: (...args: unknown[]): void => {
    if (shouldLog("info")) {
      console.info(`[${stamp()}] [INFO]`, ...args);
    }
  },
  warn: (...args: unknown[]): void => {
    if (shouldLog("warn")) {
      console.warn(`[${stamp()}] [WARN]`, ...args);
    }
  },
  error: (...args: unknown[]): void => {
    if (shouldLog("error")) {
      console.error(`[${stamp()}] [ERROR]`, ...args);
    }
  },
};
