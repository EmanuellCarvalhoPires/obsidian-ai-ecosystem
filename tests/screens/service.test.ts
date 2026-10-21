import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenService } from "../../src/screens/service";
import { createScreenTools } from "../../src/screens/tools";
import { ctx, makeRig, passwordDefinition, removeDir, resultJson, resultText, sampleDefinition, seed, fakeSecrets } from "./helpers";
import type { Rig } from "./helpers";

let rig: Rig;

beforeEach(() => {
  rig = makeRig();
});

afterEach(() => {
  vi.useRealTimers();
  rig.service.dispose();
  removeDir(rig.dir);
});

const files = (): string[] => {
  try {
    return fs.readdirSync(path.join(rig.dir, "telas")).sort();
  } catch {
    return [];
  }
};

const toolNames = (): string[] => createScreenTools(rig.service).map((t) => t.name);

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("tela_criar", () => {
  it("opens the preview and saves nothing before the user approves", async () => {
    const pending = rig.service.create({ definicao: sampleDefinition() }, ctx());
    await flush();

    const preview = rig.host.last(rig.host.previews);
    expect(preview.input.mode).toBe("create");
    expect(preview.input.definition.slug).toBe("cadastro_cliente");
    expect(JSON.parse(preview.input.json)).toMatchObject({ slug: "cadastro_cliente", titulo: "Customer form" });
    expect(files()).toEqual([]);
    expect(rig.service.list()).toEqual([]);
    expect(toolNames()).not.toContain("tela_cadastro_cliente");
    expect(rig.changes).toBe(0);

    preview.settle("aprovado");
    const result = await pending;
    expect(resultJson(result)).toEqual({ status: "aprovado", slug: "cadastro_cliente", tool: "tela_cadastro_cliente" });
  });

  it("registers the tool tela_<slug> and writes the file once approved", async () => {
    rig.host.autoPreview = "aprovado";
    await rig.service.create({ definicao: sampleDefinition() }, ctx());

    expect(files()).toEqual(["cadastro_cliente.json"]);
    expect(rig.changes).toBe(1);
    expect(toolNames()).toEqual(["tela_criar", "tela_listar", "tela_editar", "tela_remover", "tela_cadastro_cliente"]);
    expect(rig.service.get("cadastro_cliente")?.campos).toHaveLength(2);
  });

  it("saves nothing and registers nothing when the user rejects", async () => {
    rig.host.autoPreview = "recusado";
    const result = await rig.service.create({ definicao: sampleDefinition() }, ctx());

    expect(resultJson(result)).toEqual({ status: "recusado", slug: "cadastro_cliente" });
    expect(files()).toEqual([]);
    expect(rig.changes).toBe(0);
    expect(toolNames()).not.toContain("tela_cadastro_cliente");
  });

  it("closes the preview and answers expirado after 5 minutes", async () => {
    vi.useFakeTimers();
    const pending = rig.service.create({ definicao: sampleDefinition() }, ctx());
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    const preview = rig.host.last(rig.host.previews);
    expect(preview.closed).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(resultJson(await pending)).toEqual({ status: "expirado", slug: "cadastro_cliente" });
    expect(preview.closed).toBe(true);
    expect(files()).toEqual([]);
  });

  it("closes the preview and answers cancelado when the call is cancelled", async () => {
    const controller = new AbortController();
    const pending = rig.service.create({ definicao: sampleDefinition() }, ctx(controller.signal));
    await flush();
    const preview = rig.host.last(rig.host.previews);

    controller.abort();
    expect(resultJson(await pending).status).toBe("cancelado");
    expect(preview.closed).toBe(true);
    expect(files()).toEqual([]);
  });

  it("does not open a window for a call that was cancelled already", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await rig.service.create({ definicao: sampleDefinition() }, ctx(controller.signal));
    expect(resultJson(result).status).toBe("cancelado");
    expect(rig.host.previews).toHaveLength(0);
  });

  it("treats closing the preview without a decision as a rejection", async () => {
    const pending = rig.service.create({ definicao: sampleDefinition() }, ctx());
    await flush();
    rig.host.last(rig.host.previews).settle("recusado");
    expect(resultJson(await pending).status).toBe("recusado");
  });

  it("refuses a slug that is not valid, listing every problem", async () => {
    const result = await rig.service.create({ definicao: sampleDefinition({ slug: "Cadastro Cliente", titulo: "" }) }, ctx());
    expect(result.isError).toBe(true);
    const text = resultText(result);
    expect(text).toContain("slug must match");
    expect(text).toContain("titulo is required");
    expect(rig.host.previews).toHaveLength(0);
  });

  it("refuses the slugs of the infrastructure tools", async () => {
    const result = await rig.service.create({ definicao: sampleDefinition({ slug: "criar" }) }, ctx());
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("reserved");
  });

  it("refuses a slug that already exists and points to tela_editar", async () => {
    seed(rig, sampleDefinition());
    const result = await rig.service.create({ definicao: sampleDefinition() }, ctx());
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("tela_editar");
    expect(rig.host.previews).toHaveLength(0);
  });

  it("refuses to go over the limit of screens, saying why, without opening a window", async () => {
    for (let i = 0; i < 30; i++) rig.store.save(sampleDefinition({ slug: `tela_${i}` }) as never);
    rig.service.load();
    expect(rig.service.list()).toHaveLength(30);

    const result = await rig.service.create({ definicao: sampleDefinition({ slug: "uma_a_mais" }) }, ctx());
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("limit of 30");
    expect(rig.host.previews).toHaveLength(0);
    expect(rig.service.get("uma_a_mais")).toBeUndefined();
  });

  it("follows the limit from the settings", async () => {
    rig.limit = 1;
    rig.host.autoPreview = "aprovado";
    expect(resultJson(await rig.service.create({ definicao: sampleDefinition({ slug: "a" }) }, ctx())).status).toBe("aprovado");
    const second = await rig.service.create({ definicao: sampleDefinition({ slug: "b" }) }, ctx());
    expect(second.isError).toBe(true);
    expect(resultText(second)).toContain("limit of 1");
  });

  it("checks the limit again when the user approves", async () => {
    rig.limit = 1;
    const first = rig.service.create({ definicao: sampleDefinition({ slug: "a" }) }, ctx());
    const second = rig.service.create({ definicao: sampleDefinition({ slug: "b" }) }, ctx());
    await flush();
    expect(rig.host.previews).toHaveLength(2);
    rig.host.previews[0]?.settle("aprovado");
    await first;
    rig.host.previews[1]?.settle("aprovado");
    const result = await second;
    expect(result.isError).toBe(true);
    expect(rig.service.list().map((d) => d.slug)).toEqual(["a"]);
  });

  it("accepts the definition as JSON text and rejects unknown arguments", async () => {
    rig.host.autoPreview = "aprovado";
    const ok = await rig.service.create({ definicao: JSON.stringify(sampleDefinition()) }, ctx());
    expect(resultJson(ok).status).toBe("aprovado");
    const bad = await rig.service.create({ definicao: sampleDefinition({ slug: "x" }), extra: 1 }, ctx());
    expect(bad.isError).toBe(true);
    expect(resultText(bad)).toContain("extra");
  });

  it("returns an error, not a second window, for a concurrent review of the same screen", async () => {
    const first = rig.service.create({ definicao: sampleDefinition() }, ctx());
    await flush();
    const second = await rig.service.create({ definicao: sampleDefinition() }, ctx());
    expect(second.isError).toBe(true);
    expect(resultText(second)).toContain("already open");
    expect(rig.host.previews).toHaveLength(1);
    rig.host.previews[0]?.settle("recusado");
    await first;
  });
});

