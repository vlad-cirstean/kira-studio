# P78 — Code navigation: modifier-click, Go method sets, reference/implementation wiring

`docs/v1.8/SPEC.md`'s P78 row, turned into concrete steps. Everything below was read in the current
tree (`claude/v1-8-api-git-modules-e2luom` at `70c2bbc1`, P71-P77 landed); line numbers are from
that tree, and from `monaco-editor@0.56.0` / `tree-sitter-go@v0.25.0` as pinned in `package.json`
and `go.mod`.

SPEC calls this phase "mostly green field relative to prior phases' work." Checked, not assumed:
`git log` over `internal/codegraph`, `internal/codeparse` and `views/repo/navigation.ts` shows the
last touch to any of them is v1.7's M1c (`266b2947`, `f453ee37`) and C6 (`fbdd9129`). No P71-P77
commit touches any file this phase changes except `StatusBar.vue` (P76) and the two repo views.

Three parts, in SPEC's own required order at the only place it constrains one. **Part A** — the
modifier-click fix, root-caused by measurement below. **Part B** — the Go receiver/method-set gap.
**Part C** — the reference/implementation providers. Part C needs both: Monaco's peek widgets
resolve every entry through the same service Part A replaces, and a Go-to-implementation command
does nothing until Part B lands.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Which of SPEC's four candidates explains "Cmd/Ctrl+click doesn't navigate" | **None of the four as written.** Measured in the real app under Playwright: **Cmd+click navigates correctly**; Ctrl+click cannot, because Monaco derives the trigger modifier from the platform and this app runs on a Macintosh UA. What is genuinely broken is the *affordance*: the link underline and its preview never render for a cross-file target, because standalone Monaco's `ITextModelService` rejects a URI with no already-created model | §1.1-§1.3 |
| What to fix, then | A `kira-repo`-aware `ITextModelService`, installed once at Monaco bootstrap. Not a click-handling change — the click already works | §1.4 |
| Should Ctrl also trigger on macOS | **No.** Monaco binds exactly one of Cmd/Ctrl per platform and offers no "either" setting; on macOS Ctrl+click is the system secondary click. Nothing is changed here, and the reason is recorded rather than left to be re-derived | §1.5 |
| Does `method_declaration` really store no receiver | The **method symbol row** stores none, true. But the receiver's own type identifier is already an indexed `type` **reference** row — the committed golden fixture proves it (`extract_test.go:345`-`346`, two `{"type","Person"}` rows for one `type Person struct{}` plus one receiver). The gap is that nothing labels it, so a method set cannot be assembled by an indexed lookup | §2.1 |
| Is a new capture needed at all, then | **Yes**, for cost, not for information: a labelled `receiver` kind turns "every method on type T" into one `ReferencesByName` read against the existing `reference_name` index, instead of a repository-wide file scan | §3.2 |
| A second, unnamed Go gap | **An interface has no methods in the index at all** — `go/tags.scm` has no `method_elem` pattern, so `type Greeter interface { Greet() string }` yields one `type` symbol and nothing else (`extract_test.go:292`). Without it there is no method set to compare *against*, and item (2) cannot work | §2.2 |
| `go/m1c_fields.scm`'s embedded-field case | Real, and it is the file SPEC names (`m1c_fields.scm:10`: "An embedded field has no `name` field and is not matched"). Go promotes an embedded type's methods into the outer type's method set, so it is load-bearing here, not cosmetic | §2.3, §3.1 |
| What "the Go resolver checks it before falling back to name-proximity" can mean without type inference | A **ranking** rule, not a resolution claim: a method call inside a method prefers a candidate whose receiver type is the enclosing method's own receiver type. No signature comparison, no inference; a demotion, never a filter, exactly like the six rules already in `sortCandidates` | §5 |
| What "`Refs.Sites`/`Target` carrying no per-occurrence confidence signal" concretely means | `Site` (`codegraph.go:67`-`72`) has no confidence field at all, though `ReferencesTo` computes one per referring group and discards it (`references.go:170`-`181`). So the signal exists and is thrown away — it is not missing from the data, only from the type | §6.3 |
| How to surface it, given `Location[]` | It cannot go **inside** the peek list: `referencesTree.js`/`referencesWidget.js` render URI plus line preview per entry, with no per-entry label slot. It goes **beside** it — a status-bar readout, reusing P76's `blameStatus.ts` store shape verbatim | §7 |
| New unit tests | **More than prior phases, and named individually.** Two earned: the Go method-set assembly (`internal/codegraph`), and the preview-model cache's eviction rules (TS). Plus two existing test files extended | §11 |
| One Sonnet pass or a split | One, sequential, with one real seam after Part A | §12.2 |

### 0.1 Which host each item is about

`internal/codegraph` is reached through exactly two front doors. Checked by grep: the VS Code
extension (`apps/kira-studio-vscode/src`), `packages/git-ui` and `packages/git-core` contain zero
references to `codegraph` or `codeworkspace` — code navigation is desktop-only, and the extension's
own editor is VS Code's, with its own language services.

| Item | Kira Studio desktop | repo-map MCP server | VS Code extension |
|---|---|---|---|
| §1 modifier-click affordance | **yes — the only host** | no (no Monaco) | no |
| §3/§4 Go method sets | yes (`ImplementationsOf`) | **yes** — `find_implementations` answers for Go for the first time | no |
| §5 receiver ranking | yes (hover/F12) | yes (`find_definition` rule string) | no |
| §7 per-site confidence | yes (status readout) | yes (`renderReferences` line) | no |
| §8 the two providers | **yes — the only host** | already has both tools | no |

---

# Part A — the modifier-click fix

## 1. Root cause, measured

### 1.1 What was measured

SPEC asks for a root cause, not a guess, so the gesture was driven in the real application: the
`ui` Playwright tier (`bun run build:test`, project `ui`), a seeded repo workspace, `a.ts` open in
`RepoFileView.vue`'s real Monaco editor, `CodeWorkspaceService.Definitions` mocked to answer one
target, and `GotoDefinitionAtPositionEditorContribution` plus its private `ClickLinkGesture`
instrumented from the page. Three facts came out, none of them inferable from reading alone.

**Fact 1 — the gesture's own trigger check fails for Ctrl.** With Control held, the raw editor
mouse events carry `ctrlKey=true` and `target.type=6` (`CONTENT_TEXT`), yet the gesture computes
`hasTriggerModifier=false`, never fires `onExecute`, and the contribution's `isEnabled` is never
called for the click at all:

```
isEnabled -> false | hasModel=true left=true single=true type=6 trig=false has=true ordered=1
gestureDown trig=false
mousedown ctrl=true meta=false type=6
gestureUp trig=false hadKeyOnDown=false lineDown=2
```

