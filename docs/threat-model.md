# Threat model

What Engage protects, from whom, and how. Update it in the same PR as any
change that adds or moves a trust boundary ([coding standards](coding-standards.md#security)).

## The system

Describe the components, where each runs, and how data flows between them.

## Trust boundaries

| Boundary | Between | What crosses it | Controls |
|---|---|---|---|
| Release job → GitHub API | `release.yml` and the release GitHub App | Short-lived App token (Contents and Workflows: read and write) to push release tags and create releases | Token minted only in the release job and scoped to this repository; App installed on this repository only; private key held as a repository secret |

## Assets

| Asset | Why it matters |
|---|---|
| Release App private key | Anyone holding it can mint tokens that push tags and, through Workflows, change workflow files |

## Actors

| Actor | Capability | Motivation |
|---|---|---|
| Anonymous internet user | Any public request | Abuse, data access |
| Signed-in user | Their own account | Access to others' data |
| Compromised dependency | Code execution at install or runtime | Credential theft |
| Maintainer account takeover | Repository and platform access | Anything |

## Threats (STRIDE)

| Threat | Category | Mitigation | Status |
|---|---|---|---|
| | Spoofing | | |
| | Tampering | | |
| | Repudiation | | |
| | Information disclosure | | |
| | Denial of service | | |
| Leaked release token or App key used to alter workflow files | Elevation of privilege | The Workflows permission is needed because GitHub refuses a tag whose commit's workflow files differ from the default branch's. Tokens last one hour and are minted only in the release job; the key is a repository secret; the App is installed on this repository only | Accepted |

## Known gaps

None recorded yet.
