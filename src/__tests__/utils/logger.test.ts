import { Logger } from "../../logger";

describe("Logger", () => {
  beforeEach(() => {
    Logger.setLogLevel("debug");
    (global as any).mockConsole();
  });

  describe("setLogLevel and getLogLevel", () => {
    it("should set and get log level correctly", () => {
      Logger.setLogLevel("warn");
      expect(Logger.getLogLevel()).toBe("warn");
    });
  });

  describe("debug", () => {
    it("should log debug messages when level is debug", () => {
      Logger.setLogLevel("debug");
      Logger.lazyDebug(() => "Test debug message");
      expect(console.log).toHaveBeenCalledWith("🔍 DEBUG: Test debug message");
    });

    it("should not log debug messages when level is info", () => {
      Logger.setLogLevel("info");
      Logger.lazyDebug(() => "Test debug message");
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("info", () => {
    it("should log info messages when level is info or lower", () => {
      Logger.setLogLevel("info");
      Logger.info("Test info message");
      expect(console.log).toHaveBeenCalledWith("ℹ️  INFO: Test info message");
    });

    it("should not log info messages when level is warn", () => {
      Logger.setLogLevel("warn");
      Logger.info("Test info message");
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("warn", () => {
    it("should log warn messages when level is warn or lower", () => {
      Logger.setLogLevel("warn");
      Logger.warn("Test warn message");
      expect(console.warn).toHaveBeenCalledWith("⚠️  WARN: Test warn message");
    });

    it("should not log warn messages when level is error", () => {
      Logger.setLogLevel("error");
      Logger.warn("Test warn message");
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe("error", () => {
    it("should always log error messages", () => {
      Logger.setLogLevel("error");
      Logger.error("Test error message");
      expect(console.error).toHaveBeenCalledWith(
        "❌ ERROR: Test error message",
      );
    });
  });

  describe("log level filtering", () => {
    it("should respect log level hierarchy", () => {
      Logger.setLogLevel("warn");

      Logger.lazyDebug(() => "Debug message");
      Logger.info("Info message");
      Logger.warn("Warn message");
      Logger.error("Error message");

      expect(console.log).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith("⚠️  WARN: Warn message");
      expect(console.error).toHaveBeenCalledWith("❌ ERROR: Error message");
    });
  });
});
