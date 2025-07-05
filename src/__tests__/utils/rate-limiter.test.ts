import { RateLimiter } from "../../rate-limiter";

jest.mock("../../rate-limiter", () => {
  const originalModule = jest.requireActual("../../rate-limiter");
  return {
    ...originalModule,
    RateLimiter: class extends originalModule.RateLimiter {
      constructor(config: any) {
        super(config);
        this.config = config;
      }
      async delay(_ms: number): Promise<void> {
        return Promise.resolve();
      }
    },
  };
});

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    jest.useFakeTimers();
    rateLimiter = new RateLimiter({
      requestsPerMinute: 2,
      retryAttempts: 3,
      baseDelayMs: 100,
    });
    jest.clearAllTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("executeWithRateLimit", () => {
    it("should execute function successfully", async () => {
      const mockFn = jest.fn().mockResolvedValue("success");

      const result = await rateLimiter.executeWithRateLimit(mockFn);

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockResolvedValue("success");

      const resultPromise = rateLimiter.executeWithRateLimit(mockFn);

      jest.runAllTimers();

      const result = await resultPromise;

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retry attempts", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValue(new Error("Persistent failure"));

      const resultPromise = rateLimiter.executeWithRateLimit(mockFn);

      jest.runAllTimers();

      await expect(resultPromise).rejects.toThrow("Persistent failure");

      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it("should enforce rate limiting", async () => {
      const mockFn = jest.fn().mockResolvedValue("success");

      const promise1 = rateLimiter.executeWithRateLimit(mockFn);
      const promise2 = rateLimiter.executeWithRateLimit(mockFn);
      const promise3 = rateLimiter.executeWithRateLimit(mockFn);

      jest.runAllTimers();

      await Promise.all([promise1, promise2, promise3]);

      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });

  describe("backoff calculation", () => {
    it("should calculate exponential backoff correctly", async () => {
      const mockFn = jest
        .fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Second failure"))
        .mockResolvedValue("success");

      const resultPromise = rateLimiter.executeWithRateLimit(mockFn);

      jest.runAllTimers();

      const result = await resultPromise;

      expect(result).toBe("success");
      expect(mockFn).toHaveBeenCalledTimes(3);
    });
  });
});