describe("tela_editar and tela_remover", () => {
  beforeEach(() => seed(rig, sampleDefinition()));

  it("shows the new version next to the saved one and replaces it only on approval", async () => {
    const changed = sampleDefinition({ titulo: "Customer form v2" });
    const pending = rig.service.edit({ slug: "cadastro_cliente", definicao: changed }, ctx());
    await flush();
    const preview = rig.host.last(rig.host.previews);
    expect(preview.input.mode).toBe("edit");
    expect(preview.input.previous?.titulo).toBe("Customer form");
    expect(rig.service.get("cadastro_cliente")?.titulo).toBe("Customer form");

    preview.settle("aprovado");
    expect(resultJson(await pending).status).toBe("aprovado");
    expect(rig.service.get("cadastro_cliente")?.titulo).toBe("Customer form v2");
    expect(JSON.parse(fs.readFileSync(path.join(rig.dir, "telas", "cadastro_cliente.json"), "utf8")).titulo).toBe("Customer form v2");
    expect(rig.changes).toBe(1);
  });

  it("keeps the saved screen when the edit is rejected", async () => {
    rig.host.autoPreview = "recusado";
    await rig.service.edit({ slug: "cadastro_cliente", definicao: sampleDefinition({ titulo: "Other" }) }, ctx());
    expect(rig.service.get("cadastro_cliente")?.titulo).toBe("Customer form");
    expect(rig.changes).toBe(0);
  });

  it("does not let the slug change and reports an unknown slug", async () => {
    const renamed = await rig.service.edit({ slug: "cadastro_cliente", definicao: sampleDefinition({ slug: "outro" }) }, ctx());
    expect(renamed.isError).toBe(true);
    expect(resultText(renamed)).toContain("cannot change");
    const unknown = await rig.service.edit({ slug: "nao_existe", definicao: sampleDefinition() }, ctx());
    expect(unknown.isError).toBe(true);
    expect(resultText(unknown)).toContain("tela_listar");
  });

  it("fills in the slug when the definition leaves it out", async () => {
    rig.host.autoPreview = "aprovado";
    const { slug: _slug, ...withoutSlug } = sampleDefinition({ titulo: "No slug" });
    expect(resultJson(await rig.service.edit({ slug: "cadastro_cliente", definicao: withoutSlug }, ctx())).status).toBe("aprovado");
    expect(rig.service.get("cadastro_cliente")?.titulo).toBe("No slug");
  });

  it("removes the screen, its file and its tool only on approval", async () => {
    const pending = rig.service.remove({ slug: "cadastro_cliente" }, ctx());
    await flush();
    expect(rig.host.last(rig.host.previews).input.mode).toBe("remove");
    expect(files()).toEqual(["cadastro_cliente.json"]);

    rig.host.last(rig.host.previews).settle("aprovado");
    expect(resultJson(await pending)).toMatchObject({ status: "aprovado", removida: true });
    expect(files()).toEqual([]);
    expect(toolNames()).not.toContain("tela_cadastro_cliente");
  });

  it("keeps the screen when the removal is rejected or expires", async () => {
    rig.host.autoPreview = "recusado";
    await rig.service.remove({ slug: "cadastro_cliente" }, ctx());
    expect(files()).toEqual(["cadastro_cliente.json"]);

    vi.useFakeTimers();
    rig.host.autoPreview = undefined;
    const pending = rig.service.remove({ slug: "cadastro_cliente" }, ctx());
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    expect(resultJson(await pending).status).toBe("expirado");
    expect(files()).toEqual(["cadastro_cliente.json"]);
  });

  it("lists the saved screens with their fields and the limit", () => {
    const body = resultJson(rig.service.listTool());
    expect(body.limite).toBe(30);
    expect(body.total).toBe(1);
    expect(body.telas).toEqual([
      {
        slug: "cadastro_cliente",
        tool: "tela_cadastro_cliente",
        titulo: "Customer form",
        descricao: "Collects the customer data.",
        campos: [
          { id: "nome", tipo: "texto", rotulo: "Name", obrigatorio: true },
          { id: "idade", tipo: "inteiro", rotulo: "Age" },
        ],
      },
    ]);
  });

  it("removes a screen the user chose to remove in the settings", () => {
    expect(rig.service.removeSaved("cadastro_cliente")).toBe(true);
    expect(rig.service.removeSaved("cadastro_cliente")).toBe(false);
    expect(files()).toEqual([]);
    expect(rig.changes).toBe(1);
  });
});

