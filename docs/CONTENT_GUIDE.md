# Writing course content

The course is plain YAML in `content/`. You can add or improve lessons without touching code. The backend
validates everything at startup, and the tests enforce stricter rules, so most mistakes are caught before a
learner sees them.

```
content/
  curriculum.yaml          every lesson node and its prerequisites (the knowledge map)
  widgets.yaml             the visuals lessons may use, with their allowed props and goals
  dictionary/level-N.yaml  dictionary entries, grouped by the level that introduces them
  lessons/level-N/<id>.yaml  one file per written lesson
```

## The two rules everything follows

1. **New-language principle.** Plain meaning → analogy → picture → simple example → the word → the symbol →
   precise definition → connections → experiment → check. The lesson format below has a field for each step.
2. **Zero assumptions.** Never use a word, symbol or letter the learner has not met. If a sentence needs an idea
   from a later lesson, rewrite the sentence or point forward to that lesson in plain words ("you will see why in
   Level 10"). The test suite catches some slips, such as missing dictionary entries. Others, like using `÷`
   before division is taught, need a careful human reader.

## Adding a lesson

1. Find or add its node in `curriculum.yaml`:

   ```yaml
   - {id: l2-addition, stage: L2, title: "Addition", summary: "Putting groups together and counting the total.", pre: [l1-counting-objects]}
   ```

   `pre` must list **every** idea the lesson uses, not just the most recent one. The graph must stay acyclic.
   Add `goals: [pnp]`, `[rh]` or `[pnp, rh]` only on a node that a research path depends on directly.
   Ancestry works out the rest.

2. Create `content/lessons/level-2/l2-addition.yaml`. The file name must equal the `id`. Once the file exists,
   the node changes from *planned* to *available* everywhere in the app.

3. Add a dictionary entry for every word the lesson introduces (see below), with `introduced_in: l2-addition`.

4. Run the checks:

   ```bash
   backend/.venv/bin/python scripts/yaml_safe.py content/lessons/*/*.yaml content/dictionary/*.yaml
   cd backend && .venv/bin/python -m pytest tests/test_content.py
   cd frontend && npm test        # renders every formula with KaTeX in strict mode
   ```

## Lesson format

Fields are listed in the order the learner sees them. Required fields are marked ●.

| Field | What it is |
|---|---|
| ● `id`, `estimated_minutes` | |
| ● `goal` | "We are learning …" in one or two plain sentences |
| ● `why` | why the idea exists and where it leads |
| ● `problem` | a concrete problem the idea solves |
| ● `plain` | the idea in very simple everyday English, with no technical words yet |
| ● `analogy` | `{strategy, title, text, visual?}`: the main everyday comparison |
| ● `visual` | `{widget, props, caption, prompt?}`. The `caption` must start with "What you are seeing" |
| ● `example_simple`, `example_harder` | `{title, problem, steps: [...], answer, visual?}` with every step shown |
| ● `word` | `{terms: [term-id, ...], text}`: the mathematical word, introduced only now |
| ● `symbols` **or** `no_symbol_note` | each symbol: `symbol` (LaTeX), `name`, `looks_like`, `means`, `why`, `read_aloud` |
| ● `formal` | `{statement, kind, glossary: [{word, meaning}]}`: the precise version, with every word in it explained |
| `notation` | lines of notation read symbol by symbol: `expression`, `read_aloud`, `parts: [{symbol, meaning}]`, `english` |
| ● `connections_back` | `[{lesson, how}]`: what this builds on |
| ● `worked` | one worked problem (same shape as the examples) |
| ● `experiment` | `{widget, props, task, goal, success}`: something to *do*, with a goal the widget can detect |
| ● `mistakes` | `[{mistake, why, fix}]`: common misconceptions |
| ● `statements` | `[{kind, text, note?}]`: notable claims, each classified (see below) |
| ● `assessment` | `{pass_score: 0.7, questions: [...]}` with at least 3 questions |
| ● `connections_forward` | `[{lesson, how}]`: where this leads, at least one |
| ● `alternatives` | at least 2 alternative explanations for **I don't understand**, each with a different `strategy` |
| `practice` | ids of practice generators for endless extra exercises |

Alternative strategies are `story`, `everyday-objects`, `visual`, `smaller-steps`, `eli5`, `contrast`,
`history`, `physical-activity` and `question-led`. They must differ from each other and from the main analogy.

### Statement kinds

Every notable claim in a lesson is labelled with its status, and the app shows the label:

`definition` · `convention` · `established-fact` · `proven-theorem` · `conjecture` ·
`computational-observation` · `hypothesis` · `speculation` · `disproved-claim` · `unverified-proof` ·
`formally-verified-proof`

Never present a computation as a proof ("checked up to 10^12" is a `computational-observation`). Never cite a
source you have not verified.

## Questions

Every question has an `id`, a `type`, a `kind` (`recall`, `explain`, `solve`, `counterexample`, `predict` or
`apply`), a `prompt`, and optionally a `hint`, an `explanation` (shown after answering) and a `visual`. Each
assessment must include an `explain` question and at least two different kinds.

```yaml
- id: simplify
  type: choice                # also: multi: true for "choose all that apply"
  kind: apply
  prompt: What is $\tfrac{12}{18}$ in its simplest form?
  options:
    - {text: '$\tfrac{2}{3}$', correct: true}
    - text: $\tfrac{6}{9}$
      diagnosis: Equivalent, but 6 and 9 still share the factor 3.
      revisit: l1-factors     # optional: an EARLIER lesson that this mistake suggests is shaky
  explanation: Divide top and bottom by $\gcd(12, 18) = 6$.

- {id: q2, type: number, kind: solve, prompt: "...", answer: "3/4", tolerance: 0, unit: cups,
   common_wrong: [{answer: "4/3", diagnosis: "Upside down ...", revisit: l1-numerators-denominators}]}
- {id: q3, type: text, kind: recall, prompt: "...", accept: ["numerator"], mode: words}
- {id: q4, type: truefalse, kind: recall, prompt: "...", answer: false, diagnosis: "..."}
- {id: q5, type: order, kind: solve, prompt: "...", items: ["$\\tfrac{1}{4}$", "$\\tfrac{1}{2}$", "$1$"], order_label: smallest to largest}
- {id: q6, type: explain, kind: explain, prompt: "...", rubric: ["key idea 1", "key idea 2"], model_answer: "..."}
- {id: q7, type: generated, generator: gcd, params: {max: 60}}   # a fresh question every attempt
```

- Every wrong `choice` option needs a `diagnosis`: why someone might believe it, and what to look at instead.
- `revisit` must name a lesson this one builds on. Never the lesson itself, and never a later one. When a
  learner fails the check with such a mistake, that prerequisite is flagged for revision.
- `number` answers are compared exactly as fractions, so `0.75`, `3/4` and `6/8` are all accepted.
- Explain questions are graded by the AI against the `rubric`. Without AI, the learner checks their answer
  against it. Write rubric items as short, checkable ideas.

## Dictionary entries

All ten fields are required. The dictionary is the learner's reference, so write it for someone who has only
the lessons before `introduced_in`.

```yaml
- id: numerator
  word: numerator
  pronunciation: "NYOO-mer-ay-ter"
  plain: The top number of a fraction - how many of the equal parts we have.
  analogy: In "3 slices out of 8", the 3 is the numerator.
  visual: {widget: fraction, props: {numerator: 3, denominator: 8}, caption: "What you are seeing: ..."}
  formal: In the fraction $\tfrac{a}{b}$, the integer $a$ is the numerator.
  example: In $\tfrac{2}{5}$ the numerator is 2.
  non_example: In $\tfrac{2}{5}$, 5 is not the numerator - it is the denominator.
  related: [denominator, fraction]
  used_later: [{lesson: l2-fraction-arithmetic, how: 'Adding fractions with the same denominator adds numerators.'}]
  introduced_in: l1-numerators-denominators
  aliases: [numerators]      # other forms that should link here automatically
```

The frontend links a term automatically wherever its `word` or `aliases` appear in lesson text. A few everyday
words such as "number", "add" and "set" are excluded (see `AUTOLINK_STOPWORDS` in `backend/app/content/loader.py`)
so ordinary sentences are not covered in links. To force a link anyway, write `[[term-id]]` or
`[[term-id|shown words]]`.

## Text markup

| Write | Get |
|---|---|
| `$\tfrac{1}{2}$` | inline mathematics (KaTeX) |
| `$$ ... $$` on its own line | displayed mathematics |
| `\$5` | a literal dollar sign |
| `[[numerator]]`, `[[numerator\|the top number]]` | a dictionary link |
| `[[lesson:l1-fractions\|fractions]]` | a lesson link |
| `**bold**`, `*italic*`, `- item`, `1. item`, `### heading` | the usual |

## Widgets

A visual is `{widget, props}` using only the widgets and props listed in `content/widgets.yaml`. An
experiment's `goal` must be one of that widget's `goals`. To add a widget, register it in `widgets.yaml`,
implement it in `frontend/src/widgets/`, add it to `frontend/src/widgets/registry.tsx` (with an explanation of
what the learner sees), and add its id to `frontend/src/widgets/ids.ts`. A test checks that the two lists match.

## YAML pitfalls

Plain YAML values break on `: ` and ` #`, and when they start with `*`, `&`, `!`, `%`, `@`, `` ` ``, `|` or `>`.
`scripts/yaml_safe.py` rewrites such values as block scalars (`|-`). It is idempotent and leaves existing block
text alone, so run it after editing. Inside flow mappings (`{lesson: x, how: '...'}`), quote any text that
contains commas or braces.
