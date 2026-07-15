/**
 * MCP Resource registration for skill-based resources, aligned with SEP-2640
 * (Skills Extension).
 *
 * URI Scheme:
 *   skill://<skill-path>/SKILL.md   -> Each skill's SKILL.md, registered as an
 *                                      individual top-level MCP resource so every
 *                                      skill appears as a peer in the client UI.
 *   skill://<skill-path>/<file>     -> Individual files inside a skill (readable
 *                                      via the URI template, not individually listed)
 *   skill://index.json              -> SEP-2640 discovery index (application/json)
 *
 * <skill-path> is computed by getSkillPath(): "<prefix>/<baseName>" for prefixed
 * skills (final segment always equals frontmatter `name`), or just "<baseName>"
 * for bundled skills with empty prefix.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  loadSkillContent,
  getResourceAnnotations,
  buildSkillResourceUri,
  parseSkillResourceUri,
  buildSkillIndex,
} from "./skill-discovery.js";
import { isPathWithinBase, listSkillFiles, MAX_FILE_SIZE, SkillState } from "./skill-tool.js";

/** URI scheme prefix for skill resources. */
const SCHEME = "skill://";

/**
 * Get MIME type based on file extension.
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".md": "text/markdown",
    ".ts": "text/typescript",
    ".js": "text/javascript",
    ".json": "application/json",
    ".yaml": "text/yaml",
    ".yml": "text/yaml",
    ".txt": "text/plain",
    ".sh": "text/x-shellscript",
    ".py": "text/x-python",
    ".css": "text/css",
    ".html": "text/html",
    ".xml": "application/xml",
  };
  return mimeTypes[ext] || "text/plain";
}

/**
 * Register skill resources with the MCP server.
 *
 * Registers the Skill Index and a read-only URI template for on-demand
 * reads. Individual skills are NOT enumerated via the template's list
 * callback — instead, call registerIndividualSkillResources() to expose
 * each skill as its own top-level MCP resource so they appear as peers
 * in the client UI rather than grouped under a single template node.
 */
export function registerSkillResources(
  server: McpServer,
  skillState: SkillState
): void {
  registerSkillIndexResource(server, skillState);
  registerSkillReadTemplate(server, skillState);
}

/**
 * Register every skill in skillState.skillMap as its own static MCP resource.
 *
 * Each skill gets a unique top-level entry in the client UI (e.g. the
 * resources panel in Claude Desktop) instead of being grouped under a single
 * template node. Call this once after the initial skillMap is populated, and
 * again whenever new skills are discovered at runtime.
 *
 * Only registers skills that have not already been registered (tracked by
 * the returned Set). Returns the set of registered skill names so callers
 * can avoid double-registration on incremental refreshes.
 */
