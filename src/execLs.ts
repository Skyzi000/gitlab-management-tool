import { Message } from "discord.js";
import { writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { sep } from "path";
import { testProjectId, destProjectId, srcProjectId, localMemberListCsv, gitlabMemberListCsv, teamList, gitlabIssuesCsv } from "./index";

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
                    const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    const file = `${dir}${sep}${type}list_${options.local ? "local" : project}.csv`;
                    writeFileSync(file, csv);
                    await message.reply({ files: [file] });
                    rm(dir, { recursive: true, force: true });
                } catch (err) {
                    await message.reply(`:warning: ${err}`);
                }
                break;

            case "team":
                try {
                    const rows = await teamList();
                    const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    const file = `${dir}${sep}${type}list.csv`;
                    let s = "";
                    rows.forEach(row => {
                        s += `${row.team_id},${row.team_color}\n`;
                    });
                    writeFileSync(file, s);
                    await message.reply({ files: [file] });
                    rm(dir, { recursive: true, force: true });
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
                    const csv = await gitlabIssuesCsv(projectId);
                    const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    const file = `${dir}${sep}${type}list_${project}.csv`;
                    writeFileSync(file, csv);
                    await message.reply({ files: [file] });
                    rm(dir, { recursive: true, force: true });
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
                    throw new Error("未実装です");
                    // const csv = await gitlabIssuesCsv(projectId);
                    // const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    // const file = `${dir}${sep}${type}list_${project}.csv`;
                    // writeFileSync(file, csv);
                    // await message.reply({ files: [file] });
                    // rm(dir, { recursive: true, force: true });
                } catch (err) {
                    await message.reply(`:warning: ${err}`);
                }

            default:
                break;
        }
    };
}