describe("tela_<slug>", () => {
  beforeEach(() => seed(rig, sampleDefinition()));

  it("describes the screen and its fields to the agent", () => {
    const tool = createScreenTools(rig.service).find((t) => t.name === "tela_cadastro_cliente");
    expect(tool?.description).toContain("Customer form");
    expect(tool?.description).toContain("Collects the customer data.");
    expect(tool?.description).toContain("- nome (texto, required): Name.");
    expect(tool?.description).toContain("- idade (inteiro): Age.");
    expect(tool?.inputSchema).toMatchObject({ additionalProperties: false, properties: { contexto: { type: "string" }, valores_iniciais: { type: "object" } } });
  });

  it("returns confirmado with the values the user filled in", async () => {
    const pending = rig.service.call("cadastro_cliente", { contexto: "Need the customer", valores_iniciais: { nome: "Ana" } }, ctx());
    await flush();
    const screen = rig.host.last(rig.host.screens);
    expect(screen.input.context).toBe("Need the customer");
    expect(screen.input.initialValues).toEqual({ nome: "Ana" });

    const outcome = await rig.host.confirm(screen, { nome: "Ana Souza", idade: "41" });
    expect(outcome.ok).toBe(true);
    const result = await pending;
    expect(result.isError).toBeUndefined();
    expect(resultJson(result)).toEqual({ status: "confirmado", valores: { nome: "Ana Souza", idade: 41 }, secretos: {} });
    expect(result.structuredContent).toEqual(resultJson(result));
  });

  it("keeps the window open and lists what is wrong when the values do not pass", async () => {
    const pending = rig.service.call("cadastro_cliente", {}, ctx());
    await flush();
    const screen = rig.host.last(rig.host.screens);

    const refused = await rig.host.confirm(screen, { nome: "A", idade: "200" });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? {} : refused.errors).toMatchObject({ nome: { code: "too_short" }, idade: { code: "above_max" } });
    expect((await rig.host.confirm(screen, { nome: "", idade: "" })).ok).toBe(false);

    await rig.host.confirm(screen, { nome: "Ana", idade: "" });
    expect(resultJson(await pending).valores).toEqual({ nome: "Ana", idade: null });
  });

  it("answers expirado after 5 minutes and closes the window", async () => {
    vi.useFakeTimers();
    const pending = rig.service.call("cadastro_cliente", {}, ctx());
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const result = await pending;
    expect(resultJson(result)).toEqual({ status: "expirado", valores: {}, secretos: {} });
    expect(rig.host.last(rig.host.screens).closed).toBe(true);
  });

  it("refuses an answer that arrives after the screen expired", async () => {
    vi.useFakeTimers();
    const pending = rig.service.call("cadastro_cliente", {}, ctx());
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    await pending;
    const late = await rig.host.last(rig.host.screens).input.submit({ nome: "Ana" }, {});
    expect(late).toEqual({ ok: false, form: { code: "expired" } });
  });

  it("closes the window and answers cancelado when the call is cancelled", async () => {
    const controller = new AbortController();
    const pending = rig.service.call("cadastro_cliente", {}, ctx(controller.signal));
    await flush();
    controller.abort();
    expect(resultJson(await pending)).toEqual({ status: "cancelado", valores: {}, secretos: {} });
    expect(rig.host.last(rig.host.screens).closed).toBe(true);
  });

  it("answers cancelado when the user closes the window", async () => {
    const pending = rig.service.call("cadastro_cliente", {}, ctx());
    await flush();
    rig.host.last(rig.host.screens).settle({ kind: "closed" });
    expect(resultJson(await pending).status).toBe("cancelado");
  });

  it("closes open windows when the service is disposed", async () => {
    const pending = rig.service.call("cadastro_cliente", {}, ctx());
    await flush();
    rig.service.dispose();
    expect(resultJson(await pending).status).toBe("cancelado");
    expect(rig.host.last(rig.host.screens).closed).toBe(true);
  });

  it("returns an error for a second call while the screen is open", async () => {
    const first = rig.service.call("cadastro_cliente", {}, ctx());
    await flush();
    const second = await rig.service.call("cadastro_cliente", {}, ctx());
    expect(second.isError).toBe(true);
    expect(resultText(second)).toContain("already open");
    expect(rig.host.screens).toHaveLength(1);
    rig.host.last(rig.host.screens).settle({ kind: "closed" });
    await first;
    // Once the first one ended the screen can be called again.
    rig.host.autoFill = { values: { nome: "Bia" } };
    expect(resultJson(await rig.service.call("cadastro_cliente", {}, ctx())).status).toBe("confirmado");
  });

  it("rejects bad arguments before opening a window", async () => {
    for (const args of [{ contexto: 5 }, { contexto: "x".repeat(2001) }, { qualquer: 1 }, { valores_iniciais: [] }, { valores_iniciais: { nao_existe: 1 } }, { valores_iniciais: { idade: "abc" } }]) {
      const result = await rig.service.call("cadastro_cliente", args, ctx());
      expect(result.isError, JSON.stringify(args)).toBe(true);
    }
    expect(rig.host.screens).toHaveLength(0);
  });

  it("reports a screen that no longer exists", async () => {
    const result = await rig.service.call("nao_existe", {}, ctx());
    expect(result.isError).toBe(true);
  });
});

