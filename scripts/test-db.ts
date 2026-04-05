import type { ParsedNewsPayload } from '../src/types/schema';
import { saveDraft } from '../src/db/supabase';

async function main(): Promise<void> {
  const dummyPayload: ParsedNewsPayload = {
    headline: 'Acme launches tokenized weather derivatives platform',
    source: 'The Block',
    url: 'theblock.co/post/acme-launches-tokenized-weather-derivatives-platform',
    archive: [
      {
        subject: 'Acme',
        predicate: 'launched',
        object: 'tokenized weather derivatives platform',
      },
      {
        subject: 'Acme',
        predicate: 'is_a',
        object: 'company',
      },
    ],
    arena: [],
  };

  const result = await saveDraft({
    source: 'The Block',
    url: dummyPayload.url,
    headline: dummyPayload.headline,
    payload_json: dummyPayload,
    status: 'PENDING',
    tx_hash: null,
  });

  if (result.error) {
    throw result.error;
  }

  if (!result.data) {
    throw new Error('Supabase insert returned no row data.');
  }

  console.log('=== Aletheia Staging Layer Test ===');
  console.log(`Inserted draft id: ${result.data.id}`);
  console.log(`Inserted draft status: ${result.data.status}`);
  console.log(`Inserted draft headline: ${result.data.headline}`);
}

void main().catch((error) => {
  console.error('test-db failed:', error);
  process.exitCode = 1;
});
