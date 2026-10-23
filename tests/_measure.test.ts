import { it } from "vitest";
import { createBuiltinModule } from "../src/core/builtin-module";
import { ScriptEngine } from "../src/runner/script-engine";
import { startRig, rpc, stopRigs } from "./setup/helpers";
import { makeVault, nodeDetector, recordingSink, redactTopSecret, settings, writeFile, removeVault } from "./runner/helpers";
import type { ModuleInfo } from "../src/types";

const ctx = { client: { id: "c1", name: "Claude Code" }, moduleId: "ai-ecosystem" };
const size = (v: unknown) => JSON.stringify(v).length;

it("measure", async () => {
  const out: Record<string, unknown> = {};
  // item 1
  const vault = makeVault();
  const rec = recordingSink();
  const cur = settings();
  const engine = new ScriptEngine({ vaultBasePath: vault, getSettings: () => cur, getDeclaredScripts: () => [], getSecrets: () => undefined, redact: redactTopSecret, activity: rec.sink, isRegisteredModule: () => true, detector: nodeDetector() });
  const deps = { engine, vaultBasePath: vault, getSettings: () => cur, getDeclaredScripts: () => [] as string[] };
  const mod = createBuiltinModule({ version: "1", getServerStatus: () => ({ running: true, port: 1, usingAlternativePort: false }), listModules: () => modules, listServices: () => [], scripts: deps });
  writeFile(vault, "Scripts/small.js", `console.log("done: 3 files")`);
  writeFile(vault, "Scripts/mid.js", `for(let i=0;i<150;i++)console.log("line "+i+" some output text here ok")`);
  writeFile(vault, "Scripts/big.js", `process.stdout.write("a".repeat(30000)+"END")`);
  const run = mod.tools!.find((t) => t.name === "ecosystem_run_script")!;
  for (const s of ["small", "mid", "big"]) {
    const r = await run.handler({ path: `Scripts/${s}.js` }, ctx as any);
    out[`run_${s}`] = { bytes_total: size(r), text: (r.content[0] as any).text.length, structured: size(r.structuredContent) };
  }
  removeVault(vault);
  // item 2
  const st = mod.tools!.find((t) => t.name === "ecosystem_status")!;
  const sr = await st.handler({}, ctx as any);
  out.status = { bytes_total: size(sr), text: (sr.content[0] as any).text.length, structured: size(sr.structuredContent) };
  // items 4/5 : tools/list
  const rig = await startRig();
  const listed = await rpc(rig, "tools/list");
  const tools = listed.json.result.tools as Array<{ name: string }>;
  out.tools_list_total = size(tools);
  out.per_tool = Object.fromEntries(tools.map((t) => [t.name, size(t)]));
  await stopRigs();
  console.log("MEASURE " + JSON.stringify(out, null, 1));
});

const modules: ModuleInfo[] = Array.from({ length: 8 }, (_, i) => ({
  id: `module-${i}`, name: `Module ${i}`, version: "1.2.3", apiVersion: 1, registeredAt: 1, routeCount: 3, legacyAliasPaths: [],
  toolNames: Array.from({ length: 12 }, (_, j) => `module_${i}_tool_number_${j}`), promptNames: [], warnings: [],
}));
