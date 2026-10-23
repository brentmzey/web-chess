import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../utils/logger';
import { tryCatchAsync } from '../../utils/fp';

interface PocketBaseAuthResponse {
  token: string;
  record?: {
    id: string;
    email: string;
  };
}

interface CollectionListResponse {
  items: Array<{
    id: string;
    name: string;
  }>;
}

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

export const runPocketBaseMigration = async (
  baseUrl: string,
  email: string,
  password: string
): Promise<{ success: boolean; applied: string[]; errors: string[] }> => {
  const url = baseUrl.replace(/\/+$/, '');
  logger.info(`Starting PocketBase schema migration for ${url}...`);

  // 1. Authenticate as superuser
  const authRes = await tryCatchAsync(async () => {
    // Try PocketBase 0.23+ superusers collection first, fallback to admins
    const superuserRes = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password })
    });

    if (superuserRes.ok) {
      return (await superuserRes.json()) as PocketBaseAuthResponse;
    }

    const adminRes = await fetch(`${url}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password })
    });

    if (adminRes.ok) {
      return (await adminRes.json()) as PocketBaseAuthResponse;
    }

    throw new Error(`Authentication failed with status ${superuserRes.status} / ${adminRes.status}`);
  }, toError);

  const tokenRes = authRes.match({
    Ok: (auth) => auth.token,
    Err: (err) => {
      logger.error(`Superuser authentication failed: ${err.message}`);
      return null;
    }
  });

  if (!tokenRes) {
    return { success: false, applied: [], errors: ['Superuser authentication failed'] };
  }

  const token = tokenRes;
  const headers = {
    Authorization: token,
    'Content-Type': 'application/json'
  };

  // 2. Fetch existing collections
  const listRes = await fetch(`${url}/api/collections?perPage=200`, { headers });
  if (!listRes.ok) {
    const msg = `Failed to list collections: ${listRes.statusText}`;
    logger.error(msg);
    return { success: false, applied: [], errors: [msg] };
  }

  const existingCollections = ((await listRes.json()) as CollectionListResponse).items;
  const collectionMap = new Map<string, string>();
  for (const c of existingCollections) {
    collectionMap.set(c.name, c.id);
  }

  // 3. Load canonical schema.json
  const schemaPath = join(__dirname, 'schema.json');
  const schemaRaw = await readFile(schemaPath, 'utf-8');
  const schemaList = JSON.parse(schemaRaw) as Array<Record<string, any>>;

  const applied: string[] = [];
  const errors: string[] = [];

  for (const col of schemaList) {
    const existingId = collectionMap.get(col.name);

    // Resolve relation collection IDs
    const resolvedFields = (col.fields || []).map((f: Record<string, any>) => {
      if (f.type === 'relation' && typeof f.collectionId === 'string') {
        const targetId = collectionMap.get(f.collectionId);
        return {
          ...f,
          collectionId: targetId || f.collectionId
        };
      }
      return f;
    });

    const payload = {
      ...col,
      fields: resolvedFields
    };

    if (existingId) {
      // Update collection
      const updateRes = await fetch(`${url}/api/collections/${existingId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(payload)
      });

      if (updateRes.ok) {
        logger.info(`Updated collection: ${col.name} (${existingId})`);
        applied.push(`updated: ${col.name}`);
      } else {
        const errText = await updateRes.text();
        logger.warn(`Failed to update ${col.name}: ${errText}`);
        errors.push(`update ${col.name}: ${errText}`);
      }
    } else {
      // Create collection
      const createRes = await fetch(`${url}/api/collections`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (createRes.ok) {
        const created = (await createRes.json()) as { id: string };
        collectionMap.set(col.name, created.id);
        logger.info(`Created collection: ${col.name} (${created.id})`);
        applied.push(`created: ${col.name}`);
      } else {
        const errText = await createRes.text();
        logger.error(`Failed to create ${col.name}: ${errText}`);
        errors.push(`create ${col.name}: ${errText}`);
      }
    }
  }

  logger.info(`PocketBase migration finished. Applied: ${applied.length}, Errors: ${errors.length}`);
  return { success: errors.length === 0, applied, errors };
};
