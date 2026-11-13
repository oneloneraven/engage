# Privacy

Rules for handling personal data in this project. The record of what is
processed, and by whom, is in [data protection](data-protection.md).

- **Collect the minimum.** Every piece of personal data has a stated
  purpose in the record of processing before it's collected.
- **No personal data in logs**, URLs or query strings, analytics events,
  error reports, test fixtures or the repository.
- **No email addresses published** in the repository, the site or DNS
  records. Scrapers harvest them.
- **No provider or supplier names, and no detailed architecture, in
  user-facing copy.** Name what a feature does, not what it runs on.
- **One person's raw data is never exposed to another.** Features that
  combine data across people use anonymised aggregates only.
- **Test setup never reaches real external services.** Local secrets files
  can hold real keys, so bulk test setup uses fakes or test modes.
- **Telemetry is aggregate and minimal.** Prefer approaches that need no
  consent banner because they collect nothing personal.
- **A new processor** (any third party that receives personal data) is
  added to the record of processing and the threat model in the same PR.
