'use client';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  stringToHex,
  type Hash,
} from 'viem';

import {
  getIntuitionNetwork,
  getIntuitionNetworkByChainId,
  INTUITION_CHAINS,
  MULTIVAULT_ABI,
  type IntuitionAtomSearchResult,
  uploadIntuitionImage,
  type IntuitionPinRequest,
  type PublicIntuitionNetwork,
} from '../../src/intuition/public';

type AtomSchemaType = 'Thing' | 'Person' | 'Organization' | 'Account' | 'Raw';
type AtomCreationMode = 'single' | 'batch';
type ClaimFieldKey = 'subject' | 'predicate' | 'object';
type CreateWorkbenchTab = 'claim' | 'atom' | 'lists';
type ImageUploadPhase = 'idle' | 'uploading' | 'uploaded' | 'failed';

interface WalletState {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  address: string | null;
  chainId: number | null;
  error: string | null;
}

interface AtomFormState {
  schemaType: AtomSchemaType;
  name: string;
  description: string;
  url: string;
  image: string;
  email: string;
  identifier: string;
  accountChainId: string;
  accountAddress: string;
  rawData: string;
}

interface PreparedAtomInput {
  displayName: string;
  dataString: string;
  atomId: Hash;
  exists: boolean;
  schemaType: AtomSchemaType;
}

interface AtomActionResult {
  kind: 'existing' | 'created';
  displayName: string;
  termId: Hash;
  txHash?: Hash;
  dataString: string;
  image?: string | null;
  description?: string | null;
  atomType?: string | null;
}

interface BatchAtomRow extends AtomFormState {
  id: string;
  support: string;
  imageUploadPhase: ImageUploadPhase;
  imageUploadError: string | null;
  selectedImageName: string | null;
  localImagePreviewUrl: string | null;
}

interface PreparedBatchAtomRow extends PreparedAtomInput {
  rowId: string;
  asset: bigint;
  supportWei: bigint;
}

interface SearchAtomFieldProps {
  label: string;
  fieldKey: ClaimFieldKey;
  network: PublicIntuitionNetwork;
  selected: IntuitionAtomSearchResult | null;
  exact: boolean;
  placeholder: string;
  disabled?: boolean;
  lockedNote?: string | undefined;
  onSelect: (atom: IntuitionAtomSearchResult) => void;
  onExactChange: (value: boolean) => void;
  onRequestInlineCreate: (field: ClaimFieldKey, seed: string) => void;
  onClear: () => void;
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}
const EMPTY_ATOM_FORM: AtomFormState = {
  schemaType: 'Thing',
  name: '',
  description: '',
  url: '',
  image: '',
  email: '',
  identifier: '',
  accountChainId: '1',
  accountAddress: '',
  rawData: '',
};

const INLINE_CREATE_LABELS: Record<ClaimFieldKey, string> = {
  subject: 'subject',
  predicate: 'predicate',
  object: 'object',
};

const MAX_IMAGE_SIZE_BYTES = 6 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/',
]);

function getEthereumProvider(): EthereumProvider | null {
  const provider = (window as Window & { ethereum?: EthereumProvider }).ethereum;

  return provider ?? null;
}

function getExplorerTxUrl(network: PublicIntuitionNetwork, hash: Hash): string {
  return `${getIntuitionNetwork(network).explorerUrl}/tx/${hash}`;
}

function trimOrEmpty(value: string): string {
  return value.trim();
}

function formatAddress(address: string | null): string {
  if (!address) {
    return 'Not connected';
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getNetworkSearchLabel(network: PublicIntuitionNetwork): string {
  return `Searching ${getIntuitionNetwork(network).name}`;
}

function getImagePreviewCandidates(value?: string | null): string[] {
  if (!value) {
    return [];
  }

  const raw = value.trim().replace(/^['"]|['"]$/g, '');

  if (!raw) {
    return [];
  }

  if (
    raw.startsWith('https://') ||
    raw.startsWith('http://') ||
    raw.startsWith('data:') ||
    raw.startsWith('blob:')
  ) {
    return [raw];
  }

  if (raw.startsWith('ipfs://ipfs/')) {
    const path = raw.slice('ipfs://'.length);
    return [`https://ipfs.io/${path}`, `https://dweb.link/${path}`];
  }

  if (raw.startsWith('ipfs://')) {
    const cidPath = raw.slice('ipfs://'.length);
    return [`https://ipfs.io/ipfs/${cidPath}`, `https://dweb.link/ipfs/${cidPath}`];
  }

  if (raw.startsWith('/ipfs/')) {
    return [`https://ipfs.io${raw}`, `https://dweb.link${raw}`];
  }

  return [];
}

function validateAtomImageFile(file: File): string | null {
  if (!Array.from(SUPPORTED_IMAGE_MIME_TYPES).some((prefix) => file.type.startsWith(prefix))) {
    return 'Only image files are supported.';
  }

  if (file.size <= 0) {
    return 'Upload failed. The image file is empty.';
  }

  if (file.size > 5 * 1024 * 1024) {
    return 'Image must be 5MB or smaller.';
  }

  return null;
}

function readImageFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Upload failed.'));
        return;
      }

      const [, data = ''] = reader.result.split(',', 2);

      if (!data) {
        reject(new Error('Upload failed.'));
        return;
      }

      resolve(data);
    };

    reader.onerror = () => {
      reject(new Error('Upload failed.'));
    };

    reader.readAsDataURL(file);
  });
}

function normalizeImageUploadError(caughtError: unknown): string {
  if (caughtError instanceof DOMException && caughtError.name === 'AbortError') {
    return 'Upload failed.';
  }

  if (caughtError instanceof Error && caughtError.message.trim()) {
    return caughtError.message.trim();
  }

  return 'Upload failed. You can still paste an image URL manually.';
}

function buildRichPinRequest(
  network: PublicIntuitionNetwork,
  form: AtomFormState,
): IntuitionPinRequest {
  return {
    network,
    schemaType: form.schemaType === 'Raw' || form.schemaType === 'Account' ? 'Thing' : form.schemaType,
    name: trimOrEmpty(form.name),
    description: trimOrEmpty(form.description),
    image: trimOrEmpty(form.image),
    url: trimOrEmpty(form.url),
    email: trimOrEmpty(form.email),
    identifier: trimOrEmpty(form.identifier),
  };
}

function getAtomDisplayName(form: AtomFormState): string {
  if (form.schemaType === 'Account') {
    return trimOrEmpty(form.accountAddress);
  }

  if (form.schemaType === 'Raw') {
    return trimOrEmpty(form.rawData);
  }

  return trimOrEmpty(form.name);
}

function getAtomSearchSeed(form: AtomFormState): string {
  if (form.schemaType === 'Account') {
    return trimOrEmpty(form.accountAddress);
  }

  if (form.schemaType === 'Raw') {
    return trimOrEmpty(form.rawData);
  }

  return trimOrEmpty(form.name);
}

function getDefaultInlineForm(seed: string): AtomFormState {
  return {
    ...EMPTY_ATOM_FORM,
    schemaType: 'Thing',
    name: seed,
  };
}

function isRichAtomSchemaType(schemaType: AtomSchemaType): boolean {
  return schemaType === 'Thing' || schemaType === 'Person' || schemaType === 'Organization';
}

function createBatchAtomRow(seed = ''): BatchAtomRow {
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    ...EMPTY_ATOM_FORM,
    id: randomId,
    name: seed,
    support: '',
    imageUploadPhase: 'idle',
    imageUploadError: null,
    selectedImageName: null,
    localImagePreviewUrl: null,
  };
}

function parseOptionalSupport(value: string): bigint | null {
  const normalized = value.trim();

  if (!normalized) {
    return 0n;
  }

  try {
    const parsed = parseEther(normalized);

    return parsed < 0n ? null : parsed;
  } catch {
    return null;
  }
}

function validateBatchAtomRow(row: BatchAtomRow): string[] {
  const errors: string[] = [];

  if (isRichAtomSchemaType(row.schemaType)) {
    if (!row.name.trim()) {
      errors.push('Name is required.');
    }
  }

  if (row.schemaType === 'Account') {
    const chainId = Number.parseInt(row.accountChainId.trim(), 10);

    if (!Number.isFinite(chainId) || chainId <= 0) {
      errors.push('Account chain ID must be a positive number.');
    }

    if (!isAddress(row.accountAddress.trim())) {
      errors.push('Account address must be a valid EVM address.');
    }
  }

  if (row.schemaType === 'Raw' && !row.rawData.trim()) {
    errors.push('Raw URI or data value is required.');
  }

  if (parseOptionalSupport(row.support) === null) {
    errors.push('Initial support must be a valid non-negative TRUST amount.');
  }

  return errors;
}

async function prepareAtomInput(
  form: AtomFormState,
  network: PublicIntuitionNetwork,
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<PreparedAtomInput> {
  let displayName = '';
  let dataString = '';

  if (form.schemaType === 'Thing' || form.schemaType === 'Person' || form.schemaType === 'Organization') {
    displayName = trimOrEmpty(form.name);

    if (!displayName) {
      throw new Error('Name is required for this atom type.');
    }

    const pinRequest = buildRichPinRequest(network, form);
    const pinResponse = await fetch('/api/intuition/pin-metadata', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pinRequest),
    });

    const pinPayload = (await pinResponse.json()) as { uri?: string; error?: string };

    if (!pinResponse.ok || !pinPayload.uri) {
      throw new Error(pinPayload.error ?? 'Failed to pin atom metadata to IPFS.');
    }

    dataString = pinPayload.uri;
  } else if (form.schemaType === 'Account') {
    const accountChainId = Number.parseInt(form.accountChainId.trim(), 10);

    if (!Number.isFinite(accountChainId) || accountChainId <= 0) {
      throw new Error('Account chain ID must be a positive number.');
    }

    if (!isAddress(form.accountAddress.trim())) {
      throw new Error('Account address must be a valid EVM address.');
    }

    const normalizedAddress = getAddress(form.accountAddress.trim());
    displayName = normalizedAddress;
    dataString = `caip10:eip155:${accountChainId}:${normalizedAddress}`;
  } else {
    const rawData = trimOrEmpty(form.rawData);

    if (!rawData) {
      throw new Error('Raw URI or data value is required.');
    }

    displayName = rawData;
    dataString = rawData;
  }

  const atomId = (await publicClient.readContract({
    address: getIntuitionNetwork(network).multiVault,
    abi: MULTIVAULT_ABI,
    functionName: 'calculateAtomId',
    args: [stringToHex(dataString)],
  })) as Hash;

  const exists = (await publicClient.readContract({
    address: getIntuitionNetwork(network).multiVault,
    abi: MULTIVAULT_ABI,
    functionName: 'isTermCreated',
    args: [atomId],
  })) as boolean;

  return {
    displayName,
    dataString,
    atomId,
    exists,
    schemaType: form.schemaType,
  };
}

