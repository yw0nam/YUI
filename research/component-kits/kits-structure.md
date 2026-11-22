# Component kits: how they structure and split components

Scope: Astryx, Base UI, Radix Primitives, React Aria (hooks and react-aria-components), shadcn/ui.
Focus: concrete structure (packages, folders, files, one component end to end). General philosophy is covered in `philosophy.md` beside this file.

Method: GitHub API reads of each repo's default branch at 2026-11-22 (file trees via `git/trees ... recursive=1`, file contents via `contents/`), plus WebSearch snippets for doc pages. Doc pages were not fetched in full unless stated. Each claim cites the repo path it came from. Claims marked **unverified** were not checked in source.

Repo identities:
- Astryx: `github.com/meta/astryx` (the `facebook/astryx` name redirects to it; the GitHub API reports `full_name: meta/astryx`). Description: "An open source design system that's fully customizable and agent ready". MIT. Confirmed as the project the notes mean: README says "Built on React 19+ and StyleX" and "Currently in Beta" (https://github.com/meta/astryx/blob/main/README.md). Package `@astryxdesign/core` at version 0.7.18.
- Base UI: `github.com/mui/base-ui` (branch `master`), MIT. Package `@base-ui/react` version 1.9.0 (`packages/react/package.json`).
- Radix Primitives: `github.com/radix-ui/primitives` (branch `main`), MIT. Packages `@radix-ui/react-*`.
- React Aria: `github.com/adobe/react-spectrum` (branch `main`), Apache-2.0. Hooks in `react-aria` / `@react-aria/*` / `react-stately` / `@react-stately/*`; components in `react-aria-components`.
- shadcn/ui: `github.com/shadcn-ui/ui` (branch `main`), MIT.

---

## 1. Astryx (`meta/astryx`)

### 1.1 Package and folder layout

- Monorepo, pnpm workspace. Published packages under `packages/`: `core`, `cli`, `build`, `charts`, `lab`, `native`, `richtext`, `template-icons`, `vega`. Source: `packages/` listing in the repo tree (https://github.com/meta/astryx/tree/main/packages). Root README lists the published ones: `@astryxdesign/core`, `@astryxdesign/cli`, `@astryxdesign/build`, `@astryxdesign/theme-*` (https://github.com/meta/astryx/blob/main/README.md, "Packages" table).
- `@astryxdesign/lab` is not published to npm (README note).
- Core: one folder per component directly under `packages/core/src/`, e.g. `Button/`, `Dialog/`, `Field/`, `Selector/`, `Switch/`, plus `theme/`, `hooks/`, `utils/`, `i18n/`, `motion/`, `palette/` (tree: https://github.com/meta/astryx/tree/main/packages/core/src).
- Public barrel: `packages/core/src/index.ts` is a flat list of `export * from './Switch'` style lines (about 118 export lines). Its header says it is the package entry point (https://github.com/meta/astryx/blob/main/packages/core/src/index.ts).
- Core `package.json` exports subpaths such as `./theme/tokens`, `./theme/tokens.stylex`, `./astryx.css`, `./reset.css`, `./BaseProps`. Peer dependencies: `@stylexjs/stylex ^0.19.0`, `react >=19.0.0`, `react-dom >=19.0.0` (https://github.com/meta/astryx/blob/main/packages/core/package.json).
- The CLI can "swizzle" a component: copy its full source into the consumer's project. Listed in `packages/cli/README.md` (command table, https://github.com/meta/astryx/blob/main/packages/cli/README.md). The README also says "when you need to go deeper, swizzle ejects a component's full source into your project to own" (root README, "What makes Astryx different").

### 1.2 One component: `Switch` (file list)

Folder `packages/core/src/Switch/` (https://github.com/meta/astryx/tree/main/packages/core/src/Switch):

| File | Role (from its header or content) |
|---|---|
| `Switch.tsx` | Component, its props type, all StyleX style objects inline (1194 lines) |
| `index.ts` | Re-exports `Switch` and its types (header: "Entry point for Switch; re-exported by /packages/core/src/index.ts") |
| `Switch.doc.mjs` | Docs data: `anatomy` (Field, Track, Thumb, Label, Description, Spinner, Status message), props table, keywords |
| `Switch.test.tsx`, `Switch.focusRing.source-build.test.mjs`, `Switch.thumbCircle.source-build.test.mjs` | Unit and source-build tests |
| `__tests__/` | `Switch.a11y.chromium.spec.ts`, `Switch.a11y.states.ts`, `Switch.a11y.known-failures.ts`, `Switch.a11y.test.tsx`, `Switch.interaction.browser.spec.ts`, `SwitchPointer.interaction.browser.spec.ts`, `SwitchThumbRest.interaction.browser.spec.ts`, `Switch.webkitLateStamps.fixture.ts` |
| `switch.markers.stylex.ts` | StyleX markers (`switchScope`, `switchFocusInput`) used by the press/focus CSS |
| `switchFill.ts`, `switchTouch.ts`, `useSwitchTouch.ts` (+ tests) | Touch-presentation logic split out of the component |

Stories live outside the package: `apps/storybook/stories/Switch.stories.tsx`. The header of `Switch.tsx` also lists showcase blocks at `packages/cli/assets/templates/blocks/components/Switch/` and says these must be updated together (SYNC comment, `Switch.tsx` line 1-20).

### 1.3 How one component is built (layer ownership)

Source: `packages/core/src/Switch/Switch.tsx`.

- **Markup:** a `<div>` wrapper and a real `<input type="checkbox" role="switch">` (around line 1031-1045). The track is a `<div aria-hidden="true">` (line 1085). The label is rendered by the shared `FieldLabel` and feedback by `FieldStatus`, imported from sibling folders.
- **Styles:** StyleX. `stylex.create(...)` objects live in the same file (e.g. `trackSizeStyles`, line ~150). Theme values come from `../theme/tokens.stylex` (`colorVars`, `spacingVars`, `durationVars`, ...). Press state is written as a data attribute, `data-astryx-press="on" | "fading"` (lines 100-101).
- **State / behaviour:** `useOptimistic` and `useTransition` for `changeAction`; `useAnnounce` for busy-state announcements; `useSwitchTouch` for touch behaviour; `usePressFeedback`; `useTooltip` for disabled messages (imports at lines 1-60).
- **a11y:** `role="switch"`, `aria-disabled` (instead of native `disabled`, so the control stays focusable), `aria-describedby` built from description and status IDs, `aria-busy`, `aria-invalid`, `aria-required` (lines 1035-1075). Accessibility tests are in `__tests__/`.
- Every component in the tree also has an `index.ts`, a `*.doc.mjs`, and `__tests__/` with a11y specs (checked for Button, Dialog, Field, Selector, Switch).

### 1.4 Composition

- **Flat props for parts.** `Switch` takes `label`, `description`, `labelIcon`, `labelTooltip`, `status`, `labelPosition`, `size`, `xstyle`, `className`, `style` in one props object (`Switch.tsx` lines 727-930). No `Switch.Thumb`-style subcomponents are exported for Switch.
- **Compound where needed.** `Dialog` is a compound with `Dialog` (takes `children: ReactNode`, "typically a Layout with header, content, and footer slots") and a separate `DialogHeader` export. `Dialog/index.ts` exports both (`packages/core/src/Dialog/index.ts`, `Dialog.tsx` line 540).
- **Extensible variants via module augmentation.** `DialogVariantMap` is an interface that theme packages extend with `declare module` (`Dialog/index.ts` header comment).
- **Render function instead of asChild.** `Selector` takes `renderOption?: (option) => ReactNode` (`packages/core/src/Selector/Selector.tsx` line 835).
- **asChild:** I found no `asChild` convention in the components I read. A text search for `asChild` returned hits that were substrings such as `hasChildren`, so this is **unverified across the whole tree**.
- **Shared field contract.** `Field/fieldParts.ts` states that Field-composed inputs do not accept root `xstyle`, `className` or `style`; they get `containerXstyle` and `controlXstyle` instead (lines 1-40 and the `FieldContainerStyleProps` interface).

### 1.5 Styling and theming

- `BaseProps<T>` (`packages/core/src/BaseProps.ts`) gives every component `className`, `style`, `xstyle` (StyleX styles), `data-*` and `aria-*` pass-through. It omits some HTML attributes.
- README: "Override with `className` using Tailwind, CSS modules, or plain CSS". "A theme is a set of CSS custom property overrides" (root README).
- Theme packages: `packages/themes/` (seven themes listed in README). Theme building helpers: `packages/core/src/theme/defineTheme.ts`, `generateThemeRules.ts` (file names from tree; contents **not read**).
- Tokens: `packages/core/src/theme/tokens.stylex.ts` and `dataTokens.stylex.ts`. Components import token objects such as `colorVars`, `spacingVars` (`Switch.tsx` lines 12-22). StyleX exposes these as CSS variables at build time; that compile behaviour is general StyleX knowledge and was not checked in this repo.
- `packages/core/src/astryx.css` is the prebuilt CSS export (`./astryx.css` in package exports). Consumers import it, so no build plugin is needed (README: "You import pre-built CSS and use typed React components").
- A "ShadCN-copied components" refresh exists in the CLI `upgrade` command (`packages/cli/README.md`). Not investigated further.

### 1.6 API shape

- **Switch is controlled only.** Props: `value` (boolean), `onChange(checked, event)`, optional `changeAction(checked, event)` that runs in a transition with `useOptimistic`. There is no `defaultValue` or `defaultChecked` in `Switch.tsx` (grep for both returned nothing) (`Switch.tsx` lines 727-760, 1050-1060).
- `onChange` is skipped while disabled or busy (lines 1050-1054).
- No global store. Shared state goes through React context inside a component family (e.g. `DialogContext` in `Dialog/DialogContext.ts`).

---

## 2. Base UI (`mui/base-ui`)

### 2.1 Package and folder layout

- Monorepo. Packages: `packages/react` (`@base-ui/react`) and `packages/utils` (`@base-ui/utils`). Source: https://github.com/mui/base-ui/tree/master/packages.
- `packages/react/package.json` depends on `@base-ui/utils` (workspace), `@floating-ui/react-dom`, `@floating-ui/utils`, `use-sync-external-store`, `@babel/runtime`. Peer deps not checked.
- One folder per component under `packages/react/src/<name>/`, with one subfolder per part: `root/`, `thumb/`, `trigger/`, `popup/`, etc.
- Shared internals in `packages/react/src/internals/`: `useRenderElement`, `use-button/`, `field-constants/`, `getStateAttributesProps` (file names from tree; `useRenderElement.spec.tsx` exists).
- Shared helpers in `packages/utils/src/`, e.g. `useControlled.ts`.
- Docs (handbook) in `docs/src/app/(docs)/react/handbook/`: `composition/page.mdx`, `styling/page.mdx`, `customization/page.mdx`, `forms/`, `animation/`, `typescript/`.

### 2.2 One component: `Switch` (file list)

Folder `packages/react/src/switch/` (https://github.com/mui/base-ui/tree/master/packages/react/src/switch):

```
index.ts                         export * as Switch from './index.parts'; plus type and DataAttributes re-exports
index.parts.ts                   export { SwitchRoot as Root }; export { SwitchThumb as Thumb }
stateAttributesMapping.ts        maps SwitchRootState to data attributes
root/SwitchRoot.tsx              the root (337 lines)
root/SwitchRoot.test.tsx
root/SwitchRootContext.ts
root/SwitchRootDataAttributes.ts data-attribute names (data-checked, data-unchecked, data-disabled, ...)
thumb/SwitchThumb.tsx
thumb/SwitchThumb.test.tsx
thumb/SwitchThumbDataAttributes.ts
```

Consumers import `@base-ui/react/switch`, then write `<Switch.Root><Switch.Thumb /></Switch.Root>`.

### 2.3 How one component is built (layer ownership)

Source: `packages/react/src/switch/root/SwitchRoot.tsx`.

- **State:** `useControlled({controlled: checkedProp, default: Boolean(defaultChecked), ...})` (line 89) from `@base-ui/utils`. Field integration via `useRegisterFieldControl`, `useValueChanged`, validation hooks (lines 96-106).
- **Behaviour:** `useButton` from `internals/use-button` returns `getButtonProps` (line 109). The change handler calls `onCheckedChange(nextChecked, eventDetails)` (line 189).
- **Markup:** a `<span>` root via `useRenderElement('span', componentProps, {state, ref, props: [...], stateAttributesMapping})` (line 221). A hidden `<input>` with `aria-hidden` is rendered alongside for form submission (lines 173-174, 236-237).
- **a11y:** `aria-checked`, `aria-readonly`, `aria-required`, `aria-labelledby` are set explicitly (lines 125-128). Role comes from `useButton`'s props; not traced further (**unverified** which element carries `role="switch"`).
- **Styles:** none. The component emits data attributes from `stateAttributesMapping.ts` (`checked` gives `data-checked`, otherwise `data-unchecked`). Styling is the consumer's job.

### 2.4 Composition

- **Parts, not props.** `Switch.Root` plus `Switch.Thumb`. The `index.parts.ts` file is the list of parts (`packages/react/src/switch/index.parts.ts`).
- **`render` prop** replaces the default element or merges props onto a custom element. Doc: "Use the `render` prop to compose a Base UI part with your own React components... The custom component must forward the `ref`, and spread all the received props." Props are merged; class names are combined; refs are all kept (composition handbook, https://base-ui.com/react/handbook/composition, source `docs/src/app/(docs)/react/handbook/composition/page.mdx`).
- **Render function** form: `render={(props, state) => ...}` for performance-sensitive cases (same page).
- **Event veto:** `event.preventBaseUIHandler()` skips later handlers (composition and customization handbook pages; WebSearch snippet confirmed the name, source page read only in part).
- **Nested parts** (Tooltip.Trigger render={Dialog.Trigger render={Menu.Trigger ...}}) are shown in the composition handbook.

### 2.5 Styling and theming

- Three style hooks, documented in `docs/src/app/(docs)/react/handbook/styling/page.mdx` (https://base-ui.com/react/handbook/styling):
  1. `className` as a string or a function of state.
  2. Data attributes such as `[data-checked]`, `[data-disabled]`.
  3. CSS variables set by the component (e.g. positioner CSS vars in `SelectPositionerCssVars.ts`), plus `style` as a function of state.
- No token system. Examples use Tailwind classes and CSS Modules (same styling page).

### 2.6 API shape

- Switch: `checked` (controlled), `defaultChecked` (uncontrolled), `onCheckedChange(checked, eventDetails)` (`SwitchRoot.tsx` lines 263-306).
- Select: `value` / `defaultValue` via `useControlled` (`select/root/SelectRoot.tsx` line 99). Select state lives in a `SelectStore` (`select/store.ts`) and the root creates it with `useSingleAnchorPopupRoot`; this is a per-instance store, not a global one (`SelectRoot.tsx` lines 148-160).
- Events carry an `eventDetails` object with a `reason` (type `SwitchRootChangeEventReason`).

---

## 3. Radix Primitives (`radix-ui/primitives`)

### 3.1 Package and folder layout

- Monorepo. Two groups: `packages/core/*` (shared helpers: `primitive`, `number`, `rect`, `env-check`) and `packages/react/*` (one folder per component or helper). Source: https://github.com/radix-ui/primitives/tree/main/packages.
- Helpers in `packages/react/`: `primitive`, `slot`, `compose-refs`, `context`, `use-controllable-state`, `use-callback-ref`, `use-size`, `id`, `collection`, `presence`, `portal`, `popper`, `focus-scope`, `dismissable-layer`, etc. (tree).
- `packages/react/radix-ui/` is the umbrella package that re-exports all components.
- Each component folder holds `package.json`, `README.md`, `CHANGELOG.md`, `tsconfig.json`, and `src/`.

### 3.2 One component: `Switch` (file list)

Folder `packages/react/switch/` (https://github.com/radix-ui/primitives/tree/main/packages/react/switch):

```
README.md             one line pointing to the docs site
CHANGELOG.md
package.json          name @radix-ui/react-switch, version 1.4.1
tsconfig.json
src/index.ts          public exports
src/switch.tsx        the whole component (445 lines)
src/switch.test.tsx
```

Only one source file per component. Helpers live in other packages.

### 3.3 How one component is built (layer ownership)

Source: `packages/react/switch/src/switch.tsx`.

- **State:** `useControllableState` from `@radix-ui/react-use-controllable-state` in `SwitchProvider` (line 73). Context via `createContextScope` from `@radix-ui/react-context` (line 14).
- **Markup:** `Primitive.button` for the trigger (line 160) and `Primitive.span` for the thumb (line 267). `Primitive` comes from `@radix-ui/react-primitive`.
- **Hidden input:** `SwitchBubbleInput` renders a visually hidden `<input aria-hidden>` so forms get the value (lines 281-310, 377-379). It measures the control with `useSize`.
- **a11y:** `aria-checked`, `aria-required`, and `data-state` (`'checked' | 'unchecked'`) on the trigger (lines 163-165). `role` is the button's `role="switch"`; not traced in this read (**unverified**).
- **Styles:** none. Radix does not ship CSS.
- Dependencies (`package.json`): `@radix-ui/primitive`, `react-compose-refs`, `react-context`, `react-primitive`, `react-use-controllable-state`, `react-use-size`.

### 3.4 Composition

- **Parts:** `Switch.Root` (alias `Switch`), `Switch.Thumb`. Exports at `packages/react/switch/src/index.ts`.
- **Headless split (unstable):** `SwitchProvider` (`unstable_SwitchProvider`), `SwitchTrigger` (`unstable_SwitchTrigger`), `SwitchBubbleInput` (`unstable_SwitchBubbleInput`). The provider holds logic and the trigger is the markup part (lines 45-120, exports lines 1-20).
- **asChild:** `Primitive` takes `asChild`; when set, it renders `Slot` from `@radix-ui/react-slot` instead of the node (`packages/react/primitive/src/primitive.tsx` lines 33-48). Every `Primitive.*` element therefore accepts `asChild`.
- **Select** is compound: `Select.Root`, `Trigger`, `Value`, `Icon`, `Portal`, `Content`, `Viewport`, `Group`, `Label`, `Item`, `ItemText`, `ItemIndicator`, `ScrollUpButton`, `ScrollDownButton`, `Separator`, `Arrow` (`packages/react/select/src/index.ts`). All of it lives in one `select.tsx` file of 2094 lines, with one `createContextScope` for the whole component.

### 3.5 Styling and theming

- No styles. Components expose `data-state` (`checked`/`unchecked`, `open`/`closed`), `data-disabled`, and similar attributes. Verified in `switch.tsx` (line 165, 268) and used in `select.tsx`.
- `className` and `style` pass through `ComponentPropsWithoutRef<typeof Primitive.button>` (`switch.tsx` lines 122-128, 196-202).
- Theming is entirely the consumer's CSS. Radix Themes is a separate product; not investigated.

### 3.6 API shape

- Switch: `checked` (controlled), `defaultChecked` (uncontrolled), `onCheckedChange(checked: boolean)` (`switch.tsx` lines 196-202). The `bivarianceHack` in the callback type is intentional, per the source.
- Select: `open`/`defaultOpen`/`onOpenChange`, `value`/`defaultValue`/`onValueChange` via `useControllableState` (`select.tsx` lines 192-198).
- Each component has its own context scope; no global store.
- Peer deps for Select: `react` and `react-dom` `^16.8 || ^17 || ^18 || ^19 || ^19.0.0-rc` (`packages/react/select/package.json`).

---

## 4. React Aria (`adobe/react-spectrum`)

React Aria has two layers that the user should not confuse:
- **Hooks:** `react-aria` (`@react-aria/*` underneath) gives behaviour and ARIA props; `react-stately` (`@react-stately/*`) gives state hooks; `@react-types/*` gives types.
- **Components:** `react-aria-components` gives styled-less components built on those hooks.

### 4.1 Package and folder layout

- Monorepo of about 132 packages (`package.json` files under `packages/`). Source: https://github.com/adobe/react-spectrum/tree/main/packages.
- Hooks, by package:
  - `packages/react-aria/src/<feature>/` (e.g. `src/switch/useSwitch.ts`, `src/select/useSelect.ts`, `src/select/HiddenSelect.tsx`). The `react-aria` package is the umbrella and re-exports them via `packages/react-aria/exports/useSwitch.ts`.
  - `packages/@react-aria/<feature>/src/index.ts` is a re-export shim: `export {useSwitch} from 'react-aria/useSwitch'` (`packages/@react-aria/switch/src/index.ts`).
  - `packages/react-stately/src/<feature>/` (e.g. `src/toggle/useToggleState.ts`, `src/select/useSelectState.ts`); exports via `packages/react-stately/exports/`.
  - `packages/@react-stately/toggle/src/index.ts` is also a shim (`export {useToggleState} from 'react-stately/useToggleState'`).
- Components: `packages/react-aria-components/src/<Name>.tsx` (e.g. `Switch.tsx` 434 lines, `Select.tsx` 424 lines, `Button.tsx`). Tests in `packages/react-aria-components/test/<Name>.test.js`, stories in `packages/react-aria-components/stories/<Name>.stories.tsx`.
- `react-aria-components` depends on `react-aria` (3.53.1), `react-stately` (3.51.0), `@react-types/shared`, `@internationalized/date`, `@internationalized/string` (`packages/react-aria-components/package.json`).

### 4.2 One component: `Switch` (file list, and the hook layer)

Hook layer:
```
packages/react-stately/src/toggle/useToggleState.ts      state for one toggle (controlled or uncontrolled)
packages/react-aria/src/toggle/useToggle.ts              press, focus, label, input props
packages/react-aria/src/switch/useSwitch.ts              role="switch" and checked on top of useToggle
packages/react-aria/exports/useSwitch.ts                 public entry
packages/@react-aria/switch/src/index.ts                 re-export shim
```

Component layer:
```
packages/react-aria-components/src/Switch.tsx              deprecated Switch (ToggleStateContext, SwitchContext, render props)
packages/react-aria-components/test/Switch.test.js
packages/react-aria-components/stories/Switch.stories.tsx
```

The Switch component file also contains `SwitchField` and `SwitchButton`. The `Switch` docstring says it is deprecated: "Use SwitchField + SwitchButton instead." (`Switch.tsx` line 221 area).

### 4.3 How one component is built (layer ownership)

Source: `packages/react-stately/src/toggle/useToggleState.ts`, `packages/react-aria/src/switch/useSwitch.ts`, `packages/react-aria/src/toggle/useToggle.ts`, `packages/react-aria-components/src/Switch.tsx`.

- **State** (react-stately): `useToggleState(props)` returns `isSelected` and setters. Controlled or uncontrolled is handled inside the hook (signature not read line by line; **unverified** on the exact prop names).
- **Behaviour and a11y** (react-aria): `useToggle` calls `usePress` for the input and label (lines 123-136), `useFocusable` (line 189), and builds `labelProps` and `inputProps`. `useSwitch` adds `role: 'switch'` and `checked: isSelected` (lines 60-76).
- **Markup** (react-aria-components): `SwitchButton` renders `<dom.label>` containing a `VisuallyHidden` `<input>` with the hook's input props, then the children (`Switch.tsx` lines 393-434).
- **Styles:** none in the package. The component adds `defaultClassName` (`'react-aria-Switch'`) and data attributes: `data-selected`, `data-pressed`, `data-hovered`, `data-focused`, `data-focus-visible`, `data-disabled`, `data-readonly`, `data-invalid`, `data-required` (`Switch.tsx` lines 106-160 for the documented selectors, 393-434 for emission).

### 4.4 Composition

- **Context Provider wiring.** Each component root wraps children in `Provider values={[[Context, value], ...]}` (`Select.tsx` lines 243-291). Child components read these with `useContextProps`. That is how `Select.Button`, `ListBox` and `Popover` get their props without the consumer passing them.
- **Slot prop** (`slot={props.slot}` on `dom.label`) lets a parent route props to a named child.
- **Render props:** `className`, `style` and `children` accept a function of render-state values (`ClassNameOrFunction<SwitchRenderProps>`, `Switch.tsx` lines 43-104).
- **Select** is compound: `Select` (root) > `SelectValue`, `Button`, `Popover` > `ListBox` > `ListBoxItem`, plus `Label`, `Text`, `FieldError` (`Select.tsx` lines 243-291; list of child components is from the RAC package exports, not read in full).
- A searchable Select pattern (Autocomplete plus SearchField as siblings of ListBox) is shown in the docs (WebSearch snippet only, from react-aria.adobe.com/Select; **page not read**).

### 4.5 Styling and theming

- Components expose data attributes and `data-*` selectors in JSDoc (`Switch.tsx` lines 106-160).
- `className` and `style` accept render-prop functions (`Switch.tsx` line 64).
- Docs example CSS targets `.react-aria-Select` and `.react-aria-Popover[data-trigger=Select]` (WebSearch snippet only; **unverified** against the full page).
- No tokens. React Spectrum (the other styled product in the same repo) is not investigated here.

### 4.6 API shape

- Controlled and uncontrolled through `useToggleState` (react-stately). Props `isSelected`, `defaultSelected`, `onChange` (names taken from the `ToggleProps` type; **unverified** line by line).
- Events go out as callbacks. No global state. Contexts are scoped to one component tree.
- Recommended new API is `SwitchField` + `SwitchButton`; the single `Switch` is deprecated (`Switch.tsx`).

---

## 5. shadcn/ui (`shadcn-ui/ui`)

shadcn is not an installed library. Its CLI copies source files into the consumer's project. Installation docs say: `npx shadcn@latest add switch`, or "Copy and paste the following code into your project" for manual install (`apps/v4/content/docs/components/radix/switch.mdx`, `apps/v4/content/docs/components/base/switch.mdx`).

### 5.1 Package and folder layout

- Monorepo: `apps/v4/` is the docs site and registry. Source components are in three parallel bases (`apps/v4/registry/bases/`):
  - `radix/` (330 files) wraps `radix-ui`.
  - `base/` (320 files) wraps `@base-ui/react`.
  - `aria/` (314 files) wraps `react-aria-components`.
  Each base has `ui/`, `lib/` (`utils.ts`), and examples.
- `apps/v4/registry/bases/README.md` says: "For any shared surface... changes should be applied to both `base` and `radix` variants" and "Adjust only what must differ: imports and primitive APIs."
- `apps/v4/registry/new-york-v4/` holds `ui/` (62 files), `blocks/`, `charts/`, `examples/`, `hooks/`, `lib/`, `internal/`. This is the older style; the bases are the current source (folder listing from the tree).
- `apps/v4/registry/bases/__components__/` (`radix.tsx`, `base.tsx`, `aria.tsx`, `index.tsx`) is generated: "autogenerated by scripts/build-registry.mts; Do not edit this file directly." (`__components__/index.tsx` header).
- `apps/v4/registry/styles/style-*.css` (for example `style-nova.css`, `style-lyra.css`, `style-maia.css`) hold the shared style layer (see 5.5).

### 5.2 One component: `Switch` (file list)

Per base, one file per component:
```
apps/v4/registry/bases/radix/ui/switch.tsx
apps/v4/registry/bases/base/ui/switch.tsx
apps/v4/registry/bases/aria/ui/switch.tsx
apps/v4/registry/new-york-v4/ui/switch.tsx
```
No per-component test, story or index file in the registry. Docs live beside as `apps/v4/content/docs/components/<base>/switch.mdx`. Examples are in `apps/v4/examples/aria/field-switch.tsx` and similar.

### 5.3 How one component is built (layer ownership)

Source: `apps/v4/registry/bases/radix/ui/switch.tsx` (full file, 37 lines).

- **Behaviour:** entirely from `SwitchPrimitive.Root` and `SwitchPrimitive.Thumb` imported from `radix-ui`.
- **Markup and classes:** the shadcn file adds `data-slot="switch"`, `data-size`, and a class string built with `cn(...)` that merges Tailwind utilities with the consumer's `className`. The thumb gets `data-slot="switch-thumb"` and its own class.
- **Styles:** Tailwind utilities inline in the component (`peer group/switch relative inline-flex ...`), plus semantic classes `cn-switch` and `cn-switch-thumb` that are defined in the style CSS (5.5).
- **a11y:** none added in the file. It inherits Radix's.
- Props: `React.ComponentProps<typeof SwitchPrimitive.Root> & { size?: "sm" | "default" }` (the `size` prop is the only addition).
- `"use client"` at the top.

### 5.4 Composition

- **Thin wrappers.** Each exported component wraps one primitive, adds `data-slot` and classes, and forwards `...props`. Example: `Select` is `<SelectPrimitive.Root data-slot="select" {...props} />` (`apps/v4/registry/bases/radix/ui/select.tsx` lines 9-12).
- **Compound parts are exported individually.** Radix select file exports `SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` as separate functions (lines 15-204). Each has a `data-slot` name.
- **No asChild or render-prop layer** in the shadcn wrappers; composition is by re-export and by the consumer editing the copied file.
- Import alias `cn` from `"cn"` in the registry source (the CLI rewrites it to the project's alias, per the registry docs; WebSearch snippet, **unverified** in the CLI source).

### 5.5 Styling and theming

- **Tailwind plus semantic classes.** `cn()` merges class strings (`apps/v4/lib/utils.ts` is the app copy; `bases/*/lib/utils.ts` for each base).
- **`style-*.css` files** (e.g. `apps/v4/registry/styles/style-nova.css`, line ~1250) define `.cn-switch`, `.cn-switch-thumb`, `.cn-switch-aria` as `@apply` blocks over Tailwind utilities, including `data-checked:bg-primary` and `data-[size=default]:h-[18.4px]`. So theme colours come through Tailwind tokens (`bg-primary`, `bg-input`, `ring-ring`), which map to CSS variables in the project's Tailwind setup (variable definitions were not read).
- Themes are style sets (`style-*.css`), not runtime objects.
- Consumers override by editing the copied file or by passing `className` (merged with `cn`).

### 5.6 API shape

- The wrapper's props are the primitive's props plus `size`. So the API is whatever Radix or Base UI or React Aria exposes: controlled and uncontrolled (`checked`/`defaultChecked`, `onCheckedChange`) for Radix; the same family for Base UI; the `isSelected` family for React Aria.
- No global state. No state added by the wrapper.

---

## What fits YUI

Context from the brief and checked in the repo: YUI is a Tauri desktop app on React 19 (`package.json` has `"react": "19.3.1"`), moving one window at a time. Some vanilla-DOM leaf pieces stay and are mounted in React through a ref-mount wrapper (the wrapper name was **not** verified in this read). Styling is plain CSS with one tokens file, `src/ui/tokens.css`, with `--yui-*` custom properties (127 `--yui-` mentions in that file) and themes set through `data-theme` (the attribute is used in `src/ui/tokens.css` and `src/ui/tokens.test.ts`). `package.json` has no `@stylexjs` dependency. `src/` is layered by feature folders per `AGENTS.md` (the layer order `contract, tauri-env, logger → config → renderer → settings → io → dispatcher → ambient → ui → app → windows`, as stated in AGENTS.md "Engineering principles").

### Patterns that transfer

1. **One folder per component (or feature), one entry file, one file per part.** Base UI (`switch/index.ts`, `index.parts.ts`, `root/`, `thumb/`) and Radix (`switch/src/index.ts` plus one file) both do this, matching the AGENTS.md rule that a feature gets its own sub-folder and a folder holds one feature. Base UI's split into `root/` and `thumb/` is the closest model for a multi-part component in YUI's `ui/` layer.
2. **Behaviour in a hook, markup in the component.** React Aria's `useSwitch` (behaviour and ARIA props) and `SwitchButton` (markup) split is the cleanest example. It fits the AGENTS.md rule "core logic lives in its own module behind an explicit interface (inputs in, results out)". Keep the logic testable without DOM.
3. **State as data attributes, not classes.** Base UI, React Aria and Radix all expose `data-checked`, `data-disabled`, `data-state`, `data-selected`. YUI can follow this in plain CSS (`[data-theme]` is already the pattern). It needs no StyleX.
4. **Controlled-first or controlled-only API with events out.** Astryx Switch is controlled-only (`value` plus `onChange(checked, e)`, `Switch.tsx` lines 727-760). Radix and Base UI support both. For YUI, where "the client never writes the reply" and state lives elsewhere, the controlled form is the one that avoids two sources of truth. Prefer the controlled shape for any YUI component that holds backend-owned state.
5. **Thin wrapper that forwards props and adds a data-slot or data-part name** (shadcn `data-slot`). This is the simplest way to give CSS a stable hook. It needs no framework.
6. **Context scoped to one component tree, no global store.** All five kits do this. This matches "no global state" in spirit; YUI's `src/` already separates feature state into its own modules.

### Patterns that do not transfer, or transfer with cost

1. **StyleX (Astryx).** YUI has no StyleX dependency. Adopting it means a build-time compiler and a 0.x beta API. The AGENTS.md rules ("choose the simplest implementation", "prefer proven libraries when they lower overall complexity") do not support it for YUI's current plain-CSS tokens. Astryx's token idea (named token objects) can be copied in plain CSS by keeping `tokens.css` as the only source.
2. **Tailwind-based styling (shadcn).** YUI's styling is plain CSS and tokens. The `cn-*` + `@apply` pattern would reintroduce Tailwind. The `data-slot` idea transfers; the class strings do not.
3. **Copy-into-project from the CLI (shadcn, Astryx swizzle).** YUI already owns its source, so the benefit is small. The risk is drift between copies; the shadcn bases README shows the cost (two trees to keep in sync). Not recommended for YUI.
4. **`asChild` and Radix Slot.** Not needed. YUI's DOM is mounted by hand. A ref-mount wrapper takes a ref and a props object, which is simpler than Slot.
5. **Full headless kit (Radix, Base UI, React Aria) as the base of `ui/`.** These expect React rendering for each part. YUI's vanilla-DOM leaves can't use them without the ref-mount wrapper, and the wrapper would then need to host a React island. Use a kit only for a new, all-React window, and only if the ARIA behaviour (focus trap, listbox keyboard) is hard to write by hand. React Aria's hooks (`react-aria` package) are the most usable of these in a bare-DOM setting, because they return props objects and do not need components. This is **unverified** for YUI and needs a spike.
6. **Compound components with context (Radix Select, RAC Select).** These add context plumbing. YUI should use them only for a component that really has several parts. Most YUI leaves are one element.

### Short recommendation

- Keep `src/ui/tokens.css` as the only token source; follow the `data-*` state convention from Base UI and React Aria for the CSS hooks.
- Give each `ui/` feature one folder with an `index.ts`, a markup/behaviour split, and a controlled-first API. Copy the folder shape from Base UI's `switch/` (`index.ts`, `root/`, `thumb/`).
- Do not adopt StyleX, Tailwind, or a copy-based CLI.
- If a React island is needed for a complex widget, a headless hook library (React Aria hooks) is the only kit here that works without its own components. Test it in a spike before choosing it.

---

## Unverified or not read

- Astryx docs site (`astryx.atmeta.com`) and the Storybook: linked from the README, not fetched. Component API details come from source only.
- Astryx `defineTheme.ts` and `generateThemeRules.ts`: file names only.
- Astryx `asChild`: no convention found in files read; the one text-search result set was substring noise.
- Base UI `useRenderElement` implementation and `use-button` internals: not read beyond their call sites.
- Base UI `role="switch"` location: not traced.
- Radix docs site (`radix-ui.com/primitives/docs/...`): not fetched; source only.
- React Aria docs pages (`react-aria.adobe.com/Select`, `/getting-started`): WebSearch snippets only. The searchable-Select and selector CSS claims come from those snippets.
- React Aria `useToggleState` prop names: not read line by line.
- shadcn registry docs (`ui.shadcn.com/docs/registry/registry-json`, changelog 2.5.0): WebSearch snippets only. The "files can live anywhere" claim is from a snippet.
- shadcn CLI import rewriting for `cn`: not read.
- YUI ref-mount wrapper: the name and file were not located. `src/ui/quick-card/quick-card.ts` and `src/renderer/index.ts` contain `createRoot`, which may be related. Not checked further.

## Sources read (primary)

Astryx (`meta/astryx`, main):
- README: https://github.com/meta/astryx/blob/main/README.md
- Core package: https://github.com/meta/astryx/blob/main/packages/core/package.json
- Core index: https://github.com/meta/astryx/blob/main/packages/core/src/index.ts
- Switch: https://github.com/meta/astryx/blob/main/packages/core/src/Switch/Switch.tsx, `.../Switch/index.ts`, `.../Switch/Switch.doc.mjs`
- Dialog: https://github.com/meta/astryx/blob/main/packages/core/src/Dialog/index.ts, `.../Dialog/DialogHeader.tsx`, `.../Dialog/Dialog.tsx`
- Field: https://github.com/meta/astryx/blob/main/packages/core/src/Field/fieldParts.ts
- Selector: https://github.com/meta/astryx/blob/main/packages/core/src/Selector/Selector.tsx
- BaseProps: https://github.com/meta/astryx/blob/main/packages/core/src/BaseProps.ts
- CLI README: https://github.com/meta/astryx/blob/main/packages/cli/README.md

Base UI (`mui/base-ui`, master):
- Switch: https://github.com/mui/base-ui/tree/master/packages/react/src/switch (`index.ts`, `index.parts.ts`, `root/SwitchRoot.tsx`, `root/SwitchRootDataAttributes.ts`, `stateAttributesMapping.ts`, `thumb/SwitchThumb.tsx`)
- Select: https://github.com/mui/base-ui/blob/master/packages/react/src/select/index.parts.ts, `.../select/root/SelectRoot.tsx`, `.../select/store.ts`
- Package: https://github.com/mui/base-ui/blob/master/packages/react/package.json
- Handbook composition: https://github.com/mui/base-ui/blob/master/docs/src/app/(docs)/react/handbook/composition/page.mdx (live: https://base-ui.com/react/handbook/composition)
- Handbook styling: https://github.com/mui/base-ui/blob/master/docs/src/app/(docs)/react/handbook/styling/page.mdx (live: https://base-ui.com/react/handbook/styling)

Radix Primitives (`radix-ui/primitives`, main):
- Switch: https://github.com/radix-ui/primitives/blob/main/packages/react/switch/src/switch.tsx, `.../switch/src/index.ts`, `.../switch/package.json`
- Select: https://github.com/radix-ui/primitives/blob/main/packages/react/select/src/select.tsx, `.../select/src/index.ts`, `.../select/package.json`
- Primitive: https://github.com/radix-ui/primitives/blob/main/packages/react/primitive/src/primitive.tsx
- Slot: https://github.com/radix-ui/primitives/blob/main/packages/react/slot/src/slot.tsx

React Aria (`adobe/react-spectrum`, main):
- Hook: https://github.com/adobe/react-spectrum/blob/main/packages/react-aria/src/switch/useSwitch.ts
- Toggle hook: https://github.com/adobe/react-spectrum/blob/main/packages/react-aria/src/toggle/useToggle.ts
- Toggle state: https://github.com/adobe/react-spectrum/blob/main/packages/react-stately/src/toggle/useToggleState.ts
- Shims: https://github.com/adobe/react-spectrum/blob/main/packages/@react-aria/switch/src/index.ts, `.../@react-stately/toggle/src/index.ts`
- RAC Switch: https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Switch.tsx
- RAC Select: https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/src/Select.tsx
- RAC package: https://github.com/adobe/react-spectrum/blob/main/packages/react-aria-components/package.json

shadcn/ui (`shadcn-ui/ui`, main):
- Radix switch: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/switch.tsx
- Radix select: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/radix/ui/select.tsx
- Bases README: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/bases/README.md
- Styles: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/styles/style-nova.css
- Docs: https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/components/radix/switch.mdx, `.../base/switch.mdx`

YUI (local, read-only checks): `/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI/` (`package.json`, `src/ui/tokens.css`, `src/ui/tokens.test.ts`, `AGENTS.md`, `src/` listing).
