import { MilestoneSchema, UserSchema } from "@gitbeaker/core/dist/types/types";
import { gitlab } from "./index";
import { Postgres } from "./postgres";


export async function gitlabIssuesCsv(projectId: string | number) {
    const issues = await gitlab.Issues.all({ projectId, state: "opened" });
    let csv = "id,iid,title,state,created_at,labels,milestone_id,milestone_title,assignee_id\n";
    issues.forEach(i => {
        csv += `${i.id},${i.iid},${i.title},${i.state},${i.created_at},${i.labels},${(i.milestone as MilestoneSchema)?.id},${(i.milestone as MilestoneSchema)?.title},${(i.assignee as UserSchema)?.id}\n`;
    });
    return csv;
}
export async function gitlabMemberListCsv(projectId: string | number) {
    let csv: string = "";
    const teamColors = await gitlabMemberTeamColors();
    await gitlab.ProjectMembers.all(projectId, { includeInherited: true }).then((members) => {
        members.forEach(m => {
            const labId = Number(m.id);
            csv += `${m.id},${m.name},${m.username},${labId in teamColors ? teamColors[labId] : "null"}\n`;
        });
    });
    return csv;
}

async function gitlabMemberTeamColors() {
    const pg = new Postgres();
    const sql = `select gitlab_id, t.team_color from gitlab_member gm
left outer join team t
on gm.team_id = t.team_id
where gitlab_id is not null ;`;
    const r = await pg.query(sql);
    const teamColors: { [gitlabUserId: number]: string } = {};
    r.rows.forEach(row => {
        teamColors[Number(row.gitlab_id)] = row.team_color;
    })
    return teamColors;
}
