## How to run the setup

1. Call `ecosystem_setup_status` with `modulo: "{{ID}}"`. The result has what the plugin already detected (`detectado`), the answers already saved (`respostas`), the `perguntas` (each with `ja_respondida` and `detectada`), the `pre_requisitos`, the state of `CLAUDE.md` (`claude_md`) and the ready-made guide block (`bloco_claude_md`).
2. Prerequisites: if any item of `pre_requisitos` has `ok: false`, solve it first (the module instructions say how) and only then come back to this step.
3. Ask **only** what the plugin did not detect and the user has not answered yet: questions with `ja_respondida: false` and `detectada: false`. Those with `detectada: true` are not asked: show the `valor_detectado` in the final summary for the user to confirm or correct.
4. Ask **one round at a time**, in the order of the list, with the clickable question tool `AskUserQuestion`: 1 to 4 questions per call, 2 to 4 options per question, the recommended option always first and with "(Recommended)" in its label. The "Other" option shows up on its own. `AskUserQuestion` does not exist in subagents: never delegate the interview.
   - **Plan B:** if `AskUserQuestion` is denied (for example by the user's own authorization hook), fails or does not exist, do not stop and do not save anything on your own. Ask the same round in the chat itself: each question numbered, the options numbered (the recommended one first, marked "(Recommended)"), plus the option to answer with another value. Ask for a short reply (for example "1a, 2b") and wait. Use the same plan B for the summary and for the `CLAUDE.md` permission: the user's "yes" in the chat counts as the confirmation.
5. If an answer is ambiguous or incomplete and the `grill-me` skill exists, use it to clear it up. Without it, ask a follow-up question.
6. When the questions are over, show a **summary** (what was detected and what was answered) and ask for confirmation with `AskUserQuestion`, with "Confirm and apply" as the first option.
7. Only after the yes, call `ecosystem_setup_save` once per answer (`modulo`, `chave`, `valor`), skipping the questions with `salvar: false`. Do the module-specific steps that come after the summary, update the CLAUDE.md block (section below) and, last, call `ecosystem_setup_complete` with `modulo: "{{ID}}"`. If one of these tools refuses something, read the reason, sort it out with the user and try again.
8. Finish by saying what was configured. Warn that the hooks and the new tools apply to new sessions (or after restarting the session) and that this setup will not be asked for again.

## Rules that never change

- **Never ask for a token, password, API key or any secret in the chat.** If the user pastes one, do not repeat the value, do not save it anywhere and ask them to replace that credential. Secrets go in only through the `env_criar_secret` screen, which the user fills in inside Obsidian.
- Do not use the terminal, and do not read or edit the files in `.claude/ai-ecosystem/`, to work around a problem. If a tool this skill needs (`ecosystem_setup_status`, `ecosystem_setup_save`, `ecosystem_setup_complete` or another) is not in your tool list, the server may be in indexed mode: find it with `tools_find` and run it with `tools_run` (`{"id": "<tool>", "args": {...}}`). If not even `tools_find` is in the list, ask the user to restart the Claude Code session and try again afterwards.
- Never delete or move the user's files.

## Guide block in CLAUDE.md

The status result has the ready block in `bloco_claude_md`, with the markers `<!-- ai-ecosystem:start -->` and `<!-- ai-ecosystem:end -->` already in it, and `claude_md` says whether the file exists (`existe`), where it is (`caminho`), whether it already has the block (`tem_bloco`) and what the user already allowed (`permissao`: `permitido`, `criar` or `recusado`).

- If `permissao` is `permitido` or `criar`, update the block without asking again and tell the user in one line. If it is `recusado`, do not touch the file. If no permission is recorded, ask once with `AskUserQuestion`.
- **Existing file:** read the whole file. If it already has the markers, replace only the part between them (markers included) with `bloco_claude_md`. If it does not, append the block at the end of the file, after a blank line. The rest of the file is not touched, not even a space.
- **Missing file:** create it only if the user allowed it (`criar`). The new file holds just the block.
- Use the file reading and editing tools (Read and Edit, or Write for the new file), not a vault search.
