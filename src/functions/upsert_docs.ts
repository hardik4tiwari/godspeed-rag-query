import { GSContext, GSStatus, PlainObject } from "@godspeedsystems/core";
import path from "path";
import { promises as fs } from "fs";
import { execSync } from "child_process";
import simpleGit from "simple-git";

import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { TextLoader } from "langchain/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { Chroma } from "@langchain/community/vectorstores/chroma";
// import { MemoryVectorStore } from "langchain/vectorstores/memory";
// import { Document } from "langchain/document";

// Constants
const REPO_BASE_DIR = "tmp_repos";
const VECTOR_DB_DIR = "vector_store";

// Utility
const pathExists = async (p: string) =>
  fs.access(p).then(() => true).catch(() => false);

export default async function embedRepoDocs(
  ctx: GSContext,
  args: PlainObject
): Promise<GSStatus> {
    const {
        inputs: {
            data: {
                query       // query parameters from rest api
            }
        }, 
     
    }= ctx;
  const githubUrl  = query.repoUrl;
  // const githubUrl = args["githubUrl"];
  if (!githubUrl || typeof githubUrl !== "string") {
    return new GSStatus(false, 400, "Missing or invalid 'githubUrl'", {});
  }
const match = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/?#]+)/);
if (!match) {
  return new GSStatus(false, 400, "Invalid GitHub URL format", { githubUrl });
}

const [, owner, repo, rawBranch] = match;

// Clean the branch properly
const branch = rawBranch.trim().replace(/["'`\\{}()\[\]]/g, ""); // remove quotes/brackets

// Now build a valid folder name
const safeRepoName = `${owner}__${repo}__${branch}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
const collectionName = `${owner}__${repo}__${branch}`.replace(/[^a-zA-Z0-9_\-]/g, "_");

const repoPath = path.join(REPO_BASE_DIR, safeRepoName);
// const vectorDbPath = path.join(VECTOR_DB_DIR, `${safeRepoName}.json`);
const metadataPath = path.join(REPO_BASE_DIR, `${safeRepoName}.commit`);
  await fs.mkdir(REPO_BASE_DIR, { recursive: true });
  await fs.mkdir(VECTOR_DB_DIR, { recursive: true });

  const git = simpleGit();

  if (!(await pathExists(repoPath))) {
    await git.clone(
      `https://github.com/${owner}/${repo}.git`,
      repoPath,
      ["--branch", branch, "--depth", "1"]
    );
  } else {
    await git.cwd(repoPath).pull();
  }

  const currentCommit = execSync(
    `git -C ${repoPath} rev-parse HEAD`
  ).toString().trim();

  const previousCommit = (await pathExists(metadataPath))
    ? await fs.readFile(metadataPath, "utf-8")
    : null;

  if (currentCommit === previousCommit) {
    return new GSStatus(true, 200, "No new commits to process", { collectionName });
  }

  const changedFiles = previousCommit
    ? execSync(`git -C ${repoPath} diff --name-only ${previousCommit} ${currentCommit}`)
        .toString()
        .split("\n")
        .filter(Boolean)
    : await getAllTextFiles(repoPath);

  const apiKey = ctx.config?.gemini?.apiKey || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  return new GSStatus(false, 500, "Missing Gemini API key", {});
}

const embedder = new GoogleGenerativeAIEmbeddings({
  modelName: "embedding-001",
  apiKey
});
//   const embedder = new GoogleGenerativeAIEmbeddings({
//     modelName: "embedding-001",
//     apiKey: process.env.GOOGLE_API_KEY,
//   });
const vectorStore = await Chroma.fromDocuments([], embedder, {
    collectionName,
    url: "http://localhost:8000",
  });
  const vectors: { embedding: number[]; content: string; metadata: any }[] = [];

  for (const fileRelPath of changedFiles) {
    const absPath = path.join(repoPath, fileRelPath);
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) continue;

      const loader = new TextLoader(absPath);
      const rawDocs = await loader.load();
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1024,
        chunkOverlap: 100,
      });
      let splitDocs = await splitter.splitDocuments(rawDocs);

      // Filter empty pages
      splitDocs = splitDocs.filter(doc => doc.pageContent?.trim());
      await vectorStore.addDocuments(splitDocs);
    //   for (const doc of splitDocs) {
    //     const embedding = await embedder.embedQuery(doc.pageContent);
    //     vectors.push({
    //       embedding,
    //       content: doc.pageContent,
    //       metadata: doc.metadata
    //     });
    //   }

    } catch (err) {
      ctx.childLogger.warn(`Skipping unreadable file: ${fileRelPath}`);
    }
  }

  await fs.writeFile(metadataPath, currentCommit, "utf-8");
//   await fs.writeFile(vectorDbPath, JSON.stringify(vectors), "utf-8");

  return new GSStatus(true, 200, undefined, { collectionName });

}
//   const vectorStore = await MemoryVectorStore.fromDocuments([], embedder);

//   for (const fileRelPath of changedFiles) {
//     const absPath = path.join(repoPath, fileRelPath);
//     try {
//       const stat = await fs.stat(absPath);
//       if (!stat.isFile()) continue;

//       const loader = new TextLoader(absPath);
//       const rawDocs = await loader.load();
//       const splitter = new RecursiveCharacterTextSplitter({
//         chunkSize: 1024,
//         chunkOverlap: 100,
//       });
//       const splitDocs: Document[] = await splitter.splitDocuments(rawDocs);
//       await vectorStore.addDocuments(splitDocs);
//     } catch (err) {
//       ctx.childLogger.warn(`Skipping unreadable file: ${fileRelPath}`);
//     }
//   }

//   await fs.writeFile(metadataPath, currentCommit, "utf-8");
//   await fs.writeFile(vectorDbPath, JSON.stringify(vectorStore.memoryVectors), "utf-8");

//   return new GSStatus(true, 200, undefined, { vectorDbPath });
// }

// Helper: get all relevant files for initial embed
async function getAllTextFiles(dir: string, allFiles: string[] = [], root = dir): Promise<string[]> {
  const files = await fs.readdir(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(root, fullPath);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      await getAllTextFiles(fullPath, allFiles, root);
    } else if (/\.(ts|js|md|txt|yaml|yml)$/.test(file)) {
      allFiles.push(relPath);
    }
  }
  return allFiles;
}
