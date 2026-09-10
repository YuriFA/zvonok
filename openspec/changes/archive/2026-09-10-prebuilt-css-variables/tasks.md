# Tasks: prebuilt-css-variables

## 1. Stylesheet

- [x] 1.1 Audit `packages/react/src/prebuilt` styles for the five themable concerns; replace hardcoded values with `var(--zvonok-*, <current default>)`; no class or DOM changes
- [x] 1.2 Visual check: widget renders identically without overrides (prebuilt screenshot or storybook-level comparison)

## 2. Tests and docs

- [x] 2.1 Component/render test: widget root consumes the documented variables (override changes computed style; absence keeps defaults)
- [x] 2.2 Docs: theming section in the prebuilt docs with the variable table and a copy-paste override example
- [x] 2.3 Full verification: packages suites, app lint/tsc
