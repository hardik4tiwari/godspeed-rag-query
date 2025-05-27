import { GSContext, GSStatus, PlainObject } from "@godspeedsystems/core";
import fs from "fs";
import path from "path";

export default async function (ctx: GSContext, args: PlainObject): Promise<GSStatus> {
  
  const {
        inputs: {
            data: {
                query       // query parameters from rest api
            }
        }, 
     
    }= ctx;
  const repoUrl  = query.repoUrl;

  // if(repoUrl){
  //   return new GSStatus(false, 200, undefined, {error: "Invalid GitHub repo URL", repoUrl});
  // }

  if (!repoUrl || !repoUrl.includes("github.com")) {
    return new GSStatus(false, 400, undefined, {error: repoUrl});
  }

  const vectorDir = path.resolve("vector_store");
  if (!fs.existsSync(vectorDir)) {
    fs.mkdirSync(vectorDir, { recursive: true });
  }
  const activePath = path.resolve("vector_store/active_repo.json");
  fs.writeFileSync(activePath, JSON.stringify({ repoUrl }, null, 2));

  return new GSStatus(true, 200, undefined, { message: "Repo URL set", repoUrl });
}