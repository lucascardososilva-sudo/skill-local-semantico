/**
 * Skill discovery and metadata parsing module.
 *
 * Discovers Agent Skills from a directory, parses YAML frontmatter,
 * and generates server instructions XML.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Annotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Source information for a skill.
 * Indicates whether the skill comes from a local directory or GitHub repository.
 */
export interface SkillSource {
  type: "local" | "github" | "bundled" | "well-known";
  displayName: string; // "Local", "owner/repo", "Bundled", or "<origin><base-path>"
  prefix: string; // Namespace prefix for skill names (e.g., "my-project", "owner-repo", "" for bundled)
  owner?: string; // GitHub org/user (only for github type)
  repo?: string; // GitHub repo name (only for github type)
  origin?: string; // Well-known origin (only for well-known type, e.g. "https://example.com")
}

/**
 * Default source for skills discovered without explicit source info.
 */
export const DEFAULT_SKILL_SOURCE: SkillSource = {
  type: "local",
  displayName: "Local",
  prefix: "local",
};

/**
 * Source for skills bundled with the server package.
 */
export const BUNDLED_SKILL_SOURCE: SkillSource = {
  type: "bundled",
  displayName: "Bundled",
  prefix: "",
};

/**
 * Metadata extracted from a skill's SKILL.md frontmatter.
 */
export interface SkillMetadata {
  name: string; // Qualified name with prefix (e.g., "my-project__commit")
  baseName: string; // Original name from frontmatter (e.g., "commit")
  description: string;
  path: string; // Full path to SKILL.md
  disableModelInvocation?: boolean; // When true, exclude from tool description
  userInvocable?: boolean; // When false, exclude from prompts (default: true)
  // Computed effective values (after config overrides applied)
  effectiveAssistantInvocable: boolean; // True if model can auto-invoke
  effectiveUserInvocable: boolean; // True if appears in prompts menu
  isAssistantOverridden: boolean; // True if config override exists
  isUserOverridden: boolean; // True if config override exists
  // Source information
  source: SkillSource; // Where this skill came from (local or GitHub)
}

/**
 * Find the SKILL.md file in a skill directory.
 * Prefers SKILL.md (uppercase) but accepts skill.md (lowercase).
 */
function findSkillMd(skillDir: string): string | null {
  for (const name of ["SKILL.md", "skill.md"]) {
    const filePath = path.join(skillDir, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns the parsed metadata and the markdown body.
 */
function parseFrontmatter(content: string): { metadata: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter (---)");
  }

  const parts = content.split("---");
  if (parts.length < 3) {
    throw new Error("SKILL.md frontmatter not properly closed with ---");
  }

  const frontmatterStr = parts[1];
  const body = parts.slice(2).join("---").trim();

  const metadata = parseYaml(frontmatterStr) as Record<string, unknown>;
  if (typeof metadata !== "object" || metadata === null) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping");
  }

  return { metadata, body };
}

/**
 * Sanitize a prefix string for use in qualified skill names.
 * Replaces spaces with hyphens and strips special characters.
 */
export function sanitizePrefix(raw: string): string {
  return raw
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .replace(/^-+|-+$/g, "");
}

/**
 * Compute the qualified name for a skill by combining prefix and base name.
 * If prefix is empty, returns the base name unchanged.
 */
function qualifyName(prefix: string, baseName: string): string {
  const sanitized = sanitizePrefix(prefix);
  if (!sanitized) return baseName;
  return `${sanitized}__${baseName}`;
}

/**
 * Compute the SEP-2640 <skill-path> for a skill.
 *
 * Bundled (empty prefix) → baseName
 * Other → "<sanitizePrefix(prefix)>/<baseName>"
 *
 * The final segment always equals the frontmatter `name`, per SEP.
 */
export function getSkillPath(skill: SkillMetadata): string {
  const prefix = sanitizePrefix(skill.source.prefix);
  return prefix ? `${prefix}/${skill.baseName}` : skill.baseName;
}

/**
 * Build a full skill resource URI for a file relative to the skill root.
 * Per-segment encoding preserves slashes between path segments.
 */
export function buildSkillResourceUri(skill: SkillMetadata, fileRelPath: string): string {
  const skillPath = getSkillPath(skill);
  const encodedFile = fileRelPath.split("/").map(encodeURIComponent).join("/");
  return `skill://${skillPath}/${encodedFile}`;
}

/**
 * Parse a skill:// URI into a (skill, fileRelPath) pair.
 *
 * Walks skillMap to disambiguate <skill-path> from <file-path>, since the URI
 * itself does not encode where the skill segment ends. Longest-path-first
 * matching handles overlapping prefixes (e.g., foo/bar vs foo/bar/baz).
 *
 * Returns null if the URI is not a skill:// URI or no skill matches.
 */
export function parseSkillResourceUri(
  uri: string,
  skillMap: Map<string, SkillMetadata>
): { skill: SkillMetadata; fileRelPath: string } | null {
  const m = uri.match(/^skill:\/\/(.+)$/);
  if (!m) return null;
  // Decode per-segment so segments containing literal %2F round-trip cleanly.
  const remainder = m[1].split("/").map(decodeURIComponent).join("/");
  const candidates = Array.from(skillMap.values())
    .map((s) => ({ s, p: getSkillPath(s) }))
    .sort((a, b) => b.p.length - a.p.length);
  for (const { s, p } of candidates) {
    if (remainder.startsWith(p + "/")) {
      const fileRelPath = remainder.slice(p.length + 1);
      // Reject URIs with no file segment (e.g., legacy "skill://name/").
      // SEP-2640 requires SKILL.md to be explicit in the URI.
      if (fileRelPath === "") return null;
      return { skill: s, fileRelPath };
    }
  }
  return null;
}

/**
 * Build the SEP-2640 discovery index document.
 *
 * All skills are emitted as type "skill-md" with a URL pointing to their
 * SKILL.md resource. Archive and resource-template entry types are out of
 * scope for this server.
 */
export function buildSkillIndex(skillMap: Map<string, SkillMetadata>): {
  $schema: string;
  skills: Array<{ name: string; type: "skill-md"; description: string; url: string }>;
} {
  const skills: Array<{ name: string; type: "skill-md"; description: string; url: string }> = [];
  for (const skill of skillMap.values()) {
    skills.push({
      name: skill.baseName,
      type: "skill-md",
      description: skill.description,
      url: buildSkillResourceUri(skill, "SKILL.md"),
    });
  }
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills,
  };
}

