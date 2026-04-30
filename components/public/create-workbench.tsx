'use client';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useAccountModal, useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useWalletClient } from 'wagmi';
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseEther,
  stringToHex,
  type Hash,
  type WalletClient,
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
type AtomCreationMode = 'single' | 'batch' | 'csv';
type ClaimFieldKey = 'subject' | 'predicate' | 'object';
type CreateWorkbenchTab = 'claim' | 'atom' | 'lists';
type ImageUploadPhase = 'idle' | 'uploading' | 'uploaded' | 'failed';
type ListEntryMode = 'single' | 'batch' | 'csv';

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

interface CsvAtomRecord extends BatchAtomRow {
  csvLineNumber: number;
  csvSource: Record<string, string>;
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
  preferredCreatorAddress?: string | null;
  onSelect: (atom: IntuitionAtomSearchResult) => void;
  onExactChange: (value: boolean) => void;
  onRequestInlineCreate: (field: ClaimFieldKey, seed: string) => void;
  onClear: () => void;
}

interface ListBatchMemberRow {
  id: string;
  member: IntuitionAtomSearchResult | null;
  exact: boolean;
}

interface ListCsvImportRow {
  id: string;
  lineNumber: number;
  memberName: string;
  selected: IntuitionAtomSearchResult | null;
  candidates: IntuitionAtomSearchResult[];
  status: 'resolved' | 'ambiguous' | 'missing';
  note: string;
}

interface ListAtomModalState {
  target: 'list' | 'single-member' | 'batch-member';
  seed: string;
  rowId?: string;
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
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/']);
const MAX_CSV_BATCH_SIZE = 20;
const MAX_LIST_BATCH_SIZE = 20;
const HAS_TAG_PREDICATE_TERM_ID =
  '0x7ec36d201c842dc787b45cb5bb753bea4cf849be3908fb1b0a7d067c3c3cc1f5' as Hash;

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

function formatTokenAmount(value: bigint, symbol: string): string {
  const formatted = Number.parseFloat(formatEther(value)).toFixed(3).replace(/\.?0+$/, '');
  return `${formatted} ${symbol}`;
}

function getNetworkSearchLabel(network: PublicIntuitionNetwork): string {
  return `Searching ${getIntuitionNetwork(network).name}`;
}

function normalizeSearchText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesCreatorAddress(atom: IntuitionAtomSearchResult, walletAddress?: string | null): boolean {
  if (!walletAddress) {
    return false;
  }

  const normalizedWallet = walletAddress.trim().toLowerCase();

  return (
    atom.creatorId?.trim().toLowerCase() === normalizedWallet ||
    atom.creatorLabel?.trim().toLowerCase() === normalizedWallet
  );
}

function sortAtomsForWalletPreference(
  results: IntuitionAtomSearchResult[],
  walletAddress?: string | null,
): IntuitionAtomSearchResult[] {
  if (!walletAddress) {
    return results;
  }

  return results.slice().sort((left, right) => {
    const leftPreferred = matchesCreatorAddress(left, walletAddress) ? 1 : 0;
    const rightPreferred = matchesCreatorAddress(right, walletAddress) ? 1 : 0;

    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }

    if (left.positionCount !== right.positionCount) {
      return right.positionCount - left.positionCount;
    }

    return right.totalShares.localeCompare(left.totalShares);
  });
}

