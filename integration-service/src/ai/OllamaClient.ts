import { ResilientHttpClient } from '../infra/http/ResilientHttpClient.js';
import { parseAiQualityResult } from './parseAiQualityResult.js';
import type { AiQualityResult } from './aiQualityTypes.js';

interface OllamaGenerateResponse {
  response?: string;
}

/**
 * Optional generation parameters for deterministic output.
 * Per MODEL_CONFIG (integaglpi_local_kb_rag_model_query_expansion_adendum_001):
 *   temperature: 0.2 (low — focused, less creative)
 *   top_p: 0.9
 *   repeat_penalty: 1.1
 */
export interface OllamaGenerationOptions {
  temperature?: number;
  topP?: number;
  repeatPenalty?: number;
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
   * Free-text generation (no forced JSON). Used for the local technical summary
   * and KB RAG copilot. Local provider only; the caller is responsible for PII
   * sanitization of the prompt. Returns the model's plain-text response.
   *
   * @param options  Optional deterministic generation params (temperature, top_p, repeat_penalty).
   *                 Defaults: temperature=undefined (model default), topP=undefined, repeatPenalty=undefined.
   *                 For RAG use temperature=0.2, topP=0.9, repeatPenalty=1.1.
   */
  public async generateText(prompt: string, options?: OllamaGenerationOptions): Promise<string> {
    const ollamaOptions: Record<string, number> = {};
    if (options?.temperature !== undefined && Number.isFinite(options.temperature)) {
      ollamaOptions['temperature'] = Math.max(0, Math.min(1, options.temperature));
    }
    if (options?.topP !== undefined && Number.isFinite(options.topP)) {
      ollamaOptions['top_p'] = Math.max(0, Math.min(1, options.topP));
    }
    if (options?.repeatPenalty !== undefined && Number.isFinite(options.repeatPenalty)) {
      ollamaOptions['repeat_penalty'] = Math.max(1, Math.min(2, options.repeatPenalty));
    }

    const requestBody: Record<string, unknown> = {
      model: this.model,
      prompt,
      stream: false,
    };
    if (Object.keys(ollamaOptions).length > 0) {
      requestBody['options'] = ollamaOptions;
    }

    const response = await this.httpClient.request(`${this.baseUrl.replace(/\/+$/, '')}/api/generate`, {
      method: 'POST',
      timeoutMs: this.timeoutMs,
      retries: 0,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`OLLAMA_HTTP_${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    return typeof body.response === 'string' ? body.response : '';
  }
}
