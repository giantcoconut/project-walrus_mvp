import { defineChain, parseAbi, type Hex } from 'viem';

export type PublicIntuitionNetwork = 'mainnet' | 'testnet';

export interface IntuitionNetworkConfig {
  key: PublicIntuitionNetwork;
  name: string;
  chainId: number;
  rpcUrl: string;
  graphqlUrl: string;
  explorerUrl: string;
  nativeSymbol: string;
  multiVault: Hex;
}

export interface IntuitionAtomSearchResult {
  termId: Hex;
  label: string;
  type: string;
  data: string | null;
  description: string | null;
  image: string | null;
  url: string | null;
  positionCount: number;
  totalShares: string;
}

export interface IntuitionPinRequest {
  network: PublicIntuitionNetwork;
  schemaType: 'Thing' | 'Person' | 'Organization';
  name: string;
  description?: string;
  image?: string;
  url?: string;
  email?: string;
  identifier?: string;
}

export interface IntuitionImageUploadInput {
  contentType: string;
  data: string;
  filename: string;
}

export interface IntuitionUploadedImage {
  url: string;
  safe?: boolean;
}

export const INTUITION_NETWORKS: Record<PublicIntuitionNetwork, IntuitionNetworkConfig> = {
  mainnet: {
    key: 'mainnet',
    name: 'Intuition Mainnet',
    chainId: 1155,
    rpcUrl: 'https://rpc.intuition.systems/http',
    graphqlUrl: 'https://mainnet.intuition.sh/v1/graphql',
    explorerUrl: 'https://explorer.intuition.systems',
    nativeSymbol: 'TRUST',
    multiVault: '0x6E35cF57A41fA15eA0EaE9C33e751b01A784Fe7e',
  },
  testnet: {
    key: 'testnet',
    name: 'Intuition Testnet',
    chainId: 13579,
    rpcUrl: 'https://testnet.rpc.intuition.systems/http',
    graphqlUrl: 'https://testnet.intuition.sh/v1/graphql',
    explorerUrl: 'https://testnet.explorer.intuition.systems',
    nativeSymbol: 'tTRUST',
    multiVault: '0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91',
  },
};

export const INTUITION_CHAINS = {
  mainnet: defineChain({
    id: 1155,
    name: 'Intuition',
    nativeCurrency: {
      decimals: 18,
      name: 'Intuition',
      symbol: 'TRUST',
    },
    rpcUrls: {
      default: {
        http: ['https://rpc.intuition.systems/http'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Intuition Explorer',
        url: 'https://explorer.intuition.systems',
      },
    },
  }),
  testnet: defineChain({
    id: 13579,
    name: 'Intuition Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'Test Trust',
      symbol: 'tTRUST',
    },
    rpcUrls: {
      default: {
        http: ['https://testnet.rpc.intuition.systems/http'],
      },
    },
    blockExplorers: {
      default: {
        name: 'Intuition Testnet Explorer',
        url: 'https://testnet.explorer.intuition.systems',
      },
    },
  }),
} as const;

export const MULTIVAULT_ABI = parseAbi([
  'function getAtomCost() view returns (uint256)',
  'function getTripleCost() view returns (uint256)',
  'function getBondingCurveConfig() view returns ((address,uint256))',
  'function calculateAtomId(bytes data) pure returns (bytes32)',
  'function calculateTripleId(bytes32 subjectId, bytes32 predicateId, bytes32 objectId) pure returns (bytes32)',
  'function isTermCreated(bytes32 id) view returns (bool)',
  'function createAtoms(bytes[] atomDatas, uint256[] assets) payable returns (bytes32[])',
  'function createTriples(bytes32[] subjectIds, bytes32[] predicateIds, bytes32[] objectIds, uint256[] assets) payable returns (bytes32[])',
]);

export function getIntuitionNetwork(network: PublicIntuitionNetwork): IntuitionNetworkConfig {
  return INTUITION_NETWORKS[network];
}

export function getIntuitionNetworkByChainId(chainId: number | null): IntuitionNetworkConfig | null {
  if (chainId === null) {
    return null;
  }

  return Object.values(INTUITION_NETWORKS).find((network) => network.chainId === chainId) ?? null;
}

const UPLOAD_IMAGE_MUTATION = `
  mutation UploadImage($image: UploadImageInput!) {
    uploadImage(image: $image) {
      images {
        url
        safe
      }
    }
  }
`;

export async function uploadIntuitionImage(
  network: PublicIntuitionNetwork,
  image: IntuitionImageUploadInput,
  signal?: AbortSignal,
): Promise<IntuitionUploadedImage> {
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: UPLOAD_IMAGE_MUTATION,
      variables: {
        image,
      },
    }),
    cache: 'no-store',
  };

  if (signal) {
    requestInit.signal = signal;
  }

  const response = await fetch(getIntuitionNetwork(network).graphqlUrl, {
    ...requestInit,
  });

  const payload = (await response.json()) as {
    data?: {
      uploadImage?: {
        images?: Array<{
          url?: string;
          safe?: boolean;
        }>;
      };
    };
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok) {
    throw new Error(`Upload failed with HTTP ${response.status}.`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message ?? 'Upload failed.').join('; '));
  }

  const uploadedImage = payload.data?.uploadImage?.images?.[0];

  if (
    !uploadedImage?.url ||
    (!uploadedImage.url.startsWith('https://') && !uploadedImage.url.startsWith('ipfs://'))
  ) {
    throw new Error('Upload failed.');
  }

  if (uploadedImage.safe === false) {
    throw new Error('Upload failed.');
  }

  return uploadedImage.safe === undefined
    ? { url: uploadedImage.url }
    : { url: uploadedImage.url, safe: uploadedImage.safe };
}
