# Design: prebuilt-css-variables

## Context

The prebuilt stylesheet (`packages/react/src/prebuilt`) hardcodes colors,
radii, and fonts under a namespaced class prefix. Consumers cannot rebrand
without forking. See proposal.md - Why.

## Goals / Non-Goals

Goals:
- CSS-variable theming seam with guaranteed default parity.
- Minimal, documented, stable variable set.

Non-Goals:
- i18n / translated copy (deferred until real demand).
- A theming JS API (theme prop objects) - CSS custom properties only.
- Splitting the prebuilt into its own package (rejected in review).

## Decisions

### D1: Variables with `var()` fallbacks, not a theme class

Every themed declaration becomes `var(--zvonok-<name>, <current default>)`.
An unstyled host renders pixel-identical to today by construction - no
`:root` defaults block that could interact with host styles, no "theme on/
off" class. Stream follows the same fallback pattern.

### D2: Defined on the widget root, `--zvonok-` prefix

Hosts set the variables on any ancestor of the widget (or `:root` if they
choose); inheritance delivers them. The prefix plus the widget-root scoping
of all rules means we never write global custom properties ourselves.

### D3: Minimal set: five variables

`--zvonok-accent-color`, `--zvonok-background-color`,
`--zvonok-text-color`, `--zvonok-radius`, `--zvonok-font-family`.
Deliberately not a token system: every added variable is a compatibility
promise, so the set starts at brand-identity essentials and grows only on
request. Derived shades (hover states, borders) keep their computed
relationships to these five rather than becoming variables of their own
where CSS allows (e.g. `color-mix`); where it does not, they stay hardcoded.

### D4: Documentation is part of the contract

The variable list lands in the prebuilt docs with a copy-paste example;
renaming or removing a variable later is a breaking change requiring a
major-version-style note in the wave's release process.

## Risks / Trade-offs

- [Variable set too small for real brands] -> Growing it is additive and
  cheap; starting large is irreversible.
- [Host uses `--zvonok-` names already] -> Namespaced prefix makes collision
  unlikely; widget-root scoping limits any blast radius to the widget.

## Migration Plan

Additive: stylesheet swaps hardcoded values for `var()` fallbacks. No DOM
or class changes, no prop changes. Rollback = revert stylesheet.

## Open Questions

None.
