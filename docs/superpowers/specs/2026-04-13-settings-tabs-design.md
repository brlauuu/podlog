# Settings Page Tabs Design

## Problem

The settings page (`/settings`) displays notifications and remote inference configuration as two stacked sections separated by a divider. Issue #378 asks for two tabs instead, making it immediately obvious both setting categories exist.

## Goal

Convert `NotificationSettings.tsx` from a single-scroll layout to a two-tab layout using shadcn/ui Tabs. Each tab gets its own Save button that only saves that tab's dirty fields.

## Design

### Tab Structure

| Tab | Label | Content |
|-----|-------|---------|
| 1 | Notifications | `NotificationSection` + its Save button |
| 2 | Remote Inference | `RemoteInferenceSection` + its Save button |

The page title ("Settings") and subtitle remain above the tabs. The `Toast` component remains shared (one toast for the whole page).

### State Management

`NotificationSettings.tsx` currently has one `dirty: Partial<Settings>` object. This splits into two:

```ts
const [dirtyNotifications, setDirtyNotifications] = useState<Partial<Settings>>({});
const [dirtyInference, setDirtyInference] = useState<Partial<Settings>>({});
```

`handleChange` routes to the correct dirty tracker based on the field key:

```ts
const INFERENCE_FIELDS: Set<keyof Settings> = new Set([
  "inference_provider", "fireworks_api_key", "fireworks_audio_base_url",
  "fireworks_stt_model", "fireworks_stt_diarize", "fireworks_chat_base_url",
  "fireworks_chat_model", "fireworks_stt_cost_per_minute_usd",
  "embedding_provider", "embedding_model", "fireworks_embedding_base_url",
  "fireworks_embedding_model",
]);

function handleChange(field: keyof Settings, value: ...) {
  setSettings(prev => prev ? { ...prev, [field]: value } : prev);
  if (INFERENCE_FIELDS.has(field)) {
    setDirtyInference(prev => ({ ...prev, [field]: value }));
  } else {
    setDirtyNotifications(prev => ({ ...prev, [field]: value }));
  }
}
```

Two save handlers:

```ts
async function handleSaveNotifications() { /* sends dirtyNotifications */ }
async function handleSaveInference() { /* sends dirtyInference */ }
```

Each save handler follows the same pattern as the current `handleSave`: PUT to `/api/notifications/settings`, update `settings`, clear its own dirty tracker, show toast.

### Tab Component

Install shadcn Tabs:
```bash
npx shadcn@latest add tabs
```

Use `<Tabs defaultValue="notifications">` with the two tabs. The active tab is not persisted (default is always Notifications on page load).

### Save Button Placement

Each tab's Save button sits at the bottom of its `<TabsContent>`, above the shared `<Toast>`.

### Test (Notification Tab Only)

The "Send Test" button for notifications stays in the Notifications tab, behavior unchanged.

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/components/ui/tabs.tsx` | Create — shadcn install |
| `apps/web/src/components/NotificationSettings.tsx` | Modify — split dirty state, add tabs layout |
| `apps/web/tests/unit/notification-settings.test.tsx` | Modify — update tests for tab structure |

## Out of Scope

- URL-based or localStorage tab persistence
- Changes to `NotificationSection`, `RemoteInferenceSection`, or API routes
- Any new settings fields
