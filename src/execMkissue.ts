import { IssueSchema } from "@gitbeaker/core/dist/types/types";
import { Message, MessageReaction, User } from "discord.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { sep } from "path";
import { gitlabMemberTeamColors } from "./gitlab";
import { testProjectId, destProjectId, srcProjectId, gitlab, botVersion } from "./index";


export function execMkissue(message: Message<boolean>): (...args: any[]) => Promise<void> {
    return async (project, options) => {
        try {
            const projectId = project === "test" ? testProjectId :
                project === "dest" ? destProjectId : undefined;
            if (projectId === undefined) {
                await message.reply("発行先プロジェクトIDが設定されていません！");
                return;
            }
            if (srcProjectId === undefined) {
                await message.reply("発行元プロジェクトIDが設定されていません！");
                return;
            }
            const executionDetailText = await makeIssues(srcProjectId, projectId, options.yes, options.close, project);
            const executionDetails = await replyFile(executionDetailText, "txt", `${project}_${options.yes ? "execlog" : "preview"}`);
            if (!options.yes) {
                const confirm = await message.channel.send(`<@${message.author.id}> この内容で実行して良ければ :o: を、キャンセルするなら :x: をリアクションしてください`);
                const oReact = await confirm.react("⭕");
                const xReact = await confirm.react("❌");
                const filter = (reaction: MessageReaction, user: User) => (reaction.emoji.name === oReact.emoji.name || reaction.emoji.name === xReact.emoji.name) &&
                    user.id === message.author.id;
                try {
                    const reaction = await confirm.awaitReactions({ filter: filter, max: 1, time: 60000, errors: ["time"] });
                    if (reaction.first()?.emoji.name === oReact.emoji.name) {
                        const executionDetailText = await makeIssues(srcProjectId, projectId, true, options.close, project);
                        const executionDetails = await replyFile(executionDetailText, "txt", project);
                    }
                    else if (reaction.first()?.emoji.name === xReact.emoji.name) {
                        await confirm.reply("キャンセルしました。");
                    }
                } catch (error) {
                    await confirm.reply("一定時間リアクションがなかったのでタイムアウトしました。");
                    // } finally {
                    //     await Promise.all([oReact.remove(), xReact.remove()]);
                }
            }
        } catch (err) {
            console.log(err);
            await message.reply(`:warning: ${err}`);
        }
    };
    async function makeIssues(sourceProjectId: string, destProjectId: string, execute: boolean, close: boolean, project?: string) {
        const srcIssues = (await gitlab.Issues.all({ projectId: sourceProjectId, state: "opened" })) as IssueSchema[];
        let executionDetailText = `mkissue 実行内容${execute ? "" : "プレビュー"} (v${botVersion})\n\n発行元プロジェクトID: ${sourceProjectId}\n発行先プロジェクト: ${project} (id: ${destProjectId})\n`;

        srcIssues.forEach(async (srcIssue) => {
            executionDetailText += `\n------\nSrc: ${srcIssue.title} (#${srcIssue.iid})\n`;
            // チームごとのラベルは一旦外しておく
            const labels = srcIssue.labels?.filter(name => !name.startsWith("2"));
            if (labels?.find(l => l.match("個人"))) {
                if (!labels.find(l => l.match("3_全役職"))) {
                    if (labels.find(l => l.startsWith("3"))) {
                        executionDetailText += `全役職対象でないミッション作成機能は未実装なのでスキップします\n`;
                        return;
                    }
                    // 役職ラベルが何もついてなければ全役職ラベルを付ける
                    labels.push("3_全役職");
                }
                const teamColors = await gitlabMemberTeamColors();
                const destMembers = await gitlab.ProjectMembers.all(destProjectId, { includeInherited: true });

                executionDetailText += `Labels: ${labels.join(", ")}\nTargetMembers: ${destMembers.map(m => m.name).join(", ")}\n`;
                destMembers.forEach(async (member) => {
                    const la = labels.concat([`2_${teamColors[member.id]}チーム`]);

                    if (execute) {
                        gitlab.Issues.create(destProjectId, {
                            title: srcIssue.title,
                            description: srcIssue.description,
                            assignee_ids: [member.id],
                            confidential: srcIssue.confidential,
                            due_date: srcIssue.due_date,
                            labels: la
                        });
                    }
                    if (close) {
                        executionDetailText += `ソースプロジェクトの ${srcIssue.title} (#${srcIssue.iid}) をClose\n`;
                        if (execute) {
                            gitlab.Issues.closedBy(srcIssue.project_id, srcIssue.iid);
                        }
                    }
                });
            } else if (srcIssue.labels?.find(l => l.match("グループ"))) {
                executionDetailText += `グループミッション作成機能は未実装なのでスキップします\n`;
                return;
            } else {
                executionDetailText += `[Warn] 個人ラベルもグループラベルも付いていないのでスキップします\n`;
                return;
            }
        });
        return executionDetailText;
    }

    async function replyFile(data: string, extension: string, project?: string) {
        const dir = await mkdtemp(`${tmpdir()}${sep}`);
        try {
            const file = `${dir}${sep}mkissue${project ? `_${project}` : ""}.${extension}`;
            await writeFile(file, data);
            return await message.reply({ files: [file] });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
}