**Fact 2 — with Cmd it works end to end.** Same editor, same target, `Meta` instead of `Control`:

```
gestureDown trig=true
gestureUp trig=true hadKeyOnDown=true lineDown=2
isEnabled -> true | … has=true ordered=1
gotoDefinition {"lineNumber":2,"column":13}
EXECUTE fired
```

and the tab strip goes from `["","a.ts"]` to `["","b.ts"]` — the target file opened as a preview
tab through `navigation.ts`'s own editor opener.

**Fact 3 — the link affordance never renders for a cross-file target.** In the same Cmd run, with
the target in a *different* file, `document.querySelectorAll('.goto-definition-link').length` is
`0` and the page records one unhandled rejection, `Model not found`. Point the same fixture's target
back into the open file and the count is `1` with no rejection. So the underline (and the preview
hover on it) is present exactly when the target file already has a model, and absent otherwise.

The harness's own user agent matters and is recorded here because it is a trap for whoever writes
the spec in §11: Playwright's WebKit reports
`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) …`, which is also what the packaged app's
WKWebView reports. A spec that presses `Control` passes vacuously.

### 1.2 SPEC's four candidates, each settled

| Candidate | Verdict | Evidence |
|---|---|---|
| "modifier-click never reaching the provider" | **Wrong** | `has=true ordered=1` — the definition provider is registered and scores for the model. Under Cmd the provider is called twice, once on the hover path and once from `gotoDefinition` |
| "a platform Cmd-vs-Ctrl mismatch" | **Right in outline, and now exact** | `clickLinkGesture.js:58`-`68`'s `createOptions` picks `'metaKey'` when `isMacintosh`, `'ctrlKey'` otherwise. `isMacintosh` is a user-agent sniff (`base/common/platform.js`). One modifier per platform, never both |
| "an editor option shadowing the binding" | **Wrong** | Read live off the editor: `multiCursorModifier='altKey'`, `mouseMiddleClickAction='default'`, `definitionLinkOpensInPeek=false`. All defaults; nothing in this repo sets any of them |
| "the provider silently failing on click-triggered requests specifically" | **Wrong** | The provider answers identically on both paths — same `Definitions` args, same result, logged at `{line:2,column:13}` for the click and `{line:2,column:12}` for the hover |

So the reported symptom has two separable halves, and only one of them is a defect this repo owns.
Ctrl+click on macOS is not a defect (§1.5). The missing affordance is.

### 1.3 The real defect: the preview resolve kills the decoration

`goToDefinitionAtPosition.js:156`-`178` — the single-result branch of `startFindDefinition`:

```js
const result = results[0];
if (!result.uri) { return; }
return this.textModelResolverService.createModelReference(result.uri).then(ref => {
  …
  this.addDecoration(linkRange, previewValue ? … : undefined);
  ref.dispose();
});
```

`addDecoration` — the thing that paints `.goto-definition-link` and attaches the preview hover — is
reachable **only** through that `.then`. And in the standalone build the service is
`StandaloneTextModelService` (`standaloneServices.js:127`-`133`):

```js
createModelReference(resource) {
    const model = this.modelService.getModel(resource);
    if (!model) { return Promise.reject(new Error(`Model not found`)); }
    return Promise.resolve(new ImmortalReference(new SimpleModel(model)));
}
```

This app creates a model only when a tab opens that file (`views/repo/monaco.ts:115`-`128`'s
`getOrCreateModel`, called from `RepoFileView.vue`/`RepoDiffView.vue`). A cross-file definition
target — the case go-to-definition exists for — has no model, so the promise rejects, the decoration
is never added, and `startFindDefinitionFromMouse` neither awaits nor catches
(`goToDefinitionAtPosition.js:96`-`108`), leaving an unhandled rejection. Holding the modifier over
an identifier shows nothing: no underline, no pointer, no preview. The click still navigates, which
is precisely why this reads as "modifier-click does nothing."

The multi-result branch (`:147`-`154`) calls `addDecoration` directly and is unaffected — which is
why the underline does appear for an ambiguous name and not for the common single-candidate one.

**The same service is the reason C6 declined peek.** `RepoFileView.vue:215`-`221` records it:
"standalone Monaco's peek preview resolves each candidate through `ITextModelService`, which in the
standalone build only finds already-created models, so a cross-file candidate with no open tab
would render an empty preview pane." Confirmed still true and still the blocker —
`referencesWidget.js:482` and `referencesModel.js:100` both resolve every entry the same way. One
fix, two items: §8's peek UI needs this before it is worth wiring.

### 1.4 The fix: a `kira-repo`-aware `ITextModelService`

New `apps/kira-studio/frontend/src/views/repo/textModels.ts`, installed once at bootstrap.

**The seam.** `standaloneServices.js:732`-`752`'s `initialize(overrides)` keys each override by
plain service-id string through `createDecorator(serviceId)`, and `ITextModelService` is
`createDecorator('textModelService')` (`resolverService.js:3`). An override applies only while the
service is still a `SyncDescriptor`, i.e. before anything instantiates it — so it must run before
the first `editor.create`. `monacoEntry.ts` is already this app's sole contact point with
`monaco-editor` and already deep-imports through the package's `"./*": "./esm/vs/*.js"` map
(`editor/editor.api.js`, `features/register.all.js`), so the import belongs there and the call
belongs in `loadMonaco()`'s existing `.then` (`editor/monaco.ts:120`-`136`), beside `wireWorker`.
Passing the override as `editor.create`'s third argument instead would be order-dependent across
three call sites — `MonacoHost.vue`, `RepoFileView.vue`, `RepoDiffView.vue` — and silently wrong if
the console editor mounts first.

**The service.** Only what the two consumers read — `object.textEditorModel` and `dispose()`, as
used by `goToDefinitionAtPosition.js:163`-`176`, `referencesWidget.js:482`-`492` and
`referencesModel.js:100`:

```ts
async createModelReference(uri: Uri): Promise<{ object: { textEditorModel: ITextModel }; dispose(): void }> {
  const existing = mod.editor.getModel(uri);
  if (existing) return ownedRef(existing);           // a tab owns it; never disposed here
  if (uri.scheme !== 'kira-repo') throw new Error('Model not found');  // stock behaviour, verbatim
  const { repoId, path } = repoLocationFromUri(uri);
  const content = await control.codeWorkspaceReadFile(repoId, path);
  if (content.kind !== 'found') throw new Error('Model not found');
  return previewRef(getOrCreateModel(mod, uri.toString(), content.text, monacoLanguageFor(path), { repoId, path }));
}
```

Three points the implementer must not drift on:

- **Reuse `getOrCreateModel`, do not create a second model path.** It is the one cache keyed by URI
  string (`monaco.ts:13`), and `disposeModel` (`:130`) is what a tab close calls. A preview model
  created here and a tab opened on the same file later must be the same model, or the tab shows a
  stale copy.
