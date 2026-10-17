---
title: "How Ultravox Does RAG over the Phone"
date: 2026-05-09 03:00:00
tags:
  - voxflow
  - python
  - websocket
  - twilio
categories:
  - engineering
  - voice-ai
---

## Two ways to do it

**Option A: Build it yourself.**
1. Chunk documents → embed → store in vector DB (Pinecone, Weaviate, pgvector)
2. On each user turn: embed query → similarity search → top-K chunks
3. Inject chunks into the conversation context
4. Manage the embedding pipeline, re-indexing, evaluation

**Option B: Let the voice platform do it.**
1. Upload documents to the platform UI
2. Get a `corpus_id`
3. Register a `queryCorpus` tool on every call
4. Done

VoxFlow goes with option B because Ultravox already runs the retrieval inside its inference path, where it can be sub-100ms.

## The tool registration

```python
{
    "toolName": "queryCorpus",
    "parameterOverrides": {
        "corpus_id": ULTRAVOX_CORPUS_ID,
        "max_results": 5,
    },
}
```

That's the entire integration. No vector DB to operate. No re-embedding when documents change. No "retrieval evaluation" notebook. The corpus lives in Ultravox's storage, gets re-indexed when you upload new docs, and the model decides when to query it.

## When the AI calls the tool

You don't write a prompt that says "always retrieve before answering." You write a prompt that *gives the model permission*:

```
## Handling Questions
Use the function `queryCorpus` to respond to customer queries
and questions about clinic services, hours, or pricing.
```

The model decides per turn whether the question needs retrieval. Asking "How are you?" → no retrieval. Asking "What time do you close on Sundays?" → `queryCorpus(question="Sunday closing hours")`.

## What the client-side handler does

In VoxFlow it does almost nothing:

```python
async def handle_queryCorpus(uv_ws, invocation_id, params: QueryCorpusParams) -> None:
    # Ultravox performs the actual corpus query server-side;
    # this client-side hook just logs.
    logger.info("[Q&A] question=%s", params.question)
```

The retrieval happens inside Ultravox. The "tool call" is just an event the platform emits so the client (you) can log, audit, or react.

## Trade-offs of platform-managed RAG

**Wins:**
- Zero infrastructure
- Sub-100ms retrieval inside the model's loop
- No re-embedding maintenance
- Same vendor handles the eval feedback loop

**Losses:**
- Vendor lock-in for your knowledge base
- Limited control over chunking strategy
- Can't mix data sources (e.g., live DB query + vector results)
- Pricing tied to platform tier

**When to switch to self-built RAG:**
- Your knowledge base is dynamic (real-time inventory, account-specific data)
- You need to combine RAG with live API calls in one retrieval step
- Compliance requires data not leaving your VPC
- Your retrieval scoring needs custom rerankers
