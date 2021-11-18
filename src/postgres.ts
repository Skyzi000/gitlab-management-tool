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

export async function localMemberListCsv() {
    const pg = new Postgres();
    const sql = `select gm.student_id, gm.name, gm.gitlab_id, gm.gitlab_email, t.team_id, t.team_color
from gitlab_member gm
left outer join team t
on gm.team_id = t.team_id ;`;
    const qResult = await pg.query(sql);
    let csv = `${qResult.fields.map(f => f.name).join(",")}\n`;
    const members = qResult.rows;
    members.forEach(gm => {
        csv += `${gm.student_id},${gm.name},${gm.gitlab_id},${gm.gitlab_email},${gm.team_id},${gm.team_color}\n`;
    });
    return csv;
}

export async function teamList() {
    const pg = new Postgres();
    const sql = `select * from team;`;
    const r = await pg.query(sql);
    return r.rows;
}
