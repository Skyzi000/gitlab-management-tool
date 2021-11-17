import { Pool, PoolConfig, QueryConfig } from "pg";

export class Postgres {

    private pool: Pool;

    constructor(config?: PoolConfig) {
        this.pool = new Pool(config);
        // the pool will emit an error on behalf of any idle clients
        // it contains if a backend error or network partition happens
        this.pool.on('error', (err) => {
            console.error('Unexpected error on idle client', err);
            process.exit(-1);
        });
    }

    public async connect() {
        return await this.pool.connect();
    }

    public async query(query: string | QueryConfig<any[]>, parameters: any[] = []) {
        const client = await this.connect();
        try {
            return await client.query(query, parameters);
        }
        finally {
            // Make sure to release the client before any error handling,
            // just in case the error handling itself throws an error.
            client.release();
        }
    }

    public async end() {
        await this.pool.end();
    }
}
