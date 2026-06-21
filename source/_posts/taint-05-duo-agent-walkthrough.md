---
title: "Publishing a Duo agent to the GitLab AI Catalog"
date: 2026-06-21 09:00:00
tags:
  - taint-flow-auditor
  - security
  - gitlab
  - gitlab-duo
  - ai-catalog
  - tutorial
categories:
  - engineering
  - security
---

*Post 5 of 6 in the "Taint-Flow Auditor" series. This one is a how-to.*

The GitLab AI Catalog is the discovery surface for Duo agents. Anyone with
a GitLab.com account can browse it, click into an agent, and (if the agent
is public) enable it in their own projects. As a tool author, it is the
shortest path between "I built something" and "anyone on GitLab can use
it." Docs are still light, so this post is what we wish we'd had.

This is a hands-on walkthrough of:

1. Creating an agent that wraps an existing CLI scanner.
2. The system-prompt mistake we made on the first try.
3. The `SKILL.md` that turns the CLI into a Duo skill (slash command +
   foundational-flow invocation).
4. Publishing the agent publicly and getting it indexed.

## What an AI Catalog agent actually is

An agent on the AI Catalog is, mechanically, three things:

- A **system prompt** that defines persona, scope, and behaviour.
- A **tool list** the agent is allowed to invoke (built-ins like file
  read, plus user-supplied skills).
- **Metadata** for discovery: name, description, icon, topics, visibility.

That's it. There is no model fine-tuning, no separate hosted runtime. The
agent runs on GitLab's existing Duo LLM stack; the system prompt and
skill set decide what it does.

This is good news. It means you can iterate fast — a bad system prompt
is a five-minute fix, not a re-training.

## Creating the agent

In GitLab.com (you need to be on a top-level group with Duo Enterprise or
in the hackathon-provisioned namespace):

1. **Navigate**: top-left avatar → *Explore* → *AI Catalog* → *Agents*.
2. **New agent**. Fill in:
   - Name: `Taint-Flow Auditor`
   - Description: one paragraph explaining what it does. This is what
     judges and curious users see in the catalog listing.
   - Visibility: *Public* (otherwise nobody outside your group can use it).
3. **System prompt**: see the next section — this is the part we got
   wrong the first time.
4. **Skills**: link to your repository's `skills/<name>/SKILL.md`. This is
   how the agent learns about your CLI's existence and slash command.
5. **Save** → click the blue **Enable** button on the agent page.

The agent now appears in the Catalog. Anyone who navigates to your URL
can click *Enable in project* and it shows up in their Duo Chat dropdown.

## The system-prompt mistake

Our first attempt at a system prompt was the obvious thing — describe
the tool, list the sinks it knows about, ask the agent to "help users
understand security findings." The first chat session went like this:

> **User:** audit this repo
>
> **Agent:** I can help you with that. Security audits are an important
> part of the software development lifecycle. There are several aspects
> to consider, including authentication, authorization, input validation…

This is the failure mode of describing a tool without telling the agent
**what to do first**. The agent has a CLI tool available; it has no idea
that running the tool is the *single best response* to a user asking for
an audit. So it falls back on what LLMs do when uncertain: generic prose
about the topic.

The fix is a "prime directive" pattern. The first paragraph of the system
prompt is an unambiguous instruction:

```
You are the Taint-Flow Auditor agent. Your single most important
behaviour is this: when a user asks you to audit, scan, find taint, or
check security of a repository or merge request, your FIRST action is
ALWAYS to invoke the `/taint-audit` slash command (or run
`taint-audit scan . --pretty`) and paste the raw output. You do not
discuss what you might find. You do not explain what taint analysis is.
You run the scanner and show the result. Only after that do you offer
analysis, prioritisation, or fix suggestions.
```

The "ALWAYS" + "FIRST" + concrete command-line is doing all the work
here. The same agent, second session:

