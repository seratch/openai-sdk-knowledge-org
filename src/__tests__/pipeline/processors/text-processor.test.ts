import { TextProcessorImpl } from "../../../pipeline/processors/text-processor";
import { createMockDocument } from "../../utils/test-helpers";

describe("TextProcessorImpl", () => {
  let textProcessor: TextProcessorImpl;

  beforeEach(() => {
    textProcessor = new TextProcessorImpl();
  });

  describe("chunkDocuments", () => {
    it("should chunk documents into smaller pieces", () => {
      const documents = [
        createMockDocument("doc1", "A".repeat(2000), {
          title: "Long Document",
        }),
        createMockDocument("doc2", "Short content", {
          title: "Short Document",
        }),
      ];

      const chunks = textProcessor.chunkDocuments(documents);

      expect(chunks.length).toBeGreaterThan(documents.length);
      expect(chunks[0].content.length).toBeLessThanOrEqual(1000);
    });

    it("should preserve metadata in chunks", () => {
      const documents = [
        createMockDocument("doc1", "Test content", {
          title: "Test Document",
          author: "Test Author",
        }),
      ];

      const chunks = textProcessor.chunkDocuments(documents);

      expect(chunks[0].metadata.title).toBe("Test Document");
      expect(chunks[0].metadata.author).toBe("Test Author");
    });

    it("should handle empty document array", () => {
      const chunks = textProcessor.chunkDocuments([]);
      expect(chunks).toEqual([]);
    });
  });

  describe("cleanAndNormalize", () => {
    it("should normalize whitespace and line endings", () => {
      const dirtyText = "Hello   world!\r\n\nTest   content";
      const cleaned = textProcessor.cleanAndNormalize(dirtyText);

      expect(cleaned).toBe("Hello world! Test content");
    });

    it("should handle empty input", () => {
      expect(textProcessor.cleanAndNormalize("")).toBe("");
    });

    it("should trim whitespace", () => {
      const text = "  Hello world!  ";
      const cleaned = textProcessor.cleanAndNormalize(text);
      expect(cleaned).toBe("Hello world!");
    });
  });

  describe("extractMetadata", () => {
    it("should extract API endpoints from content", () => {
      const content =
        "Use https://api.openai.com/v1/embeddings and POST /v1/chat/completions";
      const metadata = textProcessor.extractMetadata(content);

      expect(metadata.apiEndpoints).toContain(
        "https://api.openai.com/v1/embeddings",
      );
      expect(metadata.apiEndpoints).toContain("POST /v1/chat/completions");
    });

    it("should extract parameters from content", () => {
      const content =
        '"model": { "temperature": 0.7 } and function_call(param)';
      const metadata = textProcessor.extractMetadata(content);

      expect(metadata.parameters).toContain("model");
      expect(metadata.parameters).toContain("function_call");
    });

    it("should detect language from code blocks", () => {
      const content = "```python\nimport openai\n```";
      const metadata = textProcessor.extractMetadata(content);

      expect(metadata.language).toBe("python");
    });
  });
});
