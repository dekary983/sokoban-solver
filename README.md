# Sokoban Solver — push-optimal by room decomposition

An entry for make.fun's [“Build the best Sokoban solver, 21 November 2026”](https://make.fun/bounty/sokoban-solver-01-run-20261121) bounty.

`main.ts` (plain JavaScript, Node 22 built-ins only) reads each level in
XSB format from `/input/<id>/level.txt` and writes the player's moves to
`/output/<id>/solution.txt`, aiming for the push-optimal solution.

## How it works

The generated levels are a one-square-wide hallway with 1–4 rooms hanging
off it. A box pushed into the hallway can never return, so every box stays
in its own room and a level's push optimum is the sum of its rooms' optima.

1. **Decompose.** Cut the non-live squares of the player's row (the
   hallway) out of the floor; the remaining components holding boxes are
   the rooms. If decomposition fails, the whole level is one room.
2. **Solve each room with push-level A\*.** The heuristic is a minimum-cost
   perfect matching between boxes and goals over exact single-box push
   distances (reverse pull-BFS per goal) — admissible and consistent, so
   the first goal state popped is push-optimal. Dead squares and frozen
   2×2 blocks prune the search; a transposition table keyed by
   (reachable-region representative, sorted boxes) keeps it small.
3. **Stitch and verify.** Room solutions are joined by shortest player
   walks, and the assembled move string is replayed internally with the
   checker's exact rules; if it does not end solved, the program emits the
   safe empty answer instead.

Everything is deterministic: budgets are expansion counts, never the wall
clock, so two runs write byte-identical output.

## Practice set

On the kit's practice set the solver reaches the known optimum on every
instance — 13 / 16 / 29 / 47 / 60 pushes (P\* = 13 / 16 / 29 / 47 / 60),
1,000 points each — in about 0.3 s for the whole set, far inside the
60 s sandbox budget.
