import { Client, ClientConfig, Pool, PoolConfig } from "pg";

/** Credentials come from env.PGURL, defaults to localhost & no auth. */
const dbConfig: ClientConfig = {
  connectionString: process.env.PGURL,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
  statement_timeout: 5000,
  database: process.env.PGURL == null ? "daimo" : undefined,
};

const poolConfig: PoolConfig = {
  ...dbConfig,
  max: 8,
  idleTimeoutMillis: 60000,
};

export class DB {
  private pool: Pool;

  constructor() {
    this.pool = new Pool(poolConfig);
  }

  getStatus() {
    const { idleCount, totalCount, waitingCount } = this.pool;
    return {
      idleCount,
      totalCount,
      waitingCount,
    };
  }

  async createTables() {
    console.log(`[DB] connecting`);
    const client = new Client(dbConfig);
    await client.connect();

    console.log("[DB] connected, creating tables if necessary");
    await client.query(`
          CREATE TABLE IF NOT EXISTS pushtoken (
            pushtoken VARCHAR(64) PRIMARY KEY,
            address CHAR(42) NOT NULL
          );
          CREATE INDEX IF NOT EXISTS pushtoken_address ON pushtoken (address);
          
          CREATE TABLE IF NOT EXISTS invitecode (
            code VARCHAR(64) PRIMARY KEY,
            use_count INT NOT NULL,
            max_uses INT NOT NULL DEFAULT 1
          );
          ALTER TABLE invitecode ADD COLUMN IF NOT EXISTS zupass_email VARCHAR DEFAULT NULL;

          CREATE TABLE IF NOT EXISTS name_blacklist (
            name VARCHAR(32) PRIMARY KEY
          );
      `);
    await client.end();
  }

  async loadPushTokens(): Promise<PushTokenRow[]> {
    console.log(`[DB] loading push tokens`);
    const client = await this.pool.connect();
    const result = await client.query<PushTokenRow>(
      `SELECT address, pushtoken FROM pushtoken`
    );
    client.release();

    console.log(`[DB] ${result.rows.length} push tokens`);
    return result.rows;
  }

  async savePushToken(token: PushTokenRow) {
    console.log(`[DB] inserting auth token`);
    const client = await this.pool.connect();
    await client.query(
      `INSERT INTO pushtoken (pushtoken, address) VALUES ($1, $2)
       ON CONFLICT (pushtoken) DO UPDATE SET address = $2`,
      [token.pushtoken, token.address]
    );
    client.release();
  }

  async loadNameBlacklist(): Promise<Set<string>> {
    console.log(`[DB] loading name blacklist`);
    const client = await this.pool.connect();
    const result = await client.query<{ name: string }>(
      `SELECT name FROM name_blacklist`
    );
    client.release();

    console.log(`[DB] ${result.rows.length} blacklisted names`);
    return new Set(result.rows.map((row) => row.name));
  }

  async loadInviteCodes(): Promise<InviteCodeRow[]> {
    console.log(`[DB] loading invite codes`);
    const client = await this.pool.connect();
    const result = await client.query<RawInviteCodeRow>(
      `SELECT code, use_count, max_uses, zupass_email FROM invitecode`
    );
    client.release();

    return result.rows.map((row) => ({
      code: row.code,
      useCount: row.use_count,
      maxUses: row.max_uses,
      zupassEmail: row.zupass_email,
    }));
  }

  async saveInviteCode(code: InviteCodeRow) {
    console.log(`[DB] inserting invite code`);
    const client = await this.pool.connect();
    await client.query(
      `INSERT INTO invitecode (code, use_count, max_uses, zupass_email) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET use_count = $2, max_uses = $3, zupass_email = $4`,
      [code.code, code.useCount, code.maxUses, code.zupassEmail]
    );
    client.release();
  }

  async incrementInviteCodeUseCount(code: string) {
    console.log(`[DB] incrementing invite code use count`);
    const client = await this.pool.connect();
    await client.query(
      `UPDATE invitecode SET use_count = use_count + 1 WHERE code = $1`,
      [code]
    );
    client.release();
  }
}

interface PushTokenRow {
  pushtoken: string;
  address: string;
}

interface InviteCodeRow {
  code: string;
  useCount: number;
  maxUses: number;
  zupassEmail: string | null;
}

interface RawInviteCodeRow {
  code: string;
  use_count: number;
  max_uses: number;
  zupass_email: string | null;
}
