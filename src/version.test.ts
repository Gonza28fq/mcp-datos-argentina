import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_AGENT, VERSION } from "./version.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

describe("versión", () => {
  it("sale de package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("el User-Agent identifica versión y repo", () => {
    expect(USER_AGENT).toBe(`mcp-datos-argentina/${pkg.version} (+https://github.com/Gonza28fq/mcp-datos-argentina)`);
  });

  it("server.json está sincronizado con package.json", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].identifier).toBe(pkg.name);
    expect(server.packages[0].version).toBe(pkg.version);
  });
});
