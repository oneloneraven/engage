# Architecture decision records

Significant, hard-to-reverse decisions, one per file, in
[Nygard's format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
Title, Status, Context, Decision, Consequences. Numbered `NNNN-title.md`.

An accepted ADR is never edited. A changed decision gets a new ADR, and the
old one's status becomes "Superseded by ADR-NNNN".

| ADR | Decision |
|---|---|
| 0001 | Record architecture decisions |
| 0002 | Screen dependencies and vendors against BDS boycott lists |
| 0003 | One Worker on two hosts |
| 0004 | Engage owns feedback storage |
| 0005 | Content-free notifications |
| 0006 | Signed reply addresses |
| 0007 | Show inbound HTML only in a sandbox |
| 0008 | Engage brokers deploy credentials (superseded by 0009) |
| 0009 | Engage operates; granting and watching move out |

Every ADR is kept in the private vault, at `oneloneraven-vault/engage/adr/`. This index lists their numbers and titles only.
