# Design philosophy of reusable UI components

Research date: 2026-11-22. Scope: principles only. Kit folder layouts (Astryx, Base UI, Radix, React Aria, shadcn/ui) are out of scope and covered by another document.

Citation rule used here: a claim is cited to the primary page that was fetched and read. Search-result snippets and third-party write-ups were used only to locate primary pages and are not a basis for any claim. Where a primary page could not be read, the claim is marked **UNVERIFIED**.

---

## 1. Headless versus styled layering

**Summary.** Kits split behaviour and accessibility (roles, focus, keyboard, state) from presentation (look). The behaviour layer ships without styles, and the consumer supplies the look. This lets one tested interaction model serve many visual systems, and it moves visual decisions to the app.

**Claims.**

- Radix Primitives describes its components as shipping without styles, following WAI-ARIA design patterns, and offering granular access to each part so consumers can wrap parts and add their own props, refs or listeners. Quote: "Components ship without styles, giving you complete control over the look and feel." and "Components adhere to the WAI-ARIA design patterns where possible." Source: [Radix Primitives introduction](https://www.radix-ui.com/primitives/docs/overview/introduction) (undated; read in session 2026-11-22).
- React Aria states that it is "style-free out of the box" and that it puts behaviour in hooks, with the components as a convenience over the hooks. Quote: "for the ultimate control, drop down to the low-level Hook-based API." Source: [React Aria](https://react-aria.adobe.com/) (undated; the page redirected from the old React Spectrum URL). The page states no tradeoffs.
- Headless UI describes itself as "Completely unstyled, fully accessible UI components, designed to integrate beautifully with Tailwind CSS." Source: [Headless UI](https://headlessui.com/) (undated).
- Base UI states that because it is unstyled, consumers can use "CSS-in-JS, plain CSS, or any other styling solution." Source: [Base UI quick start](https://base-ui.com/react/overview/quick-start) (npm badge on the page shows `@base-ui/react` 1.9.0).
- The stated reasons these kits chose the split are accessibility reuse and styling freedom. Radix says the goal is to help the community build accessible design systems and that the primitives can serve "as the base layer of your design system." Source: [Radix Primitives introduction](https://www.radix-ui.com/primitives/docs/overview/introduction).

**Costs (analysis, not a cited claim).** The consumer owns all visual work, so every app re-implements the same look per component. Keyboard and ARIA are hidden behind an API the app must still wire correctly, for example the required part structure. Upgrades change the behaviour contract, which the app must track even though no visible style changed.

---

## 2. Compound components and composition over configuration

**Summary.** Parts that share state through a parent, and composition through children or a render hook, replace long boolean-prop lists. A configuration API grows one prop per variant. A composition API lets the consumer place the parts.

**Claims.**

- Kent C. Dodds (18 Feb 2019) argues compound components give "a more expressive and flexible API" than prop configuration. He shows a prop-string select as hard to read and asks how `disabled` would be expressed. He shows a `Toggle` parent that shares state by context with `ToggleOn`, `ToggleOff` and `ToggleButton` children. Source: [Compound components with React hooks](https://kentcdodds.com/blog/compound-components-with-react-hooks).
- Radix's `asChild` prop: "Use the `asChild` prop to compose Radix's functionality onto alternative element types or your own React components." When set, "Radix will not render a default DOM element, instead cloning the part's child." The page says it can be nested to compose behaviour from several primitives. Source: [Radix composition guide](https://www.radix-ui.com/primitives/docs/guides/composition) (undated).
- Base UI's `render` prop: "Use the `render` prop to compose a Base UI part with your own React components." The custom component "must forward the `ref`, and spread all the received props on its underlying DOM node." The render function form is suggested for performance and gives control over spreading props. Source: [Base UI composition handbook](https://base-ui.com/react/handbook/composition) (npm badge shows 1.9.0).
- Base UI's composition page does not compare composition with configuration props, and the children-as-function pattern is not covered. The reasoning for composition over configuration is therefore **UNVERIFIED** from Base UI; the Kent C. Dodds article is the primary source that makes the comparison.
- React's own guidance on controlled and uncontrolled components: "Controlled components are maximally flexible, but they require the parent components to fully configure them with props." and "Uncontrolled components are easier to use within their parents because they require less configuration." Source: [React: Sharing state between components](https://react.dev/learn/sharing-state-between-components) (undated; the live docs).

**Costs (analysis).** Compound APIs need context and a stable part order, and they are harder to type than flat props. A `asChild`-style slot moves the attribute merging problem to the app.

---

## 3. Isolation: props in, events out

**Summary.** A reusable component should receive data as props and report user intent as events. It should not read or write application state directly. Control is either given by the parent (controlled) or kept internal (uncontrolled), and a component should pick one per value.

**Claims.**

- React: "It's useful to consider components as 'controlled' (driven by props) or 'uncontrolled' (driven by state)." And "When writing a component, consider which information in it should be controlled (via props), and which information should be uncontrolled (via state). But you can always change your mind and refactor later." Source: [React: Sharing state between components](https://react.dev/learn/sharing-state-between-components).
- React on hooks: "Custom Hooks let you share *stateful logic* but not *state itself.* Each call to a Hook is completely independent from every other call to the same Hook." Source: [React: Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) (undated).
- Dan Abramov, "Writing Resilient Components" (16 Mar 2019): "Components should be resilient to rendering less or more often." He warns that "by copying a prop into state you're ignoring all updates to it," and recommends naming a prop `initialColor` or `defaultColor` when only the initial value is used. Also: "Think about which state is local to a particular UI representation" and "don't hoist that state higher than necessary." Source: [Writing Resilient Components](https://overreacted.io/writing-resilient-components/).
- Container versus presentational split. The 2015 Abramov article described containers as stateful and presentational components as stateless, calling this "a soft guideline." Its 2019 update is reported to say the split is no longer recommended in favour of hooks. The original Medium page returned HTTP 403 and the overreacted mirror returned HTTP 404, so **both claims are UNVERIFIED from primary text**. Primary URL for the next reader: [Presentational and Container Components (Medium)](https://medium.com/@dan_abramov/7ca2f9a7c7d0).
- Hooks as the way to separate logic from view: React's guidance is to extract a custom hook when an Effect must synchronise with an external system, and "You don't need to extract a custom Hook for every little duplicated bit of code." Source: [React: Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).

---

## 4. Design-token tiers

**Summary.** Tokens are named values in layers. Primitive (global) values hold raw choices, semantic (alias) tokens say what a value is for, and component tokens hold values for one component. Consumers normally use the semantic layer, and the tiers can be themed by swapping one layer.

**Claims.**

- DTCG Format Module 2025.10 (Final Community Group Report, 28 Oct 2025) defines a token as an object with `$value` and requires every token to use one of the defined `$type` values. A value may be a reference, written `{group.token}`, that "always resolves to the `$value` property of the target token." Circular references are forbidden. Source: [DTCG Format Module 2025.10](https://www.designtokens.org/TR/2025.10/format/).
- DTCG defines a `dimension` type, which "Represents an amount of distance in a single dimension in the UI, such as a position, width, height, radius, or thickness." Its unit "may only be `px` or `rem`". Source: same page, section 8.2. This is the type a spacing scale would use.
- DTCG Resolver Module 2025.10 describes theming, "such as light mode, dark mode, and high contrast color modes," and states that sets "will be merged in array order," with later tokens overriding earlier ones. Source: [DTCG Resolver Module 2025.10](https://www.designtokens.org/TR/2025.10/resolver/) (28 Oct 2025).
- DTCG status: the 2025.10 release is the first stable version; the group states it is "not a W3C Standard." Source: [W3C Community Group announcement, 28 Oct 2025](https://w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/) (read via search summary only; **UNVERIFIED as a fetched primary**).
- The DTCG format spec does **not** define primitive, semantic or component tiers. Those tiers come from vendor systems (below).
- Adobe Spectrum: "Primitive tokens define the available values in the design language." "Semantic tokens are the primary way consumers interact with Spectrum design tokens." "Spectrum prioritizes reusable semantic decisions whenever possible, which reduces the need for component-specific tokens." Source: [Spectrum design tokens](https://spectrum.adobe.com/page/design-tokens/) (undated).
- Material 3 tiers (reference, system, component): **UNVERIFIED**. The Material 3 overview and how-tokens-are-used pages returned only a title or HTTP 404 in this session.
- Salesforce Lightning Design System tokens: **UNVERIFIED**. The guideline page returned HTTP 404.
- Spacing scale in the token set: the DTCG `dimension` type is the only primary-sourced support found. Whether a spacing scale belongs in the token set beyond that is **UNVERIFIED** (no Spectrum or Material spacing page was read).

---

## 5. Atomic design and its critiques

**Summary.** Brad Frost's atomic design (2013) is a mental model for composing a UI from atoms, molecules, organisms, templates and pages. Frost himself says the levels are not sequential, the chemistry analogy should be dropped, and the model is limited in scope.

**Claims.**

- Atoms are "the foundational building blocks"; molecules are "relatively simple groups of UI elements functioning together as a unit"; organisms are "relatively complex UI components composed of groups of molecules and/or atoms and/or other organisms"; templates "place components into a layout"; pages are "specific instances of templates that show what a UI looks like with real representative content." Source: [Atomic Design, chapter 2](https://atomicdesign.bradfrost.com/chapter-2/) (book text, undated).
- Frost: "atomic design is not rigid dogma" and "essentially it's merely a mental model for constructing a UI." And: "Atomic design is not a linear process." Source: same chapter 2 page.
- Frost on the chemistry analogy: "Trying to carry the chemistry analogy too far might confuse your stakeholders." Source: same page.
- Frost on scope (10 Jul 2019): "Because atomic design is limited in its scope, it doesn't explicitly deal with a whole lot of things." Motion, flows, personas, A/B testing, localization and testing are named as outside it. He writes that such topics "can live adjacent to atomic design." Source: [Extending atomic design](https://bradfrost.com/blog/post/extending-atomic-design/).
- Frost on parts and wholes (16 Dec 2013): atomic design "allows designers to traverse between abstract and concrete." Source: [The Part and The Whole](https://bradfrost.com/blog/post/the-part-and-the-whole/).
- Third-party critiques (for example, Sparkbox and the Design Systems Collective, which argue the model is rigid as application architecture): these were found only in search results and are **not** cited as a basis. A primary critique by Nathan Curtis was not found; that critique is **UNVERIFIED**.

**Boundaries in practice.** The primitive, pattern and feature split is not a Frost rule. It is the practical reading that his own scope note implies: the levels describe composition, while feature logic (flows, data, state) lives adjacent to the components. This reading is analysis, not a cited claim.

---

## 6. Copy-in ownership (shadcn/ui) versus installed library

**Summary.** A package gives upgrades and a stable API at the cost of overriding and wrapping. Copied source gives full edit rights and no upgrade path unless the team builds one.

**Claims.**

- shadcn/ui: "This is not a component library. It is how you build your component library." It says package libraries push consumers toward "wrapping components or writing style overrides when you need changes." It states "The top layer of your component code is open for modification." Source: [shadcn/ui docs](https://ui.shadcn.com/docs) (undated). The page does not state tradeoffs. It raises the question "How do I pull upstream updates in an Open Code approach?" without an answer; that tradeoff is **UNVERIFIED from a primary answer**.

**Trade-offs (analysis, not cited).** Owned code is easy to change and easy to read in the app. Bug fixes in the shared source must be re-applied by hand. Copies drift if the same component is copied in several places.

---

## 7. When not to extract a component

**Summary.** Duplication is cheaper than the wrong shared abstraction, and a shared abstraction should wait until the shape of the repeated code is clear.

**Claims.**

- Sandi Metz, "The Wrong Abstraction" (20 Jan 2016): "Duplication is far cheaper than the wrong abstraction." The sign of a wrong one: "If you find yourself passing parameters and adding conditional paths through shared code, the abstraction is incorrect." Advice: "Once an abstraction is proved wrong the best strategy is to re-introduce duplication and let it show you what's right." Source: [sandimetz.com, The Wrong Abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction).
- Rule of three, as described by J. B. Rainsberger (7 Nov 2025): "Should you follow the Rule of Three? **I don't know**." He calls the rule a guard against removing duplication without first checking whether it is "accidental or essential," and says he is more relaxed about extracting early and inlining again. Source: [Clarifying the Rule of Three in Refactoring](https://blog.jbrains.ca/permalink/clarifying-the-rule-of-three-in-refactoring). He attributes the rule to Martin Fowler's *Refactoring*. The Fowler text itself was not read: the attribution to Don Roberts and the exact Fowler wording are **UNVERIFIED**.
- React on custom hooks: "You don't need to extract a custom Hook for every little duplicated bit of code. Some duplication is fine." Source: [React: Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks).

---

## What fits YUI

YUI is a Tauri desktop app moving to React 19 one window at a time. Measurements below were taken in this session on the YUI repo at `/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI`, read-only.

| Fact | Measured value | Command |
|---|---|---|
| `src/ui/tokens.css` exists, one tokens file | 150 lines; 127 lines contain `--yui-` | `wc -l src/ui/tokens.css`; `grep -c -- '--yui-' src/ui/tokens.css` |
| Themes via `data-theme` | Dawn set on `:root`; Hearth on `:root[data-theme="hearth"]` (line 94). `apply-theme.ts` writes `root.dataset.theme`. 11 `data-theme` occurrences under `src`, in 7 files | `grep -rn 'data-theme' src`; `grep -n 'data-theme' src/ui/tokens.css` |
| No spacing tokens | 0. The only layout-like tokens are `--yui-radius*` | `grep -o -- '--yui-[a-z0-9-]*' src/ui/tokens.css \| sort -u` |
| Plain CSS, raw px/rem | 73 CSS files, 11,415 lines total. Lines with a px or rem value: 1,353 total, 1,334 excluding `tokens.css`. Occurrences: 1,637 | `find src -name '*.css' -exec cat {} + \| wc -l`; `grep -rhE '[0-9](\.[0-9]+)?(px\|rem)\b' src --include='*.css' \| wc -l` |
| Figure "1123 CSS lines" | Reproduced as a different count: 1,123 is the lines carrying a px or rem length **and no `var()`**; 1,353 is every line carrying a px or rem length | `git grep -hE '[0-9.]+(px\|rem)' -- 'src/*.css' \| grep -v 'var(' \| wc -l` (1123) at `3b42a456` |
| Switch hand-written in about 10 files | 10 non-test production files contain `role="switch"`: 8 vanilla template-string files under `src/ui/quick-controls/` and 2 React files under `src/ui/quick-card/` (`tiles.tsx`, `quiet-group.tsx`). 18 files reference `yui-switch` including tests and CSS | `grep -rl 'role="switch"' src \| grep -v '\.test\.'`; `grep -rl 'yui-switch' src \| wc -l` |
| Ref-mount wrapper for vanilla leaves | **No shared wrapper found.** The pattern exists inline in `src/ui/quick-card/head.tsx`: `Face` uses `useRef` and `useLayoutEffect` to call `avatarEl` into a host `span`. Vanilla mount functions exist (`mountCueLists`, `mountEmotionPanel`, `createDelegationChipMount`), but none is a generic React adapter | `grep -rn 'useLayoutEffect' src/ui --include='*.tsx'`; `grep -rn -E 'export (function\|const) [a-zA-Z]*[Mm]ount' src` |
| React version | 19.3.1 | `grep -n '"react"' package.json` |

Principles that apply, in order of return on effort:

1. **Tokens first, semantic tier before components.** Add a small semantic layer over the existing `--yui-*` primitives, and a spacing scale typed as DTCG `dimension` values (`px` or `rem` only). The 1,334 raw px/rem lines are the cost of not doing this. Apply the scale only when a rule is touched, not in a sweep. Keep the DTCG naming shape (`{group.token}` aliases) so a later tool can read it; do not adopt the DTCG tooling yet.
2. **Extract the switch once, as a primitive with one contract.** Ten production copies pass the rule of three by a wide margin (Rainsberger's caveat applies, so the contract should be small). Keep its markup and `aria-checked` contract in one module that both the vanilla and React paths use. Per AGENTS.md, do not add a shared adapter for it beyond what the switch needs.
3. **Ref-mount as one shared function, only when the third caller exists.** `head.tsx` is one caller. Wait for the next React window to show the same pattern before writing a generic wrapper (Metz and Rainsberger both argue against abstracting on a guess).
4. **Compound or composition APIs only for sections that grow parts.** The quick-card sections are the likely candidates. Use children and a shared context for them, not a configuration object, once a section gets a third optional part.
5. **Do not adopt a headless kit as a whole-app layer in this round.** The kit choice is out of scope here. The principle is that behaviour and styling can be split later at the switch and the sections, without moving the whole app.

Order: tokens (1), switch (2), then the adapter decision (3) when a third window needs it. Items 4 and 5 wait for a concrete need.

**UNVERIFIED items in this section.** The claim that the React 19 migration needs a generic adapter (no primary source read on this). Material 3 and Salesforce tier models.

---

## Sources

Primary (read in full or in the quoted section this session):

1. [Radix Primitives introduction](https://www.radix-ui.com/primitives/docs/overview/introduction): primary, official docs, undated.
2. [Radix composition guide](https://www.radix-ui.com/primitives/docs/guides/composition): primary, official docs, undated.
3. [React Aria](https://react-aria.adobe.com/): primary, official docs (the page redirected from react-spectrum.adobe.com/react-aria/why.html), undated.
4. [Base UI quick start](https://base-ui.com/react/overview/quick-start): primary, official docs, npm badge 1.9.0.
5. [Base UI composition handbook](https://base-ui.com/react/handbook/composition): primary, official docs, npm badge 1.9.0.
6. [Headless UI](https://headlessui.com/): primary, official docs, undated.
7. [shadcn/ui docs](https://ui.shadcn.com/docs): primary, official docs, undated.
8. [React: Sharing state between components](https://react.dev/learn/sharing-state-between-components): primary, official docs, undated.
9. [React: Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks): primary, official docs, undated.
10. [Compound components with React hooks, Kent C. Dodds, 18 Feb 2019](https://kentcdodds.com/blog/compound-components-with-react-hooks): primary, author's blog.
11. [Writing Resilient Components, Dan Abramov, 16 Mar 2019](https://overreacted.io/writing-resilient-components/): primary, author's blog.
12. [The Wrong Abstraction, Sandi Metz, 20 Jan 2016](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction): primary, author's blog.
13. [Clarifying the Rule of Three in Refactoring, J. B. Rainsberger, 7 Nov 2025](https://blog.jbrains.ca/permalink/clarifying-the-rule-of-three-in-refactoring): primary, author's blog.
14. [DTCG Format Module 2025.10, 28 Oct 2025](https://www.designtokens.org/TR/2025.10/format/): primary, community group specification.
15. [DTCG Resolver Module 2025.10, 28 Oct 2025](https://www.designtokens.org/TR/2025.10/resolver/): primary, community group specification.
16. [Adobe Spectrum design tokens](https://spectrum.adobe.com/page/design-tokens/): primary, official docs, undated.
17. [Atomic Design, chapter 2, Brad Frost](https://atomicdesign.bradfrost.com/chapter-2/): primary, author's book text, undated.
18. [Extending atomic design, Brad Frost, 10 Jul 2019](https://bradfrost.com/blog/post/extending-atomic-design/): primary, author's blog.
19. [The Part and The Whole, Brad Frost, 16 Dec 2013](https://bradfrost.com/blog/post/the-part-and-the-whole/): primary, author's blog.

Fetched but not usable (error or title only):

20. [Material Design 3 overview](https://m3.material.io/foundations/design-tokens/overview): primary, returned only the title. Not used.
21. [Material Design 3 how tokens are used](https://m3.material.io/foundations/design-tokens/how-tokens-are-used): primary, HTTP 404. Not used.
22. [Salesforce Lightning design tokens](https://www.lightningdesignsystem.com/guidelines/design-tokens/): primary, HTTP 404. Not used.
23. [Presentational and Container Components, Dan Abramov (Medium)](https://medium.com/@dan_abramov/7ca2f9a7c7d0): primary, HTTP 403. Not used.
24. [Smart and dumb components, Dan Abramov (Medium)](https://medium.com/@dan_abramov/smart-and-dumb-components-7ca2f9a7c7d0): primary, HTTP 403. Not used.
25. [Presentational and container components, overreacted](https://overreacted.io/presentational-and-container-components/): primary, HTTP 404. Not used.
26. [DTCG 2025.10 announcement, W3C Community Group, 28 Oct 2025](https://w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/): primary, seen only in search results. Not fetched.

Secondary, located through search and not used as a basis for any claim:

27. [Sparkbox, Iterating on atomic design](https://sparkbox.com/foundry/iterating_on_atomic_design): secondary, search result only.
28. [Design Systems Collective, The balancing act of design systems](https://www.designsystemscollective.com/the-balancing-act-of-design-systems-are-they-helping-or-holding-you-back-f07d8aabfb01): secondary, search result only.
29. [Rule of three (computer programming), Wikipedia](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming)): secondary, search result only.
30. [freeCodeCamp, A new approach to React component design (Austin Malerba)](https://www.freecodecamp.org/news/a-new-approach-to-react-component-design-2bf76a87add1/): secondary, search result only.

Repo measurements were taken with read-only `grep`, `wc`, `find` and `cat` commands against `/Users/nam-young-woo/Desktop/codes/waifu/2026/YUI`, as listed in the table above.
