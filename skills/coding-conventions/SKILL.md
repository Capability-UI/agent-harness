---
name: coding-conventions
description: How this harness expects you to change code and record progress.
---

# Coding conventions

1. Read before edit. Use workspace.read or workspace.grep.
2. Prefer workspace.edit over rewriting whole files.
3. After a behavior change, run the relevant tests with workspace.bash.
4. Append a short note with harness.memory.append_progress at the end of a session.
5. Do not mark feature_list items passing unless a test or check you ran succeeded.
