import { parseCopilotDraftResult } from '../ai/parseCopilotDraftResult.js';
import type { CopilotDraftResult } from '../ai/copilotTypes.js';
import { ResilientHttpClient } from '../infra/http/ResilientHttpClient.js';

interface OllamaGenerateResponse {
  response?: string;
}

export interface CopilotDraftProvider {
  generate(prompt: string): Promise<CopilotDraftResult>;
}

export class OllamaCopilotProvider implements CopilotDraftProvider {
  public constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly httpClient = new ResilientHttpClient(),
  ) {}

  public async generate(prompt: string): Promise<CopilotDraftResult> {
    const response = await this.httpClient.request(`${this.baseUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      timeoutMs: this.timeoutMs,
      retries: 0,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        format: 'json',
      }),
    });

    if (!response.ok) {
      throw new Error(`COPILOT_OLLAMA_HTTP_${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    const rawResult = typeof body.response === 'string' ? body.response : JSON.stringify(body);

    return parseCopilotDraftResult(rawResult);
  }
}
