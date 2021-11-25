import { IssueSchema, MilestoneSchema, UserSchema } from "@gitbeaker/core/dist/types/types";
import { Gitlab } from "@gitbeaker/node";
import { Client, Intents, Message, MessageReaction, TextBasedChannels, User } from "discord.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { sep } from "path";
import { getEnvironments } from "./getEnvironments";
import { gitlabMemberTeamColors } from "./gitlab";
import { parseCommand } from "./parseCommand";


const environments = getEnvironments();

export const botVersion = environments.botVersion;

export const gitlab = new Gitlab({ token: environments.gitlabToken });
export const destProjectId = process.env.GITLAB_DEST_PROJECT_ID;
export const srcProjectId = process.env.GITLAB_SOURCE_PROJECT_ID;
export const testProjectId = process.env.GITLAB_TEST_PROJECT_ID;

const client: Client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_TYPING,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS
    ]
});

client.once("ready", async () => {
    if (client.user == null) {
        console.log("client.user is null!");
        return;
    }
    client.user.setActivity({ name: `Version ${environments.botVersion}` });
    console.log(`${client.user.username} is ready!`);
});

client.on("message", onMessage);

async function onMessage(message: Message): Promise<void> {
    if (message.author.bot ||
        message.guildId == null ||
        client.user == null ||
        !(message.channel.type === "GUILD_TEXT" || message.channel.type === "GUILD_NEWS") ||
        message.channelId !== process.env.DISCORD_CHANNEL_ID) {
        return;
    }
    if (message.mentions.users.has(client.user.id)) {
        await parseCommand(message);
    }
}

process.on("beforeExit", () => {
    if (client.isReady())
        client.destroy();
});

export function execMkissue(message: Message<boolean>): (...args: any[]) => Promise<void> {
    return async (project, options) => {
        try {
            const projectId = project === "test" ? testProjectId :
                project === "dest" ? destProjectId : undefined;
            if (projectId === undefined) {
                await message.reply("宛先となるプロジェクトIDが設定されていません！");
                return;
            }
            if (srcProjectId === undefined) {
                await message.reply("ソースプロジェクトIDが設定されていません！");
                return;
            }
            const executionDetailText = await makeIssues(projectId, options.yes, options.close);
            const executionDetails = await replyFile(executionDetailText, "txt", `${project}_${options.yes ? "execlog" : "preview"}`);
            if (!options.yes) {
                const confirm = await message.channel.send(`<@${message.author.id}> この内容で実行して良ければ :o: を、キャンセルするなら :x: をリアクションしてください`);
                const oReact = await confirm.react("⭕");
                const xReact = await confirm.react("❌");
                const filter = (reaction: MessageReaction, user: User) =>
                    (reaction.emoji.name === oReact.emoji.name || reaction.emoji.name === xReact.emoji.name) &&
                    user.id === message.author.id;
                try {
                    const reaction = await confirm.awaitReactions({ filter: filter, max: 1, time: 60000, errors: ["time"] });
                    if (reaction.first()?.emoji.name === oReact.emoji.name) {
                        const executionDetailText = await makeIssues(projectId, true, options.close);
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
    async function makeIssues(projectId: string, execute: boolean, close: boolean) {
        const srcIssues = (await gitlab.Issues.all({ srcProjectId, state: "opened" })) as IssueSchema[];
        let executionDetailText = "";

        srcIssues.forEach(async issue => {
            executionDetailText += `\n------\nSrc: ${issue.title} (#${issue.iid})\n`;
            if (issue.labels?.find(l => l.match("個人"))) {
                if (!issue.labels?.find(l => l.match("全役職"))) {
                    executionDetailText += `全役職対象でないミッション作成機能は未実装なのでスキップします\n`;
                    return;
                }
                const teamColors = await gitlabMemberTeamColors();
                const members = await gitlab.ProjectMembers.all(projectId, { includeInherited: true });
                const labels = issue.labels?.filter(name => !name.startsWith("2"));
                executionDetailText += `Labels: ${labels.join(", ")}\nTargetMembers: ${members.map(m=>m.name).join(", ")}\n`;
                members.forEach(async member => {
                    const la = labels.concat([`2_${teamColors[member.id]}チーム`]);

                    if (execute) {
                        gitlab.Issues.create(projectId, {
                            title: issue.title,
                            description: issue.description,
                            assignee_ids: [member.id],
                            confidential: issue.confidential,
                            due_date: issue.due_date,
                            labels: la
                        });
                    }
                });
            } else if (issue.labels?.find(l => l.match("グループ"))) {
                executionDetailText += `グループミッション作成機能は未実装なのでスキップします\n`;
                return;
            }

            if (close) {
                executionDetailText += `ソースプロジェクトの ${issue.title} をClose\n`;
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

console.log(`${process.env.npm_package_name ?? ""}\nVersion ${environments.botVersion}`);

client.login(environments.discordBotToken);

// try {
//     if (testProjectId)
//         gitlab.Issues.create(testProjectId, { title: "test3", assignee_ids: [10042847], description: "プログラムからIssueを作ってAssignしてみるテスト２" }).then(i => {
//             console.log(i);
//         });
// } catch (err) {
//     console.error(err);
// }

// try {
//     if (testProjectId && destProjectId) {
//         gitlab.Labels.all(destProjectId).then(labels => {
//             labels.forEach(label => {
//                 gitlab.Labels.create(testProjectId, label.name, label.color, {description: label.description, priority: label.priority})
//             })
//         });
//     }
// } catch (error) {
//     console.error(error);
// }
