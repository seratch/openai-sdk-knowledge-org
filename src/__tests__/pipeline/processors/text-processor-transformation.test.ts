import { TextProcessorImpl } from "../../../pipeline/processors/text-processor";

describe("TextProcessor Content Transformation", () => {
  let processor: TextProcessorImpl;

  beforeEach(() => {
    processor = new TextProcessorImpl();
  });

  describe("transformOutdatedPatterns", () => {
    it("should transform openai.Completion.create to openai.chat.completions.create", () => {
      const input = `
        const response = openai.Completion.create({
          engine: "text-davinci-003",
          prompt: "Hello world",
          max_tokens: 100
        });
      `;

      const result = processor.cleanAndNormalize(input);

      expect(result).toContain("openai.chat.completions.create");
      expect(result).not.toContain("openai.Completion.create");
    });

    it("should transform legacy model names with intelligent context-aware selection", () => {
      const reasoningInput = `
        const response = await openai.chat.completions.create({
          model: "text-davinci-003",
          messages: [{ role: "user", content: "Solve this complex math problem step by step" }]
        });
      `;

      const embeddingInput = `
        const embeddings = await openai.embeddings.create({
          model: "text-embedding-ada-002",
          input: "text to embed"
        });
      `;

      const reasoningResult = processor.cleanAndNormalize(reasoningInput);
      const embeddingResult = processor.cleanAndNormalize(embeddingInput);

      expect(reasoningResult).toContain('"o1"');
      expect(embeddingResult).toContain('"text-embedding-3-large"');
      expect(reasoningResult).not.toContain('"text-davinci-003"');
      expect(embeddingResult).not.toContain('"text-embedding-ada-002"');
    });

    it("should transform legacy embedding models based on context", () => {
      const costOptimizedInput = `
        model: "text-search-ada-doc-001"
      `;

      const highQualityInput = `
        model: "text-embedding-ada-002"
      `;

      const costResult = processor.cleanAndNormalize(costOptimizedInput);
      const qualityResult = processor.cleanAndNormalize(highQualityInput);

      expect(costResult).toContain('"text-embedding-3-small"');
      expect(qualityResult).toContain('"text-embedding-3-large"');
      expect(costResult).not.toContain('"text-search-ada-doc-001"');
      expect(qualityResult).not.toContain('"text-embedding-ada-002"');
    });

    it("should transform response access patterns", () => {
      const input = `
        const text = response.choices[0].text;
        const content = response["choices"][0]["text"];
      `;

      const result = processor.cleanAndNormalize(input);

      expect(result).toContain("response.choices[0].message.content");
      expect(result).not.toContain("response.choices[0].text");
      expect(result).not.toContain('response["choices"][0]["text"]');
    });

    it("should transform parameter names", () => {
      const input = `
        max_tokens: 100,
        engine: "text-davinci-003"
      `;

      const result = processor.cleanAndNormalize(input);

      expect(result).toContain("max_completion_tokens:");
      expect(result).toContain("model:");
      expect(result).not.toContain("max_tokens:");
      expect(result).not.toContain("engine:");
    });

    it("should preserve modern patterns unchanged", () => {
      const input = `
        const response = await openai.chat.completions.create({
          model: "gpt-4.1",
          messages: [{ role: "user", content: "Hello" }],
          max_completion_tokens: 100
        });
        const content = response.choices[0].message.content;
      `;

      const result = processor.cleanAndNormalize(input);

      expect(result).toContain("openai.chat.completions.create");
      expect(result).toContain('"gpt-4.1"');
      expect(result).toContain("max_completion_tokens:");
      expect(result).toContain("response.choices[0].message.content");
    });

    it("should handle cost-optimized model selection", () => {
      const input = `
        model: "text-curie-001"
        model: "text-babbage-001"
        model: "ada"
      `;

      const result = processor.cleanAndNormalize(input);

      expect(result).toContain('"gpt-4.1-mini"');
      expect(result).not.toContain('"text-curie-001"');
      expect(result).not.toContain('"text-babbage-001"');
      expect(result).not.toContain('"ada"');
    });
  });
});
