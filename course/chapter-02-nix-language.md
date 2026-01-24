# Chapter 2: The Nix Language Fundamentals

## Introduction

Welcome to Chapter 2 of your Nix journey. In Chapter 1, you learned what Nix and NixOS are about. Now, we dive into the heart of the Nix ecosystem: the Nix language itself.

The Nix language is the foundation of everything you will do with Nix. Every package definition, every system configuration, every development environment is written in Nix. Understanding this language is not optional - it is essential.

The good news: Nix is a simple language. If you have experience with any programming language, you can learn Nix's core concepts in an afternoon. The syntax may look unfamiliar at first, but the underlying ideas are straightforward.

---

## 2.1 What Is the Nix Language?

The Nix language is a **domain-specific language (DSL)** designed for one purpose: describing how to build software and configure systems.

Think of Nix as "JSON with functions." It shares JSON's data-centric nature but adds the power of functions, making it possible to build complex configurations from simple, reusable pieces.

### Key Characteristics

The Nix language is:

- **Domain-specific**: Built specifically for package management and system configuration. It is not a general-purpose language like Python or JavaScript.

- **Declarative**: You describe *what* you want, not *how* to get it. There are no sequential statements to execute.

- **Pure**: Functions always produce the same output given the same input. There are no side effects during evaluation.

- **Functional**: Functions are first-class values. You can pass them as arguments, return them from other functions, and assign them to names.

- **Lazy**: Expressions are only evaluated when their values are actually needed. This enables infinite data structures and efficient evaluation.

- **Dynamically typed**: Types are checked at runtime, not compile time.

### Files and Evaluation

Nix code lives in files with the `.nix` extension. A `.nix` file contains a single Nix expression. To evaluate a Nix file, you use the `nix-instantiate --eval` command:

```bash
$ echo '1 + 2' > example.nix
$ nix-instantiate --eval example.nix
3
```

You can also experiment interactively with `nix repl`:

```bash
$ nix repl
Welcome to Nix. Type :? for help.

nix-repl> 1 + 2
3

nix-repl> "Hello, Nix!"
"Hello, Nix!"

nix-repl> :q  # exit the repl
```

The repl is invaluable for learning. Use it to test every example in this chapter.

---

## 2.2 Basic Data Types

Nix has a small set of primitive types. Master these, and you understand most Nix code.

### Strings

Strings are the most common data type in Nix configurations. There are two ways to write them.

**Single-line strings** use double quotes:

```nix
"Hello, world!"
"This is a string"
"/etc/nixos/configuration.nix"
```

**Multi-line strings** use two single quotes (`''`):

```nix
''
  This is a multi-line string.
  It can span multiple lines.
  Leading whitespace is automatically stripped.
''
```

The multi-line syntax is crucial for embedding scripts and configuration files:

```nix
''
  #!/bin/bash
  echo "Setting up environment..."
  export PATH="/usr/bin:$PATH"
''
```

Multi-line strings automatically strip the common leading whitespace from all lines. This evaluates to:

```
#!/bin/bash
echo "Setting up environment..."
export PATH="/usr/bin:$PATH"
```

**String concatenation** uses the `+` operator:

```nix
nix-repl> "Hello, " + "world!"
"Hello, world!"

nix-repl> "/home/" + "alice" + "/.config"
"/home/alice/.config"
```

### Numbers

Nix supports **integers** and **floating-point numbers**:

```nix
nix-repl> 42
42

nix-repl> -17
-17

nix-repl> 3.14159
3.14159

nix-repl> 1 + 2
3

nix-repl> 10 / 3    # integer division
3

nix-repl> 10.0 / 3  # floating-point division
3.33333
```

Standard arithmetic operators work as expected: `+`, `-`, `*`, `/`.

### Booleans

Booleans are written as `true` and `false` (lowercase):

```nix
nix-repl> true
true

nix-repl> false
false

nix-repl> !true
false

nix-repl> true && false
false

nix-repl> true || false
true

nix-repl> 1 < 2
true

nix-repl> "abc" == "abc"
true
```

Logical operators: `&&` (and), `||` (or), `!` (not).
Comparison operators: `==`, `!=`, `<`, `>`, `<=`, `>=`.

### Paths

