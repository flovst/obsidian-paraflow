---
name: joplin
description: Distinguish Joplin reading CSS, interface CSS and built-in palette objects during theme adaptation.
---

# Joplin

`userstyle.css` styles rendered notes and printing; `userchrome.css` styles the application interface. File names and surrounding profile/package documentation provide clues. Generic reading CSS can have no application-specific markers.

For reading CSS, preserve Markdown rules and adapt Joplin-specific selectors, resources and print branches to the requested output. Inspect `userchrome.css` for relevant content rules only when supplied for that purpose. Built-in themes use palette objects; [prepare-joplin.mjs](scripts/prepare-joplin.mjs) statically expands their parents and palette constants. Map the resulting semantic colors using the matching version's rendered-note styles and code theme. Keep the original inputs and licenses with the package.

Joplin's DOM can change by version. Verify content selectors against the supplied source and intended elements. Sources: [custom CSS](https://joplinapp.org/help/apps/custom_css/) and [built-in palettes](https://github.com/laurent22/joplin/tree/dev/packages/lib/themes).