describe("button fields", () => {
  it("returns the id of the clicked acao button in valores.acao", async () => {
    seed(rig, {
      slug: "escolha",
      titulo: "Choice",
      campos: [
        { id: "motivo", tipo: "texto", rotulo: "Reason" },
        { id: "gerar", tipo: "acao", rotulo: "Generate" },
        { id: "pular", tipo: "acao", rotulo: "Skip" },
      ],
    });
    const pending = rig.service.call("escolha", {}, ctx());
    await flush();
    await rig.host.confirm(rig.host.last(rig.host.screens), { motivo: "teste" }, { action: "pular" });
    expect(resultJson(await pending).valores).toEqual({ motivo: "teste", acao: "pular" });
  });

  it("returns aprovado or recusado and lets a rejection skip the required fields", async () => {
    seed(rig, {
      slug: "aprova",
      titulo: "Approval",
      campos: [
        { id: "nota", tipo: "texto_longo", rotulo: "Note", obrigatorio: true },
        { id: "decisao", tipo: "aprovacao", rotulo: "Approve the change?" },
      ],
    });
    const pending = rig.service.call("aprova", {}, ctx());
    await flush();
    const screen = rig.host.last(rig.host.screens);
    expect((await rig.host.confirm(screen, { decisao: "aprovado" })).ok).toBe(false);
    expect((await rig.host.confirm(screen, { decisao: "recusado" }, { skipRequired: true })).ok).toBe(true);
    expect(resultJson(await pending).valores).toEqual({ nota: null, decisao: "recusado" });
  });
});

