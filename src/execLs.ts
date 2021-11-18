import { Message } from "discord.js";
import { writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { sep } from "path";
import { testProjectId, destProjectId, srcProjectId } from "./index";
import { gitlabIssuesCsv, gitlabMemberListCsv, gitlabMilestonesCsv } from "./gitlab";
import { localMemberListCsv, teamList } from "./postgres";

export function execLs(message: Message<boolean>): (...args: any[]) => Promise<void> {
    return async (type, project, options, command) => {
        const projectId = project == "test" ? testProjectId :
            project == "dest" ? destProjectId :
                project == "source" ? srcProjectId : undefined;

        switch (type) {
            case "member":
                if (projectId == undefined && !options.local) {
                    await message.reply("プロジェクトIDが設定されていません！");
                    return;
                }
                try {
                    const csv = await (options.local || !projectId ? localMemberListCsv() : gitlabMemberListCsv(projectId));
                    await replyCsv(type, options.local ? "local" : project, csv);
                } catch (err) {
                    await message.reply(`:warning: ${err}`);
                }
                break;

            case "team":
                try {
                    const rows = await teamList();
                    let csv = "";
                    rows.forEach(row => {
                        csv += `${row.team_id},${row.team_color}\n`;
                    });
                    await replyCsv(csv, type);
                } catch (err) {
                    await message.reply(`:warning: ${err}`);
                }
                break;

            case "issue":
                if (projectId == undefined) {
                    await message.reply("プロジェクトIDが設定されていません！");
                    return;
                }
                try {
                    if (options.local)
                        throw new Error(`ローカルデータベースの${type}リストは未実装です。`);
                    const csv = await gitlabIssuesCsv(projectId);
                    await replyCsv(csv, type, project);
                } catch (err) {
                    await message.reply(`:warning: ${err}`);
                }
                break;

            case "milestone":
                if (projectId == undefined) {
                    await message.reply("プロジェクトIDが設定されていません！");
                    return;
                }
                try {
                    if (options.local)
                        throw new Error(`ローカルデータベースの${type}リストは未実装です。`);
                    const csv = await gitlabMilestonesCsv(projectId);
                    await replyCsv(csv, type, project);
                } catch (err) {
                    await message.reply(`:warning: ${err}`);
                }

            default:
                break;
        }
    };

    async function replyCsv(csv: string, type?: string, project?: string) {
        const dir = await mkdtemp(`${tmpdir()}${sep}`);
        const file = `${dir}${sep}${type ?? ""}list${project ? `_${project}` : ""}.csv`;
        writeFileSync(file, csv);
        await message.reply({ files: [file] });
        rm(dir, { recursive: true, force: true });
    }
}
