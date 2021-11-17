import { IssueSchema, MilestoneSchema, UserSchema } from "@gitbeaker/core/dist/types/types";
import { Gitlab } from "@gitbeaker/node";
import { Argument, Command } from "commander";
import { Client, Intents, Message, TextBasedChannels } from "discord.js";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { sep } from "path";
import { Postgres } from "./postgres";

let gitlabToken: string;
let discordBotToken: string;

if (process.env.NODE_ENV === "production") {
    const gitlabTokenFile = process.env.GITLAB_TOKEN_FILE;
    const discordTokenFile = process.env.DISCORD_BOT_TOKEN_FILE;
    if (gitlabTokenFile === undefined || !existsSync(gitlabTokenFile)) {
        if (process.env.GITLAB_TOKEN === undefined) {
            console.error("'GITLAB_TOKEN'を設定してください。")
            process.exit(1);
        }
        else {
            gitlabToken = process.env.GITLAB_TOKEN;
            console.warn(
                "環境変数'GITLAB_TOKEN'ではなく、secretsの利用をお勧めします。\n" +
                "参考: https://docs.docker.com/compose/compose-file/compose-file-v3/#secrets")
        }
    }
    else {
        gitlabToken = readFileSync(gitlabTokenFile, "utf-8").trim();
    }
    if (discordTokenFile === undefined || !existsSync(discordTokenFile)) {
        if (process.env.DISCORD_BOT_TOKEN === undefined) {
            console.error("'DISCORD_BOT_TOKEN'を設定してください。")
            process.exit(1);
        }
        else {
            discordBotToken = process.env.DISCORD_BOT_TOKEN;
            console.warn(
                "環境変数'DISCORD_BOT_TOKEN'ではなく、secretsの利用をお勧めします。\n" +
                "参考: https://docs.docker.com/compose/compose-file/compose-file-v3/#secrets")
        }
    }
    else {
        discordBotToken = readFileSync(discordTokenFile, "utf-8").trim();
    }
}
else {
    // .envファイルから環境変数の読み込み
    require("dotenv").config();
    if (process.env.GITLAB_TOKEN === undefined) {
        console.error("'GITLAB_TOKEN'を設定してください。")
        process.exit(1);
    }
    if (process.env.DISCORD_BOT_TOKEN === undefined) {
        console.error("'DISCORD_BOT_TOKEN'を設定してください。")
        process.exit(1);
    }
    gitlabToken = process.env.GITLAB_TOKEN;
    discordBotToken = process.env.DISCORD_BOT_TOKEN;
}

const gitlab = new Gitlab({ token: gitlabToken });

const destProjectId = process.env.GITLAB_DEST_PROJECT_ID;
const srcProjectId = process.env.GITLAB_SOURCE_PROJECT_ID;
const testProjectId = process.env.GITLAB_TEST_PROJECT_ID;

const client: Client = new Client({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.DIRECT_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_TYPING
    ]
});

client.once("ready", async () => {
    if (client.user == null) {
        console.log("client.user is null!");
        return;
    }
    client.user.setActivity({ name: `Version ${process.env.npm_package_version}` });
    console.log(`${client.user.username} is ready!`);
});

async function onMessage(message: Message): Promise<void> {
    if (message.author.bot || message.guildId == null || client.user == null || !(message.channel.type === "GUILD_TEXT" || message.channel.type === "GUILD_NEWS") || message.channelId !== process.env.DISCORD_CHANNEL_ID) {
        return;
    }
    if (message.mentions.users.has(client.user.id)) {
        await parseCommand(message);
    }
}
client.on("message", onMessage);

process.on("beforeExit", () => {
    if (client.isReady())
        client.destroy();
})

async function mlistCsv(projectId: string | number) {
    let mlist: string = "";
    const teamColors = await gitlabMemberTeamColors();
    await gitlab.ProjectMembers.all(projectId, { includeInherited: true }).then((members) => {
        members.forEach(m => {
            const labId = Number(m.id);
            mlist += `${m.id},${m.name},${m.username},${labId in teamColors ? teamColors[labId] : "null"}\n`;
        });
    });
    return mlist;
}

