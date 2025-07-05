import { IntelligentModelMapper } from "../../pipeline/processors/model-mapper";

describe("IntelligentModelMapper", () => {
  describe("selectModelByContext", () => {
    it("should select reasoning models for reasoning contexts", () => {
      const contexts = [
        "This requires complex reasoning and step-by-step analysis",
        "Solve this math problem using logic",
        "Chain of thought reasoning through the problem",
      ];

      contexts.forEach((context) => {
        const result = IntelligentModelMapper.selectModelByContext(
          "text-davinci-003",
          context,
        );
        expect(result).toBe("o1");
      });
    });

    it("should select cost-optimized reasoning models for simple legacy models", () => {
      const context = "This requires reasoning and problem solving";
      const result = IntelligentModelMapper.selectModelByContext(
        "text-curie-001",
        context,
      );
      expect(result).toBe("o1-mini");
    });

    it("should select embedding models for embedding contexts", () => {
      const contexts = [
        "Generate embeddings for similarity search",
        "Vector representation for semantic retrieval",
        "Embedding model for document search",
      ];

      contexts.forEach((context) => {
        const result = IntelligentModelMapper.selectModelByContext(
          "text-embedding-ada-002",
          context,
        );
        expect(result).toBe("text-embedding-3-large");
      });
    });

    it("should select appropriate chat models for general contexts", () => {
      const context = "Generate a response to the user's question";
      const result = IntelligentModelMapper.selectModelByContext(
        "text-davinci-003",
        context,
      );
      expect(result).toBe("gpt-4.1");
    });

    it("should handle unknown legacy models", () => {
      const context = "General chat completion";
      const result = IntelligentModelMapper.selectModelByContext(
        "unknown-model",
        context,
      );
      expect(result).toBe("gpt-4.1");
    });

    it("should select default models based on context when no mapping exists", () => {
      const reasoningContext = "Complex problem solving task";
      const embeddingContext = "Semantic similarity search";
      const generalContext = "General conversation";

      expect(
        IntelligentModelMapper.selectModelByContext(
          "unknown",
          reasoningContext,
        ),
      ).toBe("o1");
      expect(
        IntelligentModelMapper.selectModelByContext(
          "unknown",
          embeddingContext,
        ),
      ).toBe("text-embedding-3-small");
      expect(
        IntelligentModelMapper.selectModelByContext("unknown", generalContext),
      ).toBe("gpt-4.1");
    });
  });

  describe("getAllMappings", () => {
    it("should return all model mappings", () => {
      const mappings = IntelligentModelMapper.getAllMappings();
      expect(mappings.length).toBeGreaterThan(0);
      expect(mappings[0]).toHaveProperty("legacyModel");
      expect(mappings[0]).toHaveProperty("modernModel");
      expect(mappings[0]).toHaveProperty("useCase");
    });
  });
});
