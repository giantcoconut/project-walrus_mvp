import 'dotenv/config';

export class NvidiaKeyManager {
  private readonly keys: string[];

  private activeIndex = 0;

  constructor(keys = [process.env.NVIDIA_API_KEY_1 ?? '', process.env.NVIDIA_API_KEY_2 ?? '']) {
    this.keys = keys.map((key) => key.trim()).filter((key) => key.length > 0);

    if (this.keys.length === 0) {
      throw new Error('Missing NVIDIA_API_KEY_1 / NVIDIA_API_KEY_2 environment variables.');
    }
  }

  getActiveKey(): string {
    const key = this.keys[this.activeIndex];

    if (!key) {
      throw new Error(`Missing Nvidia API key at index ${this.activeIndex}.`);
    }

    return key;
  }

  rotateKey(): string {
    if (this.keys.length < 2) {
      return this.getActiveKey();
    }

    this.activeIndex = (this.activeIndex + 1) % this.keys.length;
    console.log('[SYSTEM] Rotating Nvidia API Key due to rate limit..');

    return this.getActiveKey();
  }
}

export const nvidiaKeyManager = new NvidiaKeyManager();
