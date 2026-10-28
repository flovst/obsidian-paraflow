# ParaFlow bundled theme input

This is ParaFlow's adapted input based on Typora 1.9.5 bundled `night.css` from [typora-default-themes](https://github.com/typora/typora-default-themes). It is included in exported ParaFlow theme packages for editing and reconversion. Upstream copyright and resource notices remain applicable.

The adaptation removes earlier declarations overridden by later declarations in the same rule. Literal values preceding CSS variables are obsolete fallbacks for browsers without custom property support; supported Obsidian browsers use the later declarations. Runtime conversion and supported-browser computed styles are unchanged.
