# ast-grep Reference for Agents

ast-grep searches code by structure (AST), not text. Use it when grep can't express what you need.

## When to Use ast-grep vs Grep

| Use **grep** when | Use **ast-grep** when |
|---|---|
| Searching for a keyword, string, or identifier | Searching for a structural pattern (e.g., "functions containing X") |
| Finding files that mention a term | Finding code that *lacks* a pattern (negation) |
| Simple text matching is sufficient | You need relational context (inside, has, precedes, follows) |
| Speed matters more than precision | Precision matters more than speed |

## CLI Commands

### Simple pattern search (`run`)

Matches a single AST node against a pattern. Good for direct, flat matches.

```bash
ast-grep run --pattern 'console.log($ARG)' --lang javascript /path/to/project
```

- Use `--json` for structured output
- **Limitation**: `run --pattern` cannot express "X inside Y" or "X containing Y" — use `scan` for those

### Complex rule search (`scan`)

Uses YAML rules for relational and composite logic. Required for `has`, `inside`, `not`, `all`, `any`.

```bash
# With a rule file
ast-grep scan --rule rule.yml /path/to/project

# With inline rules (single quotes avoid shell expansion of $)
ast-grep scan --inline-rules 'id: my-rule
language: javascript
rule:
  kind: function_declaration
  has:
    pattern: await $EXPR
    stopBy: end' /path/to/project
```

### Inspect AST structure (`--debug-query`)

Use this to discover correct `kind` names and understand how code is parsed:

```bash
# Concrete syntax tree — all nodes including punctuation
ast-grep run --pattern 'YOUR_CODE_HERE' --lang javascript --debug-query=cst

# Abstract syntax tree — named nodes only
ast-grep run --pattern 'YOUR_CODE_HERE' --lang javascript --debug-query=ast

# How ast-grep interprets your pattern
ast-grep run --pattern 'class $NAME { $$$BODY }' --lang javascript --debug-query=pattern
```

### Test against stdin

Validate a rule against a snippet without creating files:

```bash
echo "const x = await fetch();" | ast-grep scan --inline-rules 'id: test
language: javascript
rule:
  pattern: await $EXPR' --stdin
```

Add `--json` for structured output.

## Rule Syntax

Rules are YAML objects. Every field is optional, but at least one "positive" key (`pattern`, `kind`, etc.) must be present. When multiple fields appear in the same rule object, they're implicitly ANDed — the node must satisfy all of them.

### Atomic Rules

Match individual AST nodes by their intrinsic properties.

#### `pattern`

The most common rule. Matches a node by code structure using metavariables as placeholders.

**String form** — direct matching:

```yaml
pattern: console.log($ARG)
```

**Object form** — when the pattern is ambiguous or needs surrounding context to parse correctly:

```yaml
# selector picks which part of the parsed context to match
pattern:
  selector: field_definition
  context: class { $F }

# strictness controls matching precision (cst, smart, ast, relaxed, signature)
pattern:
  context: foo($BAR)
  strictness: relaxed
```

#### `kind`

Matches by Tree-sitter node type. Use `--debug-query=cst` to find correct kind names.

```yaml
kind: call_expression
kind: function_declaration
kind: arrow_function
kind: catch_clause
```

#### `regex`

Matches the full text of a node against a Rust regular expression. Useful when you need partial text matching that metavariables can't express.

```yaml
regex: ^handle[A-Z]
```

Note: `regex` is not a "positive" rule on its own — it matches any node whose text satisfies the regex. Combine with `kind` to constrain it.

#### `nthChild`

Matches nodes by their 1-based index within their parent's named children.

```yaml
# Exact position
nthChild: 1

# An+B formula (like CSS nth-child)
nthChild: "2n+1"

# Object form — count from end, filter siblings
nthChild:
  position: 1
  reverse: true
  ofRule: { kind: argument }
```

#### `range`

Matches by character position (0-based lines/columns, start inclusive, end exclusive). Rarely needed in search — mainly useful for programmatic filtering.

### Relational Rules

Filter nodes based on their relationship to other nodes in the tree. Each takes a sub-rule plus optional `stopBy` and `field` parameters.

#### `has` — node contains a descendant

```yaml
has:
  pattern: await $EXPR
  stopBy: end
```

#### `inside` — node is within an ancestor

```yaml
inside:
  kind: class_declaration
  stopBy: end
```

#### `precedes` / `follows` — sibling ordering

```yaml
precedes:
  pattern: return $VAL

follows:
  pattern: import $M from '$P'
```

#### `stopBy` — how far to search

