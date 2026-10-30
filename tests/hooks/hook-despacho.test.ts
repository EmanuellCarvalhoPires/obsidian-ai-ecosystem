// The despacho entry: one process that runs the protection of every module, with the same decisions
// as each module's own protection hook.
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOOK_SCRIPT_SOURCE } from "../../src/hooks/hook-script";
import { CORE_SPECS, DISPATCH_MATCHER, DISPATCH_SPEC, buildCommand, parseCommand, protectionModuleIds, protectionSpec } from "../../src/hooks/hook-specs";
import { HookWorld } from "./helpers";

let world: HookWorld;
beforeEach(() => {
  world = new HookWorld();
});
afterEach(() => world.cleanup());

const DISPATCH = "ai-ecosystem";
const SEARCH = "ai-vault-search";
const ENV_KEYS = "environment-variables";
const SCRIPTS = "ai-scripts";
const TEMPLATES = "ai-templates";
const GIT = "ai-git-tools";

/** One call through the despacho entry. */
function despacho(toolName: string, toolInput: Record<string, unknown>) {
  return world.run(DISPATCH, "despacho", { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput });
}

describe("hook specs: despacho", () => {
  it("has one PreToolUse entry whose matcher covers every tool the protection hooks look at", () => {
    expect(DISPATCH_MATCHER).toBe("Grep|Glob|Bash|PowerShell|Write");
    expect(DISPATCH_SPEC).toEqual({ module: "ai-ecosystem", type: "despacho", event: "PreToolUse", matcher: "Grep|Glob|Bash|PowerShell|Write" });
  });

  it("its command parses back to the despacho type", () => {
    expect(parseCommand(buildCommand("/v", "ai-ecosystem", "despacho"))).toEqual({ module: "ai-ecosystem", type: "despacho" });
  });

  it("is not one of the core entries", () => {
    expect(CORE_SPECS.map((s) => s.type)).not.toContain("despacho");
  });

  it("the script table repeats the matcher of every protection module", () => {
    for (const id of protectionModuleIds()) {
      const matcher = protectionSpec(id)?.matcher;
      expect(HOOK_SCRIPT_SOURCE, id).toContain(`["${id}", "${matcher}"]`);
    }
  });
});

interface Scenario {
  name: string;
  module: string;
  setup: () => void;
  tool: string;
  input: () => Record<string, unknown>;
}

const scenarios: Scenario[] = [
  {
    name: "ai-vault-search denies a Grep in the vault",
    module: SEARCH,
    setup: () => world.module(SEARCH),
    tool: "Grep",
    input: () => ({ pattern: "acesso", path: world.abs("Knowledge") }),
  },
  {
    name: "environment-variables denies curl to a host that has a secret",
    module: ENV_KEYS,
    setup: () => {
      world.module(ENV_KEYS);
      world.hosts(["acme.atlassian.net"]);
    },
    tool: "Bash",
    input: () => ({ command: "curl -s https://acme.atlassian.net/rest/api/3/myself" }),
  },
  {
    name: "ai-scripts denies a script in an allowed folder",
    module: SCRIPTS,
    setup: () => {
      world.module(SCRIPTS);
      world.pastas({ scripts: ["scripts"] });
    },
    tool: "Bash",
    input: () => ({ command: "python scripts/x.py --flag" }),
  },
  {
    name: "ai-templates denies a new note that matches a template target",
    module: TEMPLATES,
    setup: () => {
      world.module(TEMPLATES);
      world.pastas({ templates: ["Knowledge/Logs/*.md"] });
    },
    tool: "Write",
    input: () => ({ file_path: world.abs("Knowledge", "Logs", "Novo log.md"), content: "x" }),
  },
  {
    name: "ai-git-tools warns on git status by default",
    module: GIT,
    setup: () => world.module(GIT),
    tool: "Bash",
    input: () => ({ command: "git status" }),
  },
  {
    name: "ai-git-tools denies git status in mode bloquear",
    module: GIT,
    setup: () => {
      world.module(GIT);
      world.config({ modos: { [GIT]: "bloquear" } });
    },
    tool: "Bash",
    input: () => ({ command: "git status" }),
  },
];

describe("despacho: each module decides as its own hook does", () => {
  for (const s of scenarios) {
    it(s.name, () => {
      s.setup();
      const own = world.tool(s.module, s.tool, s.input());
      expect(own.stdout).not.toBe("");
      // The lock of the own hook must not count toward the despacho call.
      world.json("bloqueios.json", {});
      const all = despacho(s.tool, s.input());
      expect(all.status).toBe(0);
      expect(all.decision).toBe(own.decision);
      expect(all.reason).toBe(own.reason);
      expect(all.context).toBe(own.context);
    });
  }
});