Paths are a distinct type in Nix, separate from strings. They represent locations in the filesystem.

**Absolute paths** start with `/`:

```nix
nix-repl> /etc/nixos/configuration.nix
/etc/nixos/configuration.nix

nix-repl> /nix/store
/nix/store
```

**Relative paths** start with `./` or `../`:

```nix
nix-repl> ./myfile.nix
/home/user/current-directory/myfile.nix  # resolved to absolute

nix-repl> ../parent/file.nix
/home/user/parent/file.nix
```

**Home paths** start with `~`:

```nix
nix-repl> ~/.config
/home/user/.config
```

**Important**: Paths are automatically resolved to absolute paths at evaluation time. They are also copied to the Nix store when used in derivations, which is crucial for reproducibility.

Paths can be concatenated with strings:

```nix
nix-repl> /etc + "/hosts"
/etc/hosts
```

### Null

The `null` value represents the absence of a value:

```nix
nix-repl> null
null

nix-repl> null == null
true
```

You will encounter `null` in optional configuration settings and as default values.

---

## 2.3 Compound Data Types

Compound types let you build complex data structures from simpler values.

### Lists

Lists are ordered collections of values. They use square brackets with **spaces** (not commas) between elements:

```nix
nix-repl> [ 1 2 3 ]
[ 1 2 3 ]

nix-repl> [ "alice" "bob" "charlie" ]
[ "alice" "bob" "charlie" ]

nix-repl> [ 1 "two" true null ]  # mixed types allowed
[ 1 "two" true null ]
```

Lists can contain any values, including other lists and attribute sets:

```nix
[
  1
  "hello"
  [ "nested" "list" ]
  { name = "Alice"; }
]
```

**List concatenation** uses the `++` operator:

```nix
nix-repl> [ 1 2 ] ++ [ 3 4 ]
[ 1 2 3 4 ]

nix-repl> [ "a" ] ++ [ "b" "c" ] ++ [ "d" ]
[ "a" "b" "c" "d" ]
```

**Important syntax note**: Function calls inside lists need parentheses:

```nix
# This is a list with THREE elements: f, 1, 2
[ f 1 2 ]

# This is a list with ONE element: the result of calling f with arguments 1 and 2
[ (f 1 2) ]
```

### Attribute Sets

Attribute sets (often called "attrsets" or just "sets") are collections of key-value pairs. They are Nix's equivalent of objects, dictionaries, or maps in other languages.

```nix
{
  name = "Alice";
  age = 30;
  isAdmin = true;
}
```

Key points:
- Attributes are separated by semicolons (`;`)
- Each attribute ends with a semicolon
- Attribute names usually do not need quotes (unless they contain special characters)
- Order of attributes does not matter

Nested attribute sets can use **dot notation** for convenience:

```nix
# These two are equivalent:
{ a = { b = { c = 1; }; }; }

{ a.b.c = 1; }
```

This shorthand is extremely common in NixOS configurations:

```nix
{
  services.nginx.enable = true;
  services.nginx.virtualHosts."example.com" = {
    root = "/var/www/example";
  };
}
```

### Recursive Attribute Sets

In a normal attribute set, attributes cannot refer to each other:

```nix
nix-repl> { x = 1; y = x + 1; }
error: undefined variable 'x'
```

A **recursive attribute set** (`rec { ... }`) allows self-references:

```nix
nix-repl> rec { x = 1; y = x + 1; z = y + 1; }
{ x = 1; y = 2; z = 3; }
```

This is useful when attributes depend on each other:

```nix
rec {
  version = "1.2.3";
  name = "mypackage-${version}";
  src = fetchurl {
    url = "https://example.com/${name}.tar.gz";
  };
}
```

**Caution**: Use `rec` sparingly. It can make code harder to understand and can lead to infinite recursion if not careful. Often, `let` bindings (covered later) are a better choice.

---

## 2.4 Operators

### String Interpolation

String interpolation embeds expressions inside strings using `${ }`:

```nix
nix-repl> let name = "Alice"; in "Hello, ${name}!"
"Hello, Alice!"

nix-repl> let x = 5; in "x equals ${toString x}"
"x equals 5"
```

You can interpolate any expression:

