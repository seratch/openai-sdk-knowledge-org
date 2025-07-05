import { Logger } from "@/logger";

export interface RateLimitConfig {
  requestsPerMinute: number;
  retryAttempts: number;
  baseDelayMs: number;
  jitterPercent?: number;
  jitterStrategy?: "exponential" | "linear" | "decorrelated";
}

function getEnvironmentBasedConfig(
  baseConfig: RateLimitConfig,
): RateLimitConfig {
  const isTestEnvironment =
    typeof globalThis !== "undefined" && (globalThis as any).__JEST__ === true;

  if (isTestEnvironment) {
    return {
      ...baseConfig,
      retryAttempts: 1,
      baseDelayMs: 10,
    };
  }
  return baseConfig;
}

export class RateLimiter {
  private requestCount = 0;
  private resetTime = 0;
  private config: RateLimitConfig;

  constructor(baseConfig: RateLimitConfig) {
    this.config = {
      jitterPercent: 25,
      jitterStrategy: "exponential",
      ...getEnvironmentBasedConfig(baseConfig),
    };
  }

  async executeWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForRateLimit();

    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const result = await fn();
        this.updateRequestCount();
        return result;
      } catch (error) {
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === this.config.retryAttempts - 1) {
          throw error;
        }

        const delay = this.calculateBackoffDelay(attempt);
        Logger.warn(
          `Request failed (attempt ${attempt + 1}/${this.config.retryAttempts}), retrying in ${delay}ms:`,
          error,
        );
        await this.delay(delay);
      }
    }

    throw new Error("Max retry attempts exceeded");
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    if (now >= this.resetTime) {
      this.requestCount = 0;
      this.resetTime = now + 60000;
    }

    if (this.requestCount >= this.config.requestsPerMinute) {
      const baseWaitTime = this.resetTime - now;
      const jitter = this.applyJitter(baseWaitTime * 0.1, 0);
      const waitTime = Math.max(1000, baseWaitTime + jitter);
      Logger.info(`Rate limit reached, waiting ${waitTime}ms`);
      await this.delay(waitTime);
      this.requestCount = 0;
      this.resetTime = Date.now() + 60000;
    }

    const loadFactor = this.requestCount / this.config.requestsPerMinute;
    const baseSpacing = 100 + loadFactor * 400;
    const requestSpacing = this.applyJitter(baseSpacing, 0);
    await this.delay(Math.max(25, requestSpacing));
  }

  private updateRequestCount(): void {
    this.requestCount++;
  }

  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = this.config.baseDelayMs * Math.pow(2, attempt);
    return this.applyJitter(baseDelay, attempt);
  }

  private applyJitter(baseDelay: number, _attempt: number): number {
    const strategy = this.config.jitterStrategy || "exponential";

    switch (strategy) {
      case "exponential":
        return baseDelay + Math.random() * baseDelay * 0.5;
      case "decorrelated":
        return Math.random() * (baseDelay * 3);
      case "linear":
      default:
        return baseDelay + Math.random() * 1000;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: any): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (
        message.includes("400") ||
        message.includes("401") ||
        message.includes("403") ||
        message.includes("404") ||
        message.includes("422")
      ) {
        return false;
      }

      if (
        message.includes("vector_upsert_error") ||
        message.includes("status 500") ||
        message.includes("status 502") ||
        message.includes("status 503") ||
        message.includes("status 504")
      ) {
        return true;
      }

      return true;
    }
    return true;
  }
}
