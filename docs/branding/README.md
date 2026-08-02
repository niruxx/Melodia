# Branding

`app-icon.png` is the 1024×1024 source for the application icon — a headphone
glyph on Melodia's brand gradient (`#7c5cff` → `#ec4899`, the same gradient as
`.brand-mark` in `src/index.css`).

To regenerate every platform icon after editing it:

```bash
npx tauri icon docs/branding/app-icon.png
```

That rewrites `src-tauri/icons/`. The command also emits `android/` and `ios/`
folders; this project is desktop-only, so those can be deleted.