- **Register the location.** A preview model's bytes are the worktree's, byte-identical to what the
  index parsed, so `repoLocations` (`monaco.ts:104`) is correct to record — which makes navigation
  work *inside* a peek preview too. A revision-pinned URI never reaches here (it carries
  `?rev=`, and `repoLocationFromUri` returns nothing for it), the same rule C6 D7 and P76 §2
  already enforce.
- **Failure is a rejection, not a silent empty model.** Binary, too-large, missing and a bridge
  error all reject with the same `Model not found` the stock service raises, so Monaco's own
  fallbacks run unchanged. No stubbed error handling, no empty-string model.

**Eviction.** A preview model is created without a tab, so nothing ever disposes it. Left alone that
is an unbounded leak across a session's peeks. `textModels.ts` keeps its own small registry of
preview-created URIs with three interacting rules:

1. A URI a tab owns is never evicted. Ownership is `editors.ts`'s existing tab→URI registration, so
   there is no second source of truth.
2. At most `PREVIEW_MODEL_LIMIT` (40) preview models; the least recently *resolved* goes first.
3. A URI promoted to a tab leaves the preview registry entirely — it is now tab-owned, and a later
   tab close disposes it through `dropResources` as it always did.

Those three interacting rules are the §11 unit test.

### 1.5 Ctrl on macOS: deliberately unchanged

`createOptions` offers exactly two shapes and `multiCursorModifier` only swaps which of Cmd/Ctrl
and Alt is the go-to-definition trigger — it never makes both work. Setting it to `'ctrlCmd'` would
move the trigger to **Alt** on macOS, which is worse than today. And on macOS, Ctrl+click is the
system secondary click: binding navigation to it would fight the context menu. So: Cmd+click is the
gesture on this app's only platform, it already works, and nothing here changes it. Recorded so the
next pass does not re-derive it.

### 1.6 Deliberately not changed in Part A

- **`multipleDefinitions: 'goto'`** stays (`RepoFileView.vue:225`, `RepoDiffView.vue:182`). Its
  *comment's* stated reason stops being true once §1.4 lands, so §8.3 rewrites the comment to the
  real remaining reason; the behaviour is unchanged.
- **The hover's own candidate list.** Unrelated to the affordance and already correct.
- **`MonacoHost.vue`'s editors** (SQL console, request bodies). They carry no `kira-repo` model, so
  the new service never answers for them; the override is process-wide but scheme-scoped.

---

# Part B — Go method sets

## 2. What the Go index carries today

### 2.1 The receiver type is a row, but an anonymous one

`go/tags.scm:13`-`17` captures a method's name only. But `:30`'s blanket
`(type_identifier) @name @reference.type` matches the receiver's type identifier like any other, and
the committed golden fixture proves the row exists: `sample.go` declares `type Person struct{}` once
and `func (p Person) Greet() string` once, and `extract_test.go:345`-`346` asserts **two**
`{"type","Person"}` reference rows. Same for `{"type","m1cStruct"}` at `:383`-`386`.

So `internal/codegraph/implementations.go:19`-`22` ("C1's own `method_declaration` capture stores no
receiver at all, so a type's method set can't be assembled from stored rows") is true of the
*symbol* row and overstated about the index as a whole. The information is there; nothing says which
`type` reference is a receiver, so finding "every method on `T`" means reading every Go file's
symbols and references and comparing byte ranges. That is the cost §3.2 removes.

### 2.2 An interface has no methods at all

`go/tags.scm:34` captures an interface's own name. Nothing captures `method_elem`. Confirmed against
`tree-sitter-go@v0.25.0`'s `src/node-types.json`: `interface_type`'s children are `method_elem` and
`type_elem`, and `method_elem` has a required `name: (field_identifier)`. Confirmed against the
fixture: `sample.go`'s `Greeter` interface declares `Greet() string`, and the golden symbol table
(`extract_test.go:292`-`294`) goes `type Greeter` → `type Person` → `method Greet` — the one `Greet`
row is `Person`'s, at top level, not the interface's child.

Compare Java, whose vendored `tags.scm:4`-`5` captures `method_declaration` inside an interface
body, so `extract_test.go:36`-`37` asserts `{"method","greet",0}` parented to `Greeter`. Go simply
has no equivalent pattern. **Without an interface's method set there is nothing to compare a
concrete type against**, so this is a prerequisite for item (2), not an extra.

### 2.3 Embedded fields are skipped, and Go promotes through them

`m1c_fields.scm:9`-`10` states it: "An embedded field has no `name` field and is not matched."
`field_declaration`'s `name` is `multiple: true, required: false` in the grammar, so `!name` is the
exact negation to match on. Go promotes an embedded type's method set into the outer type's, so
`type Dog struct { Animal }` must inherit `Animal`'s methods or the comparison in §4 is wrong for
every embedding type in a repository. `interface_type`'s `type_elem` is the same promotion one
construct over (`type ReadWriter interface { Reader; Writer }`).

## 3. The query change

### 3.1 `queries/go/p78_method_sets.scm`

A new file, per this repo's own one-file-per-phase convention (`p64b_declarations.scm`,
`p67f_reads.scm`, `m1c_fields.scm`), each with its own `Provenance` row. `m1c_fields.scm` is left
byte-identical except for one comment line pointing at this file, so M1c's own recorded reasoning
stays readable where it was written.

```scheme
; P78 §3.1 — the receiver type of a method declaration. Labelled `receiver` rather than left to
; tags.scm's blanket (type_identifier) @reference.type so "every method on T" is one indexed read.
(method_declaration
  receiver: (parameter_list
    (parameter_declaration
      type: [
        (type_identifier) @name
        (pointer_type (type_identifier) @name)
        (generic_type name: (type_identifier) @name)
        (pointer_type (generic_type name: (type_identifier) @name))
      ]))) @reference.receiver

; An interface's own method set. Parented to the interface by extract.go's range containment, the
; same way Java's vendored file already parents an interface method.
(interface_type
  (method_elem
    name: (field_identifier) @name) @definition.method)

; Embedded interface element — `type ReadWriter interface { Reader; Writer }`.
(interface_type
  (type_elem
    [ (type_identifier) @name
      (qualified_type name: (type_identifier) @name) ]) @reference.embed)

; Embedded struct field — `type Dog struct { Animal }`. `!name` is what distinguishes it from a
; named field; m1c_fields.scm's own pattern requires `name` and so never matches this.
(source_file
  (type_declaration
    (type_spec
      type: (struct_type
        (field_declaration_list
          (field_declaration
            !name
            type: [
              (type_identifier) @name
              (pointer_type (type_identifier) @name)
              (qualified_type name: (type_identifier) @name)
              (generic_type name: (type_identifier) @name)
            ]) @reference.embed)))))

; The same embedded field as a symbol — M1c's own documented gap (m1c_fields.scm:9-10). A separate
; pattern, not a second capture on the one above: extract.go's switch (extract.go:125-168) takes the
; @definition branch first, so one match can never produce both a symbol and a reference.
(source_file
  (type_declaration
    (type_spec
      type: (struct_type
        (field_declaration_list
          (field_declaration
            !name
            type: [
              (type_identifier) @name
              (pointer_type (type_identifier) @name)
              (qualified_type name: (type_identifier) @name)
              (generic_type name: (type_identifier) @name)
            ]) @definition.field)))))
```

