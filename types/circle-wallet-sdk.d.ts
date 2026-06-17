declare module "@circle-fin/w3s-pw-react-native-sdk" {
  export type SuccessCallback = (result: any) => void;
  export type ErrorCallback = (error: any) => void;

  export const WalletSdk: {
    deviceId?: string;
    init(input: {
      endpoint: string;
      appId: string;
      settingsManagement?: { enableBiometricsPin?: boolean };
    }): Promise<void>;
    execute(
      userToken: string,
      encryptionKey: string,
      challengeIds: string[],
      successCallback: SuccessCallback,
      errorCallback: ErrorCallback,
    ): void;
    setBiometricsPin(
      userToken: string,
      encryptionKey: string,
      successCallback: SuccessCallback,
      errorCallback: ErrorCallback,
    ): void;
    moveRnTaskToFront?: () => void;
  };

  const ProgrammablewalletRnSdk: {
    addListener?: (eventName: string, callback: (event: any) => void) => { remove: () => void };
  };

  export default ProgrammablewalletRnSdk;
}

declare module "@circle-fin/w3s-pw-web-sdk" {
  export class W3SSdk {
    constructor(input: { appSettings: { appId: string } });
    getDeviceId?(): Promise<string> | string;
    setAuthentication(input: { userToken: string; encryptionKey: string }): void;
    execute(challengeId: string, callback: (error: any, result: any) => void): void;
  }
}
