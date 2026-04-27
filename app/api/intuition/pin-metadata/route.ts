import { NextRequest, NextResponse } from 'next/server';

import { getIntuitionNetwork, type IntuitionPinRequest } from '../../../../src/intuition/public';

const PIN_THING_MUTATION = `
  mutation PinThing($name: String!, $description: String!, $image: String!, $url: String!) {
    pinThing(thing: { name: $name, description: $description, image: $image, url: $url }) {
      uri
    }
  }
`;

const PIN_PERSON_MUTATION = `
  mutation PinPerson($name: String!, $description: String!, $image: String!, $url: String!, $email: String!, $identifier: String!) {
    pinPerson(person: { name: $name, description: $description, image: $image, url: $url, email: $email, identifier: $identifier }) {
      uri
    }
  }
`;

const PIN_ORGANIZATION_MUTATION = `
  mutation PinOrganization($name: String!, $description: String!, $image: String!, $url: String!, $email: String!) {
    pinOrganization(organization: { name: $name, description: $description, image: $image, url: $url, email: $email }) {
      uri
    }
  }
`;

function normalizeOptional(value: string | undefined): string {
  return value?.trim() ?? '';
}

function isValidOptionalHttpUrl(value: string): boolean {
  if (!value) {
    return true;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidOptionalImageRef(value: string): boolean {
  if (!value) {
    return true;
  }

  if (value.startsWith('ipfs://')) {
    return true;
  }

  return isValidOptionalHttpUrl(value);
}

function isValidOptionalEmail(value: string): boolean {
  if (!value) {
    return true;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as IntuitionPinRequest;
  const network = body.network;

  if (network !== 'mainnet' && network !== 'testnet') {
    return NextResponse.json({ error: 'Unsupported network.' }, { status: 400 });
  }

  const name = body.name?.trim();
  const description = normalizeOptional(body.description);
  const image = normalizeOptional(body.image);
  const url = normalizeOptional(body.url);
  const email = normalizeOptional(body.email);
  const identifier = normalizeOptional(body.identifier);

  if (!name) {
    return NextResponse.json({ error: 'Name is required.' }, { status: 400 });
  }

  if (!isValidOptionalHttpUrl(url) || !isValidOptionalImageRef(image)) {
    return NextResponse.json(
      { error: 'URL must be empty or a valid HTTPS URL. Image must be empty, a valid HTTPS URL, or an ipfs:// URI.' },
      { status: 400 },
    );
  }

  if (!isValidOptionalEmail(email)) {
    return NextResponse.json({ error: 'Email must be empty or valid.' }, { status: 400 });
  }

  const config = getIntuitionNetwork(network);

  let query: string;
  let variables: Record<string, string>;

  if (body.schemaType === 'Person') {
    query = PIN_PERSON_MUTATION;
    variables = {
      name,
      description,
      image,
      url,
      email,
      identifier,
    };
  } else if (body.schemaType === 'Organization') {
    query = PIN_ORGANIZATION_MUTATION;
    variables = {
      name,
      description,
      image,
      url,
      email,
    };
  } else {
    query = PIN_THING_MUTATION;
    variables = {
      name,
      description,
      image,
      url,
    };
  }

  const response = await fetch(config.graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Pin request failed with HTTP ${response.status}.` },
      { status: 502 },
    );
  }

  const payload = (await response.json()) as {
    data?: {
      pinThing?: { uri?: string };
      pinPerson?: { uri?: string };
      pinOrganization?: { uri?: string };
    };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors?.length) {
    return NextResponse.json(
      {
        error: payload.errors.map((error) => error.message ?? 'Unknown GraphQL error').join('; '),
      },
      { status: 502 },
    );
  }

  const uri =
    payload.data?.pinThing?.uri ??
    payload.data?.pinPerson?.uri ??
    payload.data?.pinOrganization?.uri ??
    '';

  if (!uri.startsWith('ipfs://')) {
    return NextResponse.json(
      { error: 'Pin response did not include a valid ipfs:// URI.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ uri });
}
