# 4. Engage owns feedback storage

## Status

Accepted

## Context

Each product collected feedback its own way: one in its own database with
its own admin pages, another as issues in a private repository with no way
to reply. Every new product would reinvent this, and personal data would be
spread across several stores with different retention.

## Decision

Engage is the single store for feedback, issue reports and email to product
contact addresses, across every product.

- Products submit through one API, `POST /v1/submissions`, and keep their own
  form UI. Input is validated on the server against a schema (valibot),
  including an optional product-specific `context` object checked against
  the schema in that product's registry row.
- Products are registry rows, not code. Adding one is configuration.
- A product that links submissions to its own accounts sends an opaque
  `accountRef`. When an account is deleted, the product calls
  `DELETE /v1/accounts/<product>/<accountRef>` with its own secret, and
  Engage clears the reference.
- Retention is enforced by Engage: items are deleted a set number of months
  (12 by default, per product) after archiving or last activity, and junk
  after 30 days.
- Existing feedback is imported once (#33), and the products' own stores and
  endpoints are then removed.

## Consequences

- One place to answer, one retention policy to enforce, one record of
  processing to keep current.
- Engage becomes a dependency of every product's feedback forms. An outage
  loses submissions rather than queueing them, so the public API is kept
  small.
- Each product's privacy page names Engage's processing in place of its own.

## Screening record

| Dependency | Maintainer | On a list | Note |
|---|---|---|---|
| valibot | Fabian Hiller (independent open source) | N | Checked 14 November 2026. |
