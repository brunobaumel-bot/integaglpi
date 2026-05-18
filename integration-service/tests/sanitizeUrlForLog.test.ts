import { describe, expect, it } from 'vitest';

import { sanitizeUrlForLog } from '../src/infra/logger/sanitizeUrlForLog.js';

describe('sanitizeUrlForLog', () => {
  it('strips querystring and fragment from lookaside.fbsbx.com URLs', () => {
    const result = sanitizeUrlForLog(
      'https://lookaside.fbsbx.com/whatsapp_business/attachments/file.jpg?access_token=SECRET&expires=123#frag',
    );

    expect(result).toBe('https://lookaside.fbsbx.com/whatsapp_business/attachments/file.jpg');
    expect(result).not.toContain('SECRET');
    expect(result).not.toContain('?');
    expect(result).not.toContain('#');
  });

  it('strips querystring from fbcdn.com subdomains', () => {
    expect(sanitizeUrlForLog('https://scontent.xx.fbcdn.com/v/t39/file.pdf?ext=abc&hash=def')).toBe(
      'https://scontent.xx.fbcdn.com/v/t39/file.pdf',
    );
  });

  it('strips querystring from facebook.com hosts', () => {
    expect(sanitizeUrlForLog('https://graph.facebook.com/v20.0/media-id?access_token=SECRET')).toBe(
      'https://graph.facebook.com/v20.0/media-id',
    );
  });

  it('strips querystring from whatsapp.net hosts', () => {
    expect(sanitizeUrlForLog('https://media.whatsapp.net/file.bin?signature=sig&expires=999')).toBe(
      'https://media.whatsapp.net/file.bin',
    );
  });

  it('redacts sensitive parameters on generic hosts while preserving safe parameters', () => {
    const result = sanitizeUrlForLog(
      'https://example.com/download?file=report.pdf&access_token=SECRET&signature=SIG&expires=123&page=1',
    );

    expect(result).toContain('file=report.pdf');
    expect(result).toContain('page=1');
    expect(result).toContain('access_token=%5BREDACTED%5D');
    expect(result).toContain('signature=%5BREDACTED%5D');
    expect(result).toContain('expires=%5BREDACTED%5D');
    expect(result).not.toContain('SECRET');
    expect(result).not.toContain('SIG');
  });

  it('redacts additional generic secret-like keys', () => {
    const result = sanitizeUrlForLog(
      'https://example.com/path?sig=s&ext=e&hash=h&access_key=ak&key=k&auth=a&authorization=b&session_token=st&api_key=api&apikey=api2',
    );

    expect(result.match(/%5BREDACTED%5D/g)).toHaveLength(10);
    expect(result).not.toContain('access_key=ak');
    expect(result).not.toContain('apikey=api2');
  });

  it('redacts x-api-key parameter', () => {
    const result = sanitizeUrlForLog('https://example.com/api?x-api-key=SECRET&file=report.pdf');
    expect(result).toContain('x-api-key=%5BREDACTED%5D');
    expect(result).toContain('file=report.pdf');
    expect(result).not.toContain('SECRET');
  });

  it('redacts X-API-KEY parameter', () => {
    const result = sanitizeUrlForLog('https://example.com/api?X-API-KEY=SECRET');
    expect(result).toContain('X-API-KEY=%5BREDACTED%5D');
    expect(result).not.toContain('SECRET');
  });

  it('redacts x_api_key parameter', () => {
    const result = sanitizeUrlForLog('https://example.com/api?x_api_key=SECRET');
    expect(result).toContain('x_api_key=%5BREDACTED%5D');
    expect(result).not.toContain('SECRET');
  });

  it('redacts xapikey parameter', () => {
    const result = sanitizeUrlForLog('https://example.com/api?xapikey=SECRET');
    expect(result).toContain('xapikey=%5BREDACTED%5D');
    expect(result).not.toContain('SECRET');
  });

  it('redacts api-key parameter', () => {
    const result = sanitizeUrlForLog('https://example.com/api?api-key=SECRET');
    expect(result).toContain('api-key=%5BREDACTED%5D');
    expect(result).not.toContain('SECRET');
  });

  it('preserves non-sensitive parameter values', () => {
    const result = sanitizeUrlForLog('https://example.com/path?lang=pt-BR&page=2');
    expect(result).toContain('lang=pt-BR');
    expect(result).toContain('page=2');
  });

  it('removes entire querystring and fragment on Meta/CDN hosts', () => {
    const result = sanitizeUrlForLog(
      'https://cdn.whatsapp.net/media/file.jpg?x-api-key=SECRET&lang=pt-BR#fragment',
    );
    expect(result).toBe('https://cdn.whatsapp.net/media/file.jpg');
    expect(result).not.toContain('?');
    expect(result).not.toContain('#');
  });

  it('returns a safe placeholder for invalid URLs', () => {
    expect(sanitizeUrlForLog('not a url with access_token=SECRET')).toBe('[INVALID_URL]');
  });
});
