# Writing conventions

How documentation in this repo is written. Applies to the README, ADRs,
`architecture.md`, and commit messages.

## General

- Write for an engineer reading the code, not a user deciding whether to adopt
  it. No adoption pitch, no feature marketing.
- Plain declaratives. Say what is true and stop.
- No superlatives or filler: avoid "seamlessly", "powerful", "robust",
  "simply", "just", "easily", "blazing fast". If a claim is worth making, it
  is worth a number or a reason.
- Don't hedge into vagueness. "Socket.IO support on Bun is not documented" is
  better than "there may be some potential compatibility considerations".
- Em dashes are fine.

## Division of labour

`architecture.md` says what the system *is*, in present tense. ADRs say *why
it became that*. Neither restates the other; `architecture.md` links out to
the relevant record.

## Architecture decision records

Written the day the decision is made, rather than reconstructed later. A
record written in the moment captures the actual reasoning; one written six
weeks later is a rationalisation and reads like one.

- **Nygard format only** — Context, Decision, Consequences. One page.
- **Name the rejected alternative.** A record without one is not a decision,
  it is a description. If nothing was seriously considered and set aside, no
  ADR is needed.
- **State the costs**, not only the benefits. What gets harder, what this
  commits the project to, and anything left unverified.
- **Impersonal voice.** "Use Bun as the runtime", not "we use Bun" or "I chose
  Bun". Decision sections read as imperatives; Context and Consequences are
  plain descriptive prose.
- **Cross-link** related records where the reasoning actually connects.
- **Never edit an accepted record.** Supersede it with a new one and mark the
  old `Superseded by [N]`.
- Update the table in [`adr/README.md`](adr/README.md) when adding one.

### Timing

- A decision that is expensive to reverse and can be seen coming: write the
  record *first*, with `Status: Proposed`, then flip to `Accepted` once built,
  updating Consequences with what was actually learned.
- A decision discovered mid-implementation: write it the same day, after.
- Ordinary feature work: no record. Most features involve no rejected
  alternative.

## Commits

Imperative subject line. The body explains why, not what — the diff already
covers what.
