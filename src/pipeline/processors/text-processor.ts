import { IntelligentModelMapper } from "@/pipeline/processors/model-mapper";
import { TokenCounter } from "@/pipeline/token-counter";
import { IdUtils } from "@/pipeline/processors/id-utils";

export interface JupyterNotebook {
  cells: JupyterCell[];
  metadata?: {
    kernelspec?: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info?: {
      name: string;
      version?: string;
    };
  };
  nbformat: number;
  nbformat_minor: number;
}

export interface JupyterCell {
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  metadata?: any;
  execution_count?: number | null;
  outputs?: any[];
}

export interface Document {
  id: string;
  content: string;
  metadata: ContentMetadata;
  source: string;
}

export interface DocumentChunk {
  id: string;
  content: string;
  metadata: ContentMetadata;
  chunkIndex: number;
  parentDocumentId: string;
}

export interface ContentMetadata {
  title?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceUrl?: string;
  tags?: string[];
  category?: string;
  language?: string;
  apiEndpoints?: string[];
  parameters?: string[];
  chunkIndex?: number;
  notebookKernel?: string;
  cellTypes?: string[];
  totalCells?: number;
  codeCells?: number;
  markdownCells?: number;
}

export interface TextProcessor {
  chunkDocuments(documents: Document[]): DocumentChunk[];
  extractMetadata(content: string): ContentMetadata;
  cleanAndNormalize(text: string): string;
}

export class TextProcessorImpl implements TextProcessor {
  private readonly chunkSize: number = 600;
  private readonly chunkOverlap: number = 100;

