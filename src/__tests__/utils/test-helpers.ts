export const createMockDocument = (
  id: string,
  content: string,
  metadata: any = {},
) => ({
  id,
  content,
  metadata: {
    title: `Test Document ${id}`,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
    ...metadata,
  },
  source: "test",
});

export const createMockEmbeddedDocument = (
  id: string,
  content: string,
  embedding?: number[],
) => ({
  id,
  content,
  embedding: embedding || new Array(1536).fill(0).map(() => Math.random()),
  metadata: {
    title: `Test Document ${id}`,
    createdAt: "2023-01-01T00:00:00Z",
  },
});

export const waitFor = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const expectToThrow = async (
  fn: () => Promise<any>,
  expectedError?: string,
) => {
  try {
    await fn();
    throw new Error("Expected function to throw");
  } catch (error) {
    if (expectedError && error instanceof Error) {
      expect(error.message).toContain(expectedError);
    }
  }
};
