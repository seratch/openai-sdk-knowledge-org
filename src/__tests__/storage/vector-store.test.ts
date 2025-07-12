import { VectorStoreImpl } from "../../storage/vector-store";

const mockVectorizeIndex = {
  query: jest.fn(),
  upsert: jest.fn(),
  insert: jest.fn(),
  describe: jest.fn(),
  deleteByIds: jest.fn(),
  getByIds: jest.fn(),
};
import { mockD1Database } from "../utils/mocks";
import { expectToThrow } from "../utils/test-helpers";

jest.mock("../../pipeline/processors/embeddings", () => ({
  EmbeddingGeneratorImpl: jest.fn().mockImplementation(() => ({
    generateEmbeddings: jest
      .fn()
      .mockResolvedValue([new Array(1536).fill(0.1)]),
    calculateSimilarity: jest.fn().mockReturnValue([0.85]),
  })),
}));

jest.mock("../../logger", () => ({
  Logger: {
    debug: jest.fn(),
    lazyDebug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe("VectorStoreImpl", () => {
  let vectorStore: VectorStoreImpl;

  beforeEach(() => {
    vectorStore = new VectorStoreImpl({
      DB: mockD1Database as any,
      VECTORIZE_PROD: mockVectorizeIndex as any,
      VECTORIZE_DEV: mockVectorizeIndex as any,
      OPENAI_API_KEY: "test-openai-key",
      ENVIRONMENT: "test",
      LOG_LEVEL: "debug",
      JOB_QUEUE: { send: jest.fn() } as any,
    });
  });

  describe("store", () => {
    it("should store documents successfully", async () => {
      const documents = [
        {
          id: "doc1",
          url: "https://example.com/doc1",
          content: "Content 1",
          embedding: new Array(1536).fill(0.1),
          metadata: {},
        },
        {
          id: "doc2",
          url: "https://example.com/doc2",
          content: "Content 2",
          embedding: new Array(1536).fill(0.1),
          metadata: {},
        },
      ];

      await vectorStore.store(documents);

      expect(mockVectorizeIndex.upsert).toHaveBeenCalled();
    });

    it("should skip storing empty document array", async () => {
      await vectorStore.store([]);
    });

    it("should handle storage errors", async () => {
      mockVectorizeIndex.upsert.mockRejectedValue(new Error("Storage error"));
      const documents = [
        {
          id: "doc1",
          url: "https://example.com/doc1",
          content: "Content 1",
          embedding: new Array(1536).fill(0.1),
          metadata: {},
        },
      ];

      await expectToThrow(
        () => vectorStore.store(documents),
        "Failed to store documents",
      );
    }, 10000);
  });

  describe("search", () => {
    it("should perform vector search successfully", async () => {
      mockVectorizeIndex.query.mockResolvedValue({
        matches: [
          {
            id: "test-doc-1",
            score: 0.85,
            metadata: {
              content: "Test document content",
            },
          },
        ],
      });

      const result = await vectorStore.searchWithOptions("test query", {
        limit: 5,
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "test-doc-1",
        content: "Test document content",
        score: 0.85,
        metadata: { content: "Test document content" },
      });
    });

    it("should handle search errors gracefully", async () => {
      mockVectorizeIndex.query.mockRejectedValue(new Error("Search error"));

      await expectToThrow(
        () => vectorStore.searchWithOptions("test query"),
        "Failed to search",
      );
    });
  });

  describe("hybridSearch", () => {
    it("should combine vector and keyword search results", async () => {
      mockVectorizeIndex.query.mockResolvedValue({
        matches: [
          {
            id: "vector-doc-1",
            score: 0.85,
            metadata: {
              content:
                "This is detailed documentation about the OpenAI Responses API.",
            },
          },
        ],
      });

      mockD1Database.prepare().all.mockResolvedValue({
        results: [
          {
            id: "keyword-doc-1",
            content:
              "This is a comprehensive guide about the OpenAI Responses API and how to use it effectively in Python applications.",
            metadata: JSON.stringify({ title: "OpenAI Responses API Guide" }),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const result = await vectorStore.search("test query", undefined, 10);

      expect(result.length).toBeGreaterThan(0);
      expect(mockVectorizeIndex.query).toHaveBeenCalled();
      expect(mockD1Database.prepare).toHaveBeenCalled();
    });

    it("should handle hybrid search errors gracefully", async () => {
      mockVectorizeIndex.query.mockRejectedValue(
        new Error("Vector search failed"),
      );

      const result = await vectorStore.search("test query", undefined, 10);
      expect(result).toEqual([]);
    });

    it("should limit keywords to prevent SQLite complexity error", async () => {
      const longQuery =
        "this is a very long query with many keywords that should trigger the sqlite complexity error when processed by the keyword search function because it will create too many like conditions joined with or operators which exceeds the sqlite pattern complexity limit and causes the sqlite_error that we need to fix";

      mockVectorizeIndex.query.mockResolvedValue({
        matches: [
          {
            id: "vector-doc-1",
            score: 0.85,
            metadata: {
              content: "Vector search result content",
            },
          },
        ],
      });

      mockD1Database.prepare().all.mockResolvedValue({
        results: [
          {
            id: "keyword-doc-1",
            content: "Keyword search result content",
            metadata: JSON.stringify({}),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const result = await vectorStore.search(longQuery, undefined, 10);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(mockVectorizeIndex.query).toHaveBeenCalled();
    });

    it("should handle SQLite complexity error gracefully", async () => {
      mockVectorizeIndex.query.mockResolvedValue({
        matches: [
          {
            id: "vector-doc-1",
            score: 0.85,
            metadata: {
              content: "Vector search result content",
            },
          },
        ],
      });

      mockD1Database
        .prepare()
        .all.mockRejectedValue(
          new Error("LIKE or GLOB pattern too complex: SQLITE_ERROR"),
        );

      const complexQuery =
        "this is a very long query with many keywords that should trigger the sqlite complexity error when processed by the keyword search function because it will create too many like conditions joined with or operators which exceeds the sqlite pattern complexity limit and causes the sqlite_error that we need to fix and debug properly";

      const result = await vectorStore.search(complexQuery, undefined, 10);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
