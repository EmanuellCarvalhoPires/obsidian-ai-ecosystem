import { describe, expect, it } from "vitest";
import { collectDeclaredScripts, extractDeclaredScript } from "../../src/core/declared-scripts";

describe("extractDeclaredScript", () => {
  it("accepts the tag in the frontmatter list, with or without #", () => {
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: "Scripts/a.py" }, [])).toBe("Scripts/a.py");
    expect(extractDeclaredScript({ tags: ["#mcp/script", "other"], script: "Scripts/a.py" }, [])).toBe("Scripts/a.py");
  });

  it("accepts the tag as an inline tag", () => {
    expect(extractDeclaredScript({ script: "Scripts/a.py" }, ["#mcp/script"])).toBe("Scripts/a.py");
    expect(extractDeclaredScript({ script: "Scripts/a.py" }, ["mcp/script"])).toBe("Scripts/a.py");
  });

  it("accepts a string tags property and the tag key", () => {
    expect(extractDeclaredScript({ tags: "a, mcp/script b", script: "x.js" }, [])).toBe("x.js");
    expect(extractDeclaredScript({ tag: "mcp/script", script: "x.js" }, [])).toBe("x.js");
  });

  it("is case-insensitive about the tag", () => {
    expect(extractDeclaredScript({ tags: ["MCP/Script"], script: "x.js" }, [])).toBe("x.js");
  });

  it("returns undefined without the tag, the property, or with bad values", () => {
    expect(extractDeclaredScript({ script: "x.js" }, [])).toBeUndefined();
    expect(extractDeclaredScript({ tags: ["mcp/tool"], script: "x.js" }, [])).toBeUndefined();
    expect(extractDeclaredScript({ tags: ["mcp/script/extra"], script: "x.js" }, [])).toBeUndefined();
    expect(extractDeclaredScript({ tags: ["mcp/script"] }, [])).toBeUndefined();
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: 5 }, [])).toBeUndefined();
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: "  " }, [])).toBeUndefined();
    expect(extractDeclaredScript(undefined, ["mcp/script"])).toBeUndefined();
    expect(extractDeclaredScript(null, ["mcp/script"])).toBeUndefined();
    expect(extractDeclaredScript([], ["mcp/script"])).toBeUndefined();
  });

  it("normalizes the path and refuses paths that leave the vault", () => {
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: ".\\Scripts\\a.py" }, [])).toBe("Scripts/a.py");
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: "/Scripts/a.py" }, [])).toBe("Scripts/a.py");
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: "../a.py" }, [])).toBeUndefined();
    expect(extractDeclaredScript({ tags: ["mcp/script"], script: "C:/a.py" }, [])).toBeUndefined();
  });
});

describe("collectDeclaredScripts", () => {
  it("reads the metadata cache of every markdown file", () => {
    const caches: Record<string, unknown> = {
      "a.md": { frontmatter: { tags: ["mcp/script"], script: "Scripts/b.py" } },
      "b.md": { frontmatter: { script: "Scripts/a.py" }, tags: [{ tag: "#mcp/script" }] },
      "c.md": { frontmatter: { script: "Scripts/c.py" } },
      "d.md": {},
      "e.md": null,
      "f.md": { frontmatter: { tags: ["mcp/script"], script: "Scripts/b.py" } },
    };
    const app = {
      vault: { getMarkdownFiles: () => Object.keys(caches).map((path) => ({ path })) },
      metadataCache: { getFileCache: (file: { path: string }) => caches[file.path] },
    };
    expect(collectDeclaredScripts(app as never)).toEqual(["Scripts/a.py", "Scripts/b.py"]);
  });
});