/**
 * Discover all skills in a directory.
 * Scans for subdirectories containing SKILL.md files.
 *
 * @param skillsDir - The directory to scan for skills
 * @param source - Optional source info to attach to discovered skills
 */
function parseSkillFile(filePath: string, source: SkillSource): SkillMetadata | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { metadata } = parseFrontmatter(content);

    const name = metadata.name;
    const description = metadata.description;
    const disableModelInvocation = metadata["disable-model-invocation"];
    const userInvocable = metadata["user-invocable"];

    if (typeof name !== "string" || !name.trim()) {
      return null;
    }
    if (typeof description !== "string" || !description.trim()) {
      return null;
    }

    const effectiveAssistant = disableModelInvocation !== true;
    const effectiveUser = userInvocable !== false;
    const baseName = (name as string).trim();
    const qualifiedName = qualifyName(source.prefix, baseName);

    return {
      name: qualifiedName,
      baseName,
      description: description.trim(),
      path: filePath,
      disableModelInvocation: disableModelInvocation === true,
      userInvocable: userInvocable !== false,
      effectiveAssistantInvocable: effectiveAssistant,
      effectiveUserInvocable: effectiveUser,
      isAssistantOverridden: false,
      isUserOverridden: false,
      source,
    };
  } catch (error) {
    return null;
  }
}

function discoverSkillsRecursive(
  dir: string,
  source: SkillSource,
  depth: number = 0
): SkillMetadata[] {
  if (depth > 5) return [];
  const skills: SkillMetadata[] = [];

  if (!fs.existsSync(dir)) return [];

  // Check if this directory contains a SKILL.md/skill.md
  const skillMdPath = findSkillMd(dir);
  if (skillMdPath) {
    // Treat as directory-based skill and stop recursion here
    const skill = parseSkillFile(skillMdPath, source);
    if (skill) {
      skills.push(skill);
    }
    return skills;
  }

  // If not a directory-based skill, scan files and subdirectories
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      skills.push(...discoverSkillsRecursive(fullPath, source, depth + 1));
    } else if (entry.isFile()) {
      // Don't treat SKILL.md or hidden files as file-based skills
      if (
        entry.name.toLowerCase().endsWith(".md") &&
        entry.name.toLowerCase() !== "skill.md" &&
        !entry.name.startsWith(".")
      ) {
        const skill = parseSkillFile(fullPath, source);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  }

  return skills;
}

