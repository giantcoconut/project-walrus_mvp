import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, isAddress } from 'viem';
import { mainnet } from 'viem/chains';

const ENS_RPC_CANDIDATES = [
  process.env.ENS_MAINNET_RPC_URL?.trim(),
  'https://ethereum-rpc.publicnode.com',
  'https://cloudflare-eth.com',
].filter((value): value is string => Boolean(value));

async function resolveEnsIdentity(address: `0x${string}`) {
  for (const rpcUrl of ENS_RPC_CANDIDATES) {
    try {
      const client = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl),
      });

      const ensName = await client.getEnsName({ address });

      if (!ensName) {
        return { ensName: null, ensAvatar: null };
      }

      const ensAvatar = await client.getEnsAvatar({ name: ensName });

      return {
        ensName,
        ensAvatar: typeof ensAvatar === 'string' ? ensAvatar : null,
      };
    } catch {
      continue;
    }
  }

  return { ensName: null, ensAvatar: null };
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');

  if (!address || !isAddress(address)) {
    return NextResponse.json(
      { error: 'A valid address is required.' },
      { status: 400 },
    );
  }

  const result = await resolveEnsIdentity(address);

  return NextResponse.json(result);
}
