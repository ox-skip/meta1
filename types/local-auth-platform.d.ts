declare module "@/utils/localAuth" {
  export type LocalAuthInfo = {
    hasHardware: boolean;
    enrolled: boolean;
    hasFace: boolean;
    hasFinger: boolean;
  };

  export type LocalAuthPromptResult = {
    success: boolean;
    error?: string;
  };

  export function getLocalAuthInfo(): Promise<LocalAuthInfo>;
  export function authenticateWithDevice(promptMessage: string): Promise<LocalAuthPromptResult>;
}