| Value | Behavior |
|---|---|
| `"neighbor"` (default) | Stops at first non-matching surrounding node |
| `"end"` | Searches all the way to root (`inside`) or leaves (`has`) |
| Rule object | Stops when a node matching the rule is encountered (inclusive) |

**Always use `stopBy: end`** unless you have a specific reason to limit depth. Without it, `has` and `inside` only check immediate neighbors and will miss deeply nested matches.

#### `field` — restrict to a named AST field

Only for `has` and `inside`. Matches against a specific child field of the node.

```yaml
# Match the operator field of a binary expression
has:
  field: operator
  pattern: $$OP
```

### Composite Rules

Combine rules with logical operations.

#### `all` (AND)

Every sub-rule must match. **Guarantees evaluation order** — important when later rules depend on metavariables bound by earlier ones.

```yaml
all:
  - kind: function_declaration
  - has: { pattern: await $EXPR, stopBy: end }
```

#### `any` (OR)

At least one sub-rule must match.

```yaml
any:
  - pattern: console.log($$$)
  - pattern: console.warn($$$)
  - pattern: console.error($$$)
```

#### `not` (NOT)

The sub-rule must NOT match.

```yaml
not:
  has:
    kind: throw_statement
    stopBy: end
```

#### `matches` (reuse)

References another rule by its `id`. Enables rule composition and recursion.

```yaml
matches: my-utility-rule-id
```

## Metavariables

Placeholders in patterns that capture dynamic AST content.

| Syntax | Captures | Example |
|---|---|---|
| `$VAR` | Exactly one named node | `console.log($ARG)` matches `console.log('hi')` |
| `$$VAR` | Exactly one unnamed node (operators, punctuation) | `$$OP` captures `+` in `a + b` |
| `$$$` / `$$$VAR` | Zero or more nodes (non-greedy) | `foo($$$)` matches `foo()`, `foo(a)`, `foo(a, b)` |
| `$_` / `$_VAR` | One node, non-capturing (no binding) | `$_F($_F)` matches `test(a)` and `foo(bar)` |

### Naming rules

- **Valid**: `$META`, `$META_VAR`, `$_`, `$A`
- **Invalid**: `$invalid` (lowercase), `$123` (digits), `$KEBAB-CASE` (hyphen)

### Reuse enforces equality

`$A == $A` matches `x == x` but NOT `x == y`. The second occurrence must match the same text as the first.

### Critical constraint: exclusive content

A metavariable must be the **only text** within its AST node. These will NOT work:

- `obj.on$EVENT` — `$EVENT` is mixed with `on`
- `"Hello $WORLD"` — `$WORLD` is inside a string literal with other text
- `$$$LOG$$$` — metavariable mixed with literal text
- `$jq` — lowercase, not recognized as metavariable

If you need partial text matching, use `regex` instead of `pattern`.

## Common Patterns

### Find functions containing a pattern

```yaml
rule:
  kind: function_declaration
  has:
    pattern: await $EXPR
    stopBy: end
```

### Find a pattern inside a specific context

```yaml
rule:
  pattern: console.log($$$)
  inside:
    kind: method_definition
    stopBy: end
```

### Find code missing an expected pattern (negation)

```yaml
rule:
  all:
    - kind: function_declaration
    - has: { pattern: await $EXPR, stopBy: end }
    - not:
        has:
          kind: try_statement
          stopBy: end
```

### Match multiple alternatives

```yaml
rule:
  any:
    - pattern: console.log($$$)
    - pattern: console.warn($$$)
    - pattern: console.error($$$)
    - pattern: console.debug($$$)
```

### Match a node with a specific child field

```yaml
rule:
  kind: binary_expression
  has:
    field: operator
    regex: "[+\\-]"
```

## Shell Escaping

When using `--inline-rules`:
- **Single-quote** the YAML to avoid shell expansion of `$` metavariables
- If you must use double quotes, escape with `\$VAR`

```bash
# Preferred: single quotes
ast-grep scan --inline-rules 'id: test
language: typescript
rule:
  pattern: console.log($ARG)' /path/to/project

# Alternative: double quotes with escaping
ast-grep scan --inline-rules "rule:
  pattern: console.log(\$ARG)" /path/to/project
```

## Debugging Checklist

1. Start with the simplest possible rule — a bare `pattern` or `kind`
2. Verify `kind` values with `--debug-query=cst`
3. Add `stopBy: end` to every relational rule
4. Check metavariable names are `$UPPER_SNAKE` only
5. Ensure metavariables are sole content in their AST node (no mixing with text)
6. If `run --pattern` doesn't match a structural query, switch to `scan --inline-rules` with relational rules
7. Test against a known-matching snippet via `--stdin` before searching the full codebase
