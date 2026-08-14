# Issue tracker: Linear (manual)

Issues and specs for this repo live in Linear. Humans create them by hand.

There is no Linear CLI, MCP, or API workflow wired up yet. Do not call `gh issue create`, do not write files under `.scratch/`, and do not create Linear issues automatically.

## Conventions

- **Create an issue**: do not create it. Draft a ready-to-paste title and body and ask the user to create the Linear issue.
- **Read an issue**: only if the user pastes a Linear URL, identifier, or the issue body. Do not assume a Linear integration is available.
- **List / comment / label / close**: out of scope until a Linear workflow is configured. Tell the user the intended change so they can apply it in Linear.

## When a skill says "publish to the issue tracker"

Do not publish. Draft the issue (title + body) and hand it to the user to create in Linear.

## When a skill says "fetch the relevant ticket"

Ask the user for the Linear identifier or a paste. If they already provided one in the conversation, use that text as the ticket.

## Wayfinding operations

Wayfinder maps and child tickets are not automated. Draft the map and children as markdown if the user wants to create them in Linear.
