const originalConsole = { ...console };

global.fetch = jest.fn();

(globalThis as any).__JEST__ = true;

global.crypto = {
  subtle: {
    digest: jest.fn().mockImplementation(async (_algorithm, _data) => {
      return new ArrayBuffer(32);
    }),
  },
} as any;

global.console = {
  ...console,
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.clearAllTimers();
});

(global as any).restoreConsole = () => {
  global.console = originalConsole;
};

(global as any).mockConsole = () => {
  global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };
};
