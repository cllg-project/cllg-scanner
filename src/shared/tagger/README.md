# Vendored: cllg-project/light-tagger

CRF tagger for notes (`NOTE`), bibliographic citations (`BIBL`) and references (`REF`).
Source: https://github.com/cllg-project/light-tagger @ b7ddcc4c8593acf5232a0ae738c76af750d816d5
(`js/src/{tagger,features,unicode_py}.js`, `models/{note,cite}.json`).

Local changes: the three `.js` files were converted from CommonJS to ES modules (`require`/`module.exports` -> `import`/`export`); `tagger.d.ts` was added. Nothing else.

**License:** written by the CLLG maintainers; vendored here with their consent (the upstream package.json still says `UNLICENSED`/private).

The app uses it through `../lightTag.ts`.
