# Transfer — Figma to After Effects

This is the ready-to-build Windows Electron bridge for the Transfer Figma plugin.

## Automatic build

Push this repository to GitHub. The **Actions** workflow builds the Windows installer automatically.
Open **Actions → Build Windows EXE → latest run → Artifacts** and download `Transfer-Windows-Installer`.

## Local build

```bash
npm install
npm run dist
```

The installer will be created in `dist/`.