```nix
nix-repl> "1 + 1 = ${toString (1 + 1)}"
"1 + 1 = 2"

nix-repl> let attrs = { a = "world"; }; in "Hello, ${attrs.a}!"
"Hello, world!"
```

**Important**: Only strings can be interpolated. Use `toString` for numbers:

```nix
# Wrong - causes an error:
"The answer is ${42}"

# Correct:
"The answer is ${toString 42}"
```

To include a literal `${` in a string, escape it:

```nix
# In double-quoted strings, use backslash:
"echo \${PATH}"  # evaluates to: echo ${PATH}

# In multi-line strings, use '':
''
  echo ''${PATH}
''
```

String interpolation is ubiquitous in Nix. You will see it in paths, URLs, shell scripts, and configuration values.

### Attribute Access

Access attributes with dot notation:

```nix
nix-repl> { x = 1; y = 2; }.x
1

nix-repl> let person = { name = "Alice"; age = 30; }; in person.name
"Alice"
```

For nested attributes:

```nix
nix-repl> { a = { b = { c = 42; }; }; }.a.b.c
42
```

**Access with default** using `or`:

```nix
nix-repl> { x = 1; }.y or 99
99  # y doesn't exist, so default is used

nix-repl> { x = 1; }.x or 99
1   # x exists, so its value is used
```

This is invaluable for optional configuration:

```nix
config.services.nginx.port or 80
```

### The `//` Operator (Attribute Set Merge)

The `//` operator merges two attribute sets. Attributes in the right set override those in the left:

```nix
nix-repl> { a = 1; b = 2; } // { b = 3; c = 4; }
{ a = 1; b = 3; c = 4; }
```

Think of it as "update left with right":

```nix
let
  defaults = {
    host = "localhost";
    port = 8080;
    debug = false;
  };
  overrides = {
    port = 3000;
    debug = true;
  };
in
  defaults // overrides
# Result: { host = "localhost"; port = 3000; debug = true; }
```

This pattern is extremely common for providing default values that users can override.

**Note**: The merge is shallow. Nested sets are replaced, not merged:

```nix
nix-repl> { a = { x = 1; y = 2; }; } // { a = { y = 3; }; }
{ a = { y = 3; }; }  # a.x is lost!
```

For deep merging, you would use library functions like `lib.recursiveUpdate`.

### The `++` Operator (List Concatenation)

The `++` operator concatenates lists:

```nix
nix-repl> [ 1 2 3 ] ++ [ 4 5 6 ]
[ 1 2 3 4 5 6 ]

nix-repl> [ "a" ] ++ [ "b" ] ++ [ "c" ]
[ "a" "b" "c" ]
```

Commonly used to combine package lists:

```nix
{
  environment.systemPackages =
    (with pkgs; [ vim git wget ]) ++
    (if config.services.xserver.enable
     then [ pkgs.firefox ]
     else []);
}
```

---

## 2.5 Let Bindings

The `let ... in ...` expression creates local bindings. This is how you define variables in Nix:

```nix
let
  x = 1;
  y = 2;
in
  x + y
# Evaluates to: 3
```

Bindings can reference each other (order does not matter):

```nix
let
  b = a + 1;  # refers to 'a' defined below
  a = 1;
in
  b
# Evaluates to: 2
```

**Practical example** - building a package URL:

```nix
let
  name = "hello";
  version = "2.10";
  fullName = "${name}-${version}";
  baseUrl = "https://ftp.gnu.org/gnu";
in
  "${baseUrl}/${name}/${fullName}.tar.gz"
# Evaluates to: "https://ftp.gnu.org/gnu/hello/hello-2.10.tar.gz"
```

Let bindings are scoped - they only exist within the `in` expression:

```nix
let
  secret = "password123";
in
  "The secret is hidden"
# 'secret' does not exist outside this expression
```

**Nested let bindings**:

```nix
let
  a = 1;
in
  let
    b = a + 1;
  in
    a + b
# Evaluates to: 3
```

Let bindings are the preferred way to:
- Avoid repetition
- Give meaningful names to complex expressions
- Build up complex values step by step

---

## 2.6 Functions

Functions are the heart of Nix. Every package, every module, every configuration is built with functions.

### Basic Lambda Syntax

Functions are anonymous (lambdas). The syntax is: `argument: body`

