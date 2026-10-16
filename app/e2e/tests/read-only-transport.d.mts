export type TransportFailure = {
  operation: string;
  attempt: number;
  capturedAt: string;
  code: string;
  willRetry: boolean;
};
export function retryReadOnly<T>(operation: string, read: () => T | Promise<T>, onFailure: (failure: TransportFailure) => void): Promise<T>;
export function readStatic(url: string, onFailure: (failure: TransportFailure) => void): Promise<{
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}>;
export function readRunMetadata(args: string[], onFailure: (failure: TransportFailure) => void): Promise<string>;