describe("password fields", () => {
  const secretValue = "S3cr3t-Token-Value";

  beforeEach(() => seed(rig, passwordDefinition()));

  it("stores the value in Environment Keys and never returns it", async () => {
    const pending = rig.service.call("token_api", {}, ctx());
    await flush();
    const outcome = await rig.host.confirm(rig.host.last(rig.host.screens), { servico: "github", token: secretValue });
    expect(outcome.ok).toBe(true);

    expect(rig.secrets?.created).toEqual([
      { name: "API_TOKEN", kind: "senha", value: secretValue, description: "Token of the service", createdBy: "ai-ecosystem" },
    ]);
    const result = await pending;
    expect(resultJson(result)).toEqual({ status: "confirmado", valores: { servico: "github" }, secretos: { token: "preenchido" } });
    expect(JSON.stringify(result)).not.toContain(secretValue);
  });

  it("does not create anything when the value is empty and the field is optional", async () => {
    seed(rig, { ...passwordDefinition(), slug: "opcional", campos: [{ id: "token", tipo: "senha", rotulo: "Token", destino_nome: "OTHER_TOKEN" }] });
    const pending = rig.service.call("opcional", {}, ctx());
    await flush();
    await rig.host.confirm(rig.host.last(rig.host.screens), { token: "" });
    expect(resultJson(await pending)).toEqual({ status: "confirmado", valores: {}, secretos: {} });
    expect(rig.secrets?.created).toEqual([]);
  });

  it("blocks the password with the reason when Environment Keys is missing, locked or the name is taken", async () => {
    const pending = rig.service.call("token_api", {}, ctx());
    await flush();
    const screen = rig.host.last(rig.host.screens);
    const field = screen.input.definition.campos[1]!;
    expect(screen.input.secretIssue(field)).toBeUndefined();

    rig.secrets!.locked = true;
    expect(screen.input.secretIssue(field)).toEqual({ code: "secret_locked" });
    expect(await rig.host.confirm(screen, { token: secretValue })).toMatchObject({ ok: false, errors: { token: { code: "secret_locked" } } });

    rig.secrets!.locked = false;
    rig.secrets!.names.add("API_TOKEN");
    expect(screen.input.secretIssue(field)).toEqual({ code: "secret_exists", params: { name: "API_TOKEN" } });
    expect(await rig.host.confirm(screen, { token: secretValue })).toMatchObject({ ok: false, errors: { token: { code: "secret_exists" } } });

    rig.secrets = undefined;
    expect(screen.input.secretIssue(field)).toEqual({ code: "secret_unavailable" });
    expect(await rig.host.confirm(screen, { token: secretValue })).toMatchObject({ ok: false, errors: { token: { code: "secret_unavailable" } } });
    expect(rig.secrets).toBeUndefined();

    screen.settle({ kind: "closed" });
    await pending;
  });

  it("treats an Environment Keys without the new methods as unavailable", async () => {
    const old = fakeSecrets();
    delete old.createValue;
    rig.secrets = old;
    const pending = rig.service.call("token_api", {}, ctx());
    await flush();
    const screen = rig.host.last(rig.host.screens);
    expect(screen.input.secretIssue(screen.input.definition.campos[1]!)).toEqual({ code: "secret_unavailable" });
    screen.settle({ kind: "closed" });
    await pending;
  });

  it("reports a refusal of createValue under the field, keeps the window open and tells the reason", async () => {
    const pending = rig.service.call("token_api", {}, ctx());
    await flush();
    const screen = rig.host.last(rig.host.screens);
    rig.secrets!.failWith = "invalid_name";
    expect(await rig.host.confirm(screen, { token: secretValue })).toMatchObject({ ok: false, errors: { token: { code: "secret_failed", params: { name: "API_TOKEN", reason: "invalid_name" } } } });
    rig.secrets!.failWith = undefined;
    expect((await rig.host.confirm(screen, { token: secretValue })).ok).toBe(true);
    expect(resultJson(await pending).secretos).toEqual({ token: "preenchido" });
  });

  it("rejects valores_iniciais for a password field, without echoing the value", async () => {
    const result = await rig.service.call("token_api", { valores_iniciais: { token: secretValue } }, ctx());
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("password fields cannot be pre-filled");
    expect(JSON.stringify(result)).not.toContain(secretValue);
    expect(rig.host.screens).toHaveLength(0);
  });

  it("refuses a default value on a password field in the definition", async () => {
    const result = await rig.service.create(
      { definicao: { slug: "x", titulo: "X", campos: [{ id: "s", tipo: "senha", rotulo: "S", destino_nome: "S1", padrao: "abc" }] } },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain("padrao");
  });
});

describe("persistence", () => {
  it("registers every saved screen again after a reload", async () => {
    rig.host.autoPreview = "aprovado";
    await rig.service.create({ definicao: sampleDefinition({ slug: "a" }) }, ctx());
    await rig.service.create({ definicao: sampleDefinition({ slug: "b" }) }, ctx());
    expect(files()).toEqual(["a.json", "b.json"]);

    const reloaded = new ScreenService({ store: rig.store, host: rig.host, getLimit: () => 30, getSecrets: () => undefined, onChange: () => undefined });
    expect(reloaded.load()).toEqual([]);
    expect(createScreenTools(reloaded).map((t) => t.name)).toEqual(["tela_criar", "tela_listar", "tela_editar", "tela_remover", "tela_a", "tela_b"]);
  });

  it("skips files that are not valid and reports them", () => {
    const dir = path.join(rig.dir, "telas");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "ok.json"), JSON.stringify(sampleDefinition({ slug: "ok" })));
    fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");
    fs.writeFileSync(path.join(dir, "wrong_name.json"), JSON.stringify(sampleDefinition({ slug: "other" })));
    fs.writeFileSync(path.join(dir, "invalid.json"), JSON.stringify({ slug: "invalid", titulo: "x", campos: [] }));
    const problems = rig.service.load();
    expect(rig.service.list().map((d) => d.slug)).toEqual(["ok"]);
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toContain("does not match the slug");
  });

  it("writes through a temporary file and leaves none behind", () => {
    rig.store.save(sampleDefinition() as never);
    expect(files()).toEqual(["cadastro_cliente.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(rig.dir, "telas", "cadastro_cliente.json"), "utf8")).slug).toBe("cadastro_cliente");
  });
});

describe("without Environment Keys", () => {
  it("still previews and saves screens", async () => {
    const bare = makeRig({ secrets: null });
    bare.host.autoPreview = "aprovado";
    const result = await bare.service.create({ definicao: sampleDefinition() }, ctx());
    expect(resultJson(result).status).toBe("aprovado");
    bare.service.dispose();
    removeDir(bare.dir);
  });
});
