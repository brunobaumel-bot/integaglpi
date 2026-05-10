import crypto from 'node:crypto';

export class MetaWebhookSignatureVerifier {
  public constructor(private readonly appSecret: string) {}

  public verify(signatureHeader: string | undefined, rawBody: Buffer): boolean {
    if (!signatureHeader?.startsWith('sha256=')) {
      return false;
    }

    const incomingSignature = signatureHeader.slice('sha256='.length);
    if (!/^[a-f0-9]{64}$/i.test(incomingSignature)) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.appSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const incomingBuffer = Buffer.from(incomingSignature, 'hex');

    if (expectedBuffer.length !== incomingBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, incomingBuffer);
  }
}