async function teamList() {
    const pg = new Postgres();
    const sql = `select * from team;`;
    const r = await pg.query(sql);
    return r.rows;
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

async function gitlabIssuesCsv(projectId: string | number) {
    const issues = await gitlab.Issues.all({ projectId, state: "opened" });
    let csv = "id,iid,title,state,created_at,labels,milestone_id,milestone_title,assignee_id\n";
    issues.forEach(i => {
        csv += `${i.id},${i.iid},${i.title},${i.state},${i.created_at},${i.labels},${(i.milestone as MilestoneSchema)?.id},${(i.milestone as MilestoneSchema)?.title},${(i.assignee as UserSchema)?.id}\n`;
    });
    return csv;
}

async function parseCommand(message: Message<boolean>): Promise<void> {
    // 入力中...で反応していることを返す
    message.channel.sendTyping();

    // コマンドの設定

    const bot = new Command();
    bot.name(`<@${message.client.user?.id}>`)
    // bot.allowUnknownOption(true).allowExcessArguments(true);
    bot.exitOverride();
    bot.configureOutput({
        writeOut: (str) => message.reply(str),
        writeErr: (str) => message.reply(`:warning: ${str}`)
    });
    bot
        .command("about")
        .description("Botの情報を返します。\n")
        .action(() => {
            const pj = require("../package.json");
            message.reply(`${message.client.user?.username}について\nパッケージ情報\n\`\`\`
${process.env.npm_package_name}\n${pj.description}\nVersion ${process.env.npm_package_version}
Dependencies:\n${pj.dependencies}\n\`\`\``);
        });

    bot
        .command("ls")
        .description("各種データをCSV形式のファイルにまとめて返します。\n")
        .addArgument(new Argument("<type>", "種類").choices(["member", "team", "issue", "milestone"]))
        .addArgument(new Argument("[project]", "対象のプロジェクト").choices(["test", "dest", "source"]).default("test"))
        .action(execLs(message));

    bot
        .command("mkissue")
        .description(`        ソースプロジェクトのIssueをもとにIssueを新規発行します。
        プロジェクトマイルストーンはコピーされます。
        所属チームを表す\`2\`以外のタグ(\`0\`, \`1\`, \`3\`)はそのままコピーされ、\`1\`のタグによって個人に対して発行するかどうか判断します。
        個人に対して発行されたIssueには自動的に該当する人がAssignされ、その人の所属するチームの\`2\`タグが付与されます。
        また、個人に対して発行するIssueは\`3\`の役職タグに従い、該当する役職の人にのみ発行されます。
        チームに対して発行するIssueは、各チームに対して一つずつ発行されます。\n`)
        .addArgument(new Argument("[project]", "対象のプロジェクト").choices(["test", "dest"]).default("test"))
        .option("-c, --close", "ソースプロジェクトのIssueをCloseするか", true)
        .action(execMkissue(message));


    // コマンドのパース処理・実行
    const cmds = message.content.split(" ").slice(1).filter((value) => value.trim() !== "");
    try {
        await bot.parseAsync(cmds, { from: "user" });
    } catch (err) {
        console.error(err);
    }

    // コマンド内容をコンソールに出力
    console.log(`Commands: ${cmds.join(", ")}`);
}

function execLs(message: Message<boolean>): (...args: any[]) => Promise<void> {
    return async (type, project, options, command) => {
        const projectId = project == "test" ? testProjectId :
            project == "dest" ? destProjectId :
                project == "source" ? srcProjectId : undefined;

        switch (type) {
            case "member":
                if (projectId == undefined) {
                    await message.reply("プロジェクトIDが設定されていません！");
                    return;
                }
                try {
                    const csv = await mlistCsv(projectId);
                    const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    const file = `${dir}${sep}${type}list_${project}.csv`;
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

function execMkissue(message: Message<boolean>): (...args: any[]) => Promise<void> {
    return async (project, close) => {
        try {
            throw new Error("未実装です");
        } catch (err) {
            await message.reply(`:warning: ${err}`);
        }
    };
}

console.log(`${process.env.npm_package_name}\nVersion ${process.env.npm_package_version}`);
console.log(require("../package.json").description);

client.login(discordBotToken);
