// Single source of truth for the released "Save to Poke" Shortcut version.
// Installed Shortcuts never auto-update, so every surface that hands out the
// download (MCP setup tool, /setup page, troubleshooting guidance) must be able
// to say which version is current — stale copies are otherwise undiagnosable
// (the v2/v2.1 era piled up as "Save to Poke 2"…"5" on real devices).
// Bump alongside any rebuild of public/save-to-poke.shortcut.
export const SHORTCUT_VERSION = "2.2";
export const SHORTCUT_RELEASED = "2026-06-11";