```nix
nix-repl> x: x + 1
«lambda @ (string):1:1»  # the repl shows it's a function

nix-repl> (x: x + 1) 5
6

nix-repl> (x: x * 2) 10
20
```

To give a function a name, use `let`:

```nix
let
  double = x: x * 2;
  increment = x: x + 1;
in
  double (increment 5)
# Evaluates to: 12
```

**Function application**: Simply put the argument after the function name, separated by space. No parentheses needed:

```nix
double 5       # correct
double(5)      # also works, but not idiomatic
```

### Multi-Parameter Functions (Currying)

Nix functions take exactly one argument. Multiple parameters are achieved through currying:

```nix
# A function that returns a function
add = x: y: x + y;

# Equivalent to:
add = x: (y: x + y);
```

Usage:

```nix
nix-repl> let add = x: y: x + y; in add 2 3
5

# You can partially apply:
nix-repl> let add = x: y: x + y; addFive = add 5; in addFive 3
8
```

Real-world example - a function to create a greeting:

```nix
let
  makeGreeting = greeting: name: "${greeting}, ${name}!";
  sayHello = makeGreeting "Hello";
  sayGoodbye = makeGreeting "Goodbye";
in
  [
    (sayHello "Alice")     # "Hello, Alice!"
    (sayGoodbye "Bob")     # "Goodbye, Bob!"
  ]
```

### Functions with Attribute Set Arguments

Most Nix functions take an attribute set as their argument. This is the pattern you will see everywhere:

```nix
{ name, age }: "Name: ${name}, Age: ${toString age}"
```

Calling it:

```nix
nix-repl> let f = { name, age }: "${name} is ${toString age}"; in f { name = "Alice"; age = 30; }
"Alice is 30"
```

The function **destructures** the attribute set, binding `name` and `age` to local variables.

**Required vs optional attributes**: By default, all listed attributes are required:

```nix
nix-repl> ({ x, y }: x + y) { x = 1; }
error: function at (string):1:2 called without required argument 'y'
```

### Default Values

Use `?` to provide default values for optional arguments:

```nix
{ name, greeting ? "Hello" }: "${greeting}, ${name}!"
```

```nix
nix-repl> let greet = { name, greeting ? "Hello" }: "${greeting}, ${name}!"; in greet { name = "Alice"; }
"Hello, Alice!"

nix-repl> let greet = { name, greeting ? "Hello" }: "${greeting}, ${name}!"; in greet { name = "Alice"; greeting = "Hi"; }
"Hi, Alice!"
```

This pattern is ubiquitous in Nixpkgs:

```nix
{ stdenv
, fetchurl
, enableFeatureX ? true
, enableFeatureY ? false
}:
# ... package definition
```

### The Ellipsis (`...`) for Extra Arguments

By default, passing unexpected attributes is an error:

```nix
nix-repl> ({ x }: x) { x = 1; y = 2; }
error: function at (string):1:2 called with unexpected argument 'y'
```

Use `...` to accept (and ignore) additional attributes:

```nix
nix-repl> ({ x, ... }: x) { x = 1; y = 2; z = 3; }
1
```

This is essential when your function only needs some attributes from a larger set:

```nix
{ lib, stdenv, fetchurl, ... }:
# Only uses lib, stdenv, fetchurl
# Ignores any other attributes passed in
```

### The `@` Pattern (Binding the Whole Set)

Sometimes you need both individual attributes AND the whole set. The `@` pattern does this:

```nix
{ x, y, ... } @ args:
  # x and y are bound individually
  # args is bound to the entire attribute set
```

Or equivalently:

```nix
args @ { x, y, ... }:
  # same thing, different syntax
```

Practical example:

```nix
{ pkgs, lib, ... } @ args:
let
  # Use individual bindings for common access
  inherit (lib) mkIf;

  # Pass the whole thing to another function
  result = someOtherFunction args;
in
  # ...
```

Real-world usage in NixOS modules:

```nix
{ config, lib, pkgs, ... }:
{
  options = { };
  config = { };
}
```

---

## 2.7 Conditionals

Nix has one conditional construct: `if-then-else`. It is an expression, not a statement, meaning it always returns a value.

```nix
if condition then valueIfTrue else valueIfFalse
```

Examples:

```nix
nix-repl> if true then "yes" else "no"
"yes"

nix-repl> if 1 > 2 then "math is broken" else "math works"
"math works"

nix-repl> let x = 5; in if x > 0 then "positive" else "non-positive"
"positive"
```

**Both branches are required.** There is no `if` without `else`.

**Practical usage** - conditional package inclusion:

```nix
let
  isLinux = builtins.currentSystem == "x86_64-linux";
in {
  packages = [ vim git ] ++
    (if isLinux then [ linuxPackages.perf ] else []);
}
```

**Nested conditionals**:

```nix
let
  score = 85;
in
  if score >= 90 then "A"
  else if score >= 80 then "B"
  else if score >= 70 then "C"
  else "F"
# Evaluates to: "B"
```

---

## 2.8 The Import Statement

The `import` function loads and evaluates a Nix file:

```nix
import ./other-file.nix
```

If `other-file.nix` contains:

```nix
# other-file.nix
{
  name = "Alice";
  age = 30;
}
```

Then:

```nix
# main.nix
let
  person = import ./other-file.nix;
in
  person.name
# Evaluates to: "Alice"
```

**Importing functions**: If a file contains a function, you can call it after importing:

```nix
# greet.nix
name: "Hello, ${name}!"

# main.nix
let
  greet = import ./greet.nix;
in
  greet "Alice"
# Evaluates to: "Hello, Alice!"
```

**Common pattern** - importing with arguments:

```nix
# mypackage.nix
{ stdenv, fetchurl }:
stdenv.mkDerivation {
  # ...
}

# main.nix
let
  pkgs = import <nixpkgs> {};
  mypackage = import ./mypackage.nix {
    inherit (pkgs) stdenv fetchurl;
  };
in
  mypackage
```

The `<nixpkgs>` syntax is a **lookup path** that finds Nixpkgs in the system. When you `import <nixpkgs> {}`, you get the full package set.

---

## 2.9 The With Statement

The `with` expression brings all attributes of a set into scope:

```nix
with { a = 1; b = 2; }; a + b
# Evaluates to: 3
```

Most commonly used with packages:

```nix
# Without 'with':
[ pkgs.vim pkgs.git pkgs.wget pkgs.curl ]

# With 'with':
with pkgs; [ vim git wget curl ]
```

**NixOS configuration example**:

```nix
{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    vim
    git
    wget
    curl
    firefox
    thunderbird
  ];
}
```

**Scoping behavior**: `with` does not override existing bindings:

```nix
let
  x = 10;
in
  with { x = 20; }; x
# Evaluates to: 10 (let binding takes precedence)
```

**Nested with**:

```nix
with { a = 1; }; with { b = 2; }; a + b
# Evaluates to: 3
```

**Caution**: Overusing `with` can make code harder to read because it is not obvious where names come from. Use it for well-known sets like `pkgs`, but consider explicit prefixes or `inherit` for clarity in other cases.

---

## 2.10 The Inherit Keyword

The `inherit` keyword is syntactic sugar for copying attributes.

### Basic Inherit

Inside an attribute set, `inherit x y z;` is equivalent to `x = x; y = y; z = z;`:

```nix
let
  name = "Alice";
  age = 30;
in {
  inherit name age;
  occupation = "Developer";
}
# Equivalent to: { name = "Alice"; age = 30; occupation = "Developer"; }
```

### Inherit From

`inherit (source) x y z;` copies attributes from another set:

```nix
let
  person = { name = "Alice"; age = 30; city = "NYC"; };
in {
  inherit (person) name age;
}
# Equivalent to: { name = person.name; age = person.age; }
# Result: { name = "Alice"; age = 30; }
```

### Practical Uses

**Passing dependencies in packages**:

```nix
{ lib, stdenv, fetchurl, ... }:

stdenv.mkDerivation {
  pname = "mypackage";
  inherit (lib) makeWrapper;  # bring makeWrapper into scope
  # ...
}
```

**In let bindings**:

```nix
let
  pkgs = import <nixpkgs> {};
  inherit (pkgs) vim git firefox;  # extract specific packages
in
  [ vim git firefox ]
```

**Combining inherit patterns**:

```nix
{ config, lib, pkgs, ... }:

let
  inherit (lib) mkIf mkOption types;
  inherit (pkgs) writeShellScript;
  myName = "example";
in {
  inherit myName;  # put myName into the result
  script = writeShellScript "example" "echo hello";
}
```

