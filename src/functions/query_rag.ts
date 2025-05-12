import { GSContext, GSStatus, PlainObject } from "@godspeedsystems/core";
import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
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
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)/);
  const [_, owner, repo, branch] = match;
  // Re-run upsert to check for changes
  await runUpsert(ctx, { repoUrl });
  
  try {
    // Load vector store
    const apiKey = process.env.GEMINI_API_KEY;
    const vectorStorePath = path.join("vector_store", repo);
    
    
    const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey });
    const vectorStore = await HNSWLib.load(vectorStorePath, embeddings);
    // if (apiKey) {
    //   return new GSStatus(false, 400,undefined, {error: "Query is required"});
    // }

    if (!vectorStore) {
      return new GSStatus(false, 400,undefined,{error: "No vector store found. Please run upsert first."});
    }
    // Retrieve relevant documents
    const retriever = vectorStore.asRetriever();
    const docs = await retriever.invoke(query_);


    if (!docs || docs.length === 0) {
      return new GSStatus(false, 400,undefined,{ error:"No relevant documents found." });
    }

    const contextText = docs.map(doc => doc.pageContent).join("\n\n")

    // Construct prompt
    const prompt = `Answer the question using the context below.\n\nContext:\n${contextText}\n\nQuestion: ${query_}`;

    const llm = new ChatGoogleGenerativeAI({
      apiKey: process.env.GEMINI_API_KEY!,
      model: "models/gemini-1.5-flash"
    });

    const response = await llm.invoke(prompt);

    return new GSStatus(true, 200, undefined, {
      result: response,
      used_docs: docs.map(d => d.metadata.path || d.metadata.filename)
    });

  } catch (err) {
    ctx.logger.error("RAG query failed: %o", err);
    return new GSStatus(false, 500,undefined, "Error during RAG query");
  }
}
