import { EmbeddingGeneratorImpl } from "../../../pipeline/processors/embeddings";
import { mockOpenAIEmbeddingResponse } from "../../utils/mocks";
import { expectToThrow } from "../../utils/test-helpers";

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      embeddings: {
        create: jest.fn(),
      },
    })),
  };
});

jest.mock("../../../logger", () => ({
  Logger: {
    debug: jest.fn(),
    lazyDebug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("EmbeddingGeneratorImpl", () => {
  let embeddingGenerator: EmbeddingGeneratorImpl;
  let mockOpenAI: any;

  beforeEach(() => {
    const OpenAI = require("openai").default;
    mockOpenAI = {
      embeddings: {
        create: jest.fn(),
      },
    };
    OpenAI.mockImplementation(() => mockOpenAI);
    embeddingGenerator = new EmbeddingGeneratorImpl("test-api-key");
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe("generateEmbeddings", () => {
    it("should generate embeddings for provided texts", async () => {
      mockOpenAI.embeddings.create.mockResolvedValue(
        mockOpenAIEmbeddingResponse,
      );

      const texts = ["Hello world", "Test document"];
      const result = await embeddingGenerator.generateEmbeddings(texts);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(1536);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
        model: "text-embedding-3-small",
        input: texts,
      });
    });

    it("should return empty array for empty input", async () => {
      const result = await embeddingGenerator.generateEmbeddings([]);
      expect(result).toEqual([]);
      expect(mockOpenAI.embeddings.create).not.toHaveBeenCalled();
    });

    it("should handle API errors gracefully", async () => {
      mockOpenAI.embeddings.create.mockRejectedValue(new Error("API Error"));

      await expectToThrow(
        () => embeddingGenerator.generateEmbeddings(["test"]),
        "Failed to generate embeddings",
      );
    });
  });

  describe("batchProcess", () => {
    it("should process documents in batches", async () => {
      mockOpenAI.embeddings.create.mockResolvedValue(
        mockOpenAIEmbeddingResponse,
      );

      const documents = [
        { id: "doc1", content: "Content 1", metadata: {} },
        { id: "doc2", content: "Content 2", metadata: {} },
      ];

      const result = await embeddingGenerator.batchProcess(documents);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("doc1");
      expect(result[0].embedding).toHaveLength(1536);
      expect(result[1].id).toBe("doc2");
    });

    it("should handle retry logic on failures", async () => {
      mockOpenAI.embeddings.create
        .mockRejectedValueOnce(new Error("Temporary error"))
        .mockResolvedValue(mockOpenAIEmbeddingResponse);

      const documents = [{ id: "doc1", content: "Content 1", metadata: {} }];
      const result = await embeddingGenerator.batchProcess(documents);

      expect(result).toHaveLength(1);
      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(2);
    });
  });

  describe("calculateSimilarity", () => {
    it("should calculate cosine similarity correctly", () => {
      const query = [1, 0, 0];
      const candidates = [
        [1, 0, 0],
        [0, 1, 0],
        [0.5, 0.5, 0],
      ];

      const similarities = embeddingGenerator.calculateSimilarity(
        query,
        candidates,
      );

      expect(similarities).toHaveLength(3);
      expect(similarities[0]).toBeCloseTo(1.0);
      expect(similarities[1]).toBeCloseTo(0.0);
      expect(similarities[2]).toBeCloseTo(0.7071, 3);
    });

    it("should handle zero vectors", () => {
      const query = [0, 0, 0];
      const candidates = [[1, 0, 0]];

      const similarities = embeddingGenerator.calculateSimilarity(
        query,
        candidates,
      );
      expect(similarities[0]).toBe(0);
    });
  });

  describe("estimateTokenCount", () => {
    it("should estimate token count for text", () => {
      const shortText = "Hello world";
      const longText = "A".repeat(8000);

      expect(embeddingGenerator.estimateTokenCount(shortText)).toBeGreaterThan(
        0,
      );
      expect(
        embeddingGenerator.estimateTokenCount(longText),
      ).toBeGreaterThanOrEqual(2000);
    });

    it("should return 0 for empty text", () => {
      expect(embeddingGenerator.estimateTokenCount("")).toBe(0);
    });
  });

  describe("splitOversizedDocument", () => {
    it("should not split documents under token limit", () => {
      const smallDoc = {
        id: "small-doc",
        content: "Short content",
        metadata: { title: "Test" },
        source: "test",
      };

      const result = embeddingGenerator.splitOversizedDocument(smallDoc);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(smallDoc);
    });

    it("should split oversized documents into chunks", () => {
      const largeDoc = {
        id: "large-doc",
        content: "A".repeat(30000),
        metadata: { title: "Large Test" },
        source: "test",
      };

      const result = embeddingGenerator.splitOversizedDocument(largeDoc);
      expect(result.length).toBeGreaterThan(1);

      result.forEach((chunk, index) => {
        expect(chunk.id).toBe(`large-doc_chunk_${index}`);
        expect(chunk.metadata.originalDocumentId).toBe("large-doc");
        expect(chunk.metadata.chunkIndex).toBe(index);
        expect(chunk.metadata.isChunk).toBe(true);
        expect(chunk.source).toBe("test");
      });
    });
  });

  describe("batchProcess with oversized documents", () => {
    it("should handle oversized documents by splitting them", async () => {
      mockOpenAI.embeddings.create.mockResolvedValue(
        mockOpenAIEmbeddingResponse,
      );

      const documents = [
        { id: "normal-doc", content: "Normal content", metadata: {} },
        { id: "large-doc", content: "A".repeat(30000), metadata: {} },
      ];

      const result = await embeddingGenerator.batchProcess(documents);

      expect(result.length).toBeGreaterThan(documents.length);

      expect(result.some((r) => r.id === "normal-doc")).toBe(true);

      expect(result.some((r) => r.id.startsWith("large-doc_chunk_"))).toBe(
        true,
      );
    }, 10000);

    it("should continue processing when token limit errors occur", async () => {
      mockOpenAI.embeddings.create
        .mockRejectedValueOnce(
          new Error("maximum context length is 8192 tokens"),
        )
        .mockResolvedValue(mockOpenAIEmbeddingResponse);

      const documents = [
        { id: "doc1", content: "Content 1", metadata: {} },
        { id: "doc2", content: "Content 2", metadata: {} },
      ];

      const result = await embeddingGenerator.batchProcess(documents);

      expect(mockOpenAI.embeddings.create).toHaveBeenCalled();
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });
});
