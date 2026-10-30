import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../utils/logger';
import { tryCatchAsync } from '../../utils/fp';
import { DEFAULT_ARCADE_GAME_CONFIGS, DEFAULT_SYSTEM_CONTROLS } from '../../constants/defaultConfigs';

interface PocketBaseAuthResponse {
  readonly token: string;
  readonly record?: {
    readonly id: string;
    readonly email: string;
  };
}

interface CollectionListResponse {
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
  }>;
}

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

export const runPocketBaseMigration = async (baseUrl: string,
                                             email: string,
                                             password: string,
                                             includeMultiGame: boolean = true): Promise<{ success: boolean; applied: string[]; errors: string[] }> => {
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

  // 3. Load canonical schema.json and multiGameSchema.json
  const schemaPath = join(__dirname, 'schema.json');
  const schemaRaw = await readFile(schemaPath, 'utf-8');
  const baseSchemaList = JSON.parse(schemaRaw) as Array<Record<string, any>>;

  let multiGameList: Array<Record<string, any>> = [];
  if (includeMultiGame) {
    const multiSchemaPath = join(__dirname, 'multiGameSchema.json');
    const multiSchemaRaw = await readFile(multiSchemaPath, 'utf-8');
    const parsedMulti = JSON.parse(multiSchemaRaw) as { collections?: Array<Record<string, any>> };
    multiGameList = parsedMulti.collections || [];
  }

  const schemaList = [...baseSchemaList, ...multiGameList];

  const applied: string[] = [];
  const errors: string[] = [];

  for (const col of schemaList) {
    const existingId = collectionMap.get(col.name);

    // Resolve relation collection IDs
    const resolvedFields = (col.fields || []).map((f: Record<string, any>) => {
      const refName = f.collectionId || f.collectionName;
      if (f.type === 'relation' && typeof refName === 'string') {
        const targetId = collectionMap.get(refName);
        return {
          ...f,
          collectionId: targetId || refName
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

  // 4. Upsert DB-driven configuration: insert every default game and system control whose key is missing,
  //    never overwriting values an operator has already tuned in PocketBase
  const seedMissing = async (collection: string,
                             keyField: string,
                             defaults: ReadonlyArray<Record<string, unknown>>): Promise<void> => {
    const existingRes = await fetch(`${url}/api/collections/${collection}/records?perPage=500&fields=${keyField}`, { headers });
    if (!existingRes.ok) return;
    const existing = (await existingRes.json()) as { items?: ReadonlyArray<Record<string, unknown>> };
    const existingKeys = new Set((existing.items ?? []).map(item => String(item[keyField])));
    for (const record of defaults.filter(d => !existingKeys.has(String(d[keyField])))) {
      const createRes = await fetch(`${url}/api/collections/${collection}/records`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...record, int_version: 1, txt_updated_by: 'pocketbase_migrator' })
      });
      if (createRes.ok) {
        applied.push(`seeded: ${String(record[keyField])}`);
      }
    }
  };

  const seedRes = await tryCatchAsync(async () => {
    await seedMissing('tbl_cfg_arcade_games', 'txt_game_key', DEFAULT_ARCADE_GAME_CONFIGS as unknown as ReadonlyArray<Record<string, unknown>>);
    await seedMissing('tbl_cfg_system_controls', 'txt_config_key', DEFAULT_SYSTEM_CONTROLS as unknown as ReadonlyArray<Record<string, unknown>>);
  }, toError);
  seedRes.match({
    Ok: () => undefined,
    Err: err => {
      logger.warn(`Configuration seeding encountered error: ${err.message}`);
    }
  });

  logger.info(`PocketBase migration finished. Applied: ${applied.length}, Errors: ${errors.length}`);
  return { success: errors.length === 0, applied, errors };
};
