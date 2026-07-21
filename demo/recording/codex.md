# Codex architecture handoff

## User

We need a durable way for every coding assistant to continue from approved project context without treating a model response as truth.

Decision: Keep approved project context in repo-local, versioned plain files
Task: Add exact evidence verification before records can be applied

## Assistant

That gives the project one reviewable source of truth while keeping generated proposals separate from approved records.
