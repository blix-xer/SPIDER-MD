# SPIDER-MD

A fresh, modular WhatsApp bot foundation built with Node.js and Baileys.

## Requirements

- Node.js 20 or newer
- npm
- A WhatsApp account that you are authorized to link

## Install

```bash
npm install
npm start
```

Scan the QR code from WhatsApp > Linked devices.

## Test

Send `.ping` to the linked account from another chat. SPIDER-MD should reply that it is online.

## Add a command

1. Create a new file in `src/plugins/`, for example `hello.js`.
2. Export a plugin object with `name`, optional `aliases`, `description`, and `execute`.
3. Import it in `src/plugins/index.js` and add it to the `plugins` array.

## Important

- Keep the `session/` folder private. It contains login credentials.
- Never upload `session/`, API keys, or `.env` files to GitHub.
- This is a starter foundation, not a production-ready deployment.
- Use automation responsibly and follow WhatsApp's terms.
