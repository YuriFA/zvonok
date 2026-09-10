# Proposal: prebuilt-css-variables

## Why

`ZvonokRoom` ships package-owned CSS with a namespaced class prefix but no
theming surface: a consumer wanting their brand on the prebuilt must fork
the stylesheet. Both reference platforms solve this with CSS custom
properties - Stream exposes `--str-video__*` variables over its component
tree - which is the cheapest possible integration seam: brand identity
without forking, without JS, without a second component variant.

This is change **D** of the coordinated 0.3.0 wave (after
add-roles-and-capabilities, add-client-egress-control, and
participant-vocabulary-and-quality).

## What Changes

1. **Theming variables**: the prebuilt's stylesheet consumes a documented,
   minimal set of CSS custom properties scoped to the widget root -
   accent/background/text colors, corner radius, and font family - each with
   a fallback equal to today's default, so an unstyled embed renders exactly
   as before.
2. **Namespace**: variables are prefixed `--zvonok-` (e.g.
   `--zvonok-accent-color`) and defined on the widget root, so host-page
   variables neither leak in nor are overridden globally.
3. **Docs**: a theming section documents the variable set with a copy-paste
   override example.

## Capabilities

### Modified Capabilities

- `sdk`: the prebuilt room component requirement gains the theming contract
  (variables, fallback-to-default behavior, scoping).

## Impact

- **packages/react**: `src/prebuilt` stylesheet switches hardcoded values to
  `var(--zvonok-*, <current default>)`; no DOM/class changes.
- **Docs**: theming section in the prebuilt docs.
- Non-breaking; additive to the wave's release.
