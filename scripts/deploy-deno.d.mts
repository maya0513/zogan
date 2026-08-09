export interface DeployResult {
  code: number;
  stderr: string;
  stdout: string;
  success: boolean;
}

export function deployWithRetry(run: () => Promise<DeployResult>): Promise<DeployResult>;
