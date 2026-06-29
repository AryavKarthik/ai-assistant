export interface NovaBridge {
  ping(): Promise<string>;
}

declare global {
  interface Window {
    nova: NovaBridge;
  }
}

export const nova = (): NovaBridge => window.nova;
