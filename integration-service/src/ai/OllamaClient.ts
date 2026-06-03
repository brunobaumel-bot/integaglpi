import { ResilientHttpClient } from '../infra/http/ResilientHttpClient.js';
import { parseAiQualityResult } from './parseAiQualityResult.js';
import type { AiQualityResult } from './aiQualityTypes.js';

interface OllamaGenerateResponse {
  response?: string;
}

export class OllamaClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly httpClient = new ResilientHttpClient(),
  ) {}

  public async analyze(prompt: string): Promise<AiQualityResult> {
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
      throw new Error(`OLLAMA_HTTP_${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    const rawResult = typeof body.response === 'string' ? body.response : JSON.stringify(body);

    return parseAiQualityResult(rawResult);
  }

  /**
   * Free-text generation (no forced JSON). Used for the local technical summary.
   * Local provider only; the caller is responsible for PII sanitization of the
   * prompt. Returns the model's plain-text response (trimmed by the caller).
   */
  public async generateText(prompt: string): Promise<string> {
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
      }),
    });

    if (!response.ok) {
      throw new Error(`OLLAMA_HTTP_${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    return typeof body.response === 'string' ? body.response : '';
  }
}