export function registerIndividualSkillResources(
  server: McpServer,
  skillState: SkillState,
  alreadyRegistered: Set<string> = new Set()
): Set<string> {
  for (const skill of skillState.skillMap.values()) {
    if (alreadyRegistered.has(skill.name)) continue;

    const { annotations, size } = getResourceAnnotations(skill, 0.8);
    const uri = buildSkillResourceUri(skill, "SKILL.md");

    const resourceMeta: {
      mimeType: string;
      description: string;
      annotations: typeof annotations;
      size?: number;
    } = {
      mimeType: "text/markdown",
      description: skill.description,
      annotations,
    };
    if (size !== undefined) {
      resourceMeta.size = size;
    }

    server.registerResource(
      skill.baseName,
      uri,
      resourceMeta,
      async (resourceUri) => {
        const uriStr = resourceUri.toString();
        // Re-resolve from the live skillMap so reads always reflect the
        // current on-disk state even after a skillMap refresh.
        const parsed = parseSkillResourceUri(uriStr, skillState.skillMap);
        if (!parsed) {
          throw new Error(`Skill resource not found for URI: ${uriStr}`);
        }
        try {
          const content = loadSkillContent(parsed.skill.path);
          return {
            contents: [{ uri: uriStr, mimeType: "text/markdown", text: content }],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to load skill "${parsed.skill.baseName}": ${message}`);
        }
      }
    );

    alreadyRegistered.add(skill.name);
  }
  return alreadyRegistered;
}

/**
 * Register the SEP-2640 discovery index at skill://index.json.
 */
function registerSkillIndexResource(
  server: McpServer,
  skillState: SkillState
): void {
  server.registerResource(
    "Skill Index",
    "skill://index.json",
    {
      mimeType: "application/json",
      description: "SEP-2640 Agent Skills discovery index",
      annotations: { audience: ["assistant", "user"], priority: 0.5 },
    },
    async (resourceUri) => ({
      contents: [
        {
          uri: resourceUri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(buildSkillIndex(skillState.skillMap), null, 2),
        },
      ],
    })
  );
}

/**
 * Register a read-only URI template that dispatches skill:// reads.
 *
 * The template has NO list callback — enumeration is handled by
 * registerIndividualSkillResources() which gives each skill its own
 * top-level resource entry. The template here exists solely so that
 * URI reads for supporting files (skill://<path>/<file>) and SKILL.md
 * are routed correctly, and so the complete handler can suggest URIs.
 */
function registerSkillReadTemplate(
  server: McpServer,
  skillState: SkillState
): void {
  server.registerResource(
    "Skill",
    new ResourceTemplate("skill://{+skillUri}", {
      // list is intentionally omitted (set to undefined) — individual skills
      // are registered as static top-level resources by registerIndividualSkillResources().
      // Providing a list callback here would group all skills under a single
      // template node in the client UI, which is the bug we are fixing.
      list: undefined,
      complete: {
        skillUri: (value: string) => {
          // Suggest <skill-path>/SKILL.md plus each supporting file, filtered
          // by substring. Strip the "skill://" scheme from the built URI so the
          // suggested {+skillUri} value is per-segment encoded exactly like the
          // listed resources (names with spaces/reserved chars stay in sync).
          const v = value.toLowerCase();
          const suggestions: string[] = [];
          for (const skill of skillState.skillMap.values()) {
            suggestions.push(buildSkillResourceUri(skill, "SKILL.md").slice(SCHEME.length));
            for (const file of listSkillFiles(path.dirname(skill.path))) {
              suggestions.push(buildSkillResourceUri(skill, file).slice(SCHEME.length));
            }
          }
          return suggestions.filter((u) => u.toLowerCase().includes(v));
        },
      },
    }),
    {
      mimeType: "text/markdown",
      description: "Agent Skill resource (SEP-2640)",
    },
    async (resourceUri) => {
      const uriStr = resourceUri.toString();
      const parsed = parseSkillResourceUri(uriStr, skillState.skillMap);

      if (!parsed) {
        throw new Error(`Skill resource not found for URI: ${uriStr}`);
      }

      const { skill, fileRelPath } = parsed;

      if (fileRelPath === "SKILL.md") {
        try {
          const content = loadSkillContent(skill.path);
          return {
            contents: [
              {
                uri: uriStr,
                mimeType: "text/markdown",
                text: content,
              },
            ],
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to load skill "${skill.baseName}": ${message}`);
        }
      }

      // Supporting file inside the skill directory.
      const skillDir = path.dirname(skill.path);
      const fullPath = path.resolve(skillDir, fileRelPath);

      if (!isPathWithinBase(fullPath, skillDir)) {
        throw new Error(`Path traversal blocked: ${fileRelPath}`);
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        throw new Error(`File not found: ${fileRelPath}`);
      }

      if (stat.isSymbolicLink() || stat.isDirectory()) {
        throw new Error(`Not a readable file: ${fileRelPath}`);
      }
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(
          `File too large (${stat.size} bytes, max ${MAX_FILE_SIZE}): ${fileRelPath}`
        );
      }

      const content = fs.readFileSync(fullPath, "utf-8");
      return {
        contents: [
          {
            uri: uriStr,
            mimeType: getMimeType(fileRelPath),
            text: content,
          },
        ],
      };
    }
  );
}