The `source_file` anchor on both struct patterns is deliberate and copied from `m1c_fields.scm:11`:
a function-local or anonymous struct never becomes a symbol.

### 3.2 Two new reference kinds, and the duplicate they create

`extract.go:70`-`73`'s `referenceKinds` gains `"receiver"` and `"embed"`. Both are closed-set
additions; `Reference.Kind`'s own doc comment (`:47`) and migration `0002`'s column comment list
the vocabulary and are updated with them. **No schema migration**: `kind` is a `TEXT` column, and
nothing constrains its values.

The receiver's type identifier now produces two reference rows at the identical name range — the
pre-existing `type` row (span: the identifier) and the new `receiver` row (span: the whole
`method_declaration`). M1c already met this exact shape and solved it: `dropCallDuplicateFields`
(`extract.go:183`-`198`) drops a `field` row whose *name range* coincides with a `call` row, keyed on
the name range rather than the node span because the two spans deliberately differ. Generalize that
function rather than adding a second mechanism:

```go
// dropDuplicateNameRangeRefs keeps one row per name range when two patterns match one site under
// different kinds, preferring the more specific kind: a call over a field (M1c §2.6), a receiver or
// an embed over the blanket type capture (P78 §3.2).
```

Dropping the `type` row loses nothing: the site is still returned by `ReferencesTo`, now under kind
`receiver`, and a cursor on it still resolves — but `kindCompatibility` (`resolve.go:20`-`25`) must
gain `"receiver"` and `"embed"` entries mapping to the same candidate set as `"type"`, or the new
kinds fall into `kindCompatible`'s unrecognized-kind branch (`:29`-`32`) and lose the demotion the
`type` kind had. That is a one-line table addition and is required, not optional.

### 3.3 Registration

`queries.go`, three edits, the same three every prior query file needed: the `//go:embed` list
(`:11`), a `Provenance` row (`:34`-`98`, `thisRepo`), and `querySourcePaths[Go]` (`:113`), appended
last so composition order matches the file's own P64b/P67f/M1c precedent.

## 4. The method-set index — `internal/codegraph/methodsets.go`

Computed live per call, memoized within the call, never stored. That is C2 §3's standing rule
(`codegraph.go:1`-`5`: "no edge table, ever"), and it applies here for the same reason — a method
set is derived cross-file state.

### 4.1 `methodSet(typeName)`

One function for interfaces and concrete types alike; the union of three sources.

```go
type goTypes struct {
    g          *Graph
    files      fileCache
    syms       symbolCache
    refsByFile map[int64][]codeindex.ReferenceRow
    memo       map[string]map[string]bool
    walking    map[string]bool // embedding cycle guard
}

func (ix *goTypes) methodSet(ctx context.Context, typeName string, depth int) (map[string]bool, error)
```

1. **Direct methods.** `store.ReferencesByName(repoID, typeName)` — one read against the existing
   `reference_name (repo_id, name)` index — keeping rows with `Kind == "receiver"` in a Go file. For
   each, `innermostEnclosingSymbol(fileSymbols, r.StartByte, r.EndByte)` yields the `method` symbol
   (the `receiver` row's span *is* the `method_declaration`, so containment is exact), and its
   `Name` joins the set. This is the identical containment recovery
   `containmentImplementationsOf` (`implementations.go:126`-`149`) already performs for TypeScript
   and Java — reused, not reinvented.
2. **Declared methods.** The type's own symbol's children of kind `method` — an interface's
   `method_elem` rows from §3.1, parented by `linkParents`. Found through
   `SymbolsInFile(sym.FileID)` filtered on `ParentID == sym.ID`, cached per file.
3. **Promoted methods.** Every `embed` reference contained within the type's own symbol span
   (`r.StartByte >= sym.StartByte && r.EndByte <= sym.EndByte`, the same containment test
   `implementations.go:166` already uses) names an embedded type; recurse.

Bounds, both required, neither a `TODO`:

- `depth` caps promotion at **8**. Deeper embedding exists in no real Go code and an unbounded walk
  over an index that can contain a parse error is not defensible.
- `walking` refuses a name already on the stack, so a malformed or mid-edit tree that embeds itself
  terminates instead of recursing forever.

### 4.2 `goImplementationsOf`

Replaces `implementations.go:63`-`64`'s `case "go": return nil, nil`, and that case's doc comment
(`:19`-`22`) is rewritten to describe what now happens.

**Forward — the cursor is on an interface.**

```
want := methodSet(interfaceName)
if len(want) == 0 { return nil }            // `any`/`interface{}`: every type satisfies it, and
                                            // answering "every type" is noise, not an answer
pick the method name m in want with the fewest symbol rows
candidates := { receiverTypeOf(s) | s in FindSymbolsByName(m), s is a Go "method" symbol }
return { c in candidates | methodSet(c) ⊇ want }
```

Seeding from the *rarest* method name is what keeps this bounded: a one-method interface named
`String` is the worst case and still only walks the `String` methods, not the repository.

**Reverse — the cursor is on a concrete type (or on one of its methods, via its receiver).**

```
have := methodSet(typeName)
candidateInterfaces := { parent(s) | m in have, s in FindSymbolsByName(m),
                         s is a Go "method" symbol whose parent symbol is an "interface" }
return { i in candidateInterfaces | methodSet(i) ⊆ have }
```

An interface sharing no method name with the type is never read. Both directions end at
`targetsFromNamedSymbols` (`implementations.go:186`-`196`), so the `Target` shape is unchanged.

`receiverTypeOf(methodSym)` is the one new helper both directions need: the `receiver` reference in
that method's file whose span contains the method symbol's name range, cached per file.

### 4.3 Confidence and rule strings, honestly

Go's structural satisfaction is decided here by **method name only** — parameter and result types
are not compared, because the index stores no signature. Two types with `Close()` methods of
different arity both "satisfy" `io.Closer` by this test. So:

- `Confidence: Scoped`, never `Exact`. Not a new fourth enum value: `Confidence` is mirrored in
  `packages/shared/domain/repo.ts:76`'s zod enum and read by `render.go`, and a fourth value would
  ripple through both for a distinction "scoped" already carries honestly.
- `Rule: "implementationsOf.goMethodSet"`, or `"implementationsOf.goMethodSet.promoted"` when
  embedding contributed at least one method to the match. The rule string is what
  `render.go`'s reference renderer and `navigation.ts:40`'s `renderTargetLine` already print on
  every line, so the caveat travels with the result instead of living in a doc.

### 4.4 Cost

Worst case per call: one `ReferencesByName` per type visited (indexed), one `FindSymbolsByName` per
method name in the seed set (indexed), one `SymbolsInFile`/`ReferencesInFile` per distinct file
touched (cached within the call). No repository-wide scan, no new index, no new table. A
measurement is not earned here — the reads are all index-backed and the counts are bounded by the
interface's own method count, which `CLAUDE.md`'s measurement rule calls the "short honest estimate
is enough" case.

## 5. The resolver checks it before name-proximity

### 5.1 The rule

`resolve.go` ranks by scope proximity only. The one receiver fact recoverable with no type
inference: **a call sitting inside a method whose receiver type is `T` most often calls another
method on `T`.** That is `s.helper()` inside `func (s *Server) Handle()`, the commonest
cross-method call shape in Go.

In `resolveName` (`resolve.go:292`), when `site.File.Language == "go"` and the site's innermost
enclosing symbol is a `method`, compute that method's receiver type once (§4.2's helper) and mark
every candidate that is a `method` on the same receiver type. Nothing is filtered: both candidates
still come back, in a different order.

