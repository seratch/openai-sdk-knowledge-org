export type LogLevel = "debug" | "info" | "warn" | "error";

export class Logger {
  private static logLevel: LogLevel = "info";

  static setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  static getLogLevel(): LogLevel {
    return this.logLevel;
  }

  private static shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  static lazyDebug(message: () => string) {
    if (this.shouldLog("debug")) {
      console.log(`🔍 DEBUG: ${message()}`);
    }
  }

  static info(message: string, ...args: any[]) {
    if (this.shouldLog("info")) {
      console.log(`ℹ️  INFO: ${message}`, ...args);
    }
  }

  static warn(message: string, ...args: any[]) {
    if (this.shouldLog("warn")) {
      console.warn(`⚠️  WARN: ${message}`, ...args);
    }
  }

  static error(message: string, ...args: any[]) {
    if (this.shouldLog("error")) {
      console.error(`❌ ERROR: ${message}`, ...args);
    }
  }
}
