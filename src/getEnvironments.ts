import { existsSync, readFileSync } from "fs";

export function getEnvironments(): { gitlabToken: string; discordBotToken: string; botVersion: string | undefined; } {

    let gitlabToken: string, discordToken: string, botVersion: string | undefined;

    if (process.env.NODE_ENV === "production") {
        const gitlabTokenFile = process.env.GITLAB_TOKEN_FILE;
        const discordTokenFile = process.env.DISCORD_BOT_TOKEN_FILE;
        if (gitlabTokenFile === undefined || !existsSync(gitlabTokenFile)) {
            if (process.env.GITLAB_TOKEN === undefined)
                throw new Error("GITLAB_TOKENを設定してください。");
            gitlabToken = process.env.GITLAB_TOKEN;
            console.warn("環境変数'GITLAB_TOKEN'ではなく、secretsの利用をお勧めします。\n" +
                "参考: https://docs.docker.com/compose/compose-file/compose-file-v3/#secrets");
        }
        else {
            gitlabToken = readFileSync(gitlabTokenFile, "utf-8").trim();
        }
        if (discordTokenFile === undefined || !existsSync(discordTokenFile)) {
            if (process.env.DISCORD_BOT_TOKEN === undefined)
                throw new Error("GITLAB_TOKENを設定してください。");
            discordToken = process.env.DISCORD_BOT_TOKEN;
            console.warn("環境変数'DISCORD_BOT_TOKEN'ではなく、secretsの利用をお勧めします。\n" +
                "参考: https://docs.docker.com/compose/compose-file/compose-file-v3/#secrets");
        }
        else {
            discordToken = readFileSync(discordTokenFile, "utf-8").trim();
        }
        try {
            botVersion = process.env.npm_package_version
                ?? existsSync("./package.json") ? require("./package.json").version
                : existsSync("../package.json") ? require("../package.json").version
                    : "不明";
        } catch (err) {
            console.error(err);
        }
    }
    else {
        // .envファイルから環境変数の読み込み
        require("dotenv").config();
        if (process.env.GITLAB_TOKEN === undefined)
            throw new Error("GITLAB_TOKENを設定してください。");
        gitlabToken = process.env.GITLAB_TOKEN;
        if (process.env.DISCORD_BOT_TOKEN === undefined)
            throw new Error("GITLAB_TOKENを設定してください。");
        discordToken = process.env.DISCORD_BOT_TOKEN;
        botVersion = process.env.npm_package_version ?? "不明";
    }
    return { gitlabToken, discordBotToken: discordToken, botVersion };
}
