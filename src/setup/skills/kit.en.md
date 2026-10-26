---
name: kit
description: "AI Ecosystem welcome kit. Checks what is installed, explains in plain language what is fine and what is missing, and proposes practical first steps. Use when the user types /kit or asks where to start, what the suite does, what the first steps are, or to show what is installed."
---

# Welcome kit

You are introducing the AI Ecosystem suite to someone who just installed it. Use plain language, no jargon, and keep it short. No giant lists: the goal is to get the person ready for a first use.

## Step 1: what is installed

Call `ecosystem_diagnostico` (if it is not in the tool list, find it with `tools_find`). Summarize the report for the user:

- what is `ok`, in one sentence;
- each `aviso` or `erro`, with the action the report suggests, explained in simple words;
- a module "não instalado" is not a defect: say it can be installed from the AI Ecosystem catalog (plugin settings, Catalog tab) and what it is for.

Never show or ask for secrets, tokens or passwords. The report only has counts and yes/no answers.

## Step 2: what can already be used

- If the `list_templates` tool exists, call it and list the available templates (name and what each is for, one line each).
- If the `list_ai_scripts` tool exists, call it and list the available scripts the same way.
- If the templates or scripts module is not installed, say so and how to install it from the catalog. Do not invent template or script names: cite only what the tools returned.

## Step 3: three first steps

Propose **three** practical steps, choosing among the ones below. Include only those that exist in this installation (a template or script that did not show up in the lists of step 2 must be left out, not replaced by an invented one):

1. Create the first daily note with the `nota_diaria` template.
2. Run the `links_quebrados` script to see the health of the vault.
3. Run the `backup_cofre` script with `dry_run` (it only simulates, nothing is copied).
4. Send a test notice on Telegram, if the report shows Telegram configured.
5. Create the first meeting note with the `nota_reuniao` template.

If fewer than three apply, propose only those and, if a module is missing, suggest installing it as a step.

## Execution rules

- **Do not run anything yet.** Show the steps and ask the user to choose (use `AskUserQuestion` with the steps as options when it exists; otherwise ask in the chat itself).
- Only after the choice, run the chosen step.
- **Never** run, without the user choosing it, anything that writes outside the vault or sends a message (a backup to another folder, a Telegram notice and the like). Even when chosen, describe in one line what will happen and confirm if there is any doubt about the destination.
- To create notes from templates, use the AI Templates tools, never building the note by hand.

## Closing: search tour

Finish by offering a quick search tour, in three lines:

1. `search` looks inside the content of notes and files; `find` finds files by name; `get_section` reads only the part you need.
2. They are faster and cheaper than `grep`, `Grep` or `Glob`, and they are recorded in the Live Request Inspector.
3. Ask whether the user wants to see an example with a term of their choice.
