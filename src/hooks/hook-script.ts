// Text of the Claude Code hook script, embedded in the bundle. The plugin writes it to
// <vault>/.claude/ai-ecosystem/hooks/ on load.
import source from "./script/ai-ecosystem-hook.mjs?raw";

export const HOOK_SCRIPT_SOURCE: string = source;
