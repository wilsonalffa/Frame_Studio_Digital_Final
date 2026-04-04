# Copilot instructions for FastFrame_Final

## Big picture (read this first)
- This is a **Flask server-rendered app** with one backend file (`app.py`) and a mostly client-side UI in `templates/index.html` + `static/assets/js/script.js`.
- The app is a single-process monolith: Flask serves pages and one AI endpoint; browser JS does almost all image processing/simulation with `<canvas>`.
- Route protection is session-based (`login_required` decorator). `/` and `/analisar-arte` require login.
- Main UX is tabbed inside one HTML page (`tab-quadros`, `tab-canvas`, `tab-simquadro`, `tab-simulador`) switched by `switchTab()`.

## Backend conventions
- Keep auth and route style consistent with `app.py`:
  - Login state: `session['logged_in']`
  - Credentials from env: `FF_USER`, `FF_PASS`
  - Secret key from `SECRET_KEY` (dev fallback exists)
- AI integration uses `google-generativeai` (`gemini-1.5-flash`) and expects `GOOGLE_API_KEY` from `.env`; app raises immediately if missing.
- `/analisar-arte` expects `multipart/form-data` with `file`; returns JSON `{ "analise": ... }` or `{ "erro": ... }`.

## Frontend conventions (project-specific)
- `index.html` uses many inline handlers (`onclick`, `oninput`) that call global functions from `script.js`. Prefer extending this pattern over introducing frameworks.
- `script.js` is organized by feature blocks with global state prefixes:
  - `q*` = imagem/qualidade
  - `c*` = divisão/sangria
  - `sq*` = simulação de quadro individual
  - `w*`/wall = simulação de ambiente
- Cross-tab image reuse is intentional (`qImg` auto-populates other tabs in `switchTab`). Preserve this behavior.
- Download flows use the filename modal (`askFileName` / `confirmFileName`) and export as JPG/PDF (`jsPDF` in browser).
- HEIC/HEIF support is client-side via `heic2any`; PDF upload fallback is a generated placeholder canvas.

## Feature toggles and dormant code
- “Assistente IA” UI is intentionally disabled with Jinja guards (`{% if false %}` in `index.html`).
- Matching chatbot logic is intentionally commented in `script.js` (`ASSISTENTE IA — DESATIVADO`).
- If re-enabling assistant features, update **both** template guards and JS comment block together.

## Styling/UI patterns
- Primary styles live in `static/assets/css/styles.css`, but `index.html` also has large inline `<style>` blocks for feature-specific rules.
- UI language and labels are Portuguese (pt-BR); keep new user-facing text consistent.
- Color system is custom CSS vars (`--brown`, `--gold`, etc.) mapped to brand colors (blue/red in current theme).

## Developer workflows
- Setup: create/activate virtualenv, then `pip install -r requirements.txt`.
- Required env vars for local run: `GOOGLE_API_KEY`; optional overrides: `SECRET_KEY`, `FF_USER`, `FF_PASS`.
- Run locally: `python app.py` (debug mode on, host `0.0.0.0`, port `5000`).
- There are no automated tests in this repo; validate changes by manual browser flows across all tabs.

## Safe change strategy for agents
- Make small, surgical edits: `index.html` and `script.js` are tightly coupled by hard-coded IDs and handler names.
- When renaming/removing an element ID in template, update every JS reference immediately.
- Do not “clean up” pinned dependencies in `requirements.txt` unless explicitly requested (file includes broad environment packages).