function AtomResultCard({
  title,
  body,
  network,
  result,
}: {
  title: string;
  body: string;
  network: PublicIntuitionNetwork;
  result: AtomActionResult;
}) {
  return (
    <div className="rounded-[1.15rem] border border-line/80 bg-paper/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-4">
          {result.image ? (
            <img
              src={result.image}
              alt={result.displayName || 'Resolved atom'}
              className="h-14 w-14 rounded-[0.95rem] border border-line/80 object-cover"
            />
          ) : (
            <div className="h-14 w-14 rounded-[0.95rem] border border-dashed border-line/80 bg-white/70" />
          )}
          <div className="min-w-0">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">{title}</p>
            <p className="mt-2 font-serif text-[1.5rem] leading-none tracking-[-0.04em] text-ink">
              {result.displayName || 'Resolved atom'}
            </p>
            {result.atomType ? (
              <p className="mt-2 text-[0.72rem] uppercase tracking-terminal text-muted">{result.atomType}</p>
            ) : null}
          </div>
        </div>
        <span className="rounded-full border border-ink/10 bg-white/70 px-3 py-1 text-[0.72rem] uppercase tracking-terminal text-muted">
          {result.kind === 'created' ? 'Created' : 'Already exists'}
        </span>
      </div>
      <p className="mt-4 text-sm leading-7 text-muted">{body}</p>
      {result.description ? <p className="mt-3 text-sm leading-7 text-muted">{result.description}</p> : null}
      <div className="mt-4 grid gap-3 text-sm text-muted">
        <div>
          <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Term ID</p>
          <p className="mt-1 break-all font-mono text-[0.78rem] leading-6 text-ink">{result.termId}</p>
        </div>
        <div>
          <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Atom data</p>
          <p className="mt-1 break-all font-mono text-[0.78rem] leading-6 text-ink">{result.dataString}</p>
        </div>
        {result.txHash ? (
          <div>
            <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Transaction</p>
            <a
              href={getExplorerTxUrl(network, result.txHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex break-all font-mono text-[0.78rem] leading-6 text-ink underline decoration-line underline-offset-4"
            >
              {result.txHash}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchAtomField({
  label,
  fieldKey,
  network,
  selected,
  exact,
  placeholder,
  disabled,
  lockedNote,
  onSelect,
  onExactChange,
  onRequestInlineCreate,
  onClear,
}: SearchAtomFieldProps) {
  const [query, setQuery] = useState(selected?.label ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<IntuitionAtomSearchResult[]>([]);

  useEffect(() => {
    setQuery(selected?.label ?? '');
  }, [selected]);

  useEffect(() => {
    if (disabled) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const normalizedQuery = query.trim();

    if (selected && normalizedQuery === selected.label) {
      setResults([]);
      return;
    }

    if (normalizedQuery.length < 2) {
      setResults([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/intuition/search-atoms?network=${network}&q=${encodeURIComponent(normalizedQuery)}&exact=${exact ? '1' : '0'}&limit=8`,
          {
            signal: controller.signal,
          },
        );

        const payload = (await response.json()) as {
          results?: IntuitionAtomSearchResult[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Atom search failed.');
        }

        setResults(payload.results ?? []);
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return;
        }

        setResults([]);
        setError(caughtError instanceof Error ? caughtError.message : 'Atom search failed.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [disabled, exact, network, query, selected]);

  return (
    <div className="space-y-3 rounded-[1.15rem] border border-line/80 bg-white/60 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[0.72rem] uppercase tracking-terminal text-muted">{label}</p>
          {lockedNote ? <p className="mt-1 text-sm leading-6 text-muted">{lockedNote}</p> : null}
          <p className="mt-1 text-[0.68rem] uppercase tracking-terminal text-muted">
            {getNetworkSearchLabel(network)}
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs uppercase tracking-terminal text-muted">
          <input
            type="checkbox"
            checked={exact}
            disabled={disabled}
            onChange={(event) => onExactChange(event.target.checked)}
            className="h-4 w-4 rounded border-line text-ink focus:ring-0"
          />
          Exact match
        </label>
      </div>

      <div className="space-y-3">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (selected) {
              onClear();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 placeholder:text-muted focus:border-ink/20"
        />

        {selected ? (
          <div className="rounded-xl border border-ink/10 bg-paper/75 p-4">
            <div className="flex gap-4">
              {selected.image ? (
                <img
                  src={selected.image}
                  alt={selected.label}
                  className="h-14 w-14 rounded-[0.85rem] border border-line/80 object-cover"
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-ink">{selected.label}</p>
                  <span className="rounded-full border border-line bg-white/80 px-2 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                    {selected.type}
                  </span>
                </div>
                {selected.description ? (
                  <p className="mt-2 text-sm leading-6 text-muted">{selected.description}</p>
                ) : null}
                <p className="mt-2 break-all font-mono text-[0.72rem] leading-5 text-muted">{selected.termId}</p>
              </div>
            </div>
          </div>
        ) : null}

        {!disabled && loading ? (
          <p className="text-sm text-muted">{getNetworkSearchLabel(network)}...</p>
        ) : null}
        {!disabled && error ? <p className="text-sm text-[#8a4b38]">{error}</p> : null}

        {!disabled && results.length > 0 ? (
          <div className="space-y-2">
            {results.map((result) => (
              <button
                type="button"
                key={result.termId}
                onClick={() => {
                  onSelect(result);
                  setResults([]);
                  setQuery(result.label);
                }}
                className="flex w-full items-start gap-3 rounded-xl border border-line/70 bg-paper/65 px-4 py-3 text-left transition-colors duration-150 hover:border-ink/15 hover:bg-white/80"
              >
                {result.image ? (
                  <img
                    src={result.image}
                    alt={result.label}
                    className="mt-0.5 h-12 w-12 rounded-[0.85rem] border border-line/80 object-cover"
                  />
                ) : (
                  <div className="mt-0.5 h-12 w-12 rounded-[0.85rem] border border-dashed border-line/80 bg-white/70" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-ink">{result.label}</p>
                    <span className="rounded-full border border-line bg-white/80 px-2 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                      {result.type}
                    </span>
                    {result.positionCount > 0 ? (
                      <span className="text-[0.68rem] uppercase tracking-terminal text-muted">
                        {result.positionCount} positions
                      </span>
                    ) : null}
                  </div>
                  {result.description ? (
                    <p className="mt-1 text-sm leading-6 text-muted">{result.description}</p>
                  ) : (
                    <p className="mt-1 text-sm leading-6 text-muted">No description attached.</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {!disabled && !loading && query.trim().length >= 2 && results.length === 0 && !selected ? (
          <div className="rounded-xl border border-dashed border-line bg-paper/70 p-4">
            <p className="text-sm leading-6 text-muted">
              No atom matched this {exact ? 'exact' : 'broad'} search on {getIntuitionNetwork(network).name} yet.
            </p>
            <button
              type="button"
              onClick={() => onRequestInlineCreate(fieldKey, query.trim())}
              className="mt-3 inline-flex rounded-full border border-ink px-3 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
            >
              Create “{query.trim()}” as the {INLINE_CREATE_LABELS[fieldKey]}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AtomCreatorPanel({
  network,
  walletState,
  publicClient,
  title,
  body,
  initialForm,
  compact,
  onResolved,
}: {
  network: PublicIntuitionNetwork;
  walletState: WalletState;
  publicClient: ReturnType<typeof createPublicClient>;
  title: string;
  body: string;
  initialForm?: AtomFormState;
  compact?: boolean;
  onResolved?: (atom: IntuitionAtomSearchResult) => void;
}) {
  const [form, setForm] = useState<AtomFormState>(initialForm ?? EMPTY_ATOM_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedAtomInput | null>(null);
  const [result, setResult] = useState<AtomActionResult | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [imageUploadPhase, setImageUploadPhase] = useState<ImageUploadPhase>('idle');
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
  const [localImagePreviewUrl, setLocalImagePreviewUrl] = useState<string | null>(null);
  const [existingCandidates, setExistingCandidates] = useState<IntuitionAtomSearchResult[]>([]);
  const [existingCandidatesLoading, setExistingCandidatesLoading] = useState(false);
  const [existingCandidatesError, setExistingCandidatesError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTokenRef = useRef(0);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const networkRef = useRef(network);

  useEffect(() => {
    if (initialForm) {
      setForm(initialForm);
      setPrepared(null);
      setResult(null);
      setError(null);
      setStatus(null);
      clearImageUploadState();
    }
  }, [initialForm]);

  const canWrite = walletState.status === 'connected' && walletState.chainId === getIntuitionNetwork(network).chainId;
  const walletNetworkConfig = getIntuitionNetworkByChainId(walletState.chainId);
  const hasNetworkMismatch =
    walletState.status === 'connected' &&
    walletState.chainId !== null &&
    walletState.chainId !== getIntuitionNetwork(network).chainId;
  const atomSearchSeed = getAtomSearchSeed(form);

  function invalidateImageUpload() {
    uploadTokenRef.current += 1;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
  }

  function clearImageUploadState() {
    invalidateImageUpload();
    setImageUploadPhase('idle');
    setImageUploadError(null);
    setSelectedImageName(null);
    setLocalImagePreviewUrl((current) => {
      if (current?.startsWith('blob:')) {
        URL.revokeObjectURL(current);
      }

      return null;
    });

    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  }

  useEffect(() => {
    networkRef.current = network;
    clearImageUploadState();
  }, [network]);

  function patchForm(patch: Partial<AtomFormState>) {
    setForm((current) => ({
      ...current,
      ...patch,
    }));
    setPrepared(null);
    setResult(null);
    setError(null);
    setStatus(null);
  }

  useEffect(() => {
    const normalizedSeed = atomSearchSeed.trim();

    if (normalizedSeed.length < 2) {
      setExistingCandidates([]);
      setExistingCandidatesLoading(false);
      setExistingCandidatesError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setExistingCandidatesLoading(true);
      setExistingCandidatesError(null);

      try {
        const response = await fetch(
          `/api/intuition/search-atoms?network=${network}&q=${encodeURIComponent(normalizedSeed)}&exact=0&limit=5`,
          {
            signal: controller.signal,
          },
        );

        const payload = (await response.json()) as {
          results?: IntuitionAtomSearchResult[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Existing atom lookup failed.');
        }

        setExistingCandidates(payload.results ?? []);
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return;
        }

        setExistingCandidates([]);
        setExistingCandidatesError(
          caughtError instanceof Error ? caughtError.message : 'Existing atom lookup failed.',
        );
      } finally {
        if (!controller.signal.aborted) {
          setExistingCandidatesLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [atomSearchSeed, network]);

  function useExistingCandidate(candidate: IntuitionAtomSearchResult) {
    setPrepared(null);
    setError(null);
    setStatus('An existing atom was found from the background lookup, so no new atom needs to be created.');
    setResult({
      kind: 'existing',
      displayName: candidate.label,
      termId: candidate.termId,
      dataString: candidate.data ?? atomSearchSeed,
      image: candidate.image,
      description: candidate.description,
      atomType: candidate.type,
    });
    onResolved?.(candidate);
  }

  function setSchemaType(schemaType: AtomSchemaType) {
    setForm((current) => ({
      ...EMPTY_ATOM_FORM,
      schemaType,
      name: schemaType === 'Thing' || schemaType === 'Person' || schemaType === 'Organization' ? current.name : '',
      description:
        schemaType === 'Thing' || schemaType === 'Person' || schemaType === 'Organization'
          ? current.description
          : '',
      url:
        schemaType === 'Thing' || schemaType === 'Person' || schemaType === 'Organization' ? current.url : '',
      image:
        schemaType === 'Thing' || schemaType === 'Person' || schemaType === 'Organization'
          ? current.image
          : '',
      email: schemaType === 'Person' || schemaType === 'Organization' ? current.email : '',
      identifier: schemaType === 'Person' ? current.identifier : '',
      accountChainId: schemaType === 'Account' ? current.accountChainId : '1',
      accountAddress: schemaType === 'Account' ? current.accountAddress : '',
      rawData: schemaType === 'Raw' ? current.rawData : '',
    }));
    setPrepared(null);
    setResult(null);
    setError(null);
    setStatus(null);
    clearImageUploadState();
  }

  async function handleImageFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      clearImageUploadState();
      return;
    }

    const validationError = validateAtomImageFile(file);

    if (validationError) {
      invalidateImageUpload();
      setSelectedImageName(file.name);
      setImageUploadPhase('failed');
      setImageUploadError(validationError);
      return;
    }

    invalidateImageUpload();
    const uploadToken = uploadTokenRef.current;
    const uploadNetwork = network;
    const controller = new AbortController();
    uploadAbortRef.current = controller;

    setSelectedImageName(file.name);
    setImageUploadPhase('uploading');
    setImageUploadError(null);
    setLocalImagePreviewUrl((current) => {
      if (current?.startsWith('blob:')) {
        URL.revokeObjectURL(current);
      }

      return URL.createObjectURL(file);
    });

    try {
      const data = await readImageFileAsBase64(file);
      const uploadedImage = await uploadIntuitionImage(
        uploadNetwork,
        {
          contentType: file.type,
          data,
          filename: file.name || 'atom-image',
        },
        controller.signal,
      );

      if (uploadToken !== uploadTokenRef.current || networkRef.current !== uploadNetwork) {
        return;
      }

      patchForm({ image: uploadedImage.url });
      setImageUploadPhase('uploaded');
      setImageUploadError(
        uploadedImage.safe === false ? 'Image uploaded but marked unsafe by moderation.' : null,
      );
    } catch (caughtError) {
      if (controller.signal.aborted || uploadToken !== uploadTokenRef.current || networkRef.current !== uploadNetwork) {
        return;
      }

      setImageUploadPhase('failed');
      setImageUploadError(normalizeImageUploadError(caughtError));
    } finally {
      if (uploadToken === uploadTokenRef.current) {
        uploadAbortRef.current = null;
      }
    }
  }

  useEffect(() => {
    return () => {
      if (localImagePreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(localImagePreviewUrl);
      }
    };
  }, [localImagePreviewUrl]);

  const imagePreviewCandidates = localImagePreviewUrl
    ? [localImagePreviewUrl, ...getImagePreviewCandidates(form.image)]
    : getImagePreviewCandidates(form.image);
  const imagePreviewUrl = imagePreviewCandidates[0] ?? null;

  async function handleCreate() {
    setIsCreating(true);

    if (!canWrite) {
      setError('Connect a wallet on the selected Intuition network before creating an atom.');
      setIsCreating(false);
      return;
    }

    setError(null);
    setStatus('Resolving the deterministic atom ID and preparing the protocol create flow...');

    try {
      const provider = getEthereumProvider();

      if (!provider || !walletState.address) {
        throw new Error('No browser wallet is available.');
      }

      const preparedInput = prepared ?? (await prepareAtomInput(form, network, publicClient));
      setPrepared(preparedInput);

      if (preparedInput.exists) {
        setResult({
          kind: 'existing',
          displayName: preparedInput.displayName,
          termId: preparedInput.atomId,
          dataString: preparedInput.dataString,
          image: form.image.trim() || null,
          description: form.description.trim() || null,
          atomType:
            preparedInput.schemaType === 'Account'
              ? 'Account'
              : preparedInput.schemaType === 'Raw'
                ? 'TextObject'
                : preparedInput.schemaType,
        });
        setStatus('The atom already exists on-chain, so no new create transaction was sent.');
        onResolved?.({
          termId: preparedInput.atomId,
          label: preparedInput.displayName,
          type:
            preparedInput.schemaType === 'Account'
              ? 'Account'
              : preparedInput.schemaType === 'Raw'
                ? 'TextObject'
                : preparedInput.schemaType,
          data: preparedInput.dataString,
          description: form.description.trim() || null,
          image: form.image.trim() || null,
          url: form.url.trim() || null,
          positionCount: 0,
          totalShares: '0',
        });
        return;
      }

      const atomCost = (await publicClient.readContract({
        address: getIntuitionNetwork(network).multiVault,
        abi: MULTIVAULT_ABI,
        functionName: 'getAtomCost',
      })) as bigint;

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createAtoms',
        args: [[stringToHex(preparedInput.dataString)], [atomCost]],
      });

      setStatus('Building the array-based createAtoms transaction, even for a single atom...');

      const walletClient = createWalletClient({
        chain: INTUITION_CHAINS[network],
        transport: custom(provider),
      });

      const txHash = await walletClient.sendTransaction({
        account: walletState.address as `0x${string}`,
        chain: INTUITION_CHAINS[network],
        to: getIntuitionNetwork(network).multiVault,
        data,
        value: atomCost,
      });

      setStatus('Waiting for the atom creation transaction to confirm on-chain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const createdResult: AtomActionResult = {
        kind: 'created',
        displayName: preparedInput.displayName,
        termId: preparedInput.atomId,
        txHash,
        dataString: preparedInput.dataString,
        image: form.image.trim() || null,
        description: form.description.trim() || null,
        atomType:
          preparedInput.schemaType === 'Account'
            ? 'Account'
            : preparedInput.schemaType === 'Raw'
              ? 'TextObject'
              : preparedInput.schemaType,
      };

      setResult(createdResult);
      setStatus('Atom created successfully and confirmed on the active network.');

      onResolved?.({
        termId: preparedInput.atomId,
        label: preparedInput.displayName,
        type:
          preparedInput.schemaType === 'Account'
            ? 'Account'
            : preparedInput.schemaType === 'Raw'
              ? 'TextObject'
              : preparedInput.schemaType,
        data: preparedInput.dataString,
        description: form.description.trim() || null,
        image: form.image.trim() || null,
        url: form.url.trim() || null,
        positionCount: 0,
        totalShares: '0',
      });
    } catch (caughtError) {
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'Atom creation failed.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className={`border border-line/80 bg-white/70 shadow-sheet ${compact ? 'p-6' : 'p-8'}`}>
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-[0.72rem] uppercase tracking-terminal text-muted">{title}</p>
          <p className="max-w-3xl text-sm leading-7 text-muted">{body}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['Thing', 'Person', 'Organization', 'Account', 'Raw'] as AtomSchemaType[]).map((schemaType) => (
            <button
              type="button"
              key={schemaType}
              onClick={() => setSchemaType(schemaType)}
              className={`rounded-full border px-3 py-2 text-sm transition-colors duration-150 ${
                form.schemaType === schemaType
                  ? 'border-ink/15 bg-paper text-ink'
                  : 'border-line bg-white/70 text-muted hover:border-ink/15 hover:text-ink'
              }`}
            >
              {schemaType === 'Raw' ? 'Raw URI / data' : schemaType}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {form.schemaType === 'Thing' || form.schemaType === 'Person' || form.schemaType === 'Organization' ? (
            <>
              <label className="space-y-2">
                <span className="text-sm text-muted">Name</span>
                <input
                  value={form.name}
                  onChange={(event) => patchForm({ name: event.target.value })}
                  className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-muted">URL (optional)</span>
                <input
                  value={form.url}
                  onChange={(event) => patchForm({ url: event.target.value })}
                  placeholder="https://..."
                  className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm text-muted">Description</span>
                <textarea
                  value={form.description}
                  onChange={(event) => patchForm({ description: event.target.value })}
                  rows={4}
                  className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm leading-7 text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                />
              </label>
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm text-muted">Image (optional)</span>
                <div className="space-y-3 rounded-[1rem] border border-line/80 bg-paper/45 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                      onChange={(event) => {
                        void handleImageFileSelection(event);
                      }}
                      disabled={imageUploadPhase === 'uploading'}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageUploadPhase === 'uploading'}
                      className="inline-flex rounded-full border border-line bg-white/80 px-4 py-2 text-sm text-ink transition-colors duration-150 hover:border-ink/15 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {imageUploadPhase === 'uploading' ? 'Uploading image...' : 'Choose image'}
                    </button>
                    {(selectedImageName || imageUploadPhase !== 'idle') ? (
                      <button
                        type="button"
                        onClick={clearImageUploadState}
                        disabled={imageUploadPhase === 'uploading'}
                        className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Clear
                      </button>
                    ) : null}
                    <p className="text-sm text-muted">
                      {selectedImageName ?? 'No file selected.'}
                    </p>
                  </div>
                  <p className="text-sm leading-6 text-muted">
                    {imageUploadPhase === 'uploading'
                      ? 'Uploading image...'
                      : imageUploadPhase === 'uploaded'
                        ? 'Image uploaded'
                        : imageUploadPhase === 'failed'
                          ? 'Upload failed'
                          : 'Choose image'}
                  </p>
                  {imageUploadError ? (
                    <p className="text-sm leading-6 text-[#8a4b38]">{imageUploadError}</p>
                  ) : null}
                  <input
                    value={form.image}
                    onChange={(event) => patchForm({ image: event.target.value })}
                    placeholder="https://..."
                    className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                  />
                  {imagePreviewUrl ? (
                    <div className="rounded-[1rem] border border-line/80 bg-white/75 p-3">
                      <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Image preview</p>
                      <div className="mt-3 flex min-h-[16rem] items-center justify-center overflow-hidden rounded-[1rem] border border-line/80 bg-paper/60 p-4">
                        <img
                          src={imagePreviewUrl}
                          alt={form.name.trim() || 'Atom image preview'}
                          className="max-h-[18rem] max-w-full object-contain"
                        />
                      </div>
                      {form.image.trim() ? (
                        <p className="mt-3 break-all text-[0.72rem] leading-5 text-muted">{form.image.trim()}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </label>
              {form.schemaType === 'Person' || form.schemaType === 'Organization' ? (
                <label className="space-y-2">
                  <span className="text-sm text-muted">Email (optional)</span>
                  <input
                    value={form.email}
                    onChange={(event) => patchForm({ email: event.target.value })}
                    className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                  />
                </label>
              ) : null}
              {form.schemaType === 'Person' ? (
                <label className="space-y-2">
                  <span className="text-sm text-muted">Identifier (optional)</span>
                  <input
                    value={form.identifier}
                    onChange={(event) => patchForm({ identifier: event.target.value })}
                    className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                  />
                </label>
              ) : null}
            </>
          ) : null}

          {form.schemaType === 'Account' ? (
            <>
              <label className="space-y-2">
                <span className="text-sm text-muted">Account chain ID</span>
                <input
                  value={form.accountChainId}
                  onChange={(event) => patchForm({ accountChainId: event.target.value })}
                  className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-muted">Address</span>
                <input
                  value={form.accountAddress}
                  onChange={(event) => patchForm({ accountAddress: event.target.value })}
                  placeholder="0x..."
                  className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 font-mono text-sm text-ink outline-none transition-colors duration-150 focus:border-ink/20"
                />
              </label>
            </>
          ) : null}

          {form.schemaType === 'Raw' ? (
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm text-muted">Exact URI or raw data string</span>
              <textarea
                value={form.rawData}
                onChange={(event) => patchForm({ rawData: event.target.value })}
                rows={4}
                className="w-full rounded-xl border border-line/80 bg-paper/70 px-4 py-3 font-mono text-sm leading-7 text-ink outline-none transition-colors duration-150 focus:border-ink/20"
              />
            </label>
          ) : null}
        </div>

        {atomSearchSeed.length >= 2 ? (
          <div className="rounded-[1.15rem] border border-dashed border-line bg-paper/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Existing atom lookup</p>
                <p className="mt-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                  {getNetworkSearchLabel(network)}
                </p>
              </div>
              {existingCandidatesLoading ? (
                <span className="text-[0.72rem] uppercase tracking-terminal text-muted">
                  Searching...
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-sm leading-7 text-muted">
              Similar atoms are checked automatically while you type, so creation does not start blind.
            </p>
            {existingCandidatesError ? (
              <p className="mt-3 text-sm leading-7 text-[#8a4b38]">{existingCandidatesError}</p>
            ) : null}
            {!existingCandidatesLoading && existingCandidates.length > 0 ? (
              <div className="mt-4 space-y-2">
                {existingCandidates.map((candidate) => (
                  <div
                    key={candidate.termId}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line/70 bg-white/75 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {candidate.image ? (
                        <img
                          src={candidate.image}
                          alt={candidate.label}
                          className="mt-0.5 h-12 w-12 rounded-[0.85rem] border border-line/80 object-cover"
                        />
                      ) : (
                        <div className="mt-0.5 h-12 w-12 rounded-[0.85rem] border border-dashed border-line/80 bg-white/70" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm text-ink">{candidate.label}</p>
                          <span className="rounded-full border border-line bg-paper/70 px-2 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                            {candidate.type}
                          </span>
                        </div>
                        {candidate.description ? (
                          <p className="mt-1 text-sm leading-6 text-muted">{candidate.description}</p>
                        ) : (
                          <p className="mt-1 text-sm leading-6 text-muted">No description attached.</p>
                        )}
                        <p className="mt-2 break-all font-mono text-[0.72rem] leading-5 text-muted">
                          {candidate.termId}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => useExistingCandidate(candidate)}
                      className="inline-flex rounded-full border border-line bg-paper/70 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
                    >
                      Use existing
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {!existingCandidatesLoading && !existingCandidatesError && existingCandidates.length === 0 ? (
              <p className="mt-3 text-sm leading-7 text-muted">
                No similar atoms have been found from the current name or value on {getIntuitionNetwork(network).name} yet.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void handleCreate();
            }}
            className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isCreating || !canWrite}
          >
            {isCreating ? 'Creating atom...' : hasNetworkMismatch ? 'Wrong network' : 'Create atom'}
          </button>
        </div>

        {hasNetworkMismatch ? (
          <p className="text-sm leading-7 text-muted">
            Atom creation is disabled because your wallet is on{' '}
            {walletNetworkConfig ? walletNetworkConfig.name : `chain ${walletState.chainId}`} while this page is set to{' '}
            {getIntuitionNetwork(network).name}.
          </p>
        ) : !canWrite ? (
          <p className="text-sm leading-7 text-muted">
            Wallet writes stay disabled until the connected wallet is on {getIntuitionNetwork(network).name}.
          </p>
        ) : null}
        {status ? <p className="text-sm leading-7 text-muted">{status}</p> : null}
        {error ? <p className="text-sm leading-7 text-[#8a4b38]">{error}</p> : null}
        {prepared ? (
          <div className="rounded-[1.15rem] border border-dashed border-line bg-paper/60 p-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Prepared atom payload</p>
            <div className="mt-3 grid gap-3 text-sm text-muted">
              <div>
                <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Display name</p>
                <p className="mt-1 text-ink">{prepared.displayName}</p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Term ID</p>
                <p className="mt-1 break-all font-mono text-[0.78rem] leading-6 text-ink">{prepared.atomId}</p>
              </div>
            </div>
          </div>
        ) : null}
        {result ? (
          <AtomResultCard
            title={result.kind === 'created' ? 'Atom confirmed' : 'Existing atom surfaced'}
            body={
              result.kind === 'created'
                ? 'The atom was pinned if needed, then created through the array-based protocol function with one item.'
                : 'The deterministic term already existed, so the flow surfaced it instead of sending a redundant create.'
            }
            network={network}
            result={result}
          />
        ) : null}
      </div>
    </div>
  );
}

function BatchAtomRowEditor({
  row,
  index,
  network,
  busy,
  errors,
  canRemove,
  onPatch,
  onSetSchemaType,
  onRemove,
  onAdd,
  onImageSelect,
  onClearImage,
}: {
  row: BatchAtomRow;
  index: number;
  network: PublicIntuitionNetwork;
  busy: boolean;
  errors: string[];
  canRemove: boolean;
  onPatch: (patch: Partial<BatchAtomRow>) => void;
  onSetSchemaType: (schemaType: AtomSchemaType) => void;
  onRemove: () => void;
  onAdd: () => void;
  onImageSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearImage: () => void;
}) {
  const [existingCandidates, setExistingCandidates] = useState<IntuitionAtomSearchResult[]>([]);
  const [existingCandidatesLoading, setExistingCandidatesLoading] = useState(false);
  const [existingCandidatesError, setExistingCandidatesError] = useState<string | null>(null);
  const atomSearchSeed = getAtomSearchSeed(row);

  useEffect(() => {
    const normalizedSeed = atomSearchSeed.trim();

    if (normalizedSeed.length < 2) {
      setExistingCandidates([]);
      setExistingCandidatesLoading(false);
      setExistingCandidatesError(null);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setExistingCandidatesLoading(true);
      setExistingCandidatesError(null);

      try {
        const response = await fetch(
          `/api/intuition/search-atoms?network=${network}&q=${encodeURIComponent(normalizedSeed)}&exact=0&limit=5`,
          {
            signal: controller.signal,
          },
        );

        const payload = (await response.json()) as {
          results?: IntuitionAtomSearchResult[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? 'Existing atom lookup failed.');
        }

        setExistingCandidates(payload.results ?? []);
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return;
        }

        setExistingCandidates([]);
        setExistingCandidatesError(
          caughtError instanceof Error ? caughtError.message : 'Existing atom lookup failed.',
        );
      } finally {
        if (!controller.signal.aborted) {
          setExistingCandidatesLoading(false);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [atomSearchSeed, network]);

  const previewUrl = row.localImagePreviewUrl ?? getImagePreviewCandidates(row.image)[0] ?? null;

  return (
    <div className="rounded-[1.15rem] border border-line/80 bg-paper/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Row {index + 1}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={row.schemaType}
            onChange={(event) => onSetSchemaType(event.target.value as AtomSchemaType)}
            disabled={busy}
            className="rounded-full border border-line bg-white/80 px-3 py-2 text-sm text-ink outline-none"
          >
            {(['Thing', 'Person', 'Organization', 'Account', 'Raw'] as AtomSchemaType[]).map((schemaType) => (
              <option key={schemaType} value={schemaType}>
                {schemaType === 'Raw' ? 'Raw URI / data' : schemaType}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy || !canRemove}
            className="inline-flex rounded-full border border-line bg-white/70 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {isRichAtomSchemaType(row.schemaType) ? (
          <>
            <label className="space-y-2">
              <span className="text-sm text-muted">Name</span>
              <input
                value={row.name}
                onChange={(event) => onPatch({ name: event.target.value })}
                disabled={busy}
                className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-muted">URL (optional)</span>
              <input
                value={row.url}
                onChange={(event) => onPatch({ url: event.target.value })}
                disabled={busy}
                placeholder="https://..."
                className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm text-muted">Description</span>
              <textarea
                value={row.description}
                onChange={(event) => onPatch({ description: event.target.value })}
                disabled={busy}
                rows={3}
                className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm leading-7 text-ink outline-none"
              />
            </label>
            <label className="space-y-2 md:col-span-2">
              <span className="text-sm text-muted">Image (optional)</span>
              <div className="space-y-3 rounded-[1rem] border border-line/80 bg-white/45 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onImageSelect}
                    disabled={row.imageUploadPhase === 'uploading' || busy}
                    className="hidden"
                    id={`batch-image-${row.id}`}
                  />
                  <label
                    htmlFor={`batch-image-${row.id}`}
                    className={`inline-flex rounded-full border border-line bg-white/80 px-4 py-2 text-sm text-ink transition-colors duration-150 ${
                      row.imageUploadPhase === 'uploading' || busy
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer hover:border-ink/15'
                    }`}
                  >
                    {row.imageUploadPhase === 'uploading' ? 'Uploading image...' : 'Choose image'}
                  </label>
                  {(row.selectedImageName || row.imageUploadPhase !== 'idle') ? (
                    <button
                      type="button"
                      onClick={onClearImage}
                      disabled={row.imageUploadPhase === 'uploading' || busy}
                      className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Clear
                    </button>
                  ) : null}
                  <p className="text-sm text-muted">{row.selectedImageName ?? 'No file selected.'}</p>
                </div>
                <p className="text-sm leading-6 text-muted">
                  {row.imageUploadPhase === 'uploading'
                    ? 'Uploading image...'
                    : row.imageUploadPhase === 'uploaded'
                      ? 'Image uploaded'
                      : row.imageUploadPhase === 'failed'
                        ? 'Upload failed'
                        : 'Choose image'}
                </p>
                {row.imageUploadError ? (
                  <p className="text-sm leading-6 text-[#8a4b38]">{row.imageUploadError}</p>
                ) : null}
                <input
                  value={row.image}
                  onChange={(event) => onPatch({ image: event.target.value })}
                  disabled={busy}
                  placeholder="https://... or ipfs://..."
                  className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
                />
                {previewUrl ? (
                  <div className="rounded-[1rem] border border-line/80 bg-white/75 p-3">
                    <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Image preview</p>
                    <div className="mt-3 flex min-h-[12rem] items-center justify-center overflow-hidden rounded-[1rem] border border-line/80 bg-paper/60 p-4">
                      <img
                        src={previewUrl}
                        alt={row.name.trim() || `Batch row ${index + 1} image preview`}
                        className="max-h-[14rem] max-w-full object-contain"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </label>
            {row.schemaType === 'Person' || row.schemaType === 'Organization' ? (
              <label className="space-y-2">
                <span className="text-sm text-muted">Email (optional)</span>
                <input
                  value={row.email}
                  onChange={(event) => onPatch({ email: event.target.value })}
                  disabled={busy}
                  className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
                />
              </label>
            ) : null}
            {row.schemaType === 'Person' ? (
              <label className="space-y-2">
                <span className="text-sm text-muted">Identifier (optional)</span>
                <input
                  value={row.identifier}
                  onChange={(event) => onPatch({ identifier: event.target.value })}
                  disabled={busy}
                  className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
                />
              </label>
            ) : null}
          </>
        ) : null}

        {row.schemaType === 'Account' ? (
          <>
            <label className="space-y-2">
              <span className="text-sm text-muted">Account chain ID</span>
              <input
                value={row.accountChainId}
                onChange={(event) => onPatch({ accountChainId: event.target.value })}
                disabled={busy}
                className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm text-muted">Address</span>
              <input
                value={row.accountAddress}
                onChange={(event) => onPatch({ accountAddress: event.target.value })}
                disabled={busy}
                placeholder="0x..."
                className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 font-mono text-sm text-ink outline-none"
              />
            </label>
          </>
        ) : null}

        {row.schemaType === 'Raw' ? (
          <label className="space-y-2 md:col-span-2">
            <span className="text-sm text-muted">Exact URI or raw data string</span>
            <textarea
              value={row.rawData}
              onChange={(event) => onPatch({ rawData: event.target.value })}
              disabled={busy}
              rows={3}
              className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 font-mono text-sm leading-7 text-ink outline-none"
            />
          </label>
        ) : null}

        <label className="space-y-2">
          <span className="text-sm text-muted">Initial support (optional)</span>
          <input
            value={row.support}
            onChange={(event) => onPatch({ support: event.target.value })}
            disabled={busy}
            placeholder="0"
            className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 text-sm text-ink outline-none"
          />
        </label>
      </div>

      {atomSearchSeed.trim().length >= 2 ? (
        <div className="mt-4 rounded-[1rem] border border-dashed border-line bg-paper/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Existing atom lookup</p>
              <p className="mt-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                {getNetworkSearchLabel(network)}
              </p>
            </div>
            {existingCandidatesLoading ? (
              <span className="text-[0.72rem] uppercase tracking-terminal text-muted">Searching...</span>
            ) : null}
          </div>
          {existingCandidatesError ? (
            <p className="mt-3 text-sm leading-7 text-[#8a4b38]">{existingCandidatesError}</p>
          ) : null}
          {!existingCandidatesLoading && existingCandidates.length > 0 ? (
            <div className="mt-4 space-y-2">
              {existingCandidates.map((candidate) => (
                <div key={candidate.termId} className="rounded-xl border border-line/70 bg-white/75 px-4 py-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {candidate.image ? (
                      <img
                        src={candidate.image}
                        alt={candidate.label}
                        className="mt-0.5 h-12 w-12 rounded-[0.85rem] border border-line/80 object-cover"
                      />
                    ) : (
                      <div className="mt-0.5 h-12 w-12 rounded-[0.85rem] border border-dashed border-line/80 bg-white/70" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-ink">{candidate.label}</p>
                        <span className="rounded-full border border-line bg-paper/70 px-2 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                          {candidate.type}
                        </span>
                      </div>
                      {candidate.description ? (
                        <p className="mt-1 text-sm leading-6 text-muted">{candidate.description}</p>
                      ) : null}
                      <p className="mt-2 break-all font-mono text-[0.72rem] leading-5 text-muted">{candidate.termId}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {!existingCandidatesLoading && !existingCandidatesError && existingCandidates.length === 0 ? (
            <p className="mt-3 text-sm leading-7 text-muted">
              No similar atoms have been found from the current name or value on {getIntuitionNetwork(network).name} yet.
            </p>
          ) : null}
        </div>
      ) : null}

      {errors.length > 0 ? (
        <div className="mt-4 rounded-xl border border-[#d8b7a9] bg-[#fff8f4] p-3">
          {errors.map((rowError) => (
            <p key={rowError} className="text-sm leading-6 text-[#8a4b38]">
              {rowError}
            </p>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-line bg-white/75 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
          Add row
        </button>
      </div>
    </div>
  );
}

function BatchAtomCreatorPanel({
  network,
  walletState,
  publicClient,
}: {
  network: PublicIntuitionNetwork;
  walletState: WalletState;
  publicClient: ReturnType<typeof createPublicClient>;
}) {
  const [rows, setRows] = useState<BatchAtomRow[]>([createBatchAtomRow()]);
  const [rowErrors, setRowErrors] = useState<Record<string, string[]>>({});
  const [preparedRows, setPreparedRows] = useState<PreparedBatchAtomRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: Hash; atomIds: Hash[] } | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const batchUploadTokensRef = useRef<Record<string, number>>({});
  const batchRowsRef = useRef(rows);
  const batchNetworkRef = useRef(network);

  const networkConfig = getIntuitionNetwork(network);
  const walletNetworkConfig = getIntuitionNetworkByChainId(walletState.chainId);
  const canWrite = walletState.status === 'connected' && walletState.chainId === networkConfig.chainId;
  const hasNetworkMismatch =
    walletState.status === 'connected' &&
    walletState.chainId !== null &&
    walletState.chainId !== networkConfig.chainId;
  const busy = isPreparing || isCreating;

  function invalidatePreparedState() {
    setPreparedRows(null);
    setResult(null);
    setStatus(null);
    setError(null);
  }

  function replaceRowLocalPreview(row: BatchAtomRow, nextPreviewUrl: string | null): BatchAtomRow {
    if (row.localImagePreviewUrl?.startsWith('blob:') && row.localImagePreviewUrl !== nextPreviewUrl) {
      URL.revokeObjectURL(row.localImagePreviewUrl);
    }

    return {
      ...row,
      localImagePreviewUrl: nextPreviewUrl,
    };
  }

  function patchRow(rowId: string, patch: Partial<BatchAtomRow>) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
    setRowErrors((current) => ({ ...current, [rowId]: [] }));
    invalidatePreparedState();
  }

  function clearRowImageUpload(rowId: string) {
    batchUploadTokensRef.current[rowId] = (batchUploadTokensRef.current[rowId] ?? 0) + 1;
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? replaceRowLocalPreview(
              {
                ...row,
                imageUploadPhase: 'idle',
                imageUploadError: null,
                selectedImageName: null,
              },
              null,
            )
          : row,
      ),
    );
  }

  function setRowSchemaType(rowId: string, schemaType: AtomSchemaType) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        return {
          ...createBatchAtomRow(isRichAtomSchemaType(schemaType) ? row.name : ''),
          id: row.id,
          schemaType,
          description: isRichAtomSchemaType(schemaType) ? row.description : '',
          url: isRichAtomSchemaType(schemaType) ? row.url : '',
          image: isRichAtomSchemaType(schemaType) ? row.image : '',
          email: schemaType === 'Person' || schemaType === 'Organization' ? row.email : '',
          identifier: schemaType === 'Person' ? row.identifier : '',
          accountChainId: schemaType === 'Account' ? row.accountChainId : '1',
          accountAddress: schemaType === 'Account' ? row.accountAddress : '',
          rawData: schemaType === 'Raw' ? row.rawData : '',
          support: row.support,
        };
      }),
    );
    setRowErrors((current) => ({ ...current, [rowId]: [] }));
    invalidatePreparedState();
  }

  function addRow() {
    setRows((current) => [...current, createBatchAtomRow()]);
    invalidatePreparedState();
  }

  function removeRow(rowId: string) {
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== rowId)));
    setRowErrors((current) => {
      const next = { ...current };
      delete next[rowId];
      return next;
    });
    invalidatePreparedState();
  }

  async function handleBatchRowImageSelection(rowId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      clearRowImageUpload(rowId);
      return;
    }

    const validationError = validateAtomImageFile(file);
    const uploadToken = (batchUploadTokensRef.current[rowId] ?? 0) + 1;
    batchUploadTokensRef.current[rowId] = uploadToken;

    if (validationError) {
      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? replaceRowLocalPreview(
                {
                  ...row,
                  imageUploadPhase: 'failed',
                  imageUploadError: validationError,
                  selectedImageName: file.name,
                },
                null,
              )
            : row,
        ),
      );
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const uploadNetwork = network;
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? replaceRowLocalPreview(
              {
                ...row,
                imageUploadPhase: 'uploading',
                imageUploadError: null,
                selectedImageName: file.name,
              },
              previewUrl,
            )
          : row,
      ),
    );
    invalidatePreparedState();

    try {
      const data = await readImageFileAsBase64(file);
      const uploadedImage = await uploadIntuitionImage(uploadNetwork, {
        contentType: file.type,
        data,
        filename: file.name || 'atom-image',
      });

      if (batchUploadTokensRef.current[rowId] !== uploadToken || batchNetworkRef.current !== uploadNetwork) {
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? {
                ...row,
                image: uploadedImage.url,
                imageUploadPhase: 'uploaded',
                imageUploadError:
                  uploadedImage.safe === false ? 'Image uploaded but marked unsafe by moderation.' : null,
              }
            : row,
        ),
      );
    } catch (caughtError) {
      if (batchUploadTokensRef.current[rowId] !== uploadToken || batchNetworkRef.current !== uploadNetwork) {
        return;
      }

      setRows((current) =>
        current.map((row) =>
          row.id === rowId
            ? {
                ...row,
                imageUploadPhase: 'failed',
                imageUploadError: normalizeImageUploadError(caughtError),
              }
            : row,
        ),
      );
    }
  }

  useEffect(() => {
    batchRowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    batchNetworkRef.current = network;
    batchUploadTokensRef.current = {};
    setRows((current) =>
      current.map((row) =>
        replaceRowLocalPreview(
          {
            ...row,
            imageUploadPhase: 'idle',
            imageUploadError: null,
            selectedImageName: null,
          },
          null,
        ),
      ),
    );
  }, [network]);

  useEffect(() => {
    return () => {
      batchRowsRef.current.forEach((row) => {
        if (row.localImagePreviewUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(row.localImagePreviewUrl);
        }
      });
    };
  }, []);

  async function handlePrepareBatch() {
    setIsPreparing(true);
    setError(null);
    setStatus('Preparing rows...');
    setResult(null);

    try {
      const validationErrors = rows.reduce<Record<string, string[]>>((accumulator, row) => {
        accumulator[row.id] = validateBatchAtomRow(row);
        return accumulator;
      }, {});

      if (Object.values(validationErrors).some((errors) => errors.length > 0)) {
        setRowErrors(validationErrors);
        setPreparedRows(null);
        setStatus(null);
        setError('Fix the row errors before reviewing the batch.');
        return;
      }

      const atomCost = (await publicClient.readContract({
        address: networkConfig.multiVault,
        abi: MULTIVAULT_ABI,
        functionName: 'getAtomCost',
      })) as bigint;

      const prepared: PreparedBatchAtomRow[] = [];
      const preparedErrors: Record<string, string[]> = {};

      for (const [index, row] of rows.entries()) {
        const label = getAtomDisplayName(row) || `row ${index + 1}`;
        setStatus(
          isRichAtomSchemaType(row.schemaType)
            ? `Pinning metadata for ${label}...`
            : `Preparing ${label}...`,
        );

        const preparedInput = await prepareAtomInput(row, network, publicClient);
        const supportWei = parseOptionalSupport(row.support) ?? 0n;
        preparedErrors[row.id] = preparedInput.exists
          ? ['This atom already exists. Remove it from the batch or change the row.']
          : [];
        prepared.push({
          ...preparedInput,
          rowId: row.id,
          supportWei,
          asset: atomCost + supportWei,
        });
      }

      setRowErrors(preparedErrors);

      if (Object.values(preparedErrors).some((errors) => errors.length > 0)) {
        setPreparedRows(null);
        setStatus(null);
        setError('Review found existing atoms. Remove those rows before sending the batch.');
        return;
      }

      setPreparedRows(prepared);
      setStatus(`Review ready. ${prepared.length} atoms will be created in one transaction.`);
    } catch (caughtError) {
      setPreparedRows(null);
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'Batch preparation failed.');
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleCreateBatch() {
    if (!preparedRows || preparedRows.length === 0) {
      setError('Review the batch before creating atoms.');
      return;
    }

    if (!canWrite) {
      setError('Connect a wallet on the selected Intuition network before creating atoms.');
      return;
    }

    setIsCreating(true);
    setError(null);
    setStatus('Waiting for wallet...');

    try {
      const provider = getEthereumProvider();

      if (!provider || !walletState.address) {
        throw new Error('No browser wallet is available.');
      }

      const atomDatas = preparedRows.map((row) => stringToHex(row.dataString));
      const assets = preparedRows.map((row) => row.asset);
      const value = assets.reduce((total, asset) => total + asset, 0n);

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createAtoms',
        args: [atomDatas, assets],
      });

      const walletClient = createWalletClient({
        chain: INTUITION_CHAINS[network],
        transport: custom(provider),
      });

      const txHash = await walletClient.sendTransaction({
        account: walletState.address as `0x${string}`,
        chain: INTUITION_CHAINS[network],
        to: networkConfig.multiVault,
        data,
        value,
      });

      setStatus('Confirming onchain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setResult({
        txHash,
        atomIds: preparedRows.map((row) => row.atomId),
      });
      setStatus('Batch atoms confirmed onchain.');
    } catch (caughtError) {
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'Batch atom creation failed.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="border border-line/80 bg-white/70 p-6 shadow-sheet">
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Manual batch atoms</p>
            <h3 className="font-serif text-[2rem] leading-none tracking-[-0.045em] text-ink">
              Review many atoms before one wallet step.
            </h3>
            <p className="max-w-3xl text-sm leading-7 text-muted">
              Add rows, review the resolved atom data, then send one batch create transaction.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            disabled={busy}
            className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Add row
          </button>
        </div>

        <div className="space-y-4">
          {rows.map((row, index) => {
            const errors = rowErrors[row.id] ?? [];

            return (
              <BatchAtomRowEditor
                key={row.id}
                row={row}
                index={index}
                network={network}
                busy={busy}
                errors={errors}
                canRemove={rows.length > 1}
                onPatch={(patch) => patchRow(row.id, patch)}
                onSetSchemaType={(schemaType) => setRowSchemaType(row.id, schemaType)}
                onRemove={() => removeRow(row.id)}
                onAdd={addRow}
                onImageSelect={(event) => {
                  void handleBatchRowImageSelection(row.id, event);
                }}
                onClearImage={() => clearRowImageUpload(row.id)}
              />
            );
          })}
        </div>

        {preparedRows ? (
          <div className="rounded-[1.15rem] border border-dashed border-line bg-paper/60 p-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Batch review</p>
            <div className="mt-4 space-y-3">
              {preparedRows.map((row, index) => (
                <div key={row.rowId} className="rounded-xl border border-line/70 bg-white/75 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-ink">
                        {index + 1}. {row.displayName}
                      </p>
                      <p className="mt-1 text-[0.68rem] uppercase tracking-terminal text-muted">{row.schemaType}</p>
                    </div>
                    <p className="text-sm text-muted">{formatEther(row.asset)} {networkConfig.nativeSymbol}</p>
                  </div>
                  <p className="mt-2 break-all font-mono text-[0.72rem] leading-5 text-muted">{row.atomId}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handlePrepareBatch();
            }}
            disabled={busy}
            className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPreparing ? 'Preparing rows...' : 'Review batch'}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCreateBatch();
            }}
            disabled={busy || !preparedRows || !canWrite}
            className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Creating batch...' : hasNetworkMismatch ? 'Wrong network' : 'Create batch'}
          </button>
        </div>

        {hasNetworkMismatch ? (
          <p className="text-sm leading-7 text-muted">
            Batch creation is disabled because your wallet is on{' '}
            {walletNetworkConfig ? walletNetworkConfig.name : `chain ${walletState.chainId}`} while this page is set to{' '}
            {networkConfig.name}.
          </p>
        ) : !canWrite ? (
          <p className="text-sm leading-7 text-muted">
            Wallet writes stay disabled until the connected wallet is on {networkConfig.name}.
          </p>
        ) : null}

        {status ? <p className="text-sm leading-7 text-muted">{status}</p> : null}
        {error ? <p className="text-sm leading-7 text-[#8a4b38]">{error}</p> : null}
        {result ? (
          <div className="rounded-[1.15rem] border border-line/80 bg-paper/70 p-5">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Batch confirmed</p>
            <p className="mt-2 text-sm leading-7 text-muted">{result.atomIds.length} atoms confirmed onchain.</p>
            <a
              href={getExplorerTxUrl(network, result.txHash)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex break-all font-mono text-[0.78rem] leading-6 text-ink underline decoration-line underline-offset-4"
            >
              {result.txHash}
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CreateWorkbench() {
  const [network, setNetwork] = useState<PublicIntuitionNetwork>('testnet');
  const [activeTab, setActiveTab] = useState<CreateWorkbenchTab>('atom');
  const [atomCreationMode, setAtomCreationMode] = useState<AtomCreationMode>('single');
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [wallet, setWallet] = useState<WalletState>({
    status: 'idle',
    address: null,
    chainId: null,
    error: null,
  });
  const [claimSelections, setClaimSelections] = useState<Record<ClaimFieldKey, IntuitionAtomSearchResult | null>>({
    subject: null,
    predicate: null,
    object: null,
  });
  const [claimExact, setClaimExact] = useState<Record<ClaimFieldKey, boolean>>({
    subject: false,
    predicate: false,
    object: false,
  });
  const [inlineTarget, setInlineTarget] = useState<ClaimFieldKey | null>(null);
  const [inlineSeed, setInlineSeed] = useState('');
  const [costs, setCosts] = useState<{ atomCost: bigint | null; tripleCost: bigint | null }>({
    atomCost: null,
    tripleCost: null,
  });
  const [claimStatus, setClaimStatus] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{
    tripleId: Hash;
    txHash?: Hash;
    alreadyExists: boolean;
  } | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);

  const networkConfig = getIntuitionNetwork(network);
  const inlineInitialForm = useMemo(() => getDefaultInlineForm(inlineSeed), [inlineSeed]);

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: INTUITION_CHAINS[network],
        transport: http(networkConfig.rpcUrl),
      }),
    [network, networkConfig.rpcUrl],
  );

  const canWrite = wallet.status === 'connected' && wallet.chainId === networkConfig.chainId;
  const walletNetworkConfig = getIntuitionNetworkByChainId(wallet.chainId);
  const hasNetworkMismatch =
    wallet.status === 'connected' && wallet.chainId !== null && wallet.chainId !== networkConfig.chainId;

  useEffect(() => {
    let ignore = false;

    async function loadCosts() {
      try {
        const [atomCost, tripleCost] = (await Promise.all([
          publicClient.readContract({
            address: networkConfig.multiVault,
            abi: MULTIVAULT_ABI,
            functionName: 'getAtomCost',
          }),
          publicClient.readContract({
            address: networkConfig.multiVault,
            abi: MULTIVAULT_ABI,
            functionName: 'getTripleCost',
          }),
        ])) as [bigint, bigint];

        if (!ignore) {
          setCosts({ atomCost, tripleCost });
        }
      } catch {
        if (!ignore) {
          setCosts({ atomCost: null, tripleCost: null });
        }
      }
    }

    void loadCosts();

    return () => {
      ignore = true;
    };
  }, [networkConfig.multiVault, publicClient]);

  useEffect(() => {
    const provider = getEthereumProvider();

    if (!provider) {
      return;
    }

    const ethereumProvider = provider;

    let ignore = false;

    async function syncWalletState() {
      try {
        const accounts = (await ethereumProvider.request({ method: 'eth_accounts' })) as unknown;
        const firstAccount = Array.isArray(accounts) ? (accounts[0] as string | undefined) : undefined;

        if (!firstAccount) {
          if (!ignore) {
            setWallet({
              status: 'idle',
              address: null,
              chainId: null,
              error: null,
            });
          }
          return;
        }

        const chainId = (await ethereumProvider.request({ method: 'eth_chainId' })) as unknown;
        const normalizedChainId = typeof chainId === 'string' ? Number.parseInt(chainId, 16) : null;

        if (!ignore) {
          setWallet({
            status: 'connected',
            address: getAddress(firstAccount),
            chainId: normalizedChainId,
            error: null,
          });
        }
      } catch {
        if (!ignore) {
          setWallet((current) => ({
            ...current,
            error: 'Unable to refresh wallet state.',
          }));
        }
      }
    }

    const handleAccountsChanged = (accounts: unknown) => {
      if (!Array.isArray(accounts) || !accounts[0] || typeof accounts[0] !== 'string') {
        setWallet({
          status: 'idle',
          address: null,
          chainId: null,
          error: null,
        });
        return;
      }

      void syncWalletState();
    };

    const handleChainChanged = () => {
      void syncWalletState();
    };

    void syncWalletState();
    ethereumProvider.on?.('accountsChanged', handleAccountsChanged);
    ethereumProvider.on?.('chainChanged', handleChainChanged);

    return () => {
      ignore = true;
      ethereumProvider.removeListener?.('accountsChanged', handleAccountsChanged);
      ethereumProvider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, []);

  function setSelection(field: ClaimFieldKey, atom: IntuitionAtomSearchResult | null) {
    setClaimSelections((current) => ({
      ...current,
      [field]: atom,
    }));
    setClaimResult(null);
    setClaimError(null);
    setClaimStatus(null);
  }

  async function connectWallet() {
    const provider = getEthereumProvider();

    if (!provider) {
      setWallet({
        status: 'error',
        address: null,
        chainId: null,
        error: 'No browser wallet was detected.',
      });
      return;
    }

    setWallet((current) => ({
      ...current,
      status: 'connecting',
      error: null,
    }));

    try {
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[];
      const chainIdHex = (await provider.request({
        method: 'eth_chainId',
      })) as string;

      if (!accounts[0]) {
        throw new Error('The wallet did not return an account.');
      }

      setWallet({
        status: 'connected',
        address: getAddress(accounts[0]),
        chainId: Number.parseInt(chainIdHex, 16),
        error: null,
      });
    } catch (caughtError) {
      setWallet({
        status: 'error',
        address: null,
        chainId: null,
        error: caughtError instanceof Error ? caughtError.message : 'Wallet connection failed.',
      });
    }
  }

  async function switchWalletNetwork(targetNetwork: PublicIntuitionNetwork) {
    const provider = getEthereumProvider();
    const targetNetworkConfig = getIntuitionNetwork(targetNetwork);

    if (!provider) {
      setWallet((current) => ({
        ...current,
        status: 'error',
        error: 'No browser wallet was detected.',
      }));
      return;
    }

    setIsSwitchingNetwork(true);

    const chainIdHex = `0x${targetNetworkConfig.chainId.toString(16)}`;

    try {
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: chainIdHex }],
        });
      } catch (caughtError) {
        const errorWithCode = caughtError as { code?: number };

        if (errorWithCode.code === 4902) {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
              {
                chainId: chainIdHex,
                chainName: targetNetworkConfig.name,
                nativeCurrency: {
                  name: targetNetworkConfig.nativeSymbol,
                  symbol: targetNetworkConfig.nativeSymbol,
                  decimals: 18,
                },
                rpcUrls: [targetNetworkConfig.rpcUrl],
                blockExplorerUrls: [targetNetworkConfig.explorerUrl],
              },
            ],
          });
        } else {
          setWallet((current) => ({
            ...current,
            error: caughtError instanceof Error ? caughtError.message : 'Network switch failed.',
          }));
          return;
        }
      }

      const nextChainIdHex = (await provider.request({
        method: 'eth_chainId',
      })) as string;

      setWallet((current) => ({
        ...current,
        status: current.address ? 'connected' : 'idle',
        chainId: Number.parseInt(nextChainIdHex, 16),
        error: null,
      }));
      setNetwork(targetNetwork);
    } finally {
      setIsSwitchingNetwork(false);
    }
  }

  async function handleNetworkSelection(targetNetwork: PublicIntuitionNetwork) {
    setNetwork(targetNetwork);

    if (wallet.status !== 'connected') {
      return;
    }

    if (wallet.chainId === getIntuitionNetwork(targetNetwork).chainId) {
      return;
    }

    await switchWalletNetwork(targetNetwork);
  }

  async function handleClaimCreate() {
    setIsClaiming(true);
    setClaimError(null);
    setClaimResult(null);
    setClaimStatus('Checking that all selected atoms exist and computing the deterministic triple ID...');

    try {
      if (!canWrite || !wallet.address) {
        throw new Error('Connect a wallet on the selected network before creating a claim.');
      }

      const subject = claimSelections.subject;
      const predicate = claimSelections.predicate;
      const object = claimSelections.object;

      if (!subject || !predicate || !object) {
        throw new Error('Subject, predicate, and object must all be resolved before claim creation.');
      }

      const [subjectExists, predicateExists, objectExists] = (await Promise.all([
        publicClient.readContract({
          address: networkConfig.multiVault,
          abi: MULTIVAULT_ABI,
          functionName: 'isTermCreated',
          args: [subject.termId],
        }),
        publicClient.readContract({
          address: networkConfig.multiVault,
          abi: MULTIVAULT_ABI,
          functionName: 'isTermCreated',
          args: [predicate.termId],
        }),
        publicClient.readContract({
          address: networkConfig.multiVault,
          abi: MULTIVAULT_ABI,
          functionName: 'isTermCreated',
          args: [object.termId],
        }),
      ])) as [boolean, boolean, boolean];

      if (!subjectExists || !predicateExists || !objectExists) {
        throw new Error(
          'At least one referenced atom is not confirmed on-chain yet. Create missing atoms first, then return to this claim flow.',
        );
      }

      const tripleId = (await publicClient.readContract({
        address: networkConfig.multiVault,
        abi: MULTIVAULT_ABI,
        functionName: 'calculateTripleId',
        args: [subject.termId, predicate.termId, object.termId],
      })) as Hash;

      const tripleExists = (await publicClient.readContract({
        address: networkConfig.multiVault,
        abi: MULTIVAULT_ABI,
        functionName: 'isTermCreated',
        args: [tripleId],
      })) as boolean;

      if (tripleExists) {
        setClaimResult({
          tripleId,
          alreadyExists: true,
        });
        setClaimStatus('That exact claim already exists on the active network, so no write was sent.');
        return;
      }

      const tripleCost = (await publicClient.readContract({
        address: networkConfig.multiVault,
        abi: MULTIVAULT_ABI,
        functionName: 'getTripleCost',
      })) as bigint;

      const provider = getEthereumProvider();

      if (!provider) {
        throw new Error('No browser wallet was detected.');
      }

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createTriples',
        args: [[subject.termId], [predicate.termId], [object.termId], [tripleCost]],
      });

      const walletClient = createWalletClient({
        chain: INTUITION_CHAINS[network],
        transport: custom(provider),
      });

      const txHash = await walletClient.sendTransaction({
        account: wallet.address as `0x${string}`,
        chain: INTUITION_CHAINS[network],
        to: networkConfig.multiVault,
        data,
        value: tripleCost,
      });

      setClaimStatus('Waiting for the triple creation transaction to confirm on-chain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setClaimResult({
        tripleId,
        txHash,
        alreadyExists: false,
      });
      setClaimStatus('Claim created successfully and confirmed on-chain.');
    } catch (caughtError) {
      setClaimStatus(null);
      setClaimError(caughtError instanceof Error ? caughtError.message : 'Claim creation failed.');
    } finally {
      setIsClaiming(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="border border-line/80 bg-white/70 p-6 shadow-sheet">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Session</p>
            <p className="font-serif text-[2rem] leading-none tracking-[-0.045em] text-ink sm:text-[2.2rem]">
              Create on Intuition without the raw protocol clutter.
            </p>
            <p className="max-w-3xl text-sm leading-7 text-muted">
              Pick a network, connect once, and then move straight into creating atoms or publishing claims.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['testnet', 'mainnet'] as PublicIntuitionNetwork[]).map((option) => (
              <button
                type="button"
                key={option}
                onClick={() => {
                  void handleNetworkSelection(option);
                }}
                disabled={isSwitchingNetwork}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors duration-150 ${
                  network === option
                    ? 'border-ink/15 bg-paper text-ink'
                    : 'border-line bg-white/70 text-muted hover:border-ink/15 hover:text-ink'
                } ${isSwitchingNetwork ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                {network === option ? (
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1f8a62]/35" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#1f8a62]" />
                  </span>
                ) : null}
                <span>{getIntuitionNetwork(option).name}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,0.6fr))]">
            <div className="rounded-[1.05rem] border border-line/80 bg-paper/70 p-4">
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Wallet</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-sm leading-6 text-ink">{formatAddress(wallet.address)}</p>
                {wallet.status === 'connected' ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-[#1f8a62]/20 bg-[#1f8a62]/8 px-2.5 py-1 text-[0.68rem] uppercase tracking-terminal text-[#1f8a62]">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#1f8a62]/35" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#1f8a62]" />
                    </span>
                    Connected
                  </span>
                ) : null}
              </div>
              {wallet.status === 'connected' ? (
                <p className="mt-2 text-sm leading-6 text-muted">
                  Wallet network:{' '}
                  <span className="text-ink">
                    {walletNetworkConfig ? walletNetworkConfig.name : `Unknown chain (${wallet.chainId})`}
                  </span>
                </p>
              ) : null}
            </div>
            <div className="rounded-[1.05rem] border border-line/80 bg-paper/70 p-4">
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Atom cost</p>
              <p className="mt-2 text-sm leading-6 text-ink">
                {costs.atomCost !== null ? `${formatEther(costs.atomCost)} ${networkConfig.nativeSymbol}` : 'Loading...'}
              </p>
            </div>
            <div className="rounded-[1.05rem] border border-line/80 bg-paper/70 p-4">
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Claim cost</p>
              <p className="mt-2 text-sm leading-6 text-ink">
                {costs.tripleCost !== null ? `${formatEther(costs.tripleCost)} ${networkConfig.nativeSymbol}` : 'Loading...'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {wallet.status === 'connected' ? (
              <span className="inline-flex rounded-full border border-[#1f8a62]/20 bg-[#1f8a62]/8 px-4 py-2 text-sm text-[#1f8a62]">
                Wallet connected
              </span>
            ) : (
              <button
                type="button"
                onClick={connectWallet}
                className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
              >
                {wallet.status === 'connecting' ? 'Connecting wallet...' : 'Connect wallet'}
              </button>
            )}
            <p className="text-sm leading-7 text-muted">
              {isSwitchingNetwork
                ? `Switching wallet to ${networkConfig.name}...`
                : wallet.status === 'connected' && wallet.chainId === networkConfig.chainId
                ? `Ready on ${networkConfig.name}. You can create and publish from here.`
                : wallet.status === 'connected'
                  ? `Wallet is on ${walletNetworkConfig ? walletNetworkConfig.name : `chain ${wallet.chainId}`}. Pick ${networkConfig.name} above to switch and write there.`
                  : 'You can browse first. Writing unlocks after wallet connection.'}
            </p>
          </div>

          {wallet.error ? <p className="text-sm leading-7 text-[#8a4b38]">{wallet.error}</p> : null}
        </div>
      </section>

      {activeTab === 'claim' ? (
        <section className="space-y-6">
          <div className="border border-line/80 bg-white/70 p-8 shadow-sheet">
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="inline-flex rounded-full border border-line bg-paper/75 p-1">
                  {(['atom', 'claim', 'lists'] as CreateWorkbenchTab[]).map((tab) => (
                    <button
                      type="button"
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full px-4 py-2 text-sm transition-colors duration-150 ${
                        activeTab === tab ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {tab === 'atom' ? 'Atom creation' : tab === 'claim' ? 'Claim creation' : 'Lists'}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-3">
                    <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Claim creation</p>
                    <h2 className="font-serif text-[2.3rem] leading-none tracking-[-0.045em] text-ink sm:text-[2.7rem]">
                      Turn atoms into a claim.
                    </h2>
                    <p className="max-w-3xl text-sm leading-7 text-muted">
                      Pick the subject, predicate, and object. If one is missing, create it inline and keep moving.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm leading-7 text-muted">
                      Claims are made from three atoms: subject, predicate, and object.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="text-sm leading-7 text-muted">
                    Direct claims use the usual three-part shape: subject, predicate, object.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm leading-7 text-muted">Lists live beside claims here now, as their own creation path.</p>
                </div>
              </div>

              <div className="grid gap-5">
                <SearchAtomField
                  label="Subject atom"
                  fieldKey="subject"
                  network={network}
                  selected={claimSelections.subject}
                  exact={claimExact.subject}
                  placeholder="Search for the subject..."
                  onSelect={(atom) => setSelection('subject', atom)}
                  onExactChange={(value) => setClaimExact((current) => ({ ...current, subject: value }))}
                  onRequestInlineCreate={(field, seed) => {
                    setInlineTarget(field);
                    setInlineSeed(seed);
                  }}
                  onClear={() => setSelection('subject', null)}
                />

                <SearchAtomField
                  label="Predicate atom"
                  fieldKey="predicate"
                  network={network}
                  selected={claimSelections.predicate}
                  exact={claimExact.predicate}
                  placeholder="Search for the predicate..."
                  onSelect={(atom) => setSelection('predicate', atom)}
                  onExactChange={(value) => setClaimExact((current) => ({ ...current, predicate: value }))}
                  onRequestInlineCreate={(field, seed) => {
                    setInlineTarget(field);
                    setInlineSeed(seed);
                  }}
                  onClear={() => setSelection('predicate', null)}
                />

                <SearchAtomField
                  label="Object atom"
                  fieldKey="object"
                  network={network}
                  selected={claimSelections.object}
                  exact={claimExact.object}
                  placeholder="Search for the object..."
                  onSelect={(atom) => setSelection('object', atom)}
                  onExactChange={(value) => setClaimExact((current) => ({ ...current, object: value }))}
                  onRequestInlineCreate={(field, seed) => {
                    setInlineTarget(field);
                    setInlineSeed(seed);
                  }}
                  onClear={() => setSelection('object', null)}
                />
              </div>

              {inlineTarget ? (
                <AtomCreatorPanel
                  key={`${inlineTarget}-${inlineSeed}`}
                  network={network}
                  walletState={wallet}
                  publicClient={publicClient}
                  title={`Inline atom creation for ${INLINE_CREATE_LABELS[inlineTarget]}`}
                  body="Create the missing atom here, then drop straight back into the claim."
                  initialForm={inlineInitialForm}
                  compact
                  onResolved={(atom) => {
                    setSelection(inlineTarget, atom);
                    setInlineTarget(null);
                    setInlineSeed('');
                  }}
                />
              ) : null}

              <div className="rounded-[1.15rem] border border-dashed border-line bg-paper/60 p-5">
                <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Claim preview</p>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {([
                    { key: 'subject', label: 'Subject', atom: claimSelections.subject },
                    { key: 'predicate', label: 'Predicate', atom: claimSelections.predicate },
                    { key: 'object', label: 'Object', atom: claimSelections.object },
                  ] as const).map((entry) => (
                    <div key={entry.key} className="rounded-xl border border-line/80 bg-white/70 p-4">
                      <p className="text-[0.68rem] uppercase tracking-terminal text-muted">{entry.label}</p>
                      <div className="mt-3 flex items-start gap-3">
                        {entry.atom?.image ? (
                          <img
                            src={entry.atom.image}
                            alt={entry.atom.label}
                            className="h-11 w-11 rounded-[0.8rem] border border-line/80 object-cover"
                          />
                        ) : (
                          <div className="h-11 w-11 rounded-[0.8rem] border border-dashed border-line/80 bg-paper/70" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-ink">{entry.atom?.label ?? entry.label}</p>
                          {entry.atom?.type ? (
                            <p className="mt-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                              {entry.atom.type}
                            </p>
                          ) : null}
                          {entry.atom?.description ? (
                            <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted">{entry.atom.description}</p>
                          ) : (
                            <p className="mt-2 text-sm leading-6 text-muted">Choose an atom to preview it here.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    void handleClaimCreate();
                  }}
                  disabled={isClaiming || !canWrite}
                  className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isClaiming
                    ? 'Creating claim...'
                    : hasNetworkMismatch
                      ? 'Wrong network'
                      : 'Create claim'}
                </button>
                <p className="text-sm leading-7 text-muted">
                  All three atoms must already exist before the claim can be published.
                </p>
              </div>

              {hasNetworkMismatch ? (
                <p className="text-sm leading-7 text-muted">
                  Claim creation is disabled because your wallet is on{' '}
                  {walletNetworkConfig ? walletNetworkConfig.name : `chain ${wallet.chainId}`} while this page is set to{' '}
                  {networkConfig.name}.
                </p>
              ) : !canWrite ? (
                <p className="text-sm leading-7 text-muted">
                  Claim creation stays disabled until the wallet is connected on {networkConfig.name}.
                </p>
              ) : null}
              {claimStatus ? <p className="text-sm leading-7 text-muted">{claimStatus}</p> : null}
              {claimError ? <p className="text-sm leading-7 text-[#8a4b38]">{claimError}</p> : null}
              {claimResult ? (
                <div className="rounded-[1.15rem] border border-line/80 bg-paper/70 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Claim result</p>
                      <p className="mt-2 font-serif text-[1.5rem] leading-none tracking-[-0.04em] text-ink">
                        {claimResult.alreadyExists ? 'Existing claim surfaced' : 'Claim confirmed'}
                      </p>
                    </div>
                    <span className="rounded-full border border-ink/10 bg-white/70 px-3 py-1 text-[0.72rem] uppercase tracking-terminal text-muted">
                      {claimResult.alreadyExists ? 'Already exists' : 'Created'}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-muted">
                    <div>
                      <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Triple ID</p>
                      <p className="mt-1 break-all font-mono text-[0.78rem] leading-6 text-ink">{claimResult.tripleId}</p>
                    </div>
                    {claimResult.txHash ? (
                      <div>
                        <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Transaction</p>
                        <a
                          href={getExplorerTxUrl(network, claimResult.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex break-all font-mono text-[0.78rem] leading-6 text-ink underline decoration-line underline-offset-4"
                        >
                          {claimResult.txHash}
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>
      ) : activeTab === 'atom' ? (
        <section className="space-y-6">
          <div className="border border-line/80 bg-white/70 p-8 shadow-sheet">
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="inline-flex rounded-full border border-line bg-paper/75 p-1">
                  {(['atom', 'claim', 'lists'] as CreateWorkbenchTab[]).map((tab) => (
                    <button
                      type="button"
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full px-4 py-2 text-sm transition-colors duration-150 ${
                        activeTab === tab ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {tab === 'atom' ? 'Atom creation' : tab === 'claim' ? 'Claim creation' : 'Lists'}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Atom creation</p>
                  <h2 className="font-serif text-[2.3rem] leading-none tracking-[-0.045em] text-ink sm:text-[2.7rem]">
                    Create the building block first.
                  </h2>
                  <p className="max-w-3xl text-sm leading-7 text-muted">
                    Start with the atom you need. If a matching atom already exists, reuse it instead of minting a duplicate.
                  </p>
                </div>
              </div>

              <div className="inline-flex rounded-full border border-line bg-paper/75 p-1">
                {(['single', 'batch'] as AtomCreationMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => setAtomCreationMode(mode)}
                    className={`rounded-full px-4 py-2 text-sm transition-colors duration-150 ${
                      atomCreationMode === mode ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {mode === 'single' ? 'Single atom' : 'Batch atoms'}
                  </button>
                ))}
              </div>

              {atomCreationMode === 'single' ? (
                <AtomCreatorPanel
                  network={network}
                  walletState={wallet}
                  publicClient={publicClient}
                  title="Atom creation"
                  body="Create the building block you need, then bring it straight into a claim."
                />
              ) : (
                <BatchAtomCreatorPanel
                  network={network}
                  walletState={wallet}
                  publicClient={publicClient}
                />
              )}

              <div className="border border-line/80 bg-paper/70 p-5">
                <div className="flex flex-wrap items-center gap-3 text-sm leading-7 text-muted">
                  <p>Supported here: Thing, Person, Organization, Account (CAIP-10), and raw URI/data.</p>
                  <p>Rich atoms pin metadata first. If a match already exists, reuse it.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-6">
          <div className="border border-line/80 bg-white/70 p-8 shadow-sheet">
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="inline-flex rounded-full border border-line bg-paper/75 p-1">
                  {(['atom', 'claim', 'lists'] as CreateWorkbenchTab[]).map((tab) => (
                    <button
                      type="button"
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`rounded-full px-4 py-2 text-sm transition-colors duration-150 ${
                        activeTab === tab ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
                      }`}
                    >
                      {tab === 'atom' ? 'Atom creation' : tab === 'claim' ? 'Claim creation' : 'Lists'}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Lists</p>
                  <h2 className="font-serif text-[2.3rem] leading-none tracking-[-0.045em] text-ink sm:text-[2.7rem]">
                    Group atoms into a list.
                  </h2>
                  <p className="max-w-3xl text-sm leading-7 text-muted">
                    Lists are not direct claims. They are for grouping, tagging, and organizing atoms around one anchor.
                  </p>
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.7fr)]">
                <div className="rounded-[1.15rem] border border-line/80 bg-paper/70 p-6">
                  <div className="space-y-5">
                    <div>
                      <p className="text-[0.72rem] uppercase tracking-terminal text-muted">How this should work</p>
                      <p className="mt-3 text-sm leading-7 text-muted">
                        Pick the anchor atom first, then attach existing atoms as members or tags. That flow deserves its
                        own builder instead of being hidden inside direct claim creation.
                      </p>
                    </div>

                    <div className="divide-y divide-line/70 border-y border-line/70">
                      {[
                        'Choose the atom the list belongs to',
                        'Search and attach the atoms you want grouped under it',
                        'Review the structure before publishing the list',
                      ].map((step, index) => (
                        <div key={step} className="grid gap-3 py-4 sm:grid-cols-[3rem_minmax(0,1fr)] sm:items-start">
                          <p className="text-sm text-muted">0{index + 1}</p>
                          <p className="text-sm leading-7 text-ink">{step}</p>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveTab('claim')}
                        className="inline-flex rounded-full border border-line bg-white/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
                      >
                        Back to claims
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('atom')}
                        className="inline-flex rounded-full border border-line bg-white/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
                      >
                        Back to atoms
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.15rem] border border-line/80 bg-paper/70 p-6">
                  <div className="space-y-4">
                    <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Status</p>
                    <p className="font-serif text-[2rem] leading-none tracking-[-0.045em] text-ink">Coming next</p>
                    <p className="text-sm leading-7 text-muted">
                      This tab is now the list creation placeholder inside the main creation hub. When the real builder
                      lands, it should open here instead of living on a separate page.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