  chunkDocuments(documents: Document[]): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];

    for (const doc of documents) {
      let processedContent: string;
      let enhancedMetadata = { ...doc.metadata };

      if (
        doc.source.toLowerCase().endsWith(".ipynb") ||
        (doc.content.trim().startsWith("{") && doc.content.includes('"cells"'))
      ) {
        const notebookData = this.parseJupyterNotebook(doc.content);
        processedContent = notebookData.text;
        enhancedMetadata = { ...enhancedMetadata, ...notebookData.metadata };
      } else {
        processedContent = this.filterOSRuntimeMetadata(doc.content);
      }

      const text = this.cleanAndNormalize(processedContent);
      const docChunks = this.createChunks(text, {
        ...doc,
        metadata: enhancedMetadata,
      });
      chunks.push(...docChunks);
    }

    return chunks;
  }

  extractMetadata(content: string): ContentMetadata {
    const apiEndpoints = this.extractApiEndpoints(content);
    const parameters = this.extractParameters(content);
    const language = this.detectLanguage(content);

    return {
      apiEndpoints,
      parameters,
      language,
    };
  }

  cleanAndNormalize(text: string): string {
    const cleaned = text.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    return this.transformOutdatedPatterns(cleaned);
  }

  private transformOutdatedPatterns(text: string): string {
    let transformed = text;

    transformed = transformed.replace(
      /openai\.Completion\.create\s*\(/g,
      "openai.chat.completions.create(",
    );

    transformed = transformed.replace(
      /openai\.completions\.create\s*\(/g,
      "openai.chat.completions.create(",
    );

    transformed = this.transformModelsIntelligently(transformed);

    transformed = transformed.replace(
      /(\w+)\s*=\s*openai\.Completion\.create\s*\(\s*engine\s*=\s*["']([^"']+)["']/g,
      (_match, varName, legacyModel) => {
        const modernModel = IntelligentModelMapper.selectModelByContext(
          legacyModel,
          transformed,
        );
        return `${varName} = openai.chat.completions.create(model="${modernModel}"`;
      },
    );

    transformed = transformed.replace(
      /prompt\s*=\s*["']([^"']+)["']/g,
      'messages=[{"role": "user", "content": "$1"}]',
    );

    transformed = transformed.replace(
      /\bmax_tokens\s*:/g,
      "max_completion_tokens:",
    );
    transformed = transformed.replace(
      /\bmax_tokens\s*=/g,
      "max_completion_tokens=",
    );
    transformed = transformed.replace(/\bengine\s*:/g, "model:");
    transformed = transformed.replace(/\bengine\s*=/g, "model=");

    transformed = transformed.replace(
      /response\[["']choices["']\]\[0\]\[["']text["']\]/g,
      "response.choices[0].message.content",
    );

    transformed = transformed.replace(
      /response\.choices\[0\]\.text/g,
      "response.choices[0].message.content",
    );

    return transformed;
  }

  private transformModelsIntelligently(text: string): string {
    let transformed = text;

    const modelPattern =
      /["'](text-davinci-003|text-davinci-002|text-davinci-001|text-curie-001|text-babbage-001|text-ada-001|davinci|curie|babbage|ada|text-embedding-ada-002|text-search-ada-doc-001|text-search-ada-query-001)["']/g;

    transformed = transformed.replace(modelPattern, (_match, legacyModel) => {
      const modernModel = IntelligentModelMapper.selectModelByContext(
        legacyModel,
        text,
      );
      return `"${modernModel}"`;
    });

    return transformed;
  }

  private createChunks(text: string, doc: Document): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let currentPos = 0;
    let chunkIndex = 0;

    while (currentPos < text.length) {
      const chunkEnd = Math.min(currentPos + this.chunkSize, text.length);
      let actualEnd = chunkEnd;

      if (chunkEnd < text.length) {
        const nextSpace = text.indexOf(" ", chunkEnd);
        if (nextSpace !== -1 && nextSpace - chunkEnd < 100) {
          actualEnd = nextSpace;
        }
      }

      const chunkContent = text.slice(currentPos, actualEnd);

      const maxTokensPerChunk = 500;
      const truncatedContent = TokenCounter.truncateText(
        chunkContent,
        maxTokensPerChunk,
      );

      chunks.push({
        id: IdUtils.ensureSafeId(`${doc.id}_chunk_${chunkIndex}`),
        parentDocumentId: doc.id,
        content: truncatedContent,
        metadata: {
          ...doc.metadata,
          chunkIndex,
        },
        chunkIndex,
      });

      currentPos = Math.max(actualEnd - this.chunkOverlap, currentPos + 1);
      chunkIndex++;
    }

    return chunks;
  }

  private filterOSRuntimeMetadata(content: string): string {
    const patterns = [
      /\b(node|nodejs)\s+v?\d+\.\d+\.\d+/gi,
      /\b(python)\s+\d+\.\d+\.\d+/gi,
      /\b(windows|macos|linux|ubuntu)\s+\d+/gi,
      /\bos:\s*[^\n]+/gi,
      /\bplatform:\s*[^\n]+/gi,
      /\bversion:\s*\d+\.\d+\.\d+/gi,
      /\bruntime:\s*[^\n]+/gi,
    ];

    let filteredContent = content;
    patterns.forEach((pattern) => {
      filteredContent = filteredContent.replace(pattern, "");
    });

    return filteredContent.replace(/\n\s*\n/g, "\n").trim();
  }

  private extractApiEndpoints(content: string): string[] {
    const patterns = [
      /https:\/\/api\.openai\.com\/v\d+\/[^\s)]+/g,
      /POST \/v\d+\/[^\s)]+/g,
      /GET \/v\d+\/[^\s)]+/g,
      /PUT \/v\d+\/[^\s)]+/g,
      /DELETE \/v\d+\/[^\s)]+/g,
    ];

    const endpoints = new Set<string>();

    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        matches.forEach((match) => endpoints.add(match.trim()));
      }
    }

    return Array.from(endpoints);
  }

  private extractParameters(content: string): string[] {
    const patterns = [
      /"([a-z_]+)":\s*{/g,
      /\b([a-z_]+)\s*\(.*?\)/g,
      /--([a-z-]+)/g,
    ];

    const parameters = new Set<string>();

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        parameters.add(match[1]);
      }
    }

    return Array.from(parameters);
  }

  private detectLanguage(content: string): string {
    const languagePatterns = [
      { pattern: /```python/i, language: "python" },
      { pattern: /```javascript/i, language: "javascript" },
      { pattern: /```typescript/i, language: "typescript" },
      { pattern: /```json/i, language: "json" },
      { pattern: /```bash/i, language: "bash" },
      { pattern: /```curl/i, language: "curl" },
      { pattern: /import\s+\w+/g, language: "python" },
      { pattern: /const\s+\w+\s*=/g, language: "javascript" },
      { pattern: /curl\s+-/g, language: "curl" },
      { pattern: /"cell_type":\s*"code"/g, language: "jupyter" },
      { pattern: /"kernelspec".*"python"/g, language: "python" },
      { pattern: /"language_info".*"python"/g, language: "python" },
      { pattern: /"language_info".*"javascript"/g, language: "javascript" },
    ];

    for (const { pattern, language } of languagePatterns) {
      if (pattern.test(content)) {
        return language;
      }
    }

    return "text";
  }

  private parseJupyterNotebook(content: string): {
    text: string;
    metadata: Partial<ContentMetadata>;
  } {
    try {
      const notebook: JupyterNotebook = JSON.parse(content);

      let combinedText = "";
      let codeCells = 0;
      let markdownCells = 0;
      const cellTypes: string[] = [];

      for (const cell of notebook.cells) {
        cellTypes.push(cell.cell_type);

        const cellSource = Array.isArray(cell.source)
          ? cell.source.join("")
          : cell.source;

        if (cell.cell_type === "code") {
          codeCells++;
          combinedText += `\n\n--- CODE CELL ---\n${cellSource}\n--- END CODE CELL ---\n`;
        } else if (cell.cell_type === "markdown") {
          markdownCells++;
          combinedText += `\n\n${cellSource}\n`;
        } else if (cell.cell_type === "raw") {
          combinedText += `\n\n${cellSource}\n`;
        }
      }

      const notebookMetadata: Partial<ContentMetadata> = {
        language:
          notebook.metadata?.language_info?.name ||
          notebook.metadata?.kernelspec?.language ||
          "python",
        notebookKernel: notebook.metadata?.kernelspec?.display_name,
        cellTypes: [...new Set(cellTypes)],
        totalCells: notebook.cells.length,
        codeCells,
        markdownCells,
      };

      return {
        text: combinedText.trim(),
        metadata: notebookMetadata,
      };
    } catch (error) {
      return {
        text: content,
        metadata: { language: "text" },
      };
    }
  }
}
