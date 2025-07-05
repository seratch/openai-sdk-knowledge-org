export class TokenCounter {
  private static readonly CHARS_PER_TOKEN = 4;

  private static readonly MAX_TOKENS_PER_REQUEST = 8192;

  private static readonly SAFETY_MARGIN = 1000;

  public static readonly SAFE_TOKEN_LIMIT =
    TokenCounter.MAX_TOKENS_PER_REQUEST - TokenCounter.SAFETY_MARGIN;

  public static readonly D1_MAX_ROW_SIZE = 2000000;
  public static readonly D1_SAFE_CONTENT_SIZE = 1500000;
  public static readonly D1_SAFE_JSON_SIZE = 100000;

  static estimateTokens(text: string): number {
    return Math.ceil(text.length / TokenCounter.CHARS_PER_TOKEN);
  }

  static estimateTokensForArray(texts: string[]): number {
    return texts.reduce(
      (total, text) => total + TokenCounter.estimateTokens(text),
      0,
    );
  }

  static isWithinLimit(texts: string[]): boolean {
    return (
      TokenCounter.estimateTokensForArray(texts) <=
      TokenCounter.SAFE_TOKEN_LIMIT
    );
  }

  static findMaxBatchSize(texts: string[], startSize: number = 100): number {
    for (let size = Math.min(startSize, texts.length); size > 0; size--) {
      const batch = texts.slice(0, size);
      if (TokenCounter.isWithinLimit(batch)) {
        return size;
      }
    }
    return 1;
  }

  static truncateText(text: string, maxTokens: number): string {
    const maxChars = maxTokens * TokenCounter.CHARS_PER_TOKEN;
    if (text.length <= maxChars) {
      return text;
    }

    const truncated = text.substring(0, maxChars);
    const lastSpace = truncated.lastIndexOf(" ");

    return lastSpace > maxChars * 0.8
      ? truncated.substring(0, lastSpace)
      : truncated;
  }

  static validateAndTruncateContent(
    content: string,
    maxBytes: number = TokenCounter.D1_SAFE_CONTENT_SIZE,
  ): string {
    const contentBytes = new TextEncoder().encode(content).length;

    if (contentBytes <= maxBytes) {
      return content;
    }

    const safeCharCount = Math.floor(maxBytes / 2);
    const truncated = content.substring(0, safeCharCount);

    const lastSpace = truncated.lastIndexOf(" ");
    const finalContent =
      lastSpace > safeCharCount * 0.8
        ? truncated.substring(0, lastSpace)
        : truncated;

    return finalContent + "... [TRUNCATED]";
  }
}
