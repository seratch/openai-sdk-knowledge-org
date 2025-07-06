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