async function searchAtoms(
  network: PublicIntuitionNetwork,
  query: string,
  exact: boolean,
  limit: number,
  preferredCreatorAddress?: string | null,
  signal?: AbortSignal,
): Promise<IntuitionAtomSearchResult[]> {
  const requestInit: RequestInit = {};

  if (signal) {
    requestInit.signal = signal;
  }

  const response = await fetch(
    `/api/intuition/search-atoms?network=${network}&q=${encodeURIComponent(query)}&exact=${exact ? '1' : '0'}&limit=${limit}`,
    requestInit,
  );

  const payload = (await response.json()) as {
    results?: IntuitionAtomSearchResult[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? 'Atom search failed.');
  }

  return sortAtomsForWalletPreference(payload.results ?? [], preferredCreatorAddress);
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

function createListBatchMemberRow(): ListBatchMemberRow {
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return {
    id: randomId,
    member: null,
    exact: true,
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

function slugifyCsvHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (character === ',' && !insideQuotes) {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if ((character === '\n' || character === '\r') && !insideQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      currentRow.push(currentCell);
      currentCell = '';

      const hasValues = currentRow.some((cell) => cell.trim().length > 0);
      if (hasValues) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentCell += character;
  }

  if (insideQuotes) {
    throw new Error('CSV contains an unclosed quoted value.');
  }

  currentRow.push(currentCell);
  if (currentRow.some((cell) => cell.trim().length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

function normalizeCsvSchemaType(value: string): AtomSchemaType | null {
  const normalized = slugifyCsvHeader(value);

  if (!normalized) {
    return 'Thing';
  }

  if (normalized === 'thing') return 'Thing';
  if (normalized === 'person') return 'Person';
  if (normalized === 'organization') return 'Organization';
  if (normalized === 'account' || normalized === 'caip10' || normalized === 'account_caip10') return 'Account';
  if (normalized === 'raw' || normalized === 'raw_data' || normalized === 'uri' || normalized === 'data') return 'Raw';

  return null;
}

function mapCsvRecordToAtom(
  values: Record<string, string>,
  csvLineNumber: number,
): { atom: CsvAtomRecord; errors: string[] } {
  const schemaType = normalizeCsvSchemaType(values.schema_type ?? '');
  const errors: string[] = [];

  if (!schemaType) {
    errors.push('schema_type must be Thing, Person, Organization, Account, or Raw.');
  }

  const resolvedSchemaType = schemaType ?? 'Thing';
  const atom = createBatchAtomRow() as CsvAtomRecord;
  atom.csvLineNumber = csvLineNumber;
  atom.csvSource = values;
  atom.schemaType = resolvedSchemaType;
  atom.name = values.name?.trim() ?? '';
  atom.description = values.description?.trim() ?? '';
  atom.url = values.url?.trim() ?? '';
  atom.image = (values.image_url ?? values.image ?? '').trim();
  atom.support = (values.deposit ?? '').trim();
  atom.email = values.email?.trim() ?? '';
  atom.identifier = values.identifier?.trim() ?? '';
  atom.accountChainId = (values.account_chain_id ?? values.chain_id ?? '1').trim() || '1';
  atom.accountAddress = (values.account_address ?? values.address ?? '').trim();
  atom.rawData = (values.raw_data ?? values.data ?? '').trim();

  if (resolvedSchemaType === 'Account' && !atom.accountAddress && values.name?.trim()) {
    atom.accountAddress = values.name.trim();
  }

  if (resolvedSchemaType === 'Raw' && !atom.rawData && values.name?.trim()) {
    atom.rawData = values.name.trim();
  }

  if (isRichAtomSchemaType(resolvedSchemaType) && !atom.name) {
    errors.push('name is required for Thing, Person, and Organization atoms.');
  }

  if (resolvedSchemaType === 'Account' && !atom.accountAddress) {
    errors.push('account_address is required for Account atoms.');
  }

  if (resolvedSchemaType === 'Raw' && !atom.rawData) {
    errors.push('raw_data is required for Raw atoms.');
  }

  return { atom, errors };
}

function parseCsvAtomFile(text: string): { atoms: CsvAtomRecord[]; errors: string[] } {
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    throw new Error('CSV is empty.');
  }

  const headerRow = rows[0];
  if (!headerRow) {
    throw new Error('CSV is empty.');
  }

  const headers = headerRow.map(slugifyCsvHeader);
  if (!headers.includes('name') && !headers.includes('raw_data') && !headers.includes('account_address')) {
    throw new Error('CSV must include at least a name, raw_data, or account_address column.');
  }

  const atoms: CsvAtomRecord[] = [];
  const errors: string[] = [];

  rows.slice(1).forEach((cells, rowIndex) => {
    const values = headers.reduce<Record<string, string>>((accumulator, header, headerIndex) => {
      accumulator[header] = (cells[headerIndex] ?? '').trim();
      return accumulator;
    }, {});

    if (Object.values(values).every((value) => value === '')) {
      return;
    }

    const csvLineNumber = rowIndex + 2;
    const { atom, errors: rowMappingErrors } = mapCsvRecordToAtom(values, csvLineNumber);
    atoms.push(atom);

    rowMappingErrors.forEach((error) => {
      errors.push(`Line ${csvLineNumber}: ${error}`);
    });
  });

  if (atoms.length === 0) {
    throw new Error('CSV did not contain any usable atoms.');
  }

  if (atoms.length > MAX_CSV_BATCH_SIZE) {
    errors.push(`CSV import is limited to ${MAX_CSV_BATCH_SIZE} atoms per transaction.`);
  }

  return { atoms, errors };
}

function parseListCsvFile(text: string): { rows: Array<{ lineNumber: number; memberName: string }>; errors: string[] } {
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    throw new Error('CSV is empty.');
  }

  const headerRow = rows[0];

  if (!headerRow) {
    throw new Error('CSV is empty.');
  }

  const headers = headerRow.map(slugifyCsvHeader);
  const preferredHeader = ['name', 'member', 'atom', 'label'].find((header) => headers.includes(header));

  if (!preferredHeader) {
    throw new Error('CSV must include a name, member, atom, or label column.');
  }

  const headerIndex = headers.indexOf(preferredHeader);
  const parsedRows: Array<{ lineNumber: number; memberName: string }> = [];
  const errors: string[] = [];

  rows.slice(1).forEach((cells, rowIndex) => {
    const memberName = (cells[headerIndex] ?? '').trim();
    const lineNumber = rowIndex + 2;

    if (!memberName) {
      errors.push(`Line ${lineNumber}: ${preferredHeader} is required.`);
      return;
    }

    parsedRows.push({ lineNumber, memberName });
  });

  if (parsedRows.length === 0) {
    throw new Error('CSV did not contain any usable members.');
  }

  if (parsedRows.length > MAX_LIST_BATCH_SIZE) {
    errors.push(`CSV import is limited to ${MAX_LIST_BATCH_SIZE} list entries per transaction.`);
  }

  return { rows: parsedRows, errors };
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
  preferredCreatorAddress,
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
        const searchedResults = await searchAtoms(
          network,
          normalizedQuery,
          exact,
          8,
          preferredCreatorAddress,
          controller.signal,
        );
        setResults(searchedResults);
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
  }, [disabled, exact, network, preferredCreatorAddress, query, selected]);

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
  walletClient,
  publicClient,
  title,
  body,
  initialForm,
  compact,
  onResolved,
}: {
  network: PublicIntuitionNetwork;
  walletState: WalletState;
  walletClient?: WalletClient | null | undefined;
  publicClient: ReturnType<typeof createPublicClient>;
  title: string;
  body: string;
  initialForm?: AtomFormState | undefined;
  compact?: boolean | undefined;
  onResolved?: ((atom: IntuitionAtomSearchResult) => void) | undefined;
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

  function resetAtomForm() {
    setForm(initialForm ?? EMPTY_ATOM_FORM);
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
      if (!walletClient || !walletState.address) {
        throw new Error('No connected wallet client is available.');
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
          creatorId: null,
          creatorLabel: null,
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
        creatorId: null,
        creatorLabel: null,
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
          <div className="space-y-3">
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
            {result.kind === 'created' ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={resetAtomForm}
                  className="inline-flex rounded-full border border-ink/15 bg-ink px-4 py-2 text-sm text-paper transition-colors duration-150 hover:bg-[#3a2a23]"
                >
                  Clear form for another atom
                </button>
                <p className="text-sm leading-7 text-muted">
                  This wipes the current atom fields so you can start the next one cleanly.
                </p>
              </div>
            ) : null}
          </div>
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
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Atom {index + 1}</p>
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
                          alt={row.name.trim() || `Batch atom ${index + 1} image preview`}
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
          className="inline-flex items-center gap-2 rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition-colors duration-150 hover:bg-[#3a2a23] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
          Add atom
        </button>
      </div>
    </div>
  );
}

function BatchAtomCreatorPanel({
  network,
  walletState,
  walletClient,
  publicClient,
}: {
  network: PublicIntuitionNetwork;
  walletState: WalletState;
  walletClient?: WalletClient | null;
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
    setStatus('Preparing atoms...');
    setResult(null);

    try {
      const validationErrors = rows.reduce<Record<string, string[]>>((accumulator, atom) => {
        accumulator[atom.id] = validateBatchAtomRow(atom);
        return accumulator;
      }, {});

      if (Object.values(validationErrors).some((errors) => errors.length > 0)) {
        setRowErrors(validationErrors);
        setPreparedRows(null);
        setStatus(null);
        setError('Fix the atom errors before reviewing the batch.');
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
        const label = getAtomDisplayName(row) || `atom ${index + 1}`;
        setStatus(
          isRichAtomSchemaType(row.schemaType)
            ? `Pinning metadata for ${label}...`
            : `Preparing ${label}...`,
        );

        const preparedInput = await prepareAtomInput(row, network, publicClient);
        const supportWei = parseOptionalSupport(row.support) ?? 0n;
        preparedErrors[row.id] = preparedInput.exists
          ? ['This atom already exists. Remove it from the batch or change the atom.']
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
        setError('Review found existing atoms. Remove those atoms before sending the batch.');
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
      if (!walletClient || !walletState.address) {
        throw new Error('No connected wallet client is available.');
      }

      const atomDatas = preparedRows.map((row) => stringToHex(row.dataString));
      const assets = preparedRows.map((row) => row.asset);
      const value = assets.reduce((total, asset) => total + asset, 0n);

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createAtoms',
        args: [atomDatas, assets],
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
              Add atoms, review the resolved atom data, then send one batch create transaction.
            </p>
          </div>
          <button
            type="button"
            onClick={addRow}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition-colors duration-150 hover:bg-[#3a2a23] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span aria-hidden="true" className="text-base leading-none">+</span>
            Add atom
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
            {isPreparing ? 'Preparing atoms...' : 'Review batch'}
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

function CsvAtomImportPanel({
  network,
  walletState,
  walletClient,
  publicClient,
}: {
  network: PublicIntuitionNetwork;
  walletState: WalletState;
  walletClient?: WalletClient | null;
  publicClient: ReturnType<typeof createPublicClient>;
}) {
  const [csvText, setCsvText] = useState('');
  const [atoms, setAtoms] = useState<CsvAtomRecord[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string[]>>({});
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [preparedAtoms, setPreparedAtoms] = useState<PreparedBatchAtomRow[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txHash: Hash; atomIds: Hash[] } | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const networkConfig = getIntuitionNetwork(network);
  const walletNetworkConfig = getIntuitionNetworkByChainId(walletState.chainId);
  const canWrite = walletState.status === 'connected' && walletState.chainId === networkConfig.chainId;
  const hasNetworkMismatch =
    walletState.status === 'connected' &&
    walletState.chainId !== null &&
    walletState.chainId !== networkConfig.chainId;
  const busy = isParsing || isPreparing || isCreating;

  function clearPreparedState() {
    setPreparedAtoms(null);
    setResult(null);
    setStatus(null);
    setError(null);
  }

  function resetImport() {
    setCsvText('');
    setAtoms([]);
    setRowErrors({});
    setImportErrors([]);
    clearPreparedState();
  }

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsParsing(true);
    setError(null);
    setStatus('Importing CSV...');

    try {
      const text = await file.text();
      setCsvText(text);
      const parsed = parseCsvAtomFile(text);
      setAtoms(parsed.atoms);
      setImportErrors(parsed.errors);
      setRowErrors({});
      setPreparedAtoms(null);
      setResult(null);
      setStatus(`Imported ${parsed.atoms.length} atoms from CSV.`);
    } catch (caughtError) {
      setAtoms([]);
      setImportErrors([]);
      setRowErrors({});
      setPreparedAtoms(null);
      setResult(null);
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'CSV import failed.');
    } finally {
      setIsParsing(false);
      event.target.value = '';
    }
  }

  async function handleParseCsvText() {
    setIsParsing(true);
    setError(null);
    setStatus('Parsing CSV...');

    try {
      const parsed = parseCsvAtomFile(csvText);
      setAtoms(parsed.atoms);
      setImportErrors(parsed.errors);
      setRowErrors({});
      setPreparedAtoms(null);
      setResult(null);
      setStatus(`Imported ${parsed.atoms.length} atoms from CSV.`);
    } catch (caughtError) {
      setAtoms([]);
      setImportErrors([]);
      setRowErrors({});
      setPreparedAtoms(null);
      setResult(null);
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'CSV import failed.');
    } finally {
      setIsParsing(false);
    }
  }

  async function handlePrepareCsvBatch() {
    setIsPreparing(true);
    setError(null);
    setStatus('Validating atoms...');
    setResult(null);

    try {
      const validationErrors = atoms.reduce<Record<string, string[]>>((accumulator, atom) => {
        accumulator[atom.id] = validateBatchAtomRow(atom);
        return accumulator;
      }, {});

      if (importErrors.length > 0) {
        setRowErrors(validationErrors);
        setPreparedAtoms(null);
        setStatus(null);
        setError('Fix the CSV import issues before reviewing the batch.');
        return;
      }

      if (Object.values(validationErrors).some((errors) => errors.length > 0)) {
        setRowErrors(validationErrors);
        setPreparedAtoms(null);
        setStatus(null);
        setError('Fix the atom validation issues before reviewing the batch.');
        return;
      }

      const atomCost = (await publicClient.readContract({
        address: networkConfig.multiVault,
        abi: MULTIVAULT_ABI,
        functionName: 'getAtomCost',
      })) as bigint;

      const prepared: PreparedBatchAtomRow[] = [];
      const preparedErrors: Record<string, string[]> = {};

      for (const [index, atom] of atoms.entries()) {
        const label = getAtomDisplayName(atom) || `atom ${index + 1}`;
        setStatus(
          isRichAtomSchemaType(atom.schemaType)
            ? `Pinning metadata for ${label}...`
            : `Preparing ${label}...`,
        );

        const preparedInput = await prepareAtomInput(atom, network, publicClient);
        const supportWei = parseOptionalSupport(atom.support) ?? 0n;
        preparedErrors[atom.id] = preparedInput.exists
          ? ['This atom already exists. Remove it from the CSV or change the source data.']
          : [];

        prepared.push({
          ...preparedInput,
          rowId: atom.id,
          supportWei,
          asset: atomCost + supportWei,
        });
      }

      setRowErrors(preparedErrors);

      if (Object.values(preparedErrors).some((errors) => errors.length > 0)) {
        setPreparedAtoms(null);
        setStatus(null);
        setError('Review found existing atoms. Remove those CSV atoms before sending the batch.');
        return;
      }

      setPreparedAtoms(prepared);
      setStatus(`Preview ready. ${prepared.length} atoms can be created in one transaction.`);
    } catch (caughtError) {
      setPreparedAtoms(null);
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'CSV batch preparation failed.');
    } finally {
      setIsPreparing(false);
    }
  }

  async function handleCreateCsvBatch() {
    if (!preparedAtoms || preparedAtoms.length === 0) {
      setError('Review the CSV import before creating atoms.');
      return;
    }

    if (!canWrite) {
      setError('Connect a wallet on the selected Intuition network before creating atoms.');
      return;
    }

    setIsCreating(true);
    setError(null);
    setStatus('Waiting for wallet approval...');

    try {
      if (!walletClient || !walletState.address) {
        throw new Error('No connected wallet client is available.');
      }

      const atomDatas = preparedAtoms.map((atom) => stringToHex(atom.dataString));
      const assets = preparedAtoms.map((atom) => atom.asset);
      const value = assets.reduce((total, asset) => total + asset, 0n);

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createAtoms',
        args: [atomDatas, assets],
      });

      const txHash = await walletClient.sendTransaction({
        account: walletState.address as `0x${string}`,
        chain: INTUITION_CHAINS[network],
        to: networkConfig.multiVault,
        data,
        value,
      });

      setStatus('Confirming transaction onchain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setResult({
        txHash,
        atomIds: preparedAtoms.map((atom) => atom.atomId),
      });
      setStatus('CSV atoms confirmed onchain.');
    } catch (caughtError) {
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'CSV atom creation failed.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="border border-line/80 bg-white/70 p-6 shadow-sheet">
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-[0.72rem] uppercase tracking-terminal text-muted">CSV atom import</p>
          <h3 className="font-serif text-[2rem] leading-none tracking-[-0.045em] text-ink">
            Import atoms from a spreadsheet.
          </h3>
          <p className="max-w-3xl text-sm leading-7 text-muted">
            Start with a simple `name` column, then add optional fields like `description`, `url`, `image_url`,
            `deposit`, or `schema_type` when needed. CSV imports are capped at {MAX_CSV_BATCH_SIZE} atoms per transaction.
          </p>
        </div>

        <div className="rounded-[1.05rem] border border-line/80 bg-paper/60 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition-colors duration-150 hover:bg-[#3a2a23]">
              <span aria-hidden="true" className="text-base leading-none">+</span>
              Upload CSV
              <input type="file" accept=".csv,text/csv" onChange={(event) => void handleCsvFile(event)} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => {
                void handleParseCsvText();
              }}
              disabled={busy || !csvText.trim()}
              className="inline-flex rounded-full border border-line bg-white/75 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isParsing ? 'Parsing CSV...' : 'Preview import'}
            </button>
            <button
              type="button"
              onClick={resetImport}
              disabled={busy && !csvText}
              className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Clear import
            </button>
          </div>
          <textarea
            value={csvText}
            onChange={(event) => {
              setCsvText(event.target.value);
              clearPreparedState();
            }}
            rows={8}
            placeholder={'name,description,url,image_url,deposit,schema_type\nAcme,Trusted supplier,https://acme.com,,0.001,Thing'}
            className="mt-4 w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 font-mono text-sm leading-7 text-ink outline-none transition-colors duration-150 focus:border-ink/20"
          />
        </div>

        {atoms.length > 0 ? (
          <div className="rounded-[1.15rem] border border-dashed border-line bg-paper/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[0.72rem] uppercase tracking-terminal text-muted">CSV preview</p>
                <p className="mt-1 text-sm leading-6 text-muted">
                  {atoms.length} atoms ready for validation on {getIntuitionNetwork(network).name}.
                </p>
              </div>
              <span className="rounded-full border border-line bg-white/80 px-3 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                Scroll to inspect
              </span>
            </div>
            <div className="mt-4 overflow-x-auto">
              <div className="max-h-[24rem] overflow-y-auto rounded-xl border border-line/70 bg-white/75">
                <table className="min-w-full text-left text-sm">
                  <thead className="sticky top-0 bg-paper/95 text-[0.68rem] uppercase tracking-terminal text-muted">
                    <tr>
                      <th className="px-4 py-3">Line</th>
                      <th className="px-4 py-3">Atom</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Deposit</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line/70">
                    {atoms.map((atom) => {
                      const atomErrors = rowErrors[atom.id] ?? [];
                      return (
                        <tr key={atom.id}>
                          <td className="px-4 py-3 text-muted">{atom.csvLineNumber}</td>
                          <td className="px-4 py-3 text-ink">
                            {getAtomDisplayName(atom) || 'Untitled atom'}
                          </td>
                          <td className="px-4 py-3 text-muted">{atom.schemaType}</td>
                          <td className="px-4 py-3 text-muted">{atom.support.trim() || '0'}</td>
                          <td className="px-4 py-3">
                            {atomErrors.length > 0 ? (
                              <span className="text-[#8a4b38]">{atomErrors[0]}</span>
                            ) : (
                              <span className="text-muted">Ready</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}

        {importErrors.length > 0 ? (
          <div className="rounded-xl border border-[#d8b7a9] bg-[#fff8f4] p-4">
            {importErrors.map((importError) => (
              <p key={importError} className="text-sm leading-6 text-[#8a4b38]">
                {importError}
              </p>
            ))}
          </div>
        ) : null}

        {preparedAtoms ? (
          <div className="rounded-[1.15rem] border border-dashed border-line bg-paper/60 p-4">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Import review</p>
            <div className="mt-4 space-y-3">
              {preparedAtoms.map((atom, index) => (
                <div key={atom.rowId} className="rounded-xl border border-line/70 bg-white/75 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-ink">
                        {index + 1}. {atom.displayName}
                      </p>
                      <p className="mt-1 text-[0.68rem] uppercase tracking-terminal text-muted">{atom.schemaType}</p>
                    </div>
                    <p className="text-sm text-muted">
                      {formatTokenAmount(atom.asset, networkConfig.nativeSymbol)}
                    </p>
                  </div>
                  <p className="mt-2 break-all font-mono text-[0.72rem] leading-5 text-muted">{atom.atomId}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void handlePrepareCsvBatch();
            }}
            disabled={busy || atoms.length === 0}
            className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPreparing ? 'Validating atoms...' : 'Validate and review'}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCreateCsvBatch();
            }}
            disabled={busy || !preparedAtoms || !canWrite}
            className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreating ? 'Submitting import...' : hasNetworkMismatch ? 'Wrong network' : 'Create CSV batch'}
          </button>
        </div>

        {hasNetworkMismatch ? (
          <p className="text-sm leading-7 text-muted">
            CSV import is disabled because your wallet is on{' '}
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
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">CSV batch confirmed</p>
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

function ListSearchField({
  label,
  network,
  selected,
  exact,
  placeholder,
  disabled,
  lockedNote,
  preferredCreatorAddress,
  createLabel,
  onSelect,
  onExactChange,
  onRequestCreate,
  onClear,
}: {
  label: string;
  network: PublicIntuitionNetwork;
  selected: IntuitionAtomSearchResult | null;
  exact: boolean;
  placeholder: string;
  disabled?: boolean | undefined;
  lockedNote?: string | undefined;
  preferredCreatorAddress?: string | null | undefined;
  createLabel?: string | undefined;
  onSelect: (atom: IntuitionAtomSearchResult) => void;
  onExactChange: (value: boolean) => void;
  onRequestCreate?: ((seed: string) => void) | undefined;
  onClear: () => void;
}) {
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
        const searchedResults = await searchAtoms(
          network,
          normalizedQuery,
          exact,
          8,
          preferredCreatorAddress,
          controller.signal,
        );
        setResults(searchedResults);
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
  }, [disabled, exact, network, preferredCreatorAddress, query, selected]);

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
        <div className="flex flex-wrap items-center gap-3">
          {onRequestCreate ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRequestCreate(query.trim())}
              className="inline-flex rounded-full border border-line bg-white/75 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              Create atom
            </button>
          ) : null}
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
              ) : (
                <div className="h-14 w-14 rounded-[0.85rem] border border-dashed border-line/80 bg-white/70" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm text-ink">{selected.label}</p>
                  <span className="rounded-full border border-line bg-white/80 px-2 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                    {selected.type}
                  </span>
                  {matchesCreatorAddress(selected, preferredCreatorAddress) ? (
                    <span className="text-[0.68rem] uppercase tracking-terminal text-[#1f8a62]">Your atom</span>
                  ) : null}
                </div>
                {selected.description ? (
                  <p className="mt-2 text-sm leading-6 text-muted">{selected.description}</p>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-muted">No description attached.</p>
                )}
                <p className="mt-2 break-all font-mono text-[0.72rem] leading-5 text-muted">{selected.termId}</p>
              </div>
            </div>
          </div>
        ) : null}

        {!disabled && loading ? <p className="text-sm text-muted">{getNetworkSearchLabel(network)}...</p> : null}
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
                    {matchesCreatorAddress(result, preferredCreatorAddress) ? (
                      <span className="text-[0.68rem] uppercase tracking-terminal text-[#1f8a62]">Your atom</span>
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
            {onRequestCreate ? (
              <button
                type="button"
                onClick={() => onRequestCreate(query.trim())}
                className="mt-3 inline-flex rounded-full border border-ink px-3 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper"
              >
                Create "{query.trim()}" as the {createLabel ?? 'atom'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ListBatchMemberEditor({
  index,
  network,
  preferredCreatorAddress,
  row,
  disabled,
  onSelect,
  onExactChange,
  onRequestCreate,
  onRemove,
}: {
  index: number;
  network: PublicIntuitionNetwork;
  preferredCreatorAddress?: string | null;
  row: ListBatchMemberRow;
  disabled?: boolean;
  onSelect: (atom: IntuitionAtomSearchResult | null) => void;
  onExactChange: (value: boolean) => void;
  onRequestCreate: (seed: string, rowId: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 rounded-[1.15rem] border border-line/80 bg-paper/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">List member {index + 1}</p>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="inline-flex rounded-full border border-line bg-white/75 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          Remove
        </button>
      </div>

      <ListSearchField
        label="Member atom"
        network={network}
        selected={row.member}
        exact={row.exact}
        disabled={disabled}
        preferredCreatorAddress={preferredCreatorAddress}
        placeholder="Search for the atom to add..."
        lockedNote="Search for the atom you want to add to this list."
        onRequestCreate={(seed) => onRequestCreate(seed, row.id)}
        onSelect={onSelect}
        onExactChange={onExactChange}
        onClear={() => onSelect(null)}
      />
    </div>
  );
}

function ListCreatorPanel({
  network,
  walletState,
  walletClient,
  publicClient,
  tripleCost,
}: {
  network: PublicIntuitionNetwork;
  walletState: WalletState;
  walletClient?: WalletClient | null;
  publicClient: ReturnType<typeof createPublicClient>;
  tripleCost: bigint | null;
}) {
  const networkConfig = getIntuitionNetwork(network);
  const canWrite = walletState.status === 'connected' && walletState.chainId === networkConfig.chainId;
  const walletNetworkConfig = getIntuitionNetworkByChainId(walletState.chainId);
  const hasNetworkMismatch =
    walletState.status === 'connected' &&
    walletState.chainId !== null &&
    walletState.chainId !== networkConfig.chainId;

  const [entryMode, setEntryMode] = useState<ListEntryMode>('single');
  const [listAtom, setListAtom] = useState<IntuitionAtomSearchResult | null>(null);
  const [listExact, setListExact] = useState(true);
  const [singleMember, setSingleMember] = useState<IntuitionAtomSearchResult | null>(null);
  const [singleExact, setSingleExact] = useState(true);
  const [batchRows, setBatchRows] = useState<ListBatchMemberRow[]>([createListBatchMemberRow()]);
  const [csvText, setCsvText] = useState('');
  const [csvRows, setCsvRows] = useState<ListCsvImportRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvStatus, setCsvStatus] = useState<string | null>(null);
  const [isResolvingCsv, setIsResolvingCsv] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    txHash?: Hash;
    createdCount: number;
    existingCount: number;
    listLabel: string;
    listTermId: Hash;
  } | null>(null);
  const [modalState, setModalState] = useState<ListAtomModalState | null>(null);

  const inlineInitialForm = useMemo(
    () => (modalState ? getDefaultInlineForm(modalState.seed) : undefined),
    [modalState],
  );

  function clearActionState() {
    setStatus(null);
    setError(null);
    setResult(null);
  }

  function getResolvedBatchMembers() {
    return batchRows.flatMap((row) => (row.member ? [row.member] : []));
  }

  function getResolvedCsvMembers() {
    return csvRows.flatMap((row) => (row.status === 'resolved' && row.selected ? [row.selected] : []));
  }

  async function submitListEntries(members: IntuitionAtomSearchResult[]) {
    setIsSubmitting(true);
    clearActionState();
    setCsvStatus(null);

    try {
      if (!canWrite || !walletState.address) {
        throw new Error('Connect a wallet on the active Intuition network before adding to a list.');
      }

      if (!walletClient) {
        throw new Error('No connected wallet client is available.');
      }

      if (!listAtom) {
        throw new Error('Resolve the list atom first.');
      }

      const dedupedMembers = Array.from(new Map(members.map((member) => [member.termId, member])).values());

      if (dedupedMembers.length === 0) {
        throw new Error('Resolve at least one member atom before adding to the list.');
      }

      if (dedupedMembers.length > MAX_LIST_BATCH_SIZE) {
        throw new Error(`List creation is limited to ${MAX_LIST_BATCH_SIZE} members per transaction.`);
      }

      setStatus('Checking the list atom, member atoms, and the canonical has tag predicate on-chain...');

      const termIdsToCheck = [listAtom.termId, HAS_TAG_PREDICATE_TERM_ID, ...dedupedMembers.map((member) => member.termId)];
      const existenceChecks = (await Promise.all(
        termIdsToCheck.map((termId) =>
          publicClient.readContract({
            address: networkConfig.multiVault,
            abi: MULTIVAULT_ABI,
            functionName: 'isTermCreated',
            args: [termId],
          }),
        ),
      )) as boolean[];

      if (existenceChecks.some((exists) => !exists)) {
        throw new Error('At least one required atom is not confirmed on-chain yet. Create missing atoms first.');
      }

      setStatus('Computing the list entries that already exist so only missing ones are sent...');

      const tripleIds = (await Promise.all(
        dedupedMembers.map((member) =>
          publicClient.readContract({
            address: networkConfig.multiVault,
            abi: MULTIVAULT_ABI,
            functionName: 'calculateTripleId',
            args: [member.termId, HAS_TAG_PREDICATE_TERM_ID, listAtom.termId],
          }),
        ),
      )) as Hash[];

      const tripleExists = (await Promise.all(
        tripleIds.map((tripleId) =>
          publicClient.readContract({
            address: networkConfig.multiVault,
            abi: MULTIVAULT_ABI,
            functionName: 'isTermCreated',
            args: [tripleId],
          }),
        ),
      )) as boolean[];

      const membersToCreate = dedupedMembers.filter((_, index) => !tripleExists[index]);
      const existingCount = tripleExists.filter(Boolean).length;

      if (membersToCreate.length === 0) {
        setResult({
          createdCount: 0,
          existingCount,
          listLabel: listAtom.label,
          listTermId: listAtom.termId,
        });
        setStatus('Those atoms are already in this list on the active network, so no write was sent.');
        return;
      }

      const resolvedTripleCost =
        tripleCost ??
        ((await publicClient.readContract({
          address: networkConfig.multiVault,
          abi: MULTIVAULT_ABI,
          functionName: 'getTripleCost',
        })) as bigint);

      const assets = Array.from({ length: membersToCreate.length }, () => resolvedTripleCost);
      const predicateIds = Array.from({ length: membersToCreate.length }, () => HAS_TAG_PREDICATE_TERM_ID);
      const objectIds = Array.from({ length: membersToCreate.length }, () => listAtom.termId);
      const totalValue = resolvedTripleCost * BigInt(membersToCreate.length);

      setStatus('Waiting for wallet approval to add the missing atoms to this list...');

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createTriples',
        args: [membersToCreate.map((member) => member.termId), predicateIds, objectIds, assets],
      });

      const txHash = await walletClient.sendTransaction({
        account: walletState.address as `0x${string}`,
        chain: INTUITION_CHAINS[network],
        to: networkConfig.multiVault,
        data,
        value: totalValue,
      });

      setStatus('Confirming the list entry transaction on-chain...');
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setResult({
        txHash,
        createdCount: membersToCreate.length,
        existingCount,
        listLabel: listAtom.label,
        listTermId: listAtom.termId,
      });
      setStatus('List entries confirmed on-chain.');
    } catch (caughtError) {
      setStatus(null);
      setError(caughtError instanceof Error ? caughtError.message : 'List creation failed.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResolveCsv() {
    setIsResolvingCsv(true);
    setCsvStatus('Validating CSV rows and resolving member atoms against the graph...');
    setCsvErrors([]);
    clearActionState();

    try {
      const { rows, errors: parsingErrors } = parseListCsvFile(csvText);
      const cappedRows = rows.slice(0, MAX_LIST_BATCH_SIZE);

      const resolvedRows: ListCsvImportRow[] = await Promise.all(
        cappedRows.map(async (row) => {
          const results = await searchAtoms(network, row.memberName, true, 8, walletState.address);
          const normalizedName = normalizeSearchText(row.memberName);
          const exactMatches = results.filter((candidate) => normalizeSearchText(candidate.label) === normalizedName);
          const walletPreferredMatches = exactMatches.filter((candidate) =>
            matchesCreatorAddress(candidate, walletState.address),
          );

          if (walletPreferredMatches.length === 1) {
            return {
              id: `${row.lineNumber}-${normalizedName}`,
              lineNumber: row.lineNumber,
              memberName: row.memberName,
              selected: walletPreferredMatches[0] ?? null,
              candidates: exactMatches,
              status: 'resolved' as const,
              note: 'Exact match found and your own atom was preferred.',
            };
          }

          if (exactMatches.length === 1) {
            return {
              id: `${row.lineNumber}-${normalizedName}`,
              lineNumber: row.lineNumber,
              memberName: row.memberName,
              selected: exactMatches[0] ?? null,
              candidates: exactMatches,
              status: 'resolved' as const,
              note: 'Exact match found.',
            };
          }

          if (exactMatches.length > 1) {
            return {
              id: `${row.lineNumber}-${normalizedName}`,
              lineNumber: row.lineNumber,
              memberName: row.memberName,
              selected: null,
              candidates: exactMatches,
              status: 'ambiguous' as const,
              note: 'Multiple exact matches exist. Pick the right atom before submitting.',
            };
          }

          return {
            id: `${row.lineNumber}-${normalizedName}`,
            lineNumber: row.lineNumber,
            memberName: row.memberName,
            selected: null,
            candidates: [],
            status: 'missing' as const,
            note: 'No exact atom matched this member name on the active network.',
          };
        }),
      );

      const resolvedCount = resolvedRows.filter((row) => row.status === 'resolved').length;
      const unresolvedCount = resolvedRows.length - resolvedCount;

      setCsvRows(resolvedRows);
      setCsvErrors(parsingErrors);
      setCsvStatus(
        unresolvedCount === 0
          ? `${resolvedCount} members resolved and ready for list creation.`
          : `${resolvedCount} members resolved. ${unresolvedCount} still need review.`,
      );
    } catch (caughtError) {
      setCsvRows([]);
      setCsvStatus(null);
      setCsvErrors([caughtError instanceof Error ? caughtError.message : 'CSV import failed.']);
    } finally {
      setIsResolvingCsv(false);
    }
  }

  const unresolvedCsvCount = csvRows.filter((row) => row.status !== 'resolved').length;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Lists</p>
        <h2 className="font-serif text-[2.3rem] leading-none tracking-[-0.045em] text-ink sm:text-[2.7rem]">
          Add atoms to a list.
        </h2>
        <p className="max-w-3xl text-sm leading-7 text-muted">
          Pick or create the list name first, then add one atom, several atoms, or a CSV of member names. Under the
          hood, each entry becomes the usual Intuition claim structure with the canonical has tag predicate.
        </p>
      </div>

      <ListSearchField
        label="List atom"
        network={network}
        selected={listAtom}
        exact={listExact}
        preferredCreatorAddress={walletState.address}
        placeholder="Search for the list name..."
        lockedNote="This is the list name atom. If it does not exist yet, create it here first."
        createLabel="list"
        onSelect={(atom) => {
          setListAtom(atom);
          clearActionState();
        }}
        onExactChange={setListExact}
        onRequestCreate={(seed) => {
          setModalState({
            target: 'list',
            seed,
          });
        }}
        onClear={() => {
          setListAtom(null);
          clearActionState();
        }}
      />

      {modalState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(28,18,12,0.45)] px-4 py-8">
          <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto border border-line/80 bg-paper p-6 shadow-sheet">
            <button
              type="button"
              onClick={() => setModalState(null)}
              className="absolute right-4 top-4 inline-flex rounded-full border border-line bg-white/80 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
            >
              Close
            </button>

            <AtomCreatorPanel
              key={`${modalState.target}-${modalState.rowId ?? 'single'}-${modalState.seed}`}
              network={network}
              walletState={walletState}
              walletClient={walletClient ?? null}
              publicClient={publicClient}
              title={
                modalState.target === 'list'
                  ? 'Create the list atom'
                  : 'Create member atom'
              }
              body={
                modalState.target === 'list'
                  ? 'Create the list name, then keep adding atoms to it.'
                  : 'Create the atom you want to add to this list.'
              }
              initialForm={inlineInitialForm}
              compact
              onResolved={(atom) => {
                if (modalState.target === 'list') {
                  setListAtom(atom);
                } else if (modalState.target === 'single-member') {
                  setSingleMember(atom);
                } else if (modalState.target === 'batch-member' && modalState.rowId) {
                  setBatchRows((current) =>
                    current.map((entry) => (entry.id === modalState.rowId ? { ...entry, member: atom } : entry)),
                  );
                }
                setModalState(null);
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="inline-flex rounded-full border border-line bg-paper/75 p-1">
        {(['single', 'batch', 'csv'] as ListEntryMode[]).map((mode) => (
          <button
            type="button"
            key={mode}
            onClick={() => {
              setEntryMode(mode);
              clearActionState();
            }}
            className={`rounded-full px-4 py-2 text-sm transition-colors duration-150 ${
              entryMode === mode ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
            }`}
          >
            {mode === 'single' ? 'Single entry' : mode === 'batch' ? 'Batch entries' : 'CSV import'}
          </button>
        ))}
      </div>

      {entryMode === 'single' ? (
        <div className="space-y-5">
          <ListSearchField
            label="Member atom"
            network={network}
            selected={singleMember}
            exact={singleExact}
            preferredCreatorAddress={walletState.address}
            placeholder="Search for the atom to add..."
            lockedNote="Choose the atom you want to add to the list."
            createLabel="member"
            onSelect={(atom) => {
              setSingleMember(atom);
              clearActionState();
            }}
            onExactChange={setSingleExact}
            onRequestCreate={(seed) => {
              setModalState({
                target: 'single-member',
                seed,
              });
            }}
            onClear={() => {
              setSingleMember(null);
              clearActionState();
            }}
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void submitListEntries(singleMember ? [singleMember] : []);
              }}
              disabled={isSubmitting || !canWrite || !listAtom || !singleMember}
              className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Adding to list...' : hasNetworkMismatch ? 'Wrong network' : 'Add to list'}
            </button>
            <p className="text-sm leading-7 text-muted">Resolve the list name and one member atom, then publish.</p>
          </div>
        </div>
      ) : entryMode === 'batch' ? (
        <div className="space-y-5">
          <div className="space-y-4">
            {batchRows.map((row, index) => (
              <ListBatchMemberEditor
                key={row.id}
                index={index}
                network={network}
                preferredCreatorAddress={walletState.address}
                row={row}
                disabled={isSubmitting}
                onSelect={(atom) => {
                  setBatchRows((current) =>
                    current.map((entry) => (entry.id === row.id ? { ...entry, member: atom } : entry)),
                  );
                  clearActionState();
                }}
                onExactChange={(value) => {
                  setBatchRows((current) =>
                    current.map((entry) => (entry.id === row.id ? { ...entry, exact: value } : entry)),
                  );
                  clearActionState();
                }}
                onRequestCreate={(seed, rowId) => {
                  setModalState({
                    target: 'batch-member',
                    seed,
                    rowId,
                  });
                }}
                onRemove={() => {
                  setBatchRows((current) =>
                    current.length > 1 ? current.filter((entry) => entry.id !== row.id) : [createListBatchMemberRow()],
                  );
                  clearActionState();
                }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => setBatchRows((current) => [...current, createListBatchMemberRow()])}
            disabled={isSubmitting || batchRows.length >= MAX_LIST_BATCH_SIZE}
            className="inline-flex rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition-colors duration-150 hover:bg-[#3a2a23] disabled:cursor-not-allowed disabled:opacity-60"
          >
            + Add atom
          </button>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void submitListEntries(getResolvedBatchMembers());
              }}
              disabled={isSubmitting || !canWrite || !listAtom || getResolvedBatchMembers().length === 0}
              className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Adding to list...' : hasNetworkMismatch ? 'Wrong network' : 'Add atoms to list'}
            </button>
            <p className="text-sm leading-7 text-muted">
              Batch entries that already exist are skipped automatically before the transaction is built.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-5 rounded-[1.15rem] border border-line/80 bg-paper/60 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink bg-ink px-4 py-2 text-sm text-paper transition-colors duration-150 hover:bg-[#3a2a23]">
              <span aria-hidden="true" className="text-base leading-none">+</span>
              Upload CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) {
                    return;
                  }

                  void file.text().then((text) => {
                    setCsvText(text);
                    setCsvRows([]);
                    setCsvErrors([]);
                    setCsvStatus(null);
                    clearActionState();
                  });
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                void handleResolveCsv();
              }}
              disabled={isResolvingCsv || !csvText.trim()}
              className="inline-flex rounded-full border border-line bg-white/75 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isResolvingCsv ? 'Resolving members...' : 'Preview import'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCsvText('');
                setCsvRows([]);
                setCsvErrors([]);
                setCsvStatus(null);
                clearActionState();
              }}
              className="inline-flex rounded-full border border-line bg-paper/70 px-4 py-2 text-sm text-muted transition-colors duration-150 hover:border-ink/15 hover:text-ink"
            >
              Clear import
            </button>
          </div>

          <textarea
            value={csvText}
            onChange={(event) => {
              setCsvText(event.target.value);
              setCsvRows([]);
              setCsvErrors([]);
              setCsvStatus(null);
              clearActionState();
            }}
            rows={8}
            placeholder={'name\nEthereum\nBase\nOptimism'}
            className="w-full rounded-xl border border-line/80 bg-white/70 px-4 py-3 font-mono text-sm leading-7 text-ink outline-none transition-colors duration-150 focus:border-ink/20"
          />

          {csvStatus ? <p className="text-sm leading-7 text-muted">{csvStatus}</p> : null}
          {csvErrors.length > 0 ? (
            <div className="rounded-xl border border-[#d8a68e] bg-[#fff5f0] p-4 text-sm leading-7 text-[#8a4b38]">
              {csvErrors.map((entry) => (
                <p key={entry}>{entry}</p>
              ))}
            </div>
          ) : null}

          {csvRows.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-[1.05rem] border border-line/80 bg-white/75 p-4">
                <p className="text-[0.72rem] uppercase tracking-terminal text-muted">CSV review</p>
                <p className="mt-2 text-sm leading-7 text-muted">
                  {csvRows.filter((row) => row.status === 'resolved').length} resolved, {unresolvedCsvCount} still need
                  review.
                </p>
              </div>

              <div className="space-y-3">
                {csvRows.map((row) => (
                  <div key={row.id} className="rounded-[1.05rem] border border-line/80 bg-white/75 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Line {row.lineNumber}</p>
                        <p className="mt-1 text-sm text-ink">{row.memberName}</p>
                      </div>
                      <span className="rounded-full border border-line bg-paper/80 px-3 py-1 text-[0.68rem] uppercase tracking-terminal text-muted">
                        {row.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted">{row.note}</p>

                    {row.status === 'resolved' && row.selected ? (
                      <div className="mt-3 rounded-xl border border-ink/10 bg-paper/70 p-4">
                        <div className="flex gap-3">
                          {row.selected.image ? (
                            <img
                              src={row.selected.image}
                              alt={row.selected.label}
                              className="h-11 w-11 rounded-[0.8rem] border border-line/80 object-cover"
                            />
                          ) : (
                            <div className="h-11 w-11 rounded-[0.8rem] border border-dashed border-line/80 bg-white/70" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-ink">{row.selected.label}</p>
                            <p className="mt-1 break-all font-mono text-[0.72rem] leading-5 text-muted">
                              {row.selected.termId}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {row.status === 'ambiguous' && row.candidates.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {row.candidates.slice(0, 4).map((candidate) => (
                          <button
                            type="button"
                            key={`${row.id}-${candidate.termId}`}
                            onClick={() => {
                              setCsvRows((current) =>
                                current.map((entry) =>
                                  entry.id === row.id
                                    ? {
                                        ...entry,
                                        selected: candidate,
                                        status: 'resolved',
                                        note: 'Exact match reviewed and selected manually.',
                                      }
                                    : entry,
                                ),
                              );
                              clearActionState();
                            }}
                            className="flex w-full items-start gap-3 rounded-xl border border-line/70 bg-paper/65 px-4 py-3 text-left transition-colors duration-150 hover:border-ink/15 hover:bg-white/80"
                          >
                            {candidate.image ? (
                              <img
                                src={candidate.image}
                                alt={candidate.label}
                                className="mt-0.5 h-11 w-11 rounded-[0.8rem] border border-line/80 object-cover"
                              />
                            ) : (
                              <div className="mt-0.5 h-11 w-11 rounded-[0.8rem] border border-dashed border-line/80 bg-white/70" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm text-ink">{candidate.label}</p>
                                {matchesCreatorAddress(candidate, walletState.address) ? (
                                  <span className="text-[0.68rem] uppercase tracking-terminal text-[#1f8a62]">
                                    Your atom
                                  </span>
                                ) : null}
                              </div>
                              {candidate.description ? (
                                <p className="mt-1 text-sm leading-6 text-muted">{candidate.description}</p>
                              ) : null}
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void submitListEntries(getResolvedCsvMembers());
              }}
              disabled={isSubmitting || !canWrite || !listAtom || csvRows.length === 0 || unresolvedCsvCount > 0}
              className="inline-flex rounded-full border border-ink px-4 py-2 text-sm text-ink transition-colors duration-150 hover:bg-ink hover:text-paper disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Adding to list...' : hasNetworkMismatch ? 'Wrong network' : 'Add resolved atoms to list'}
            </button>
            <p className="text-sm leading-7 text-muted">
              Unresolved CSV rows must be reviewed first so the app does not guess the wrong atom.
            </p>
          </div>
        </div>
      )}

      {hasNetworkMismatch ? (
        <p className="text-sm leading-7 text-muted">
          List creation is disabled because your wallet is on{' '}
          {walletNetworkConfig ? walletNetworkConfig.name : `chain ${walletState.chainId}`} while this page is set to{' '}
          {networkConfig.name}.
        </p>
      ) : !canWrite ? (
        <p className="text-sm leading-7 text-muted">
          List creation stays disabled until the wallet is connected on {networkConfig.name}.
        </p>
      ) : null}

      {status ? <p className="text-sm leading-7 text-muted">{status}</p> : null}
      {error ? <p className="text-sm leading-7 text-[#8a4b38]">{error}</p> : null}
      {result ? (
        <div className="rounded-[1.15rem] border border-line/80 bg-paper/70 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[0.72rem] uppercase tracking-terminal text-muted">List result</p>
              <p className="mt-2 font-serif text-[1.5rem] leading-none tracking-[-0.04em] text-ink">
                {result.createdCount > 0 ? 'List updated' : 'No new entries needed'}
              </p>
            </div>
            <span className="rounded-full border border-ink/10 bg-white/70 px-3 py-1 text-[0.72rem] uppercase tracking-terminal text-muted">
              {result.createdCount} new
            </span>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-muted">
            <div>
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">List atom</p>
              <p className="mt-1 text-ink">{result.listLabel}</p>
              <p className="mt-1 break-all font-mono text-[0.78rem] leading-6 text-ink">{result.listTermId}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Created now</p>
                <p className="mt-1 text-ink">{result.createdCount}</p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Already there</p>
                <p className="mt-1 text-ink">{result.existingCount}</p>
              </div>
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
      ) : null}
    </div>
  );
}

export function CreateWorkbench() {
  const { address, isConnected, status: accountStatus } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const [network, setNetwork] = useState<PublicIntuitionNetwork>('testnet');
  const [activeTab, setActiveTab] = useState<CreateWorkbenchTab>('atom');
  const [atomCreationMode, setAtomCreationMode] = useState<AtomCreationMode>('single');
  const [walletUiError, setWalletUiError] = useState<string | null>(null);
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

  const wallet = useMemo<WalletState>(() => {
    if (isConnected && address) {
      return {
        status: 'connected',
        address: getAddress(address),
        chainId: chainId ?? null,
        error: walletUiError,
      };
    }

    if (accountStatus === 'connecting' || accountStatus === 'reconnecting') {
      return {
        status: 'connecting',
        address: address ? getAddress(address) : null,
        chainId: chainId ?? null,
        error: walletUiError,
      };
    }

    return {
      status: walletUiError ? 'error' : 'idle',
      address: address ? getAddress(address) : null,
      chainId: chainId ?? null,
      error: walletUiError,
    };
  }, [accountStatus, address, chainId, isConnected, walletUiError]);

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
    if (accountStatus === 'connected' || accountStatus === 'reconnecting') {
      setWalletUiError(null);
    }
  }, [accountStatus, address, chainId]);

  useEffect(() => {
    if (walletNetworkConfig && network !== walletNetworkConfig.key) {
      setNetwork(walletNetworkConfig.key);
    }
  }, [network, walletNetworkConfig]);

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
    setWalletUiError(null);

    if (!openConnectModal) {
      setWalletUiError('No wallet connector is available in this browser.');
      return;
    }
    openConnectModal();
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

      if (!walletClient) {
        throw new Error('No connected wallet client is available.');
      }

      const data = encodeFunctionData({
        abi: MULTIVAULT_ABI,
        functionName: 'createTriples',
        args: [[subject.termId], [predicate.termId], [object.termId], [tripleCost]],
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
    <div className="grid gap-8 xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-start">
      <aside className="border border-line/80 bg-white/70 p-6 shadow-sheet xl:sticky xl:top-24">
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-[0.72rem] uppercase tracking-terminal text-muted">Session</p>
            <p className="font-serif text-[1.55rem] leading-none tracking-[-0.045em] text-ink sm:text-[1.7rem]">
              Ready to write on Intuition.
            </p>
            <p className="text-sm leading-7 text-muted">
              Check the active network, confirm your wallet, and move straight into creation.
            </p>
          </div>

          <div className="space-y-3">
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
            </div>

            <div className="rounded-[1.05rem] border border-line/80 bg-paper/70 p-4">
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Current network</p>
              <p className="mt-2 text-sm leading-6 text-ink">
                {walletNetworkConfig ? walletNetworkConfig.name : networkConfig.name}
              </p>
            </div>

            <div className="rounded-[1.05rem] border border-line/80 bg-paper/70 p-4">
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Atom cost</p>
              <p className="mt-2 text-sm leading-6 text-ink">
                {costs.atomCost !== null ? formatTokenAmount(costs.atomCost, networkConfig.nativeSymbol) : 'Loading...'}
              </p>
            </div>

            <div className="rounded-[1.05rem] border border-line/80 bg-paper/70 p-4">
              <p className="text-[0.68rem] uppercase tracking-terminal text-muted">Claim cost</p>
              <p className="mt-2 text-sm leading-6 text-ink">
                {costs.tripleCost !== null ? formatTokenAmount(costs.tripleCost, networkConfig.nativeSymbol) : 'Loading...'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {wallet.status === 'connected' ? (
              <button
                type="button"
                onClick={openAccountModal ?? undefined}
                className="inline-flex rounded-full border border-[#1f8a62]/20 bg-[#1f8a62]/8 px-4 py-2 text-sm text-[#1f8a62] transition-colors duration-150 hover:border-[#1f8a62]/40 hover:bg-[#1f8a62]/12"
              >
                Wallet connected
              </button>
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
              {wallet.status === 'connected' && wallet.chainId === networkConfig.chainId
                ? `Ready on ${networkConfig.name}.`
                : wallet.status === 'connected'
                  ? `Wallet is on ${walletNetworkConfig ? walletNetworkConfig.name : `chain ${wallet.chainId}`}. Switch networks from the header if needed.`
                  : 'Writing unlocks after wallet connection.'}
            </p>
          </div>

          {wallet.error ? <p className="text-sm leading-7 text-[#8a4b38]">{wallet.error}</p> : null}
        </div>
      </aside>

      <div className="space-y-6">
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
                  preferredCreatorAddress={wallet.address}
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
                  preferredCreatorAddress={wallet.address}
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
                  preferredCreatorAddress={wallet.address}
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
                  walletClient={walletClient ?? null}
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
                {(['single', 'batch', 'csv'] as AtomCreationMode[]).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => setAtomCreationMode(mode)}
                    className={`rounded-full px-4 py-2 text-sm transition-colors duration-150 ${
                      atomCreationMode === mode ? 'bg-ink text-paper' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {mode === 'single' ? 'Single atom' : mode === 'batch' ? 'Batch atoms' : 'CSV import'}
                  </button>
                ))}
              </div>

              {atomCreationMode === 'single' ? (
                <AtomCreatorPanel
                  network={network}
                  walletState={wallet}
                  walletClient={walletClient ?? null}
                  publicClient={publicClient}
                  title="Atom creation"
                  body="Create the building block you need, then bring it straight into a claim."
                />
              ) : atomCreationMode === 'batch' ? (
                <BatchAtomCreatorPanel
                  network={network}
                  walletState={wallet}
                  walletClient={walletClient ?? null}
                  publicClient={publicClient}
                />
              ) : (
                <CsvAtomImportPanel
                  network={network}
                  walletState={wallet}
                  walletClient={walletClient ?? null}
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

              </div>
              <ListCreatorPanel
                network={network}
                walletState={wallet}
                walletClient={walletClient ?? null}
                publicClient={publicClient}
                tripleCost={costs.tripleCost}
              />
            </div>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