`inherit` reduces repetition and makes it clear where values come from.

---

## 2.11 Putting It All Together

Let's combine everything into a realistic example. Here is a simplified NixOS module pattern:

```nix
# myservice.nix
{ config, lib, pkgs, ... }:

let
  inherit (lib) mkIf mkOption mkEnableOption types;
  cfg = config.services.myservice;
in {
  options.services.myservice = {
    enable = mkEnableOption "my custom service";

    port = mkOption {
      type = types.port;
      default = 8080;
      description = "Port to listen on";
    };

    user = mkOption {
      type = types.str;
      default = "myservice";
      description = "User to run the service as";
    };
  };

  config = mkIf cfg.enable {
    systemd.services.myservice = {
      description = "My Custom Service";
      wantedBy = [ "multi-user.target" ];

      serviceConfig = {
        ExecStart = "${pkgs.myservice}/bin/myservice --port ${toString cfg.port}";
        User = cfg.user;
      };
    };

    networking.firewall.allowedTCPPorts = [ cfg.port ];

    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.user;
    };

    users.groups.${cfg.user} = {};
  };
}
```

This example demonstrates:
- Function with attribute set argument and ellipsis
- `let` bindings with `inherit`
- Attribute sets with dot notation
- String interpolation
- `if-then-else` via `mkIf`
- List syntax
- The `with` pattern (implicit in `wantedBy`)

---

## Exercises

### Exercise 1: Basic Types
Write a Nix expression that creates an attribute set with:
- Your name (string)
- Your age (integer)
- Whether you know Nix (boolean)
- A list of three programming languages you know

### Exercise 2: Let Bindings
Using `let`, define:
- `firstName` and `lastName` strings
- `fullName` that combines them with a space
- `greeting` that says "Hello, [fullName]!"

Return the greeting.

### Exercise 3: Functions
Write a function `describePerson` that takes an attribute set with `name` and optional `age` (default: "unknown"), and returns a string like "Alice is 30 years old" or "Bob is unknown years old".

### Exercise 4: Conditionals
Write a function `gradeToLetter` that takes a numeric grade (0-100) and returns:
- "A" for 90+
- "B" for 80-89
- "C" for 70-79
- "F" for below 70

### Exercise 5: Attribute Set Merge
Given:
```nix
defaults = { shell = "bash"; editor = "nano"; browser = "firefox"; };
preferences = { editor = "vim"; browser = "chrome"; };
```

Use `//` to merge them, with preferences taking priority.

### Exercise 6: Module Pattern
Create a simple configuration that would represent a web server:
- Use let bindings for `serverName`, `port`, and `documentRoot`
- Create an attribute set with `config` containing these values
- Include an `enable` attribute set to `true`
- Use `inherit` where appropriate

---

## Summary

In this chapter, you learned:

1. **What Nix is**: A pure, functional, lazy, domain-specific language for configuration

2. **Basic types**: Strings, numbers, booleans, paths, null

3. **Compound types**: Lists (with spaces, not commas), attribute sets, recursive attribute sets

4. **Operators**: String interpolation (`${}`), attribute access (`.`), merge (`//`), concatenation (`++`)

5. **Let bindings**: Local variable definitions with `let ... in`

6. **Functions**: Lambda syntax (`x: body`), attribute set arguments, defaults (`?`), ellipsis (`...`), and `@` pattern

7. **Conditionals**: `if-then-else` expressions

8. **Import**: Loading other Nix files with `import`

9. **With**: Bringing attributes into scope

10. **Inherit**: Copying attributes concisely

These fundamentals appear in every Nix file you will ever read or write. In the next chapter, we will explore Nix Flakes - the modern way to manage Nix projects and dependencies.

---

## Additional Resources

- **Nix Language Reference**: https://nix.dev/manual/nix/stable/language/
- **Nix Language Basics Tutorial**: https://nix.dev/tutorials/nix-language
- **Nix Pills (Functions chapter)**: https://nixos.org/guides/nix-pills/functions-and-imports
- **Interactive Nix tour**: https://nixcloud.io/tour/
- **Noogle (function search)**: https://noogle.dev/