This is not type resolution and the plan does not pretend otherwise. `other.helper()` inside the
same method is ranked the same way and can be ranked wrong — which is exactly why it is a tiebreak
among seven, not a gate.

### 5.2 Where it sits

`sortCandidates` (`resolve.go:225`-`258`), one comparison inserted between `sameLanguageFamily` and
`basenameMatches`:

- **Below** `kindCompatible` and `sameLanguageFamily` — what a reference syntactically *is*, and
  which language can define it, are facts; a receiver match is a strong heuristic.
- **Above** `basenameMatches` and `commonPrefixLen` — a receiver match is a real Go relationship;
  those two are path conventions.

`ruleFor` (`:260`-`276`) gains the flag and returns `"sameReceiver"` for a candidate the new rule
marked, so the rule string a hover prints names the reason.

Cost: two cached `ReferencesInFile` reads on a path that already loads the referring file's symbols.
`ReferencesTo` memoizes `resolveName` per (directory, kind, language) group (`references.go:142`),
and the new work is skipped entirely for non-Go sites and for Go sites not inside a method.

### 5.3 The hover line stops being unconditional

`navigation.ts:50` prints `_Name-resolved, not type-resolved._` on every hover, which is the right
discipline and, once §5 lands, no longer the whole truth. Make it rule-aware: when every target's
rule is `sameReceiver`, print `_Receiver-matched (Go) — signatures are not compared._` instead.
Otherwise the existing line, unchanged. One conditional, no new vocabulary.

---

# Part C — reference/implementation wiring

## 6. What Monaco can and cannot carry

### 6.1 The stock peek UI is bundled — confirmed

`features/register.all.js:25` imports `gotoSymbol/browser/link/goToDefinitionAtPosition.js`, which
imports `DefinitionAction` from `goToCommands.js` — so that whole module's `registerAction2` calls
run. Grepped in the pinned build: `GoToImplementationAction` (`goToCommands.js:463`, Cmd/Ctrl+F12),
`PeekImplementationAction` (`:495`, Cmd+Shift+F12), `GoToReferencesAction` (`:534`, Shift+F12) and
`PeekReferencesAction` (`:568`) are all registered. `register.all.js:49` separately imports
`standalone/browser/referenceSearch/standaloneReferenceSearch.js`, which registers
`StandaloneReferencesController` under `ReferencesController.ID`. Nothing to add, nothing to import.

### 6.2 A `Location[]` has no per-entry slot — confirmed

`referencesTree.js` and `referencesWidget.js` render each entry as its URI plus the matched line's
text, with `_getAriaLabel` as the only other per-entry string, and neither is caller-supplied.
`registerReferenceProvider`'s return type is `Location[]`. So no confidence value can ride *inside*
the peek list. This is the constraint SPEC names, restated after checking it.

### 6.3 The signal exists today and is discarded

`Site` (`codegraph.go:67`-`72`) is path/language/kind/name/spans/enclosing. No confidence. But
`ReferencesTo` computes one per referring group and throws it away per site
(`references.go:170`-`181`): `groupResolutionTargets` returns `(ids, conf, err)`, and `conf` is used
only for the boolean `discriminant` gate. An included site can come from an `Exact`/`Scoped` group
*or* from a single-candidate `RepoWide` group — materially different evidence, currently
indistinguishable in the result.

So the per-occurrence signal is not missing from the data. It is missing from the type.

## 7. The confidence signal

### 7.1 `Site.Confidence`

`Site` gains `Confidence Confidence` — the referring group's own resolved confidence,
already in hand at `references.go:180`. Three rules, all in that one function:

- Resolved mode: the group's `conf`.
- `IncludeDefinition` sites (`:218`-`236`): `Exact`. The definition's own name span is not a guess.
- `NameOnly` mode: `RepoWide`, with a one-line comment saying why — nothing was resolved, so a
  repository-wide name match is literally what the row is. `NameOnly` is reachable only from the MCP
  server's own `mode` argument; the wire schema in §7.2 never sees it.

`render.go`'s `renderReferences` (`:99`) prints it per site, the same discipline it already applies
to a `Target`'s rule/confidence — so `find_references` in the repo-map MCP server gets the honesty
too, not just the desktop app.

### 7.2 The wire types

`packages/shared/domain/repo.ts`, beside `navTargetSchema`/`navResultSchema`:

```ts
export const refSiteSchema = z.object({
  path: z.string(), language: z.string(), kind: z.string(), name: z.string(),
  enclosing: z.string(),
  confidence: z.enum(['exact', 'scoped', 'repoWide']),
  startLine: z.number(), startColumn: z.number(), endLine: z.number(), endColumn: z.number(),
});
export const refResultSchema = z.object({
  status: z.enum(['ready', 'indexing', 'unavailable']),
  name: z.string(),
  sites: z.array(refSiteSchema),
  total: z.number(), truncated: z.boolean(), unattributed: z.number(),
});
```

Implementations need no new result type: `ImplementationsOf` returns `[]Target`, which is exactly
`navResultSchema`'s shape.

