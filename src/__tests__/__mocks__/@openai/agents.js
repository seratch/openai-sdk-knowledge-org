const mockAgent = {
  name: 'mock-agent',
  model: 'gpt-4o',
  instructions: 'Mock agent instructions',
  tools: []
};

const mockRun = jest.fn().mockResolvedValue({
  finalOutput: 'This is a mocked response from OpenAI GPT-4.',
  toolsUsed: []
});

const mockTool = jest.fn().mockImplementation((config) => ({
  name: config.name,
  description: config.description,
  parameters: config.parameters,
  execute: config.execute
}));

class MockAgent {
  constructor(config) {
    this.name = config.name;
    this.model = config.model;
    this.instructions = config.instructions;
    this.tools = config.tools || [];
  }
}

const mockWebSearchTool = jest.fn().mockReturnValue({
  name: 'web_search',
  description: 'Search the web for information',
  type: 'hosted'
});

module.exports = {
  Agent: MockAgent,
  run: mockRun,
  tool: mockTool,
  webSearchTool: mockWebSearchTool
};