export function discoverSkills(skillsDir: string, source?: SkillSource): SkillMetadata[] {
  const skillSource = source || DEFAULT_SKILL_SOURCE;
  return discoverSkillsRecursive(skillsDir, skillSource);
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generate the server instructions with available skills.
 * Includes a brief preamble about skill usage following the Agent Skills spec.
 */
export function generateInstructions(skills: SkillMetadata[]): string {
  const preamble = `# Skills

When a user's task matches a skill description below: 1) activate it, 2) follow its instructions completely.

`;

  if (skills.length === 0) {
    return preamble + "<available_skills>\n</available_skills>";
  }

  const limit = 20;
  const showSkills = skills.slice(0, limit);
  const lines: string[] = ["<available_skills>"];

  for (const skill of showSkills) {
    lines.push("<skill>");
    lines.push(`<name>${escapeXml(skill.name)}</name>`);
    lines.push(`<description>${escapeXml(skill.description)}</description>`);
    lines.push(`<location>${escapeXml(skill.path)}</location>`);
    lines.push("</skill>");
  }

  lines.push("</available_skills>");

  let results = preamble + lines.join("\n");
  if (skills.length > limit) {
    results += `\n\nNOTE: There are ${skills.length} skills available (showing first ${limit}). ` +
      `If none of the above are relevant, use the 'search-skills' tool to search all available skills by keyword.`;
  }
  return results;
}

/**
 * Load the full content of a skill's SKILL.md file.
 */
export function loadSkillContent(skillPath: string): string {
  return fs.readFileSync(skillPath, "utf-8");
}

/**
 * Create a map from skill name to skill metadata for fast lookup.
 * Uses first-wins behavior: if duplicate names exist, the first occurrence is kept.
 */
export function createSkillMap(skills: SkillMetadata[]): Map<string, SkillMetadata> {
  const map = new Map<string, SkillMetadata>();
  for (const skill of skills) {
    if (map.has(skill.name)) {
      const existing = map.get(skill.name)!;
      console.error(
        `Warning: Duplicate skill name "${skill.name}" found at ${skill.path} - ` +
        `keeping first occurrence from ${existing.path}`
      );
    } else {
      map.set(skill.name, skill);
    }
  }
  return map;
}

/**
 * Invocation override settings per skill (imported type reference).
 */
interface SkillInvocationOverrides {
  assistant?: boolean;
  user?: boolean;
}

/**
 * Apply invocation overrides from config to compute effective values.
 * Returns a new array with updated effective* fields.
 */
export function applyInvocationOverrides(
  skills: SkillMetadata[],
  overrides: Record<string, SkillInvocationOverrides>
): SkillMetadata[] {
  return skills.map((skill) => {
    const override = overrides[skill.name];
    if (!override) {
      return skill; // No override, keep frontmatter defaults
    }

    const hasAssistantOverride = override.assistant !== undefined;
    const hasUserOverride = override.user !== undefined;

    return {
      ...skill,
      effectiveAssistantInvocable: hasAssistantOverride
        ? override.assistant!
        : !skill.disableModelInvocation,
      effectiveUserInvocable: hasUserOverride
        ? override.user!
        : skill.userInvocable !== false,
      isAssistantOverridden: hasAssistantOverride,
      isUserOverridden: hasUserOverride,
    };
  });
}

/**
 * Filter skills that can be invoked by the model (appear in tool description).
 * Uses effective value which considers config overrides.
 */
export function getModelInvocableSkills(skills: SkillMetadata[]): SkillMetadata[] {
  return skills.filter((skill) => skill.effectiveAssistantInvocable);
}

/**
 * Filter skills that can be invoked by the user (appear in prompts menu).
 * Uses effective value which considers config overrides.
 */
export function getUserInvocableSkills(skills: SkillMetadata[]): SkillMetadata[] {
  return skills.filter((skill) => skill.effectiveUserInvocable);
}

/**
 * Compute MCP resource annotations and file size for a skill.
 * Derives audience from effective invocation flags and sets default priority.
 *
 * @param skill - The skill metadata
 * @param priority - Priority hint (0.0 = least important, 1.0 = most important, default 0.5)
 * @returns Object with annotations and optional size (in bytes) for use on MCP resources
 */
export function getResourceAnnotations(
  skill: SkillMetadata,
  priority: number = 0.5
): { annotations: Annotations; size?: number } {
  const clampedPriority = Number.isFinite(priority)
    ? Math.max(0, Math.min(1, priority))
    : 0.5;
  const audience: ("user" | "assistant")[] = [];
  if (skill.effectiveAssistantInvocable) {
    audience.push("assistant");
  }
  if (skill.effectiveUserInvocable) {
    audience.push("user");
  }
  const annotations: Annotations = { audience, priority: clampedPriority };
  let size: number | undefined;
  try {
    const stat = fs.statSync(skill.path);
    annotations.lastModified = stat.mtime.toISOString();
    size = stat.size;
  } catch {
    // Skip lastModified/size if file cannot be stat'd
  }
  return { annotations, size };
}

export const SKILL_COUNT_WARNING_THRESHOLD = 50;

export function warnLargeSkillCount(skillCount: number): void {
  if (skillCount >= SKILL_COUNT_WARNING_THRESHOLD) {
    console.error(
      `Warning: ${skillCount} skills discovered. Large skill counts can degrade LLM performance ` +
      `by bloating tool descriptions. Consider reducing the number of skill directories or ` +
      `setting 'disable-model-invocation: true' in SKILL.md frontmatter for user-only skills.`
    );
  }
}

export function findMatchingSkills(
  query: string,
  skillMap: Map<string, SkillMetadata>,
  limit: number = 10
): SkillMetadata[] {
  const q = query.toLowerCase();
  const matches: { skill: SkillMetadata; score: number }[] = [];

  for (const skill of skillMap.values()) {
    let score = 0;
    if (skill.name.toLowerCase() === q || skill.baseName.toLowerCase() === q) {
      score += 100;
    } else if (skill.name.toLowerCase().includes(q) || skill.baseName.toLowerCase().includes(q)) {
      score += 50;
    }

    // Check description
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    let descMatches = 0;
    for (const word of words) {
      if (skill.description.toLowerCase().includes(word)) {
        descMatches++;
      }
    }
    if (words.length > 0) {
      score += (descMatches / words.length) * 30;
    }

    if (score > 0) {
      matches.push({ skill, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map((m) => m.skill);
}
