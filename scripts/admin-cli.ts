import 'dotenv/config';

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { mintDraftOnChain } from '../src/services/chain-executor';
import { fetchPendingDrafts, updateDraft } from '../src/db/supabase';

async function main(): Promise<void> {
  const cli = createInterface({ input, output });
  const skippedDraftIds = new Set<string>();

  try {
    while (true) {
      const pendingDrafts = await fetchPendingDrafts(50);
      const nextDraft = pendingDrafts.find((draft) => !skippedDraftIds.has(draft.id));

      if (!nextDraft) {
        console.log('No more PENDING drafts available.');
        break;
      }

      console.log('\n=== Pending Draft ===');
      console.log(`ID: ${nextDraft.id}`);
      console.log(`Source: ${nextDraft.source}`);
      console.log(`Headline: ${nextDraft.headline}`);
      console.log(`URL: ${nextDraft.url}`);
      console.log(`Created: ${nextDraft.created_at}`);
      console.log(`Main Triple: ${JSON.stringify(nextDraft.payload_json.archive[0], null, 2)}`);

      const choice = (await cli.question('Approve (a) | Reject (r) | Skip (s): '))
        .trim()
        .toLowerCase();

      if (choice === 'a') {
        await updateDraft(nextDraft.id, {
          status: 'APPROVED',
          approved_at: new Date().toISOString(),
          last_error: null,
        });

        try {
          await mintDraftOnChain(nextDraft.id);
          console.log(`[admin-cli] Draft ${nextDraft.id} minted successfully.`);
        } catch (error) {
          console.error(`[admin-cli] Minting failed for draft ${nextDraft.id}:`, error);
        }

        continue;
      }

      if (choice === 'r') {
        await updateDraft(nextDraft.id, {
          status: 'REJECTED',
          last_error: null,
        });
        console.log(`[admin-cli] Draft ${nextDraft.id} rejected.`);
        continue;
      }

      if (choice === 's') {
        skippedDraftIds.add(nextDraft.id);
        console.log(`[admin-cli] Draft ${nextDraft.id} skipped for this session.`);
        continue;
      }

      console.log('[admin-cli] Unrecognized input. Re-querying pending drafts.');
    }
  } finally {
    cli.close();
  }
}

void main().catch((error) => {
  console.error('admin-cli failed:', error);
  process.exitCode = 1;
});
