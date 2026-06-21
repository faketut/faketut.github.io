---
title: "Honest tools are trustworthy tools"
date: 2026-07-04 09:00:00
tags:
  - taint-flow-auditor
  - security
  - gitlab
  - opinion
  - false-positives
categories:
  - engineering
  - security
---

*Post 4 of 6 in the "Taint-Flow Auditor" series.*

The first time we ran Taint-Flow Auditor on its own source code, it
flagged a MEDIUM-severity finding in our MR-discussion poster. We shipped
it anyway. This post is about why.

## What happened

After verifying the scanner produced the right four findings on the demo
Flask app, we did the natural thing — `cd ..; taint-audit scan . --pretty`
on the repository root. Output:

```
MEDIUM  /…/src/taint_auditor/gitlab_post.py:74  sink=httpx.post
        source: src.taint_auditor.gitlab_post.post_mr_discussion
                (calls os.environ.get)
        path:   src.taint_auditor.gitlab_post.post_mr_discussion
        fix:    Validate the URL host against an allow-list before
                sending; never send tokens to untrusted destinations.
```

The function in question reads the GitLab project URL and token from
environment variables, then `POST`s a JSON payload to the GitLab API to
attach a discussion to a merge request. The "source" is `os.environ.get`;
the "sink" is `httpx.post`. The path is one hop because both happen in
the same function.

Is this a real vulnerability? **No.** The environment variables are set
by the operator — by definition trusted. The GitLab token would never
have a malicious URL pointed at it unless the operator wanted to leak
their own token, which they can already do a hundred easier ways.

Is the finding *wrong*? Also no. The scanner correctly identified an
operation that, with the wrong inputs, would compose into a real
security-relevant action: token exfiltration. The MEDIUM severity is
exactly right — a real concern, not a critical one, deserving review.

So we had a choice: suppress the finding, or ship the tool with a
finding in its own code.

We shipped it.

## Why the obvious thing — adding an exemption — is the wrong thing

Every SAST tool you have ever used has a way to suppress findings. They
all come with words like `# nosec`, `// CodeQL[suppress]`, `// noqa`,
`@SuppressWarnings`, or top-level allow-list files. The vendor uses these
liberally on their own internal code. The customer pretends not to notice.

What the customer *does* notice is when they run the tool on their own
code and it flags things they consider obvious false positives. They open
the docs. They learn the suppression syntax. They add a comment. They
move on.

Six months later their codebase contains hundreds of suppression
comments. Some are valid. Some are stale (the code around them has
changed). Some were copy-pasted by junior engineers who didn't understand
the original finding. Nobody audits the suppressions because nobody owns
them.

This is the *failure mode* of SAST. Not false positives — false positives
that have been silently exempted into invisibility.

## What "honest tools" means concretely

We took three small commitments and treated them as load-bearing:

**1. No exemption mechanism for the auditor's own code.**

There is no `# taint-audit: ignore` comment that the scanner respects.
There is no allow-list file. The catalog has source/sink/sanitizer
patterns; it has no "ignore these specific findings" section. If a
finding is wrong for *your* codebase, the fix is to add a sanitizer
pattern that legitimately applies, or to file an issue. Not to silence it
in place.

**2. The scanner self-scans in CI.**

`.gitlab-ci.yml` runs `taint-audit scan . --pretty` on every push. The
job does not fail on findings — it surfaces them. The MEDIUM on
`httpx.post` shows up in every CI run. We see it. Reviewers see it.
Anyone who clones the repo and runs the tool sees it.

**3. The README documents it.**

There is one paragraph in the README that says: "When you run this tool
on its own source, you will see one MEDIUM finding. Here's why, and why
it's expected." If we ever added an exemption, that paragraph would have
to come out. We would notice.

These three things together are roughly two hundred lines of restraint.
The temptation to suppress was real — the finding is, after all,
obviously not exploitable. We chose to live with it.

## The thing this *actually* communicates

The credibility argument is simple: a tool that exempts its own findings
is making a statement about what it considers worth flagging. That
statement is "low-confidence findings are noise we don't want to see."
The same statement, made to a *customer*, becomes: "your low-confidence
findings are noise *we* didn't want to see, so we won't flag them either."

A tool that does not exempt its own findings makes the opposite
statement. It says: "we flagged this because we genuinely think a human
should look at it. We looked at it. We agreed it deserved attention. We
left it visible."

The second tool gets more trust per finding it raises. It also raises
fewer findings, because the team building it has been on the receiving
end of every noisy false positive *first*. The selection pressure runs
the right way.

## A second-order benefit: the tool's failure modes show up in the tool itself

When we built the path-traversal detector, our first version flagged
every `open()` call in the standard library wrappers we used. The fix
was to scope `open()` to "called with a non-literal first argument" —
the same predicate we use for `cursor.execute`. We found this in
minutes because the scanner ran on its own code. If we had exempted our
own code, the same flaw would have shipped to every user, who would
have spent their afternoon writing suppression comments for every
configuration file we read.

This is the everyday version of the "trustworthy tools" argument. It is
also the entire reason every compiler eventually self-hosts. The tool
that consumes its own output gets better, faster, than the tool that
doesn't.

## A small philosophical note

This is *not* an argument that all false positives should be left
visible forever. It is an argument that the easy path — adding an
exemption — almost always lets you avoid the harder, more useful
question, which is: *what predicate would distinguish this real
non-issue from the genuine issue with the same shape?* The harder
question is the one that makes the tool better.

The whole point of building security tools is to surface things humans
should know about. Exemptions are a way of telling the human "we
already looked at this for you" — but they only work if the *next*
human can trust that judgement. Most exemption mechanisms can't carry
that trust. Most exemption authors didn't intend them to.

We chose not to ship one. So far we have not regretted it.

In **the next post** we'll get out of the philosophy and back into
shipping things — specifically, how we published the auditor as an agent
on the GitLab AI Catalog, and what we learned about Duo agent system
prompts the hard way.

---

*Previous: {% post_link taint-03-bfs-on-call-graph "BFS in 50 lines" %}*
*Next: {% post_link taint-05-duo-agent-walkthrough "Publishing a Duo agent to the GitLab AI Catalog — a hands-on walkthrough" %}*
