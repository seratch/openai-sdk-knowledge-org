import { TokenCounter } from "../../pipeline/token-counter";

describe("TokenCounter", () => {
  describe("estimateTokens", () => {
    it("calculates tokens based on character count", () => {
      const text = "a".repeat(10);
      expect(TokenCounter.estimateTokens(text)).toBe(Math.ceil(10 / 4));
    });
  });

  describe("estimateTokensForArray", () => {
    it("sums token count for array of strings", () => {
      const texts = ["a".repeat(8), "b".repeat(4)];
      const expected =
        TokenCounter.estimateTokens(texts[0]) +
        TokenCounter.estimateTokens(texts[1]);
      expect(TokenCounter.estimateTokensForArray(texts)).toBe(expected);
    });
  });

  describe("isWithinLimit", () => {
    it("returns true when under the safe limit", () => {
      const tokens = TokenCounter.SAFE_TOKEN_LIMIT - 10;
      const text = "a".repeat(tokens * 4);
      expect(TokenCounter.isWithinLimit([text])).toBe(true);
    });

    it("returns false when over the safe limit", () => {
      const tokens = TokenCounter.SAFE_TOKEN_LIMIT + 10;
      const text = "a".repeat(tokens * 4);
      expect(TokenCounter.isWithinLimit([text])).toBe(false);
    });
  });

  describe("findMaxBatchSize", () => {
    it("finds largest batch that fits within limit", () => {
      const singleLength = (TokenCounter.SAFE_TOKEN_LIMIT / 2) * 4;
      const texts = [
        "a".repeat(singleLength),
        "b".repeat(singleLength),
        "c".repeat(singleLength),
      ];
      expect(TokenCounter.findMaxBatchSize(texts, 3)).toBe(2);
    });

    it("returns 1 when all items exceed the limit individually", () => {
      const text = "a".repeat((TokenCounter.SAFE_TOKEN_LIMIT + 5) * 4);
      expect(TokenCounter.findMaxBatchSize([text], 5)).toBe(1);
    });
  });

  describe("truncateText", () => {
    it("truncates to token boundary and respects word breaks", () => {
      const text = "12345678901234 5678"; // space after index 14
      const maxTokens = 4; // 16 chars
      expect(TokenCounter.truncateText(text, maxTokens)).toBe("12345678901234");
    });
  });

  describe("validateAndTruncateContent", () => {
    it("returns content when below byte limit", () => {
      const text = "hello";
      expect(TokenCounter.validateAndTruncateContent(text, 20)).toBe(text);
    });

    it("truncates and appends marker when over byte limit", () => {
      const text = "a".repeat(50);
      const result = TokenCounter.validateAndTruncateContent(text, 20);
      expect(result.startsWith("a".repeat(10))).toBe(true);
      expect(result.endsWith("... [TRUNCATED]")).toBe(true);
    });
  });
});