`internal/codeworkspace/nav.go` gains `References` and `Implementations` beside `Definitions`
(`:39`), each a copy of its structure: `ValidateRelPath`, the non-blocking `graphAndReady` gate
returning `indexing`, the `GetFile` lookup returning `unavailable`, `LineIndex`-based position
mapping including the `ValidateRelPath`-guarded cross-file read at `:94`-`98` (C13-13's containment
rule — carried over, not re-derived).

### 7.3 The status-bar readout

`apps/kira-studio/frontend/src/state/navStatus.ts`, structurally P76's `state/blameStatus.ts`: a
small `reactive` store in `state/`, written by `views/repo/`, read by `workbench/StatusBar.vue`,
neither importing the other.

One deliberate difference, stated rather than copied blindly: **no owner token.**
`blameStatus.ts`'s token exists because two tab views race across a view switch (its own doc
comment). `navigation.ts` registers once per process and is the only writer, so a token would be
ceremony. The store clears on a new request and on an active-tab change (one watch on
`state/tabs.ts`'s active id) so a stale readout never outlives the file it describes.

`StatusBar.vue` renders it beside P76's blame item, `data-testid="nav-status"`:

- references: `12 references · 3 unattributed · truncated`, with a tooltip breaking the sites down
  by confidence (`9 exact/scoped · 3 repo-wide`).
- implementations: `4 implementations · method set, signatures not compared` when every target's
  rule starts `implementationsOf.goMethodSet`.

Zero and one are spelled out (`no references`, `1 reference`); the `unattributed` and `truncated`
clauses are omitted when zero and false.

### 7.4 Rejected alternatives

- **A synthetic entry in the peek list** carrying the caveat. Rejected: every row in that list is a
  location the user can open, and a fake one is exactly the "a guess must never read like a fact"
  failure this repo's rendering discipline exists to prevent.
- **Filtering low-confidence sites out.** Rejected: it trades a stated caveat for silent recall
  loss, and `Unattributed` already reports what the resolver genuinely could not attribute.
- **Ordering the `Location[]` by confidence.** Rejected because it does not survive:
  `ReferencesModel` groups by URI and orders within a file by position, so provider order is not
  what the tree shows.
- **Putting the caveat in the hover.** Rejected: the hover fires on dwell, so it would need a
  references round trip on every dwell to have anything to say.
- **A toast/announce region.** The desktop app has neither — grepped, no `aria-live` and no
  announce testid anywhere under `frontend/src`. Building one for this would be a second mechanism
  where §7.3's is already proven at P76.

## 8. The providers

### 8.1 `registerReferenceProvider`

In `ensureNavigationRegistered` (`navigation.ts:56`), same `SELECTOR`, beside the two existing
registrations:

```ts
mod.languages.registerReferenceProvider(SELECTOR, {
  async provideReferences(model, position, context) {
    const loc = repoLocationOf(model);
    if (!loc) return null;                    // D7: the diff's HEAD side, deliberately
    const res = await control.codeWorkspaceReferences(
      loc.repoId, loc.path, position.lineNumber, position.column, context.includeDeclaration);
    if (res.status !== 'ready') { publishNavStatus(null); return null; }
    publishNavStatus(referenceSummary(res));
    return res.sites.map((s) => ({ uri: repoFileUriObject(mod, loc.repoId, s.path), range: rangeOf(s) }));
  },
});
```

`context.includeDeclaration` maps straight to `RefOpts.IncludeDefinition` — Monaco's own flag, not a
new one. `RefOpts.Mode` is always `Resolved` from this caller: `NameOnly` is the MCP server's
recall-over-precision mode and would put unattributable occurrences in a UI that cannot caveat them.

### 8.2 `registerImplementationProvider`

The same shape over `Implementations`, returning `NavTarget[]` mapped to `Location[]` and publishing
the implementation summary. Nothing else: with Part B landed, Go answers; every other language
already did through `containmentImplementationsOf`.

### 8.3 `gotoLocation` and C6 D4's comment

Both repo views set only `multipleDefinitions: 'goto'` today. Add `multipleReferences: 'peek'` and
`multipleImplementations: 'peek'` explicitly rather than relying on Monaco's defaults, so the two
new commands' behaviour is stated where the third one's already is.

`multipleDefinitions: 'goto'` stays — but its comment's reason ("peek would render an empty preview
pane") is false once §1.4 lands, and leaving a false comment beside a correct setting is worse than
either. Rewrite it to the reason that still holds: the hover already lists every candidate with its
own rule and confidence, so a definition jump going straight to the best-ranked one loses nothing,
and a peek would put a second candidate list behind an extra dismissal.

## 9. Deliberately out of scope

- **Signature-aware Go implementation matching.** The index stores no parameter or result types, so
  §4 compares method *names*. Storing signatures is its own phase with its own schema question.
- **Type inference of any kind.** §5 is a ranking tiebreak off one syntactically-recoverable fact.
  Nothing here resolves `x.Method()` by knowing `x`'s type, and the hover says so.
- **Interface satisfaction across packages by import path.** Names are compared unqualified, the
  same assumption every other rule in `resolve.go` already makes.
- **Rust/Python/TS implementation improvements.** `rustImplementationsOf` and
  `containmentImplementationsOf` are untouched; this row is Go's gap.
- **Making Ctrl+click work on macOS.** §1.5.
- **`registerTypeDefinitionProvider` / `registerDeclarationProvider`.** Monaco bundles their actions
  too; SPEC names two providers, and a type-definition provider needs the signature data §9 bullet 1
  just excluded.
- **A persistent method-set index or edit-triggered invalidation.** C2 §3's "no edge table, ever"
  stands; §4 computes per call.
- **The repo-map MCP server's own tool surface.** `find_implementations` starts answering for Go
  because the underlying function does. No tool, argument or output format changes beyond §7.1's
  per-site confidence line.
- **A settings toggle for any of this.** Nothing in SPEC asks for one, and the Code intelligence
  settings tab is the indexer's, not the navigator's.

## 10. Files

Added:

| File | What |
|---|---|
| `apps/kira-studio/frontend/src/views/repo/textModels.ts` | The `kira-repo` `ITextModelService` and its preview-model registry (§1.4) |
| `apps/kira-studio/frontend/src/state/navStatus.ts` | The references/implementations readout store (§7.3) |
| `apps/kira-studio/internal/codeparse/queries/go/p78_method_sets.scm` | Receiver, interface method, embedded type/field captures (§3.1) |
| `apps/kira-studio/internal/codegraph/methodsets.go` | `methodSet`, `receiverTypeOf`, `goImplementationsOf` (§4) |
| `apps/kira-studio/internal/codegraph/methodsets_test.go` | §11.1 |
| `apps/kira-studio/tests/unit/repo-preview-models.spec.ts` | §11.2 |

Modified:

| File | Change |
|---|---|
| `apps/kira-studio/frontend/src/views/repo/monacoEntry.ts` | Deep-imports `StandaloneServices`; exports the one initializer (§1.4) |
| `apps/kira-studio/frontend/src/editor/monaco.ts` | `loadMonaco` installs the service override before any editor exists (§1.4) |
| `apps/kira-studio/frontend/src/views/repo/monaco.ts` | `repoLocationFromUri` for the service's reverse mapping (§1.4) |
| `apps/kira-studio/frontend/src/views/repo/navigation.ts` | The two new providers; rule-aware hover line (§5.3, §8.1, §8.2) |
| `apps/kira-studio/frontend/src/views/repo/RepoFileView.vue`, `RepoDiffView.vue` | `multipleReferences`/`multipleImplementations`; the rewritten D4 comment (§8.3) |
| `apps/kira-studio/frontend/src/workbench/StatusBar.vue` | The `nav-status` item beside P76's blame item (§7.3) |
| `apps/kira-studio/frontend/src/bridge/index.ts` | `codeWorkspaceReferences`, `codeWorkspaceImplementations` (§7.2) |
| `packages/shared/domain/repo.ts` | `refSiteSchema`, `refResultSchema` (§7.2) |
| `apps/kira-studio/internal/bridge/codeworkspace.go` | `References`/`Implementations` + their args structs (§7.2) |
| `apps/kira-studio/internal/codeworkspace/nav.go` | `References`/`Implementations` (§7.2) |
| `apps/kira-studio/frontend/bindings/**` | Regenerated — `wails3 task common:generate:bindings`, never a hand-typed flag list (`docs/DEV_ENVIRONMENT.md`) |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts`, `mockRuntime.ts` | Two `CHANNEL_TO_FQN` entries (§11.3) |
| `apps/kira-studio/internal/codeparse/queries.go` | Embed list, `Provenance` row, `querySourcePaths[Go]` (§3.3) |
| `apps/kira-studio/internal/codeparse/extract.go` | Two `referenceKinds`; `dropCallDuplicateFields` generalized (§3.2) |
| `apps/kira-studio/internal/codeparse/queries/go/m1c_fields.scm` | One comment line pointing at the new file (§3.1) |
| `apps/kira-studio/internal/codeparse/testdata/extract/sample.go` | Fixture additions for the four new capture shapes (§11.1) |
| `apps/kira-studio/internal/codeparse/extract_test.go` | The Go golden table, extended (§11.1) |
| `apps/kira-studio/internal/codeindex/migrations/0002_c2_reference_name_range.sql` | Kind-vocabulary comment only — **no new migration**, `kind` is unconstrained `TEXT` (§3.2) |
| `apps/kira-studio/internal/codegraph/codegraph.go` | `Site.Confidence` (§7.1) |
| `apps/kira-studio/internal/codegraph/references.go` | Carries the group confidence onto each site (§7.1) |
| `apps/kira-studio/internal/codegraph/implementations.go` | The Go case; its rewritten doc comment (§4.2) |
| `apps/kira-studio/internal/codegraph/resolve.go` | `kindCompatibility` entries; the receiver tiebreak; `ruleFor` (§3.2, §5.2) |
| `apps/kira-studio/internal/codegraph/resolve_test.go`, `implementations_test.go` | Extended (§11.1) |
| `apps/kira-studio/internal/repomap/render.go` | Per-site confidence in `renderReferences` (§7.1) |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | §11.3 |

Deleted: none. No new dependency: Monaco, tree-sitter-go and zod are all already here, and the one
"could a library do this" question — the `ITextModelService` implementation — is answered by using
Monaco's own documented override seam rather than hand-rolling around it.

No contract change: `packages/git-ipc`'s contract is the git module's, and nothing in this phase
touches it. `CONTRACT_VERSION` stays at 38, `graphChunkFrame.{bin,json}` is not regenerated, and
`stash_test.go`'s `TestContractVersion_Is38` is not renamed.

## 11. Tests

`CLAUDE.md`'s default is no dedicated unit test. This phase earns **two**, and says why each clears
the bar and why the rest do not — more than P73-P77 needed, because this is the first v1.8 row whose
weight is a parser query and a resolver algorithm rather than UI wiring.

### 11.1 Go

**Earned — `internal/codegraph/methodsets_test.go`.** §4 is a decision structure with interacting
rules: three sources unioned, promotion through two different embedding constructs, a depth cap, a
cycle guard, and two directions with different seeding. That is squarely the bar's "parser/splitter
with several interacting rules" and "decision structure too large to hold in your head." Seeded
through `helpers_test.go`'s existing `seedFile`/`sym`/`ref` constructors — no new harness. Cases:

| Case | Asserts |
|---|---|
| Struct with two methods satisfies a two-method interface | The direct-method path and the `⊇` test |
| Struct missing one method | Not returned — the comparison is containment, not intersection |
| Struct embedding a type that supplies the missing method | Promotion, and the `.promoted` rule string |
| Interface embedding another interface | `type_elem` promotion on the wanted side |
| Two types embedding each other | Terminates, via the cycle guard, with whatever is reachable |
| Embedding nested nine deep | Stops at the cap rather than walking forever |
| Empty interface (`any`) | Returns nothing, per §4.2, not every type in the repository |
| Cursor on the concrete type | Reverse direction returns the interface |
| Two methods with the same name on different receivers | Only the matching receiver's type is a candidate |
| Every target | `Confidence == Scoped`, never `Exact` (§4.3) |

**Earned by extension — `internal/codeparse/extract_test.go`.** The Go golden table is this repo's
stated anti-drift guard for exactly this class of change (`extract_test.go:19`-`22`). `sample.go`
gains, under the fixture's own `p78`-prefixed naming rule (it is indexed alongside the real
repository, so a colliding name would poison `find_references`): a pointer receiver, a value
receiver, a generic receiver, an interface with two method specs, an interface embedding another,
and a struct embedding both a plain and a pointer type. The table then proves the new rows exist —
and, equally, that the duplicate `type` row for each receiver is **gone** (§3.2).

**Earned by extension — `implementations_test.go` and `resolve_test.go`.** One Go case in the first
(the language dispatch now reaches `goImplementationsOf` instead of returning nil), one in the
second (the receiver tiebreak reorders two same-named methods, and both are still returned).
`resolve_test.go` already tests `sortCandidates`' interacting order; a seventh rule belongs in it.

**Not earned.** `Site.Confidence` is a field assignment from a value the same function already
computes — the bar's "thin pass-through." `nav.go`'s two new functions are structural copies of
`Definitions` with a different graph call. `bridge/codeworkspace.go`'s two methods are argument
validation plus a call. `render.go`'s extra column is a format string. None gets a test.

### 11.2 TypeScript

**Earned — `apps/kira-studio/tests/unit/repo-preview-models.spec.ts`.** §1.4's registry is cache
eviction with interacting rules, which the bar names explicitly. Cases: a tab-owned URI survives a
full registry; the cap evicts least-recently-resolved first; a preview URI promoted to a tab leaves
the registry and is never evicted afterwards; re-resolving an existing preview refreshes its
recency; a non-`kira-repo` URI and a `?rev=`-pinned URI both reject rather than fabricate a model.

**Not earned.** `navStatus.ts` is a `reactive` object with a setter — smaller than
`blameStatus.ts`, which correctly has no test either. The summary string builder is formatting.

### 11.3 UI

Extend `apps/kira-studio/tests/ui/repo-workspace.spec.ts` — it already boots a repo workspace with a
real Monaco editor and a mocked `codeWorkspaceReadFile` (`:399`-`407`), which is precisely what the
new service needs. Two cases:

1. **Cmd+click navigates, and the affordance renders.** Seed `a.ts` referencing a name defined in
   `b.ts`, answer `codeWorkspaceDefinitions` with that target and `codeWorkspaceReadFile` for
   `b.ts`. Hold `Meta`, hover the identifier, assert one `.goto-definition-link`, click, assert the
   tab strip now shows `b.ts`.
2. **Shift+F12 peeks references and publishes the readout.** Answer `codeWorkspaceReferences` with
   three sites and `unattributed: 2`; assert the peek widget opens and
   `[data-testid="nav-status"]` reads the summary.

**The modifier is `Meta`, not `Control`, and the spec must carry a comment saying why.** §1.1
measured it: this tier's WebKit reports a Macintosh UA, so Monaco's trigger is `metaKey`; a
`Control` press produces a green test that proves nothing, which is worse than no test.

Case 1 is also the regression guard for §1.3 — without the new service the underline assertion fails
while the click assertion still passes, which is the exact shape of the bug.

### 11.4 Checks

`go build ./... && go vet ./... && go test ./...`; `bun typecheck`, `bun lint`; both `bun run build`
and `bun run build:vscode` (the extension is untouched, so its build succeeding is the proof that it
stayed untouched); `bun run test:unit`; `bun run test:ui`. Per `CLAUDE.md`, the expensive tiers run
once near the end, not per commit.

`bun run build:vscode` and `bun run test:webview` are expected to be unaffected — if either changes
behaviour, something in this phase reached a shared package it should not have.

## 12. Order and sizing

### 12.1 Commits

1. **§1.4 — the model service.** `textModels.ts`, `monacoEntry.ts`, `editor/monaco.ts`,
   `views/repo/monaco.ts`. Independent of everything else, and a prerequisite for commit 10's peek
   previews — a stronger ordering reason than SPEC's own note that item (1) may land anywhere.
   → `fix(repo): resolve a repo file's Monaco model on demand for previews`
2. **§11.2.**
   → `test(repo): cover the preview model cache's eviction rules`
3. **§3 — the queries.** The new `.scm`, `extract.go`'s two kinds and generalized dedupe,
   `queries.go`'s three registrations, `resolve.go`'s `kindCompatibility` entries. One commit: a
   registered query whose kinds `extract.go` drops on the floor indexes nothing, and a kept `type`
   duplicate would land and then be deleted one commit later.
   → `feat(repomap): capture Go receiver types, interface methods and embedded types`
4. **§11.1's fixture and golden table.**
   → `test(codeparse): extend the Go golden fixture for method-set rows`
5. **§4 — the index and the Go implementations path.**
   → `feat(codegraph): answer Go implementations from stored method sets`
6. **§11.1's `methodsets_test.go` and the `implementations_test.go` case.**
   → `test(codegraph): cover Go method-set assembly, promotion and both directions`
7. **§5 — the receiver tiebreak**, with its `resolve_test.go` case and §5.3's hover line.
   → `feat(codegraph): rank a Go method call by its enclosing receiver type`
8. **§7.1 — per-site confidence.** `codegraph.go`, `references.go`, `render.go` together: the field
   and its only two writers and its only reader.
   → `feat(codegraph): carry each reference site's own resolved confidence`
9. **§7.2 — the backend surface.** `nav.go`, `bridge/codeworkspace.go`, the zod schemas,
   `bridge/index.ts`, the regenerated bindings, the two mock channel entries. One commit: a bound
   method without its regenerated binding fails the Vite build outright.
   → `feat(repo): answer references and implementations over the bridge`
10. **§8 — the providers.** `navigation.ts`, `navStatus.ts`, `StatusBar.vue`, the two views'
    `gotoLocation` options and the rewritten D4 comment.
    → `feat(repo): wire Monaco's reference and implementation providers`
11. **§11.3's two cases**, once the behaviour they describe is in.
    → `test(repo): cover modifier-click navigation and the references peek`

SPEC's one hard ordering constraint — item (2) before item (3) — is satisfied: commits 3-7 precede
commits 9-10, so Go-to-implementation never ships as a command that silently answers nothing.

### 12.2 One pass, one seam

One Sonnet subagent, sequential. The genuine seam is after commit 2: Part A is entirely frontend and
shares no file with Parts B and C. It is not worth a second subagent — commits 1-2 are two files and
a test, and a fresh subagent would have to be handed §1's whole measurement to avoid re-deriving it.

Commits 3-11 are strictly ordered and must not be parallelized: 5 reads the rows 3 writes, 7 reads
the helper 5 adds, 10 reads the result shape 8 and 9 define.

Size: roughly 12 source files plus 5 test/fixture files, one new query file, one new Go file, two
new frontend modules, no schema migration and no contract bump. The load-bearing decisions are four
— the service override over eager model pre-creation (§1.4), a labelled `receiver` kind over
positional derivation (§3.2), method-name comparison with `Scoped` confidence over a fourth enum
value (§4.3), and the readout beside the peek list over a synthetic entry inside it (§7.4).

## 13. Dogfooding note

The repo-map MCP server's tools were not reachable for this planning pass — the same constraint P75
§10, P76 §14 and P77 §19 each recorded, and `CLAUDE.md`'s own step-3 caveat: this is a subagent
session and the tool manifest is fixed at session start. Navigation was done with Grep/Glob/Read,
plus a Playwright run of the real application for §1.

**Nothing new is logged in `docs/v1.8/mcp-repo-map-issues.md`.** This pass never called the server,
so it produced no evidence about it; inventing an entry would be the manufactured finding
`CLAUDE.md` warns against.

Worth carrying forward for whoever next works on that server, since it is this phase's own subject
matter: once §4 lands, `find_implementations` answers for Go for the first time, and its results
carry `implementationsOf.goMethodSet` in the rule column. A dogfooding pass that sees empty Go
results after this phase is a real finding and should be logged.
