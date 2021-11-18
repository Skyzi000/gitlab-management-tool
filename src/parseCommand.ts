import { Argument, Command } from "commander";
import { Message } from "discord.js";
import { execLs } from "./execLs";
import { botVersion, execMkissue } from "./index";

export async function parseCommand(message: Message<boolean>): Promise<void> {
    // 入力中...で反応していることを返す
    message.channel.sendTyping();

    // コマンドの設定
    const bot = new Command();
    bot.name(`<@${message.client.user?.id}>`);
    // bot.allowUnknownOption(true).allowExcessArguments(true);
    bot.exitOverride();
    bot.configureOutput({
        writeOut: (str) => message.reply(str),
        writeErr: (str) => message.reply(`:warning: ${str}`)
    });
    bot
        .command("version")
        .aliases(["v", "V", "ver", "about"])
        .description("バージョン情報を返します。\n")
        .action(() => {
            message.reply(`${message.client.user?.username}について\n\`\`\`\nVersion ${botVersion}\n\`\`\``);
        });

    bot
        .command("ls")
        .aliases(["list", "csv", "csvlist"])
        .description("各種データをCSV形式のファイルにまとめて返します。\n")
        .addArgument(new Argument("<type>", "種類").choices(["member", "team", "issue", "milestone"]))
        .addArgument(new Argument("[project]", "対象のプロジェクト").choices(["test", "dest", "source"]).default("test"))
        .option("-l, --local", "GitLabに問い合わせたりせず、ローカルのデータベース上の情報のみを返します。")
        .action(execLs(message));

    bot
        .command("mkissue")
        .aliases(["mkissues", "makeissue", "pubissue", "pubissues", "publishissue", "publishissues"])
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
