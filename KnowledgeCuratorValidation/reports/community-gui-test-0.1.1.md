# Knowledge Curator 0.1.1 — Community GUI Clean-install Checklist

Status: `MANUAL_GUI_TEST_REQUIRED`

This checklist must be completed in a new disposable Vault before creating the `0.1.1` tag or GitHub Release.

## Environment

- Tester:
- Date:
- Operating system:
- Obsidian version:
- Knowledge Curator version: `0.1.1`

## Installation

1. Create a new empty Obsidian Vault.
2. Create `.obsidian/plugins/knowledge-curator/` inside that Vault.
3. Copy the candidate `main.js`, `manifest.json`, and `styles.css` into that directory.
4. Open **Settings → Community plugins**.
5. Enable Community plugins if required.
6. Enable **Knowledge Curator**.

## Verification

- [ ] Obsidian recognizes Knowledge Curator as version `0.1.1`.
- [ ] The plugin enables without a runtime error.
- [ ] The Knowledge Curator Sidebar opens normally.
- [ ] The Settings tab opens normally.
- [ ] Leave LLM and Tavily API Keys empty; the plugin remains stable.
- [ ] Provider-dependent actions show a clear configuration error and do not crash.
- [ ] The default mode is **Test Mode**.
- [ ] Test Mode only permits the fixed isolated test Wiki scope.
- [ ] Switch to **Production Preview**.
- [ ] Production Preview permits analysis/verification/PR preview but blocks Accept.
- [ ] No Markdown is written during scan, analysis, verification, or draft generation.
- [ ] Restart Obsidian.
- [ ] Settings and Sidebar state recover normally after restart.

## Result

- `GUI_CLEAN_INSTALL = PENDING`
- `MIN_APP_VERSION_VERIFIED = PENDING`
- Actual Obsidian version tested:
- Notes:

Do not create the `0.1.1` tag or GitHub Release until both pending fields have been replaced with verified results.
