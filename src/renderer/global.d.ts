import type { DesktopApi } from '../shared/contracts';

declare global {
  interface Window {
    agentPipeline: DesktopApi;
  }
}

export {};
