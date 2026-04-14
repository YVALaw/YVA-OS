# YVA OS Refactor (Milestone A)

This project is the React + TypeScript refactor of the legacy single-file invoicing app.

## Goals for Milestone A

- Create a clean project structure (separation of concerns)
- Add routing with **Reports** as the landing page
- Keep the React app as the only maintained invoicing UI
- Remove the retired legacy single-file app once React feature parity is complete

## Run locally

1. Install dependencies

```bash
npm install
```

2. Start dev server

```bash
npm run dev
```

## Logo

Place your logo at:

- `public/yva-logo.png`

A placeholder note file is currently in `public/yva-logo.txt`.

## Data

For now the app reads from the same localStorage keys as the legacy app:

- yvaEmployeesV1
- yvaProjectsV2
- yvaClientsV1
- yvaInvoicesV1
- yvaInvoiceCounterV1

Later we will move this behind a Firestore adapter without changing UI behavior.
