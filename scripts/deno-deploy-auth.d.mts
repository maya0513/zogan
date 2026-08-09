export interface DeployClientOptions {
  apiEndpoint: string;
  org?: string;
  token: string;
}

export function deployClientOptions(token: string, org: string): DeployClientOptions;
