export interface CloudPilotRequest {
  prompt: string;
  model: string;
  timeoutMs: number;
}

export interface CloudPilotResult {
  text: string;
  provider: string;
  estimatedCost: number;
  actualCost: number | null;
}

export interface CloudPilotProvider {
  complete(request: CloudPilotRequest): Promise<CloudPilotResult>;
}

export class DisabledCloudPilotProvider implements CloudPilotProvider {
  public async complete(): Promise<CloudPilotResult> {
    throw new Error('AI_PILOT_PROVIDER_DISABLED');
  }
}

export class LocalFallbackPilotProvider implements CloudPilotProvider {
  public async complete(request: CloudPilotRequest): Promise<CloudPilotResult> {
    const preview = request.prompt.replace(/\s+/g, ' ').trim().slice(0, 220);
    return {
      text: `Fallback local sintético. Payload anonimizado recebido: ${preview}`,
      provider: 'local',
      estimatedCost: 0,
      actualCost: 0,
    };
  }
}

export class CloudPilotProviderStub implements CloudPilotProvider {
  public async complete(): Promise<CloudPilotResult> {
    throw new Error('AI_PILOT_CLOUD_PROVIDER_NOT_CONFIGURED');
  }
}

export function createPilotProvider(provider: 'disabled' | 'local' | 'cloud'): CloudPilotProvider {
  if (provider === 'cloud') {
    return new CloudPilotProviderStub();
  }
  if (provider === 'local') {
    return new LocalFallbackPilotProvider();
  }
  return new DisabledCloudPilotProvider();
}
