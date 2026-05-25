---
title: "Engineering a Real-Time Interview Copilot: from it works to low-latency, stable, and invisible"
date: 2026-04-24 00:00:00
tags:
  - real-time
  - copilot
  - optimization
categories:
  - engineering
---

This post summarizes engineering lessons from building a Windows desktop **real-time interview copilot**. The typical pipeline is:

**invisible overlay** + **ASR (speech-to-text) → streaming text LLM** + **hotkey screenshot → vision LLM** + **local RAG knowledge base**.

The goal wasn’t to pile on features—it was to make the system **fast to hear, fast to answer, non-blocking, failure-tolerant, and self-recovering**.

---

## 1. Goals and constraints

### 1.1 UX goals (the top 3)
- **Low end-to-end latency**: after the user finishes a sentence, answers should start streaming quickly.
- **High stability**: ASR/LLM failures must not freeze the whole app; errors should be recoverable.
- **Invisible / non-intrusive**: the overlay defaults to **click-through**, with an explicit mode to enable interactions when needed.

### 1.2 Real-world constraints
- **Windows audio capture is tricky**: WASAPI loopback, device switching, mute states, and sample-rate mismatches can break stability.
- **Cloud dependencies are noisy**: ASR/LLM latency spikes and rate limits require buffering and degradation strategies.
- **Two pipelines in parallel**: voice and screenshot flows must be isolated to avoid “screenshot failure breaks voice”.

---

## 2. Architecture: split into two isolated pipelines

### 2.1 Voice (ASR → text LLM) main pipeline
- **WASAPI Loopback Capture**: capture system output (interviewer audio typically comes from meeting apps)
- **ASR Streaming**: partial / final transcripts
- **Partial Segmenter**: cut partials by punctuation/timeouts to avoid frequent interrupts or late triggers
- **RAGManager**: local retrieval (resume / project highlights / templates)
- **Text LLM (OpenAI-compatible)**: stream answers
- **ASR Overlay**: show live Q&A in overlay

### 2.2 Screenshot (Alt+P → vision LLM) independent pipeline
- **Hotkey trigger**: Alt+P
- **Region capture + compression**: reduce payload size and stabilize latency
- **Vision LLM** (e.g., Gemini): parse questions/code/tables
- **Vision Overlay**: render separately without blocking voice

> The key architectural idea: **isolate everything that can be slow, flaky, or UI-blocking**, so the main pipeline stays usable.

---

## 3. Measuring “fast”: define observable latency metrics

### 3.1 Four recommended latencies
- **T_capture→ASR_partial**: audio-in to first partial transcript
- **T_final_sentence**: final sentence to LLM trigger
- **T_llm_first_token**: LLM request to first token
- **T_e2e_first_answer**: user sentence end to readable answer starting to appear

### 3.2 Make it observable
- For each answer, log: trigger reason (punctuation/timeout/manual), prompt length, RAG hits, token rate, retries.

---

## 4. Engineering tactics (high level)

Below are a few tactics that consistently improved perceived performance and reliability:

- **Backpressure & queues**: cap in-flight requests; drop/merge partials; avoid unbounded memory growth.
- **Circuit breakers**: if ASR/LLM fails repeatedly, degrade gracefully (e.g., disable RAG, reduce context, switch model).
- **Thread/process isolation**: keep UI responsive; separate audio I/O from network I/O; avoid single-thread “god loop”.
- **Deterministic overlay states**: treat overlay as a state machine (hidden → showing → interactive), with idempotent transitions.

---

## 5. Closing thoughts

In real-time assistants, the difference between “works” and “usable” is almost always **latency + failure isolation + observability**. If you can measure first-token time, isolate pipelines, and recover from partial outages, the product becomes stable enough to trust under pressure.
