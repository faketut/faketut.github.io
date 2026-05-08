---
title: Optimizing a WLP4 (C-like) Compiler Backend: from “correct codegen” to smaller, faster, and more robust
date: 2026-04-28 00:00:00
tags:
  - compiler
  - optimization
  - ARM64
categories:
  - engineering
---

This post summarizes an optimization journey for a **WLP4 (C-like teaching language) compiler backend**. The input is a typed AST and the output is **ARM64 assembly**. The goal is not merely “translate semantics correctly”, but to push the generator toward:

- less work for common expressions
- less saving/restoring around function calls
- tighter stack frame layout
- more direct pointer arithmetic and addressing
- more stable, predictable generated code

---

## 1. Goals and core constraints

### 1.1 The top three priorities
- **Semantic correctness**: integers, pointers, procedure calls, heap allocation, and branches must follow the language rules exactly.
- **Efficient output**: fewer instructions, fewer memory touches, fewer stack adjustments can change runtime noticeably.
- **Maintainability**: optimizations shouldn’t turn codegen into patch spaghetti; adding new patterns should stay sane.

### 1.2 Real-world constraints
- **Frontend is fixed**: the backend consumes a structured, production-expanded tree with type suffixes; it must follow that shape.
- **ABI constraints exist**: on ARM64, `sp` must be 16-byte aligned at call sites; arg/return/callee-saved regs follow conventions.
- **WLP4 is not “just integers”**: it has `long` and `long*`; arithmetic and comparisons must be type-aware (especially pointer offsets).

---

## 2. Architecture: a lightweight AST + a stateful code generator

The overall structure is intentionally simple:

- **Parser**: reads the frontend output line-by-line and constructs an AST with `kind / rhs / children / type`.
- **Node memoization**: caches properties like `memoConst`, `memoPure`, `memoSu`, and `memoHash` for later analysis.
- **CodeGen**: maintains symbol tables, types, register allocation, per-procedure frame state, literal pools, and label generation.
- **Procedure-level emission**: collect procedures and feature usage, emit assembly per procedure, then add stubs (e.g., `getchar`/`putchar`) as needed.

The key design choice: keep “semantic checks” and “instruction emission” localized. For example, constant folding and peephole patterns happen near the expression being generated, without requiring a full-blown IR pipeline.

---

## 3. Defining performance: what does “a faster backend” mean?

When optimizing a backend, “it compiles” is not enough. At minimum, measure these costs:

### 3.1 Instruction count
- Can constant expressions fold at compile time?
- Can patterns like `x + 0`, `x * 1`, `x - x` be removed?
- Can pointer access become a single load/store instead of “compute address then load”?

### 3.2 Memory accesses
- Do locals need to be loaded from the stack every time?
- Are we pushing too many temporaries before calls?
- Are there redundant saves/restores in the frame?

### 3.3 Call overhead
- Are we saving registers we don’t need?
- For > 8 args, do we pass on stack correctly and compactly?

---

## 4. Closing

The biggest gains came from treating codegen like a performance-sensitive subsystem: define measurable costs, add small analyses (purity/const-ness, simple pattern matching), respect ABI constraints, and keep the generator maintainable.

