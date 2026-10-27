// The three setup tools of the core (always registered, never hidden): ecosystem_setup_status,
// ecosystem_setup_save and ecosystem_setup_complete. The setup skills call them. Pure Node.
import type { HubTool, HubToolResult } from "../types";
import type { SetupManager } from "./setup-manager";

export const SETUP_TOOL_NAMES = ["ecosystem_setup_status", "ecosystem_setup_save", "ecosystem_setup_complete"] as const;

function json(value: Record<string, unknown>, isError = false): HubToolResult {
  const result: HubToolResult = { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
  if (isError) result.isError = true;
  return result;
}

function failure(error: string, faltando?: string[]): HubToolResult {
  return json({ ok: false, erro: error, ...(faltando ? { faltando } : {}) }, true);
}

function moduleArg(args: Record<string, unknown>): string | undefined {
  return typeof args.modulo === "string" && args.modulo.trim() !== "" ? args.modulo.trim() : undefined;
}

/** A batch of answers as { key: value }, from 1 to 20 answers. Undefined when the value is not one. */
function batchArg(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const count = Object.keys(value).length;
  return count >= 1 && count <= 20 ? (value as Record<string, unknown>) : undefined;
}

export function createSetupTools(setup: SetupManager): HubTool[] {
  const status: HubTool = {
    name: "ecosystem_setup_status",
    title: "Setup status of a module",
    description:
      "Guided setup of an AI Ecosystem module. Returns what the plugin detected (detectado), the answers already saved (respostas), " +
      "the questions with the flags ja_respondida and detectada (ask only the ones that are neither), the prerequisites, the state of CLAUDE.md " +
      "and the generated usage guide block (bloco_claude_md). Used by the skills configurar-<module>. " +
      "For a module that is already configured the questions and the usage block are left out unless completo is true.",
    inputSchema: {
      type: "object",
      properties: {
        modulo: { type: "string", description: 'Module id, e.g. "ai-ecosystem", "ai-scripts" or "telegram-ai-gateway".' },
        completo: {
          type: "boolean",
          default: false,
          description: "Also return perguntas and bloco_claude_md for a module that is already configured (to change its answers). Default false.",
        },
      },
      required: ["modulo"],
      additionalProperties: false,
    },
    annotations: { title: "Setup status of a module", readOnlyHint: true, openWorldHint: false },
    handler: async (args) => {
      const modulo = moduleArg(args);
      if (!modulo) return failure("modulo is required.");
      const result = await setup.status(modulo, { completo: args.completo === true });
      return result.ok ? json({ ...result.status }) : failure(result.error);
    },
  };

  const save: HubTool = {
    name: "ecosystem_setup_save",
    title: "Save one setup answer",
    description:
      "Saves one answer of the guided setup of a module, after the user confirmed it. Never pass a token, password or any secret value: " +
      "secrets are created only through the screen of env_criar_secret. Core keys: agentes, arquivo_settings, modo_hooks, claude_md (module ai-ecosystem); " +
      "modo_hooks (bloquear, avisar or off) is accepted on any module; pastas_permitidas (ai-scripts) adds allowed script folders. Other keys go to the module. " +
      "Pass respostas to save several answers in one call.",
    inputSchema: {
      type: "object",
      properties: {
        modulo: { type: "string", description: "Module id." },
        chave: { type: "string", description: "Key of the answer, as listed in perguntas." },
        valor: { description: "The answer: a string, a boolean, a number or a list of strings." },
        respostas: {
          type: "object",
          description: "Several answers at once, as { key: value }. Use instead of chave and valor.",
          additionalProperties: true,
        },
      },
      required: ["modulo"],
      additionalProperties: false,
    },
    annotations: { title: "Save one setup answer", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const modulo = moduleArg(args);
      if (!modulo) return failure("modulo is required.");
      if (args.respostas !== undefined) {
        if ("chave" in args || "valor" in args) return failure("Give chave and valor, or respostas, not both.");
        const answers = batchArg(args.respostas);
        if (!answers) return failure("respostas must be an object with 1 to 20 answers.");
        // Answers are saved in order; one refused answer does not stop the others.
        const salvas: string[] = [];
        const recusadas: Record<string, string> = {};
        for (const [chave, valor] of Object.entries(answers)) {
          const result = await setup.save(modulo, chave, valor);
          if (result.ok) salvas.push(chave);
          else recusadas[chave] = result.error;
        }
        const refused = Object.keys(recusadas).length;
        return json({ ok: refused === 0, modulo, salvas, ...(refused > 0 ? { recusadas } : {}) }, refused > 0);
      }
      if (typeof args.chave !== "string") return failure("chave is required.");
      if (!("valor" in args)) return failure("valor is required.");
      const result = await setup.save(modulo, args.chave, args.valor);
      return result.ok ? json({ ok: true, modulo, chave: args.chave }) : failure(result.error);
    },
  };

  const complete: HubTool = {
    name: "ecosystem_setup_complete",
    title: "Finish the setup of a module",
    description:
      "Finishes the guided setup of a module: validates it (the module and its prerequisites), writes the marker, removes the temporary setup hook, " +
      "installs the protection hooks, shows the module's tools to Claude Code and updates GEMINI.md. Call it only after the user confirmed the summary and the answers were saved. " +
      "If something is missing it answers with the list (faltando).",
    inputSchema: {
      type: "object",
      properties: { modulo: { type: "string", description: "Module id." } },
      required: ["modulo"],
      additionalProperties: false,
    },
    annotations: { title: "Finish the setup of a module", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (args) => {
      const modulo = moduleArg(args);
      if (!modulo) return failure("modulo is required.");
      const result = await setup.complete(modulo);
      return result.ok ? json({ ok: true, ...result.resumo }) : failure(result.error, result.faltando);
    },
  };

  return [status, save, complete];
}
