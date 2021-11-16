import { Gitlab } from "@gitbeaker/node";
import { existsSync, readFileSync } from "fs";


let gitlabToken: string;

if (process.env.NODE_ENV === "production") {
    const tokenFile = process.env.GITLAB_TOKEN_FILE;
    if (tokenFile === undefined || !existsSync(tokenFile)) {
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
        gitlabToken = readFileSync(tokenFile, "utf-8").trim();
    }
}
else {
    // .envファイルから環境変数の読み込み
    require("dotenv").config();
    if (process.env.GITLAB_TOKEN === undefined) {
        console.error("'GITLAB_TOKEN'を設定してください。")
        process.exit(1);
    }
    gitlabToken = process.env.GITLAB_TOKEN;
}


const gitlab = new Gitlab({ token: gitlabToken });

const projectId = process.env.GITLAB_PROJECT_ID;
if (projectId == undefined)
    process.exit();
gitlab.ProjectMembers.all(projectId, { includeInherited: true }).then((members) => {
    members.forEach(m => {
        console.log(`${m.id},${m.name},${m.username}`)
    })
});
