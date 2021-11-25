import { IssueSchema } from "@gitbeaker/core/dist/types/types";
import { Mutex } from "async-mutex";
import { Message, MessageReaction, User } from "discord.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import Keyv from "keyv";
import { tmpdir } from "os";
import { sep } from "path";
import { gitlabMemberTeamColors } from "./gitlab";
import { botVersion, destProjectId, gitlab, srcProjectId, testProjectId } from "./index";
import { getKeyvPgConStr } from "./keyv";


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
                const confirm = await message.channel.send(`<@${message.author.id}> この内容で実行して良ければ :o: で、キャンセルするなら :x: でリアクションしてください`);
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
        const srcIssues = (await gitlab.Issues.all({ projectId: sourceProjectId, state: "opened" }));
        /** 生成元のマイルストーンのグローバルidをキー、生成先のマイルストーンのグローバルidとする */
        const milestoneDb = new Keyv<number>(getKeyvPgConStr(), { table: `milestone_${sourceProjectId}`, namespace: destProjectId });
        /** 生成したIssueのiidをキー、生成元のIssueのiidをバリューとする */
        const issueDb = new Keyv<number>(getKeyvPgConStr(), { table: `issue_${sourceProjectId}`, namespace: destProjectId });
        const executionDetailHeader = `mkissue 実行内容${execute ? "" : "プレビュー"} (v${botVersion})\n\n発行元プロジェクトID: ${sourceProjectId}\n発行先プロジェクト: ${project} (id: ${destProjectId})\n`;
        const milestoneMutex = new Mutex();
        const results = await Promise.all(srcIssues.map(async srcIssue => makeIssue(srcIssue)));
        return `${executionDetailHeader}\n------\n${results.join("\n------\n")}`;

        async function makeIssue(sourceIssue: Omit<IssueSchema, "epic">): Promise<string> {
            const srcIssue = sourceIssue as IssueSchema;
            let executionDetailText = `Src: ${srcIssue.title} (#${srcIssue.iid})\n`;
            try {
                // チームごとのラベルは一旦外しておく
                const labels = srcIssue.labels?.filter(name => !name.startsWith("2"));
                if (!labels)
                    return executionDetailText + "ラベルがないのでスキップします\n";
                // マイルストーンIDの取得
                let destMilestoneId: number | undefined;
                await milestoneMutex.runExclusive(async () => {
                    destMilestoneId = await getDestMilestoneId(srcIssue);
                    if (srcIssue.milestone?.id && !destMilestoneId) {
                        executionDetailText += `Milestone: "${srcIssue.milestone.title}" (新規作成)\n`;
                        if (execute) {
                            destMilestoneId = await createMilestone(srcIssue);
                        }
                    } else {
                        executionDetailText += `Milestone: "${srcIssue.milestone.title}" (${destMilestoneId})\n`;
                    }
                });
                if (!labels.find(l => l.match("3_全役職"))) {
                    if (labels.find(l => l.startsWith("3"))) {
                        executionDetailText += `全役職対象でないミッション作成機能は未実装なのでスキップします\n`;
                        return executionDetailText;
                    }
                    // 役職ラベルが何もついてなければ全役職ラベルを付ける
                    labels.push("3_全役職");
                }
                if (labels.find(l => l.match("個人"))) {
                    const teamColors = await gitlabMemberTeamColors();
                    const destMembers = (await gitlab.ProjectMembers.all(destProjectId, { includeInherited: true })).filter(member => member.id in teamColors && teamColors[member.id]);
                    executionDetailText += `Labels: ${labels.join(", ")}\nTargetMembers: ${destMembers.map(m => m.name).join(", ")}\n`;
                    if (execute) {
                        const results = await Promise.all(destMembers.map(async member => {
                            try {
                                const la = labels.concat([`2_${teamColors[member.id]}チーム`]);
                                const created = await gitlab.Issues.create(destProjectId, {
                                    title: srcIssue.title,
                                    description: srcIssue.description,
                                    assignee_ids: [member.id],
                                    confidential: srcIssue.confidential,
                                    due_date: srcIssue.due_date,
                                    labels: la,
                                    milestone_id: destMilestoneId
                                });
                                issueDb.set(created.iid.toString(), srcIssue.iid);
                                return created;
                            } catch (error) {
                                executionDetailText += `[Error] ${member.name}に割り当てるIssueの生成中にエラーが発生したのでスキップします\n詳細: ${error}`;
                            }
                        }));
                        executionDetailText += `生成したIssueの数: ${results.filter(r => r !== undefined).length}`;
                    }
                    if (close) {
                        executionDetailText += `ソースプロジェクトの ${srcIssue.title} (#${srcIssue.iid}) をClose\n`;
                        if (execute) {
                            await gitlab.Issues.edit(srcIssue.project_id, srcIssue.iid, { state_event: "close" });
                        }
                    }
                } else if (srcIssue.labels?.find(l => l.match("グループ"))) {

                    executionDetailText += `グループミッション作成機能は未実装なのでスキップします\n`;
                    return executionDetailText;
                } else {
                    executionDetailText += `[Warn] 個人ラベルもグループラベルも付いていないのでスキップします\n`;
                    return executionDetailText;
                }
            } catch (error) {
                executionDetailText += `[Error] 予期しないエラーが発生したのでスキップします\n詳細: ${error}\n${error instanceof Error ? error.stack : ""}\n`;
                console.error(error);
                return executionDetailText;
            }
            return executionDetailText;
        }

        async function createMilestone(srcIssue: IssueSchema) {
            const createdMilestone = await gitlab.ProjectMilestones.create(destProjectId, srcIssue.milestone.title, {
                description: srcIssue.milestone.description,
                due_date: srcIssue.milestone.due_date,
                start_date: srcIssue.milestone.start_date
            });
            const destMilestoneId = createdMilestone.id;
            await milestoneDb.set(srcIssue.milestone.id.toString(), destMilestoneId);
            return destMilestoneId;
        }

        async function getDestMilestoneId(srcIssue: IssueSchema) {
            if (!srcIssue.milestone)
                return;
            // まずデータベースから取得を試みる
            let milestoneId = await milestoneDb.get(srcIssue.milestone.id.toString());
            if (milestoneId && !isNaN(milestoneId))
                return milestoneId;
            // データベースになければTitleをもとに検索する
            const destMilestones = await gitlab.ProjectMilestones.all(destProjectId);
            milestoneId = destMilestones.find(milestone => milestone.title === srcIssue.milestone.title)?.id;
            if (!milestoneId)
                return;
            // 見つかったらデータベースにidを書き込んでから返す
            await milestoneDb.set(srcIssue.milestone.id.toString(), milestoneId);
            return milestoneId;
        }
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
