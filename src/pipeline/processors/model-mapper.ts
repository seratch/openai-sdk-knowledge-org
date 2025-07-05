export interface ModelMapping {
  legacyModel: string;
  modernModel: string;
  useCase: "chat" | "reasoning" | "embedding" | "cost-optimized";
  reasoning?: string;
}

export class IntelligentModelMapper {
  private static readonly MODEL_MAPPINGS: ModelMapping[] = [
    {
      legacyModel: "text-davinci-003",
      modernModel: "gpt-4.1",
      useCase: "chat",
      reasoning: "High-quality chat completion",
    },
    {
      legacyModel: "text-davinci-002",
      modernModel: "gpt-4.1",
      useCase: "chat",
      reasoning: "High-quality chat completion",
    },
    {
      legacyModel: "text-davinci-001",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized chat",
    },
    {
      legacyModel: "davinci",
      modernModel: "gpt-4.1",
      useCase: "chat",
      reasoning: "High-quality chat completion",
    },

    {
      legacyModel: "text-curie-001",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized for simple tasks",
    },
    {
      legacyModel: "text-babbage-001",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized for simple tasks",
    },
    {
      legacyModel: "text-ada-001",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized for simple tasks",
    },
    {
      legacyModel: "curie",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized for simple tasks",
    },
    {
      legacyModel: "babbage",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized for simple tasks",
    },
    {
      legacyModel: "ada",
      modernModel: "gpt-4.1-mini",
      useCase: "cost-optimized",
      reasoning: "Cost-optimized for simple tasks",
    },

    {
      legacyModel: "text-embedding-ada-002",
      modernModel: "text-embedding-3-large",
      useCase: "embedding",
      reasoning: "High-quality embeddings",
    },
    {
      legacyModel: "text-search-ada-doc-001",
      modernModel: "text-embedding-3-small",
      useCase: "embedding",
      reasoning: "Cost-optimized embeddings",
    },
    {
      legacyModel: "text-search-ada-query-001",
      modernModel: "text-embedding-3-small",
      useCase: "embedding",
      reasoning: "Cost-optimized embeddings",
    },
  ];

  static selectModelByContext(legacyModel: string, context: string): string {
    const mapping = this.MODEL_MAPPINGS.find(
      (m) => m.legacyModel === legacyModel,
    );
    if (!mapping) {
      return this.getDefaultModernModel(context);
    }

    if (this.isReasoningContext(context)) {
      return this.getReasoningModel(mapping);
    }

    if (this.isEmbeddingContext(context)) {
      return mapping.useCase === "embedding"
        ? mapping.modernModel
        : "text-embedding-3-small";
    }

    return mapping.modernModel;
  }

  private static isReasoningContext(context: string): boolean {
    const reasoningKeywords = [
      "reasoning",
      "logic",
      "math",
      "problem solving",
      "analysis",
      "complex",
      "step by step",
      "chain of thought",
      "reasoning through",
      "solve",
      "calculate",
    ];
    return reasoningKeywords.some((keyword) =>
      context.toLowerCase().includes(keyword),
    );
  }

  private static isEmbeddingContext(context: string): boolean {
    const embeddingKeywords = [
      "embedding",
      "vector",
      "similarity",
      "search",
      "retrieval",
      "semantic",
    ];
    return embeddingKeywords.some((keyword) =>
      context.toLowerCase().includes(keyword),
    );
  }

  private static getReasoningModel(mapping: ModelMapping): string {
    if (mapping.useCase === "cost-optimized") {
      return "o1-mini";
    }
    return "o1";
  }

  private static getDefaultModernModel(context: string): string {
    if (this.isReasoningContext(context)) {
      return "o1";
    }
    if (this.isEmbeddingContext(context)) {
      return "text-embedding-3-small";
    }
    return "gpt-4.1";
  }

  static getAllMappings(): ModelMapping[] {
    return [...this.MODEL_MAPPINGS];
  }
}
