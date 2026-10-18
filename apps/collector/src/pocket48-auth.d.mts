export declare const CREDENTIAL_PATH: string;
export declare function loadCredential(): Promise<{ token?: string; deviceId?: string } | null>;
export declare function createPocket48Pa(): Promise<string>;
