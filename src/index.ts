import { Gitlab } from "@gitbeaker/node";
import { Client, Intents, TextBasedChannels } from "discord.js";
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
client.on("message", async message => {
    if (message.author.bot || message.guildId == null || client.user == null || !(message.channel.type === "GUILD_TEXT" || message.channel.type === "GUILD_NEWS") || message.channelId !== process.env.DISCORD_CHANNEL_ID) {
        return;
    }
    if (message.mentions.users.has(client.user.id)) {
        const cmds = message.content.split(" ").slice(1).filter((value) => value.trim() !== "");
        console.log(`Commands: ${cmds.join(", ")}`);
        switch (cmds[0]?.trim()) {
            case "v":
            case "version":
            case "about":
                message.reply(`${process.env.npm_package_name}\nVersion \`${process.env.npm_package_version}\``);
                break;
            case "teamlist":
                if (destProjectId == undefined)
                    return;
                message.channel.sendTyping();
                try {
                    const tlist = await terrariaTeams();
                    const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    const file = dir + sep + "teamlist.csv";
                    let s = "";
                    tlist.forEach(row => {
                        s += `${row.gitlab_id},${row.team_id},${row.team_color}\n`;
                    });
                    writeFileSync(file, s);
                    await message.reply({ files: [file] });
                    rm(dir, { recursive: true, force: true });
                } catch (err) {
                    console.error(err);
                }
                break;
            case "mlist":
                if (destProjectId == undefined)
                    return;
                message.channel.sendTyping();
                try {
                    const mlist = await mlistCsv(destProjectId);
                    const dir = await mkdtemp(`${tmpdir()}${sep}`);
                    const file = dir + sep + "mlist.csv";
                    writeFileSync(file, mlist);
                    await message.reply({ files: [file] });
                    rm(dir, { recursive: true, force: true });
                } catch (err) {
                    console.error(err);
                }
                break;
            default:
                await message.reply(`コマンド \`${cmds.join(" ")}\` を解釈できません。`);
                break;
        }
    }
});

console.log(`${process.env.npm_package_name}\nVersion ${process.env.npm_package_version}`);
client.login(discordBotToken);

async function mlistCsv(projectId: string | number) {
    let mlist: string = "";
    await gitlab.ProjectMembers.all(projectId, { includeInherited: true }).then((members) => {
        members.forEach(m => {
            mlist += `${m.id},${m.name},${m.username}\n`;
        });
    });
    return mlist;
}

async function terrariaTeams() {
    const pg = new Postgres();
    const sql = `select gitlab_id, gm.team_id, t.team_color from gitlab_member gm
inner join team t
on gm.team_id = t.team_id
where gitlab_id is not null ;`;
    const r = await pg.query(sql);
    return r.rows;
}
