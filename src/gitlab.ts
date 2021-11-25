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

export async function gitlabMilestonesCsv(projectId: string | number) {
    const milestones = await gitlab.ProjectMilestones.all(projectId);
    let csv = "id,iid,title,state,created_at,expired\n";
    milestones.forEach(m => {
        csv += `${m.id},${m.iid},${m.title},${m.state},${m.created_at},${m.expired}\n`;
    });
    return csv;
}

export async function gitlabMemberListCsv(projectId: string | number) {
    const teamColors = await gitlabMemberTeamColors();
    const members = await gitlab.ProjectMembers.all(projectId, { includeInherited: true });
    let csv: string = "id,name,username,team_color";
    members.forEach(m => {
        const labId = Number(m.id);
        csv += `${m.id},${m.name},${m.username},${labId in teamColors ? teamColors[labId] : "null"}\n`;
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
