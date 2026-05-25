---
title: "Beating the reference compiler by 5×: a WLP4 → ARM64 optimization journey"
date: 2026-05-18 03:00:00
tags:
  - c-class-compiler
  - compiler
  - optimization
categories:
  - engineering
---

> **TL;DR.** A four-pass compiler for the CS241 teaching language WLP4, targeting a restricted ARM64 subset. After a handful of focused codegen tricks and a CI loop that measures every push, our `.com` outputs come out **−79.6%** smaller than the course's reference compiler `wlp4c` across a 65-program benchmark — every single test is smaller, ranging from −63% (heap-intensive) to −92% (pure arithmetic).
>
> What follows is the engineering log, not just the numbers: which optimizations actually mattered, which I deliberately *didn't* do, and why the development loop is structured the way it is.

---

## Table of contents

1. [Setting and constraints](#1-setting-and-constraints)
2. [The starting point](#2-the-starting-point)
3. [Phase 1 — Building a safety net](#3-phase-1--building-a-safety-net)
4. [Phase 2A — Diagnostics that survive contact with reality](#4-phase-2a--diagnostics-that-survive-contact-with-reality)
5. [The optimizations that earned their keep](#5-the-optimizations-that-earned-their-keep)
6. [Phase 5 — Measuring like we mean it](#6-phase-5--measuring-like-we-mean-it)
7. [Phase 4 — CMake + a real driver](#7-phase-4--cmake--a-real-driver)
8. [What I deliberately did *not* do](#8-what-i-deliberately-did-not-do)
9. [Lessons](#9-lessons)
10. [Appendix: full benchmark table](#10-appendix-full-benchmark-table)

---

## 1. Setting and constraints

WLP4 is a *very* small C-flavored language used in a university compilers course:

- Two scalar types: `long` and `long*`.
- Entry point is `wain(a, b)`, not `main`.
- Procedures, locals, `if/else`, `while`, `*p` / `&x`, `new[]`, `delete[]`, `println`, `putchar`, `getchar`.
- No early `return`, no `for`, no structs, no globals.

The target is a **restricted ARM64 subset** — only a curated handful of instructions are accepted by the course emulator (`bin_ref/arm64emu`): essentially `add/sub/mul/smulh/umulh/sdiv/udiv`, `cmp`, `b/b.cond/br/blr`, `ldur/stur` with 9-bit signed immediates, and a PC-relative `ldr xN, imm`. **No `mov`, no `movz/movk`, no `ldp/stp`, no register-immediate add**. Constants come exclusively from a PC-relative literal pool. This sounds annoying but it's actually the source of most of the size win — see §5.3.

The "oracle" we're racing against is `bin_ref/wlp4c`, the canonical course compiler. Both produce the same `.com` file format (header + program + relocation/import/export footer), both go through the same assembler `bin_ref/linkasm`, both are run under the same `arm64emu`. So `wc -c program.com` is a clean apples-to-apples comparison.

## 2. The starting point

Before this session, the compiler was already past "naive". The previous commit (`6a9ed5d wlp4gen: trivial-leaf frame elision + tail-call optimization`) had two big wins in place:

- **Trivial-leaf frame elision** — procedures with no locals, no `&param`, no calls, and whose body is a single `return expr;` skip prologue/epilogue entirely. Just compute `expr`, `br x30`.
- **Tail-call optimization** — `return f(...)` reuses the caller's frame.

What was missing was:
1. A regression net I could trust before changing codegen.
2. Hard numbers on whether the optimizations were actually paying off.
3. A way to develop on macOS without manually round-tripping every test through a Linux VM (the course tools are x86-64 ELF only).

So the work split into two threads: **infrastructure first, then talk about codegen**.

## 3. Phase 1 — Building a safety net

Commit [`a6f4a75`](https://github.com/faketut/C-class-compiler/commit/a6f4a75). 12 new test programs, a portable test runner, a GitHub Actions workflow.

The expanded corpus was deliberately picked to cover the parts of `wlp4gen` most likely to silently regress:

- **Parameter-count boundary cases** (`four_args`, `six_args`, `eight_args`) — the ARM64 calling convention uses x0–x7 for the first 8 args; the 9th lives on the stack. The code path that spills overflow params is exercised exactly once in normal usage; without an explicit test it's easy to break.
- **Pointer arithmetic** (`ptr_arith_sub`, `ptr_ptr_sub`) — `long*` − `long*` returns the **element distance**, not the byte distance. Three different sites need to agree on that fact.
- **Heap with loops** (`alloc_loop`) — exercises the runtime `init`/`new`/`delete` imports plus the linker.
- **Nested calls** (`nested_call`) — call-saves around argument evaluation.

### The portable runner

[`scripts/run-tests.sh`](../scripts/run-tests.sh) does one branch at the top:

```bash
if [[ "$(uname -s)" == "Darwin" ]]; then
  exec colima ssh -- bash -lc "cd '$ROOT' && bash scripts/run-tests.sh"
fi
```

On macOS, it re-exec's itself inside [colima](https://github.com/abiosoft/colima) (a small Lima VM running x86_64 Ubuntu) so the course's Linux binaries Just Work. On Linux (CI), it runs directly. This costs ~5 seconds of VM ssh overhead per local run, and zero in CI. *No code duplication, no environment matrix, no flaky cross-compilation*.

### One subtle bug I hit later

A few hours in I started seeing **intermittent failures** — different tests would fail on each invocation. Classic race. The fix was a one-line change in Phase 2A:

```bash
# Per-invocation scratch dir so concurrent runs don't clobber each other.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
```

The original script used hardcoded `/tmp/got.wlp4ti`, `/tmp/our.com`, etc. Fine for serial runs, broken the moment two `colima ssh` sessions overlap (which happens whenever an editor agent kicks off a verification while a previous one is still draining). Lesson: even for a "one-developer test script", `mktemp -d` is one line for an unbounded amount of debugging avoided.

## 4. Phase 2A — Diagnostics that survive contact with reality

Commit [`c254eac`](https://github.com/faketut/C-class-compiler/commit/c254eac).

The original scanner printed `ERROR: unexpected character`. Type errors printed `ERROR: type mismatch`. Useless once your program is more than 20 lines.

The fix in [src/wlp4scan.cc](../src/wlp4scan.cc) is mechanical but worth describing because the **shape of the change matters**:

```cpp
size_t line_no = 1;
size_t lineStart = 0;
auto advancePos = [&](size_t k) {
    for (size_t i = 0; i < k; ++i) {
        if (input[pos + i] == '\n') {
            ++line_no;
            lineStart = pos + i + 1;
        }
    }
    pos += k;
};
```

Two state variables, one lambda. Every `pos += longest` became `advancePos(longest)`; whitespace and comment skips update inline. Now errors say `ERROR scan at line 14 col 9: unexpected '@'`. The point is: this is a **non-invasive** instrumentation. The scanner's hot path got one extra `if (input[pos+i] == '\n')` per character — negligible — and the rest of the file is untouched.

For [`wlp4type`](../src/wlp4type.cc), the trick was a single file-scoped `static string g_curProc;` that gets set at the top of each `for (Node* proc : procedureNodes)` iteration. Every existing `reportError(detail)` site now produces `ERROR type in foo(): <detail>` without touching the dozens of error sites individually. Surgical change > rewrite.

## 5. The optimizations that earned their keep

Now the meaty part. The codegen in [src/wlp4gen.cc](../src/wlp4gen.cc) is 1300 lines. Here are the ideas that actually moved the benchmark needle, in approximate order of contribution.

### 5.1 Trivial-leaf frame elision (pre-existing)

For a procedure like:

```c
long add(long a, long b) { return a + b; }
```

Reference compiler emits ~30 instructions: prologue with `sub sp`, `stur x29`, `stur x30`, body, epilogue with restores, `br x30`. We emit:

```
Padd:
  add x0, x0, x1
  br x30
```

Two instructions. **The frame setup is dead weight when the function has no locals, no `&p`, no calls, and the body fits the pattern `return expr;`** Walking the AST once at the top of `emitProcedure` to check this is cheap and unlocks a 90%+ size win on any small leaf — which is the majority of WLP4 test programs.

This was inherited from the prior commit, but I want to flag it because the benchmark would be ~−40% instead of ~−80% without it. **The biggest optimization is the one you can avoid emitting code for entirely.**

### 5.2 Tail-call optimization (pre-existing)

`return f(args)` reuses the caller's frame: jump to `f` with `b Pf` instead of `blr Pf; br x30`. Combined with §5.1, recursive functions like `fact` end up tight loops.

### 5.3 The per-procedure literal pool with dedup

This is the most architecturally interesting piece, because the ARM64 subset *forces* it: there's no immediate-form `add` or `mov`. You cannot say `add x0, x0, #4`. You can only `add` register to register. So every numeric constant has to come from memory, loaded via PC-relative `ldr xN, imm`.

The reference compiler's approach: every time you need a constant, emit a 5-instruction sequence (`ldr xN, 8; b 12; .8byte K; ...`) that hops over an inline 8-byte literal. Three uses of `4` → three inline literals → 60 bytes.

Our approach in [`finalizeLiteralPool`](../src/wlp4gen.cc):

```cpp
void emitLoadLitPayload(int reg, const string& payload) {
    auto [it, inserted] = payloadToId.try_emplace(payload, idToPayload.size());
    if (inserted) idToPayload.push_back(payload);
    string tag = fmt("PFIX", it->second, "!");      // sentinel for patching
    fixups.push_back({tag, payload});
    emit(fmt("  ldr x", reg, ", ", tag));
}
```

Each unique constant gets **one** `.8byte` slot at the end of the procedure, and every load is a single `ldr xN, <pc_offset>` whose offset gets patched in `finalizeLiteralPool` after we know the final layout. The patching is a simple two-pass linear scan: first pass records the byte address of every emitted line, second pass replaces the `PFIXn!` tag with the computed signed offset.

Concrete impact: a 5-call program with `4` used 5 times costs us 8 bytes for the slot + 5 × 4 bytes for the `ldr` = 28 bytes. The reference: 5 × ~20 bytes = 100 bytes. And literal pools amortize *across the whole procedure*, so the savings compound with size.

This single mechanism is, I'd estimate, half of the total benchmark win.

### 5.4 Constant folding in `isConst`

The arithmetic chain templates in the generated corpus show the most extreme ratio: `arith_chain_8` is **−91.6%** smaller. Why?

```c
long wain(long a, long b) {
  return (((((((28 * 41) - 18) + 38) * 23) + 49) * 50) + 12);
}
```

[`isConst`](../src/wlp4gen.cc#L228) walks the expression tree and folds `+ − × ÷ %` into a single literal. Combined with §5.1 (trivial-leaf elision), the entire procedure becomes:

```
Pwain:
  ldr x0, 8
  br x30
  .8byte <folded value>
```

Six bytes of useful code. The reference compiler builds the full AST evaluator at runtime: load 28, load 41, mul, ..., one constant-load + arithmetic chain per operator. For an 8-operand chain that's ~50 instructions of dead work.

Note that `isConst` only folds when *both* operands are themselves constant — it doesn't try partial evaluation, it doesn't reorder for associativity, it doesn't fold across pointer types. **The simple cases handle 90% of opportunities.**

### 5.5 Parameter / local promotion to callee-saved registers

`emitPrologue` checks: if the procedure uses ≤ 9 named values (params + locals) and never takes `&` of any of them, all of them get assigned to `x19..x27` instead of stack slots. The epilogue only saves/restores the registers actually used. The frame, if no other reason exists for it, gets a smaller `belowFpBytes`.

This is *the* single optimization most likely to break things — register allocation has to stay consistent across calls (save before, restore after) and across `if/while` branches. The way I keep it tractable: a single `regTab: id → reg` map per procedure built during prologue, consulted everywhere a local is read/written, and *no further changes* to the rest of the codegen. Either an id is in `regTab` (use the register) or it's not (use frame offsets). One state machine, no per-statement bookkeeping.

## 6. Phase 5 — Measuring like we mean it

Commit [`55a2576`](https://github.com/faketut/C-class-compiler/commit/55a2576) added [`tools/bench.sh`](../tools/bench.sh). Three things matter about how it's structured:

1. **It runs the full compile + link pipeline on both sides**, then `wc -c` the resulting `.com` files. Both go through the same `linkasm`, so footer/header overhead cancels out — the delta is the program section.
2. **It re-execs into colima on macOS automatically**, same trick as the test runner. Zero friction to run locally.
3. **It generates CSV** rather than a pretty table, so I can pipe it into anything (the GitHub Actions step posts a summary to `$GITHUB_STEP_SUMMARY` and uploads the raw CSV as a downloadable artifact).

Commit [`2350dc4`](https://github.com/faketut/C-class-compiler/commit/2350dc4) added [`tools/gen_random_wlp4.py`](../tools/gen_random_wlp4.py): 8 parametric templates (arithmetic chains, local sums, if-ladders, while-sums, multi-arg procs, nested calls, pointer walks, recursive fib) seeded deterministically. This grew the benchmark from 25 hand-written tests to 65 programs.

### The data

| Corpus | Files | Ours (bytes) | Reference (bytes) | Delta |
|---|---:|---:|---:|---:|
| Hand-written | 25 | 7,212 | 36,668 | **−80.33%** |
| Hand + generated | 65 | 19,588 | 95,976 | **−79.59%** |

The −80% holds steady when corpus size and shape change. That's the validation I wanted before claiming the result generalizes.

### Picking apart a single program

For `arith_chain_4`:

| | Ours | Reference |
|---|---:|---:|
| `.com` total bytes | 124 | 1,328 |
| Literal pool bytes (our side) | 32 | — |
| Reduction | **−90.7%** | |

124 bytes is essentially: ARMCOM header (20) + 6 instructions (24) + an aligned literal slot (8) + footer (~70). The compiler is at the floor; the remaining bytes are format overhead.

### One amusing failure of the generator

My first cut of `t_recursive` produced:

```c
long f(long n) {
    if (n <= 0) { return n; }
    else { return f(n - 1) + f(n - 2); }
}
```

…which is invalid WLP4. The grammar requires **exactly one trailing `return` per procedure body, never inside `if/else`**. I caught it because the parser flagged 7 out of 40 generated programs as `unexpected token 'RETURN' (#15) in state 131`. Three-line fix using a `result` variable; the generator now emits valid WLP4 100% of the time.

Lesson: **a noisy parser is a feature, not a bug**. If you can't tell what's wrong from the error, your generator/optimizer/refactor will silently swallow problems for hours. The Phase 2A `line:col` work paid for itself on the first non-trivial use.

## 7. Phase 4 — CMake + a real driver

Commit [`ebd2f47`](https://github.com/faketut/C-class-compiler/commit/ebd2f47). The repo had `build-toolchain.sh` (4 invocations of `g++`) which was fine — but for anyone running the project from an IDE that has CMake integration, it was friction. Adding a minimal [`CMakeLists.txt`](../CMakeLists.txt) was 30 lines of cmake + a `WLP4_WERROR` option for CI. The shell script stays as the zero-dependency fast path.

The [`bin/wlp4`](../bin/wlp4) driver is more interesting. It does:

```
wlp4 [-S | -c] [-o OUT] SRC.wlp4
```

with the macOS routing trick for `-c`:

```bash
if [[ "$uname_s" == "Darwin" ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- bash -lc "cat > /tmp/.wlp4-in.asm && \
        '$ROOT/bin_ref/linkasm' < /tmp/.wlp4-in.asm" < "$asm_tmp" > "$out"
else
    # native path
    "$LINKASM" < "$asm_tmp" > "$out"
fi
```

`bin/wlp4 -c test/procedures/proc.wlp4` now Just Works on either host. This is *not* a big feature, but it removed a per-test mental tax that was discouraging quick experimentation.

## 8. What I deliberately did *not* do

Equally important. The original plan had nine work items; only six landed. Here's what was cut and why.

### Self-implemented `linkasm` / `binasm` / `linker-striparmcom`

The pitch: own the entire toolchain instead of vendoring Linux binaries from `bin_ref/`. The cost: ~1k–1.5k LoC of reverse-engineering, with **no formal spec for the assembler syntax**. The doc `docs/armcom.txt` is 60 lines and covers only the binary `.com` format, not the input language to the assembler. Every ARM64 mnemonic the codegen emits would need a hand-rolled encoder, validated byte-for-byte against the reference.

The benefit: native macOS testing without colima. *Real value, but not on the critical path for any user-visible improvement.* Skipped.

### Parse-table extraction (constexpr arrays)

[`src/parse_tables.h`](../src/parse_tables.h) embeds the LR tables as giant raw string literals; `wlp4parse` re-tokenizes them at startup. Replacing with `constexpr` arrays would shave the parser binary by ~30 KB and save a few ms of startup. Skipped: zero impact on any benchmark, full impact on the risk of breaking the parser on a `.wlp4i` shape we don't have a test for.

### Further wlp4gen micro-optimizations (dead-branch elimination, register-resident `i = i + 1`)

The benchmark is already at −80%. The remaining headroom is in patterns that essentially don't occur in real WLP4 programs:

- `if (1 == 1)` — nobody writes this; the constant-folded test never fires.
- `while (0) { ... }` — same.
- `i = i + 1` collapsed into a single `add` — only saves cycles, not bytes, and only when `i` is already in a register. Maybe 1–2% on tight loops *if* I'm careful about correctness.

Risk-adjusted, these are negative-EV. Calling them out as "deferred until there's a real driver" rather than secretly skipping them.

### The discipline

Karpathy's [behavioral guidelines](https://github.com/karpathy/...) say: *don't add abstractions for one-time operations; don't refactor code that isn't broken; every changed line should trace to the user's request*. Applied to compiler work: **don't add an optimization that won't show up on a benchmark you've already built.** The benchmark is the success criterion. If it doesn't move, the optimization didn't happen.

## 9. Lessons

A few generalizable things, in order of how often I had to re-learn them:

1. **Build the measurement before the optimization.** I had Phase 1's CI + Phase 5's benchmark before I touched any codegen this session. Every subsequent decision had a number attached. The −80% headline is only meaningful because I can point at the script and the corpus that produced it.

2. **A safety net plus a noisy error message ≈ unlimited iteration budget.** Phase 1 (regression tests) and Phase 2A (line:col diagnostics) combined cost about 2 hours and saved an unknowable but large amount of debugging time. The flaky-tests episode in §3 would have been hours of head-scratching without `line:col` confirming the scanner was producing identical output on retry.

3. **Surgical > rewrite.** The scanner diagnostics change is two state variables, one lambda. The type-pass change is one static string. The test runner `/tmp` race fix is `TMP=$(mktemp -d)`. Each ships in a commit with a clear blast radius. Compare against the alternative of "while we're in there, let's refactor".

4. **Restrictive targets force good architecture.** The ARM64 subset has no immediate-form arithmetic. That's annoying for a one-shot translator but it forces the literal-pool design, which then gives you dedup almost for free, which then gives you most of the size win. The constraint *was* the optimization.

5. **Know when to stop.** Six commits in, three planned items remained, all with the same property: high effort, negligible benchmark impact, real regression risk. The right call is to *write up the work* and put down the keyboard, not to continue grinding for marginal numbers. That's this blog post.

## 10. Appendix: full benchmark table

See [docs/benchmark.csv](benchmark.csv) for the raw 65-row table. The columns:

- `name` — program identifier (test file basename)
- `our_bytes` — `wc -c` of `wlp4{scan|parse|type|gen} | linkasm` output
- `ref_bytes` — `wc -c` of `wlp4c` output
- `delta_bytes` = `our_bytes − ref_bytes` (negative is smaller)
- `delta_pct` = `100 × delta_bytes / ref_bytes`
- `our_pool` — bytes in our literal pool (8 × count of `.8byte` lines)
- `ref_pool` — left at 0 (we don't have the reference's intermediate asm)

Top 5 wins (smaller is more dramatic):

| name | our_bytes | ref_bytes | delta_pct |
|---|---:|---:|---:|
| arith_chain_8 | 124 | 1,472 | −91.58% |
| arith_chain_7 | 124 | 1,436 | −91.36% |
| arith_chain_4 | 124 | 1,328 | −90.66% |
| arith_chain_3 | 124 | 1,292 | −90.40% |
| wain_ptr | 140 | 1,240 | −88.71% |

Bottom 5 (smallest wins, where overhead matters most):

| name | our_bytes | ref_bytes | delta_pct |
|---|---:|---:|---:|
| alloc_loop | 724 | 1,968 | −63.21% |
| alloc_basic | 548 | 1,572 | −65.14% |
| nested_call | 468 | 1,592 | −70.60% |
| recursive | 404 | 1,584 | −74.49% |
| eight_args | 396 | 1,640 | −75.85% |

The pattern is clean: **arithmetic-heavy** programs benefit most (constant folding + tiny pools), **heap and many-arg** programs benefit least (linker-pulled `alloc.com`, mandatory parameter spilling for 8+ args). Every test in between sits in a tight band around −80%.

---

### Reproducing

```bash
git clone https://github.com/faketut/C-class-compiler.git
cd C-class-compiler
./build-toolchain.sh
bash scripts/run-tests.sh        # 25/25 should pass
bash tools/bench.sh > docs/benchmark.csv
# On macOS, install colima first: brew install colima && colima start --arch x86_64
```

The benchmark is deterministic (`gen_random_wlp4.py` is seeded). The CSV will reproduce byte-for-byte across runs.