describe("despacho: combining the modules", () => {
  const COMMAND = "python scripts/x.py && git status";

  beforeEach(() => {
    world.pastas({ scripts: ["scripts"] });
  });

  it("a block of one module beats the warning of another on the same Bash call", () => {
    world.module(SCRIPTS);
    world.module(GIT);
    const own = world.tool(SCRIPTS, "Bash", { command: COMMAND });
    expect(own.decision).toBe("deny");
    world.json("bloqueios.json", {});

    const run = despacho("Bash", { command: COMMAND });
    expect(run.status).toBe(0);
    expect(run.decision).toBe("deny");
    expect(run.reason).toBe(own.reason);
    expect(run.reason).toContain("ecosystem_run_script");
    expect(run.reason).not.toContain("git_status");
  });

  it("two modules that only warn give one additionalContext with both messages on separate lines", () => {
    world.config({ modos: { [SCRIPTS]: "avisar" } });
    world.module(SCRIPTS);
    world.module(GIT);
    const scripts = world.tool(SCRIPTS, "Bash", { command: COMMAND });
    const git = world.tool(GIT, "Bash", { command: COMMAND });
    expect(scripts.decision).toBeUndefined();
    expect(git.decision).toBeUndefined();

    const run = despacho("Bash", { command: COMMAND });
    expect(run.status).toBe(0);
    expect(run.decision).toBeUndefined();
    expect(run.stdout).not.toContain("permissionDecision");
    expect(run.context).toBe([scripts.context, git.context].join("\n"));
    expect(run.context).toContain("ecosystem_run_script");
    expect(run.context).toContain("git_status");
  });

  it("skips a module whose hooks were removed (hooksRemovidos true in its state)", () => {
    world.module(GIT);
    world.json(`modules/${SCRIPTS}.json`, { estado: "configurado", origem: "catalogo", nome: SCRIPTS, respostas: {}, hooksRemovidos: true });
    const run = despacho("Bash", { command: COMMAND });
    expect(run.status).toBe(0);
    expect(run.decision).toBeUndefined();
    expect(run.context).toBe(world.tool(GIT, "Bash", { command: COMMAND }).context);

    world.json(`modules/${SCRIPTS}.json`, { estado: "configurado", origem: "catalogo", nome: SCRIPTS, respostas: {} });
    expect(despacho("Bash", { command: "python scripts/x.py" }).decision).toBe("deny");
  });

  it("skips a module that is not set up yet", () => {
    world.module(SCRIPTS, "pendente_configuracao");
    world.module(GIT);
    const run = despacho("Bash", { command: COMMAND });
    expect(run.status).toBe(0);
    expect(run.decision).toBeUndefined();
    expect(run.context).toBe(world.tool(GIT, "Bash", { command: COMMAND }).context);
    expect(run.context).not.toContain("ecosystem_run_script");
  });

  it("prints nothing for a tool that no protection hook covers", () => {
    world.module(SCRIPTS);
    world.module(GIT);
    world.module(SEARCH);
    expect(despacho("Read", { file_path: world.abs("a.md") }).stdout).toBe("");
  });

  it("prints nothing without the heartbeat of the core (and answers again with it)", () => {
    world.module(SEARCH);
    const grep = { pattern: "x", path: world.abs("Knowledge") };
    expect(despacho("Grep", grep).decision).toBe("deny");
    world.heartbeat(null);
    expect(despacho("Grep", grep).stdout).toBe("");
  });

  it("lets the 2nd identical attempt through with the reminder, like the separate hooks", () => {
    world.module(SCRIPTS);
    const call = () => despacho("Bash", { command: "python scripts/x.py" });
    expect(call().decision).toBe("deny");
    const second = call();
    expect(second.decision).toBeUndefined();
    expect(second.stdout).not.toContain("permissionDecision");
    expect(second.context).toContain("Liberado pela trava de repetição (2ª tentativa");
    expect(call().decision).toBe("deny");
  });

  it("exits 0 with no output when the input is not JSON", () => {
    world.module(SCRIPTS);
    const result = spawnSync(process.execPath, [world.script, DISPATCH, "despacho"], { input: "garbage", encoding: "utf8", timeout: 15000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});