> **User:** audit this repo
>
> **Agent:** Running `taint-audit scan . --pretty`…
>
> ```
> HIGH    db.py:20   sink=cursor.execute
>         source: views.search   (reads request.args)
>         path:   views.search -> db.run_search -> db.run_query
>         …
> ```
>
> Here are the 4 findings, ordered by severity. The HIGH SQL injection
> in `db.run_query` should be addressed first — it is reachable from any
> unauthenticated user…

Same model. Same skill set. Completely different first response. The
difference was four words in the system prompt: `your FIRST action is
ALWAYS`.

The general principle: LLMs are excellent at improvising once they have
data. They are bad at the meta-decision of "should I generate data right
now?" The system prompt's job is to remove that meta-decision.

## The SKILL.md

A skill is a Markdown file that lives in your repo at
`skills/<name>/SKILL.md`. Frontmatter is small:

```yaml
---
name: taint-flow-auditor
description: Find interprocedural taint flows in Python using the GitLab
  Orbit knowledge graph. Use when reviewing security-sensitive merge
  requests or investigating suspected injection vulnerabilities.
metadata:
  slash-command: enabled
---
```

The body is prose, but it is read by the model, not by humans. Structure
it for the model:

- **When to invoke** — list the specific phrasings that should trigger
  the skill. `is this safe?`, `audit`, `find vulns`, `/taint-audit`.
- **How to run** — the exact shell commands. The model copies these.
- **How to interpret** — the schema of the output. Severity levels.
  What each field means. The model uses this to summarise.
- **Known limitations** — what the tool *cannot* do. Explicit limits
  prevent the agent over-claiming. (See post 4 on honest tools — this
  applies to the agent too.)

One thing to avoid: do not write the SKILL.md as if it were a tutorial.
"First, you should think about whether you really need to run a security
scan…" is fine for a human, terrible for a model. Be imperative and
specific: "Invoke when X. Run command Y. Output schema is Z."

## Wiring the slash command

`metadata.slash-command: enabled` in the frontmatter does the work. The
agent's name becomes the slash command: `/taint-audit`. Users in any
project that has enabled this agent can type `/taint-audit` in Duo Chat
and get the scanner output directly, without going through the
free-text "audit this please" path.

The slash-command path is the one we recommend in our README and demo.
It makes the agent feel like a first-class part of the IDE rather than
"a chat I have to coach."

## Visibility, topics, and getting found

The AI Catalog has a search index, but newer agents need help climbing
it. Two things to do after publishing:

1. **Set topics on your repository.** The Catalog uses GitLab project
   topics for discovery. We use:
   - `duo-agent-platform`
   - `agent-skill`
   - `security`
   - `sast`
   - `gitlab-orbit`
2. **Link the agent from your README**, your blog posts, your demo
   video, and your project description. The Catalog re-indexes
   periodically, but inbound links are still what surfaces it.

## What we'd do differently next time

- **Test the system prompt before publishing.** The "describe the tool"
  prompt mistake cost us a re-record of part of our demo video. Run a
  test chat session as a second user (or in incognito) before you commit
  to a system prompt.
- **Write the SKILL.md before building the agent UI.** The agent
  configuration UI auto-detects skills from `skills/*/SKILL.md` in the
  linked repo, so having the file already in place is faster than
  iterating in the UI.
- **Include an explicit "when not to invoke" section in SKILL.md.** Our
  first version listed only positive triggers; the agent occasionally
  invoked the scanner on non-security questions. Adding "Do not invoke
  for non-security review questions" fixed it.

That's all there is to it. The hardest part of publishing a Duo agent
is not the tooling — it is realising that *the system prompt is the
product*.

In **the final post** we'll talk about where this project goes next —
JavaScript, Go, per-argument taint, auto-fix MRs — and why each of
those is straightforward to add now that Orbit has done the hard part.

---

*Previous: {% post_link taint-04-honest-tools "Honest tools are trustworthy tools" %}*
*Next: {% post_link taint-06-roadmap "Roadmap — from function-level to argument-level taint" %}*
