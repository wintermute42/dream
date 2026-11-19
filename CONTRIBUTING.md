# Contributing

Thanks for your interest in Dream! Bug reports and ideas are welcome as issues; please use the templates and leave out
anything private (keys, QR codes, your own paths or addresses). Security problems go privately, see `SECURITY.md`.

Pull requests are welcome too. A few things keep Dream consistent:

- **Everything in the repository is English** (code, comments, commits, README). Text a person sees goes through the
  translation files: English in the code, the German in `static/i18n/de.json`; `python3 scripts/i18n_check.py` must
  report nothing missing.
- **The README is the manual:** a change in behaviour updates `README.md` and `README.de.md` in the same pull request.
- **Rights are checked in the server,** never only in the page: a new route or setting that costs money, changes the
  owner's files or uses the Mac's camera is for Dream Control only (`rights.py`: the roles table, `CONTROL_ONLY`,
  `GUEST_HTTP`; a setting a guest may change says so in the settings table, `settings.py`).
- **No personal data** anywhere: examples use invented, neutral values.
- **Licence:** Dream is under the AGPL-3.0-or-later. A new model needs a licence that allows at least free private and
  non-commercial use (see "Licences" in the README).
- **Contributor License Agreement:** before a pull request can be merged, its author signs the [CLA](CLA.md) once, by
  commenting on the pull request with the sentence the CLA bot asks for. You keep the copyright in your contribution;
  the CLA lets the maintainer offer Dream under the AGPL and also under other licences (for example a commercial
  licence), which the AGPL alone would not allow for code of several authors. Dream stays available under the AGPL.

Run the tests before a pull request: `uv run pytest` (no model or GPU needed) and `python3 scripts/i18n_check.py`;
the CI runs them, with the JavaScript tests, on Linux and macOS for every pull request, and a pull request can only be
merged when both are green. A change to the rights (a new route, role or setting) needs its line in `tests/test_rights.py` or
`tests/test_settings.py`. `server.py` only puts the parts together; `CLAUDE.md` says which file holds what. Please also describe in the pull request how you tried your change.
