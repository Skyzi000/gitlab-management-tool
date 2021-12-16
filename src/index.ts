import { Gitlab } from "@gitbeaker/node";
import { Client, Intents, Message, TextBasedChannels } from "discord.js";
import { getEnvironments } from "./getEnvironments";
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

client.on("messageCreate", onMessage);

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

console.log(`${process.env.npm_package_name ?? ""}\nVersion ${environments.botVersion}`);

client.login(environments.discordBotToken);
