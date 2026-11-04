# demo/

A self-contained, front-end-only demo of the WayStone interface, served at `/demo`.

- It has no database, no server-side account, no sessions and no hashing. The username and password are compared as plain text in `api.js`, and the signed-in state lives in page memory, so a refresh signs you out.
- `server.js` builds the page from the real `index.html` and swaps two modules using an import map: `/core/client/api.js` becomes `demo/api.js`, and `/core/client/crypto.js` becomes `demo/crypto.js`. Everything else is the real application code.
- `data.json` uses the same format as the Export button. Items are stored as plain JSON in memory.
- Credentials live in `config.js`, which the handbook page also reads.
- Writes are refused (`api.js`), and `demo.css` hides the controls that would attempt them.
