# Contributing

Thanks for your interest in Dream! Bug reports and ideas are welcome as issues; please use the templates and leave out
anything private (keys, QR codes, your own paths or addresses). Security problems go privately, see `SECURITY.md`.

Pull requests are welcome too. A few things keep Dream consistent:

- **Everything in the repository is English** (code, comments, commits, README). Text a person sees goes through the
  translation files: English in the code, the German in `static/i18n/de.json`; `python3 scripts/i18n_check.py` must
  report nothing missing.
- **The README is the manual:** a change in behaviour updates `README.md` and `README.de.md` in the same pull request.
- **Rights are checked in the server,** never only in the page: a new route or setting that costs money, changes the
  owner's files or uses the Mac's camera is for Dream Control only (`server.py`: `CONTROL_ONLY`, `GUEST_KEYS`,
  `GUEST_HTTP`).
- **No personal data** anywhere: examples use invented, neutral values.
- **Licence:** Dream is under the AGPL-3.0-or-later; by contributing you agree that your contribution is too. A new model
  needs a licence that allows at least free private and non-commercial use (see "Licences" in the README).

Automated tests are being set up; until then please describe in the pull request how you tested your change.
