import { parseHeadline } from '../src/services/ai-parser';

async function main(): Promise<void> {
  const headline = 'SEC issues Wells Notice to major decentralized exchange Uniswap';
  const url = 'https://www.reuters.com/world/us/sec-issues-wells-notice-to-major-decentralized-exchange-uniswap';
  const source = 'Reuters Top News';

  const payload = await parseHeadline(headline, url, source);

  console.log('=== Aletheia Cognitive Engine Test ===');
  console.log(JSON.stringify(payload, null, 2));
}

void main().catch((error) => {
  console.error('test-brain failed:', error);
  process.exitCode = 1;
});
 