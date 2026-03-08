/**
 * Minimal VS Code API mock for unit tests.
 * Only the surface area used by zerlyKeyManager.ts and aiService.ts is mocked.
 */

class EventEmitter<T> {
  private _listeners: Array<(e: T) => void> = [];

  readonly event = (listener: (e: T) => void) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter(l => l !== listener); } };
  };

  fire(data: T): void {
    for (const l of this._listeners) l(data);
  }

  dispose(): void {
    this._listeners = [];
  }
}

const vscode = {
  EventEmitter,
  workspace: {
    getConfiguration: jest.fn((_section: string) => ({
      get: (_key: string) => undefined,
      update: jest.fn(async () => {}),
    })),
  },
  window: {
    showWarningMessage: jest.fn(() => Promise.resolve(undefined) as Promise<string | undefined>),
    showErrorMessage: jest.fn(() => Promise.resolve(undefined) as Promise<string | undefined>),
    showInformationMessage: jest.fn(() => Promise.resolve(undefined) as Promise<string | undefined>),
  },
  env: {
    openExternal: jest.fn(),
  },
  Uri: {
    parse: (s: string) => ({ toString: () => s }),
  },
  ConfigurationTarget: { Global: 1 },
};

module.exports = vscode;
