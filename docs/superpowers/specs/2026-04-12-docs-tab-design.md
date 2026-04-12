# Docs Tab + Wizard Removal Design Spec

**Date:** 2026-04-12
**Issue:** #350

## Overview

Replace the first-run setup wizard with a `/docs` page that renders markdown guides from `docs/guide/` with a sidebar navigation. This provides permanent, discoverable documentation access while simplifying the codebase.

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Navbar: Search | Ask | Sources | Queue | Settings | Docs | About │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐  ┌─────────────────────────────────────────┐ │
│  │ Guide        │  │                                         │ │
│  │              │  │  # Installation                         │ │
│  │ ● README     │  │                                         │ │
│  │ ○ 01-install │  │  Get Podlog running on your machine...   │ │
│  │ ○ 02-first   │  │                                         │ │
│  │ ○ 03-feeds   │  │  ## System Requirements                 │ │
│  │ ○ 04-search  │  │  ...                                    │ │
│  │ ...          │  │                                         │ │
│  └──────────────┘  └─────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

- **Sidebar:** Fixed left, 200-250px wide, scrollable, highlights current page
- **Content:** Right side, renders selected markdown with prose styling
- **Default:** README displayed when visiting `/docs`

## How It Works

### Route

`apps/web/src/app/docs/page.tsx` — Server component that reads the filesystem and passes doc list to client component.

### Client Component

`apps/web/src/app/docs/DocsClient.tsx` — Client component handling:
- Sidebar rendering with current-page highlighting
- Markdown content rendering
- URL param sync (`?page=01-installation`) for shareability

### Sidebar Logic

- Fetches `docs/guide/` directory at runtime
- Lists all `.md` files sorted alphabetically by filename
- Active page highlighted in sidebar
- Optional: Strip `.md` extension and convert `01-installation` → "Installation" for display

### Content Rendering

- `react-markdown` for markdown parsing
- `@tailwindcss/typography` prose classes for styling
- `remark-gfm` for GitHub-flavored markdown (tables, task lists, strikethrough)
- `rehype-raw` to allow HTML in markdown

### Internal Link Handling

`react-markdown` link transformer rewrites `*.md` links to query params:
- `[Installation](01-installation.md)` → `/docs?page=01-installation`
- `[README](README.md)` → `/docs?page=README`

This preserves existing doc content without modification.

### Navbar Change

Add `Docs` between Settings and About:
```tsx
{ href: "/docs", label: "Docs" },
```

## Files to Create

```
apps/web/src/app/docs/
  page.tsx              # Server component: reads filesystem, passes doc list
  DocsClient.tsx        # Client component: sidebar + content rendering
```

## Files to Delete

### Components
- `apps/web/src/components/SetupWizard.tsx`
- `apps/web/src/components/WizardProvider.tsx`
- `apps/web/src/components/WizardHealthCheck.tsx`
- `apps/web/src/components/WizardAddFeed.tsx`
- `apps/web/src/components/WizardComplete.tsx`
- `apps/web/src/components/HelpMenu.tsx`

### API Routes
- `apps/web/src/app/api/wizard/` (entire directory)

### Tests
- `apps/web/tests/unit/setup-wizard.test.tsx`
- `apps/web/tests/unit/wizard-status-route.test.ts`

### Files to Modify
- `apps/web/src/app/layout.tsx` — Remove WizardProvider, SetupWizard imports/usage
- `apps/web/src/components/Navbar.tsx` — Remove HelpMenu, add Docs link

## Dependencies

Add to `apps/web/package.json`:
- `react-markdown` — Markdown rendering
- `remark-gfm` — GitHub-flavored markdown
- `rehype-raw` — Allow HTML in markdown

## Testing

1. Unit test: Verify sidebar shows all docs from directory
2. Unit test: Verify markdown renders correctly
3. Unit test: Verify internal link transformation works
4. Integration: Navigate between docs via sidebar

## Edge Cases

- **No docs directory:** Show "Documentation not found" message
- **Missing doc file:** Show 404-style message for that page
- **Empty README:** Render empty content area
- **Code blocks:** Ensure syntax highlighting works (use existing syntax highlighter or keep plain)
