# AGENTS.md

Guidance for AI agents working in this repository.

> This file currently covers ONE cross-repo convention. It is **not** a complete description of this
> repository's conventions — read the README and the code around whatever you are changing.

## UI mockups live in a different repository

**Never add a design mockup to this repository.** Mockups — static HTML pages we look at and comment
on before something is built — are authored in the public repo `Colibriecosystem/colibri-mockups`
and published at <https://colibriecosystem.github.io/colibri-mockups/>.

A mockup exists to be opened by other people and commented on, so it needs a permanent URL, and
GitHub Pages on this organisation's plan publishes from a public repository only — a private repo
cannot host one at all. Same rule, same reason, as the SDK and the connect page: a public-facing
artefact is authored in its public repo.

Three rules that follow, each easy to get wrong:

- **Scrub before publishing.** No issue numbers, no private repo names, no source paths, no internal
  ticket references. A mockup is a public page and the roadmap it hints at is visible to anyone with
  the link.
- **Vendor only what the page uses.** Before copying a file out of a private repo into the public mockups repo, read what else it carries. A design-system string table, for instance, usually holds the admin console's vocabulary alongside the handful of strings a page actually needs; vendor the handful, not the file.
- **Links to individual mockups live on that repo's front page only.** Anywhere else — here, a doc,
  an issue — link the site root, so there is exactly one place to update when a mockup is added or
  renamed.
