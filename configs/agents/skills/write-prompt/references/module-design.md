# Module design

Defining a new internal unit's public surface. The deliverable describes the surface and its contracts — explicitly not the implementation.

## Cover in the interview

Axes to hit; derive the actual questions from the task.

- Who consumes this module, and how do they call it?
- What is public vs internal?
- The method signatures, and the input/output contract of each.
- Error and edge-case behavior at the boundary.
- What state does it own?
- What will it explicitly not do?

## Assert before writing — unconditional

Carry each as an acceptance criterion tied to a seam, or an explicit, justified N/A.

- **Surface minimalism** — only what consumers need is public; everything else internal. Each public method has a stated input/output contract and documented error/edge behavior.
- **Boundary honesty** — the module does not silently depend on or mutate things outside its stated surface; what it owns vs touches is explicit.
- **Contract stability** — return types and error modes are defined at the boundary, not left implicit, so consumers can depend on them.
- **Stated non-goals** — what it will not do is written down, to prevent later scope creep into it.
- **No premature generality (forbid)** — no extension points, generics, or configuration for use cases that don't yet exist. A deep module is a lot of behavior behind a small interface, not a wide interface anticipating every caller.

## Seams — where each assertion gets verified

- Test through the **public interface only** — never the implementation. Tests that reach internal collaborators couple to structure and break on refactor; tests through the surface describe what the module does and survive.
- Choose the highest seam that exercises real behavior; prefer an existing one; confirm it with the user.
- Each public-contract assertion is verified by exercising that method through the surface, not by inspecting internals.
