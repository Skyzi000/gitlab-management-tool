import { Argument, Command } from "commander";
import { Message } from "discord.js";
import { execLs } from "./execLs";
import { execMkissue } from "./execMkissue";
import { botVersion } from "./index";

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
        .addArgument(new Argument("[project]", "対象のプロジェクト、またはローカルのデータベース").choices(["test", "dest", "source", "local"]).default("local"))
        .action(execLs(message));

    bot
        .command("mkissue")
        .aliases(["mkissues", "makeissue", "pubissue", "pubissues", "publishissue", "publishissues"])
        .description(`        ソースプロジェクトのOpen状態のIssueをもとにIssueを新規発行します。
        プロジェクトマイルストーンはコピーされます。
        所属チームを表す\`2\`以外のラベル(\`0\`, \`1\`, \`3\`)はそのままコピーされ、\`1\`のラベルによって個人に対して発行するかどうか判断します。
        個人に対して発行されたIssueには自動的に該当する人がAssignされ、その人の所属するチームの\`2\`ラベルが付与されます。
        また、個人に対して発行するIssueは\`3\`の役職ラベルに従い、該当する役職の人にのみ発行されます。
        チームに対して発行するIssueは、各チームに対して一つずつ発行されます。
        影響の大きいコマンドなので、デフォルトではまず操作内容を書き出し、実行するか否かを尋ねます。
        \`- y\` または \`--yes\` オプション付きでコマンドを実行すると、即実行します。\n`)
        .addArgument(new Argument("[project]", "対象のプロジェクト").choices(["test", "dest"]).default("dest"))
        .option("--no-close", "ソースプロジェクトのIssueをCloseしないようにします")
        .option("-y, --yes", "確認せずに即実行します")
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
