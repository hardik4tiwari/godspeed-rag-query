import { GSContext, GSStatus, PlainObject } from "@godspeedsystems/core";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Document } from "langchain/document";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import runUpsert from "./upsert_docs";
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
  const query_  = query.Query;

  if (!query_) {
    return new GSStatus(false, 400,undefined, {error: "Query is required"});
  }
  
  const activePath = path.resolve("vector_store/active_repo.json");
  if (!fs.existsSync(activePath)) {
    return new GSStatus(false, 400,undefined,{error: "No active repo set. Please POST to /set-repo first."});
  }
  
  const { repoUrl } = JSON.parse(fs.readFileSync(activePath, "utf-8"));
  // const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
  // const [_, owner, repo, branch] = match;

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/?#]+)/);
if (!match) {
  return new GSStatus(false, 400, "Invalid GitHub URL format", { repoUrl });
}

const [, owner, repo, rawBranch] = match;

// Clean the branch properly
const branch = rawBranch.trim().replace(/["'`\\{}()\[\]]/g, ""); // remove quotes/brackets

// Now build a valid folder name
const collectionName = `${owner}__${repo}__${branch}`.replace(/[^a-zA-Z0-9_\-]/g, "_");

  // Re-run upsert to check for changes
  await runUpsert(ctx, { repoUrl });
  
  try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new GSStatus(false, 500, undefined, { error: "Missing GEMINI_API_KEY" });
  }
  const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey });
  if (!apiKey) {
    return new GSStatus(false, 500, undefined, { error: "Missing GEMINI_API_KEY" });
  }
  const vectorStore = await Chroma.fromExistingCollection(embeddings, {
    collectionName,
    url: "http://localhost:8000"
  });

  ctx.logger.info("Querying vector store with: %s", query_);
  ctx.logger.info("Chroma collection name: %s", collectionName);

  // const vectorDbPath = path.join(VECTOR_DB_DIR, `${safeRepoName}.json`);
  // if (!fs.existsSync(vectorDbPath)) {
  //   return new GSStatus(false, 400, undefined, { error: "Vector DB not found for this repo. Please run upsert first." });
  // }
  
  // const rawVectors = JSON.parse(fs.readFileSync(vectorDbPath, "utf-8"));
  // const documents = rawVectors.map((item: any) =>
  // new Document({
  //   pageContent: item.pageContent,
  //   metadata: item.metadata || {}
  // })
  // );
  // const embeddings = rawVectors.map((item: any) => item.embedding);
  // const embedder = new GoogleGenerativeAIEmbeddings({
  // modelName: "embedding-001",
  // apiKey
  // });
  // const vectorStore = await MemoryVectorStore.fromVectors(documents, embeddings,embedder);
  
  // if (fs.existsSync(vectorDbPath)) {
  //   return new GSStatus(false, 400, undefined, { error: "Vector DB not found for this repo. Please run upsert first." });
  // }
  const retriever = vectorStore.asRetriever();
  const docs = await retriever.invoke(query_);
  
  ctx.logger.info("Retrieved docs: %o", docs);
  if (!docs || docs.length === 0) {
    return new GSStatus(false, 404, undefined, { error: "No relevant documents found." });
  }
  const contextText = docs.map(d => d.pageContent).join("\n\n");
  ctx.logger.info("Context content: %s", docs.map(doc => doc.pageContent).join("\n\n"));

  // const contextText = docs.map(doc => doc.pageContent).join("\n\n");

  const prompt = `Answer the question using the context below.\n\nContext:\n${contextText}\n\nQuestion: ${query_}`;

  const llm = new ChatGoogleGenerativeAI({
    apiKey,
    model: "models/gemini-1.5-flash",
  });

  const response = await llm.invoke(prompt);

  return new GSStatus(true, 200, undefined, {
    result: response,
    used_docs: docs.map(d => d.metadata?.path || d.metadata?.filename || "unknown")
  });

} catch (err) {
  ctx.logger.error("RAG query failed: %o", err);
  return new GSStatus(false, 500, undefined, { error: "Error during RAG query" });
  }
}
