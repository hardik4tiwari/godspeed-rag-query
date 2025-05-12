import { GSContext, GSStatus, PlainObject } from "@godspeedsystems/core";
import { Document } from "langchain/document";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

import simpleGit from "simple-git";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { error } from "console";
import os from "os";

// const STATE_FILE = "vector_store/state.json";

export default async function (ctx: GSContext, args: PlainObject): Promise<GSStatus> {
  const { repoUrl } = args;

  if (!repoUrl || !repoUrl.includes("github.com")) {
    return new GSStatus(false, 400,undefined,{error: "Invalid GitHub repo URL"});
  }

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
  if (!match) return new GSStatus(false, 400,undefined,{error: "URL must be in format github.com/owner/repo/tree/branch"});

  const [_, owner, repo, branch] = match;
  const gitUrl = `https://github.com/${owner}/${repo}.git`;
  // const tmpDir = `/tmp/${owner}_${repo}_${Date.now()}`;

  // this path ensures that tempDir path is valid for both linux and windows
  const tmpDir = path.join(os.tmpdir(), `${owner}_${repo}_${Date.now()}`);

  const vectorStorePath = path.join("vector_store", repo);
  const git = simpleGit();
  try {
    if(tmpDir){
      return new GSStatus(false, 400,undefined,{error: "Temporary directory already exists"});
    }
    //cloning the entire repo
    await git.clone(gitUrl, tmpDir, ['--depth=1', '--branch', branch]);

    const latestCommit = (await git.cwd(tmpDir).revparse(['HEAD'])).trim();
    const prevState = loadState(repo) || { last_commit: null, file_hashes: {} };
    //checking for a commit in repo, if no latest commit then no changes in doc
    if (prevState.last_commit === latestCommit) {
      return new GSStatus(true, 200, undefined, { message: "Repo already up to date (no changes)." });
    }

    const supportedExts = [".md", ".ts", ".js", ".json", ".yaml", ".yml"];
    const docsToEmbed: Document[] = [];
    const newFileHashes: Record<string, string> = {};

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (supportedExts.includes(path.extname(entry))) {
          const content = fs.readFileSync(fullPath, "utf8");
          const relPath = path.relative(tmpDir, fullPath);
          const hash = crypto.createHash("md5").update(content).digest("hex");
          newFileHashes[relPath] = hash;
          //chcking if the file has changed using the hash value
          if (prevState.file_hashes[relPath] !== hash) {
            docsToEmbed.push(new Document({
              pageContent: content,
              metadata: { path: relPath, repo, branch }
            }));
          }
        }
      }
    };

    walk(tmpDir);

    const changedDocs = Object.values(docsToEmbed);
    if (changedDocs.length === 0) {
      return new GSStatus(true, 200, undefined, { message: "No files changed. Vector DB is up to date." });
    }

    const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: process.env.GEMINI_API_KEY! });
    const vectorStore = await HNSWLib.fromDocuments(changedDocs, embeddings);
    await vectorStore.save(vectorStorePath);

    saveState(repo, {
      last_commit: latestCommit,
      file_hashes: newFileHashes
    });

    return new GSStatus(true, 200, undefined, {
      message: `Embedded ${changedDocs.length} changed files.`,
      changed: changedDocs.map(doc => doc.metadata.path)
    });

  }catch(err) {
    ctx.logger.error("Error in upsert_docs_lc: %o", err);
    return new GSStatus(false, 500,undefined,{error: "Failed to upsert docs"});
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function loadState(repo: string) {
  try {
    const statePath = path.resolve("vector_store", `${repo}_state.json`);
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

function saveState(repo: string, state: any) {
  const dir = path.resolve("vector_store");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const statePath = path.join(dir, `${repo}_state.json`);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}