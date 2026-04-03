# Email Notification Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stale "Configured" label when email is cleared, add multi-recipient support with a tag-style input and email validation.

**Architecture:** The `notification_email_to` field stays a single string but now holds comma-separated emails. The backend normalizes empty/whitespace strings to `None` so the `email_configured` flag correctly reflects cleared fields. The frontend replaces the single text input with an `EmailTagInput` component that validates and manages a list of email chips, serializing to/from the comma-separated string.

**Tech Stack:** React (Next.js 14), Python (FastAPI), SQLAlchemy, smtplib

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `apps/pipeline/app/services/notification_settings.py` | Modify | Normalize empty strings to `None` for nullable fields; use truthiness for `email_configured` |
| `apps/pipeline/tests/unit/test_notification_settings.py` | Modify | Add tests for empty-string normalization and multi-email configured flag |
| `apps/pipeline/app/api/notifications.py` | Modify | Handle comma-separated `To` in `send_test_email` |
| `apps/pipeline/app/services/notifications.py` | Modify | Handle comma-separated `To` in `send_email` |
| `apps/pipeline/app/services/digest.py` | Modify | Handle comma-separated `To` in `_send_digest` |
| `apps/pipeline/tests/unit/test_notifications_api.py` | Modify | Add test for multi-recipient test email |
| `apps/web/src/components/NotificationSettings.tsx` | Modify | Replace email input with `EmailTagInput`; derive `email_configured` from local state |
| `apps/web/tests/unit/notification-settings.test.tsx` | Modify | Add tests for tag input, validation, configured badge |

---

### Task 1: Backend — Normalize empty strings to `None`

**Files:**
- Modify: `apps/pipeline/app/services/notification_settings.py:19-31,50-67,70-117`
- Test: `apps/pipeline/tests/unit/test_notification_settings.py`

The root cause of the stale label: saving `""` stores it in DB, and the `is not None` check treats it as configured.

- [ ] **Step 1: Write failing test — saving empty string normalizes to None**

Add to `TestSaveNotificationSettings` in `apps/pipeline/tests/unit/test_notification_settings.py`:

```python
def test_empty_string_normalized_to_none(self):
    stored = json.dumps({"notification_email_to": "user@example.com"})
    db = _mock_db(stored_json=stored)
    with patch("app.services.notification_settings.settings") as mock_settings:
        mock_settings.telegram_bot_token = None
        mock_settings.telegram_chat_id = None
        mock_settings.notification_email_to = None
        mock_settings.notification_email_from = "podlog@localhost"
        mock_settings.smtp_host = "host.docker.internal"
        mock_settings.smtp_port = 25
        mock_settings.smtp_user = None
        mock_settings.smtp_password = None
        mock_settings.smtp_use_tls = False
        mock_settings.notification_frequency = "immediate"

        result = save_notification_settings(db, {"notification_email_to": ""})

    assert result["notification_email_to"] is None
    assert result["email_configured"] is False

def test_whitespace_only_normalized_to_none(self):
    stored = json.dumps({"notification_email_to": "user@example.com"})
    db = _mock_db(stored_json=stored)
    with patch("app.services.notification_settings.settings") as mock_settings:
        mock_settings.telegram_bot_token = None
        mock_settings.telegram_chat_id = None
        mock_settings.notification_email_to = None
        mock_settings.notification_email_from = "podlog@localhost"
        mock_settings.smtp_host = "host.docker.internal"
        mock_settings.smtp_port = 25
        mock_settings.smtp_user = None
        mock_settings.smtp_password = None
        mock_settings.smtp_use_tls = False
        mock_settings.notification_frequency = "immediate"

        result = save_notification_settings(db, {"notification_email_to": "   "})

    assert result["notification_email_to"] is None
    assert result["email_configured"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py::TestSaveNotificationSettings::test_empty_string_normalized_to_none tests/unit/test_notification_settings.py::TestSaveNotificationSettings::test_whitespace_only_normalized_to_none -v`

Expected: FAIL — `result["notification_email_to"]` is `""` / `"   "`, not `None`

- [ ] **Step 3: Implement empty-string normalization**

In `apps/pipeline/app/services/notification_settings.py`, add a set of nullable fields and a normalization step in `save_notification_settings`:

After the `_SENSITIVE_FIELDS` line (line 32), add:

```python
_NULLABLE_FIELDS = {
    "telegram_bot_token",
    "telegram_chat_id",
    "notification_email_to",
    "smtp_user",
    "smtp_password",
}
```

In `save_notification_settings`, after the `smtp_port` validation block (line 84) and before the DB query (line 86), add:

```python
    # Normalize empty/whitespace strings to None for nullable fields
    for key in list(updates.keys()):
        if key in _NULLABLE_FIELDS and isinstance(updates[key], str) and not updates[key].strip():
            updates[key] = None
```

Also update the merge logic in both `get_notification_settings` and `save_notification_settings` — change the `email_configured` check from `is not None` to a truthiness check. In `get_notification_settings` (line 66):

```python
    merged["email_configured"] = bool(merged.get("notification_email_to"))
```

In `save_notification_settings` (line 116):

```python
    merged["email_configured"] = bool(merged.get("notification_email_to"))
```

And in `get_notification_settings`, also skip empty strings during merge (line 58-60):

```python
        for key, value in db_settings.items():
            if key in merged and value is not None and value != "":
                merged[key] = value
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py -v`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notification_settings.py apps/pipeline/tests/unit/test_notification_settings.py
git commit -m "fix: normalize empty email strings to null so configured label updates correctly

Closes the stale 'Configured' badge bug from issue #112. Empty or
whitespace-only strings in nullable notification fields are now
stored as None, and email_configured uses a truthiness check."
```

---

### Task 2: Backend — Multi-recipient email sending

**Files:**
- Modify: `apps/pipeline/app/api/notifications.py:86-107`
- Modify: `apps/pipeline/app/services/notifications.py:319-353`
- Modify: `apps/pipeline/app/services/digest.py:331-346`
- Test: `apps/pipeline/tests/unit/test_notifications_api.py`

SMTP's `send_message` already reads recipients from the `To` header, and comma-separated addresses in the `To` header are valid per RFC 2822. So the main change is setting `msg["To"]` to the comma-separated string (which it already does — it just needs to stay that way). The key thing is that `send_message` correctly parses comma-separated `To` headers into individual envelope recipients.

No code change is actually needed for `send_email`, `send_test_email`, or `_send_digest` — they already set `msg["To"] = to_addr` (or `ns["notification_email_to"]`), and `server.send_message(msg)` extracts recipients from headers. Comma-separated addresses work out of the box.

However, we should add a test to confirm multi-recipient works, and we should add backend validation for the email format.

- [ ] **Step 1: Write failing test — validate email format on save**

Add to `TestSaveNotificationSettings` in `apps/pipeline/tests/unit/test_notification_settings.py`:

```python
def test_rejects_invalid_email_format(self):
    db = _mock_db(stored_json=None)
    with pytest.raises(ValueError, match="notification_email_to"):
        save_notification_settings(db, {"notification_email_to": "not-an-email"})

def test_accepts_comma_separated_emails(self):
    db = _mock_db(stored_json=None)
    with patch("app.services.notification_settings.settings") as mock_settings:
        mock_settings.telegram_bot_token = None
        mock_settings.telegram_chat_id = None
        mock_settings.notification_email_to = None
        mock_settings.notification_email_from = "podlog@localhost"
        mock_settings.smtp_host = "host.docker.internal"
        mock_settings.smtp_port = 25
        mock_settings.smtp_user = None
        mock_settings.smtp_password = None
        mock_settings.smtp_use_tls = False
        mock_settings.notification_frequency = "immediate"

        result = save_notification_settings(
            db, {"notification_email_to": "a@example.com, b@example.com"}
        )

    assert result["notification_email_to"] == "a@example.com, b@example.com"
    assert result["email_configured"] is True

def test_rejects_comma_list_with_invalid_email(self):
    db = _mock_db(stored_json=None)
    with pytest.raises(ValueError, match="notification_email_to"):
        save_notification_settings(
            db, {"notification_email_to": "good@example.com, bad-email"}
        )
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py::TestSaveNotificationSettings::test_rejects_invalid_email_format tests/unit/test_notification_settings.py::TestSaveNotificationSettings::test_accepts_comma_separated_emails tests/unit/test_notification_settings.py::TestSaveNotificationSettings::test_rejects_comma_list_with_invalid_email -v`

Expected: FAIL — no validation exists yet

- [ ] **Step 3: Add email validation to `save_notification_settings`**

In `apps/pipeline/app/services/notification_settings.py`, add at the top with other imports:

```python
import re
```

Add a validation helper after the `_NULLABLE_FIELDS` set:

```python
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
```

In `save_notification_settings`, after the nullable normalization block and before the DB query, add:

```python
    if "notification_email_to" in updates and updates["notification_email_to"] is not None:
        emails = [e.strip() for e in updates["notification_email_to"].split(",")]
        for email in emails:
            if not _EMAIL_RE.match(email):
                raise ValueError(
                    f"notification_email_to contains invalid email address: '{email}'"
                )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py -v`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/notification_settings.py apps/pipeline/tests/unit/test_notification_settings.py
git commit -m "feat: validate email format and support comma-separated recipients

Backend now validates each email in notification_email_to against a
standard format regex. Comma-separated lists are supported — each
address is validated individually."
```

---

### Task 3: Frontend — Email tag input component

**Files:**
- Modify: `apps/web/src/components/NotificationSettings.tsx:6-20,246-382`
- Test: `apps/web/tests/unit/notification-settings.test.tsx`

Replace the single `<input type="email">` with a tag/chip input. Emails are displayed as removable chips. The user types an email and presses Enter or comma to add it. The underlying `notification_email_to` value stays a comma-separated string for API compatibility.

- [ ] **Step 1: Write failing tests for the tag input behavior**

Add to `apps/web/tests/unit/notification-settings.test.tsx`:

```typescript
describe("Email tag input", () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        telegram_bot_token: null,
        telegram_chat_id: null,
        notification_email_to: "existing@example.com",
        notification_email_from: "podlog@localhost",
        smtp_host: "host.docker.internal",
        smtp_port: 25,
        smtp_user: null,
        smtp_password: null,
        smtp_use_tls: false,
        notification_frequency: "immediate",
        telegram_configured: false,
        email_configured: true,
      }),
    });
  });

  it("displays existing emails as tags", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));
    expect(screen.getByText("existing@example.com")).toBeInTheDocument();
  });

  it("adds a valid email on Enter", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("new@example.com")).toBeInTheDocument();
  });

  it("rejects an invalid email with error message", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    expect(screen.queryByText("not-an-email")).not.toBeInTheDocument();
  });

  it("removes an email when X is clicked", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const removeBtn = screen.getByRole("button", { name: /remove existing@example.com/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText("existing@example.com")).not.toBeInTheDocument();
  });

  it("shows not configured when all emails removed", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const removeBtn = screen.getByRole("button", { name: /remove existing@example.com/i });
    fireEvent.click(removeBtn);

    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("prevents duplicate emails", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: /email/i }));
    fireEvent.click(screen.getByRole("tab", { name: /email/i }));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "existing@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/already added/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-coverage`

Expected: FAIL — no tag input exists yet

- [ ] **Step 3: Implement EmailTagInput and integrate into EmailTab**

In `apps/web/src/components/NotificationSettings.tsx`, add the `EmailTagInput` component after the `FieldGroup` component (after line 171) and before the tab content section:

```typescript
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

function EmailTagInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const emails = value
    ? value.split(",").map((e) => e.trim()).filter(Boolean)
    : [];

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;

    if (!EMAIL_RE.test(email)) {
      setError("Invalid email address");
      return;
    }
    if (emails.includes(email)) {
      setError("Already added");
      return;
    }

    setError(null);
    setInput("");
    const next = [...emails, email];
    onChange(next.join(", "));
  }

  function removeEmail(email: string) {
    const next = emails.filter((e) => e !== email);
    onChange(next.length > 0 ? next.join(", ") : null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(input);
    }
    if (e.key === "Backspace" && !input && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
  }

  return (
    <div>
      <div
        className={`flex flex-wrap gap-1.5 items-center min-h-[42px] w-full rounded-md border border-border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring ${
          error ? "border-red-500" : ""
        }`}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 bg-indigo-500/15 text-indigo-400 text-xs px-2 py-1 rounded-md"
          >
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              className="hover:text-red-400 text-xs leading-none"
              onClick={() => removeEmail(email)}
            >
              x
            </button>
          </span>
        ))}
        <input
          type="text"
          className="flex-1 min-w-[180px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none py-1"
          placeholder={emails.length === 0 ? "Add email address and press Enter" : "Add another..."}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (input.trim()) addEmail(input);
          }}
        />
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
```

Then update the `EmailTab` component. Replace the "Send to" `FieldGroup` block (lines 268-277) with:

```typescript
      <FieldGroup label="Send to" hint="Email addresses that receive notifications">
        <EmailTagInput
          value={settings.notification_email_to}
          onChange={(val) => onChange("notification_email_to", val ?? "")}
        />
      </FieldGroup>
```

Also update the `StatusBadge` in EmailTab to derive configured status from the actual email value, not just the server flag. Replace line 265:

```typescript
      <StatusBadge configured={!!settings.notification_email_to} />
```

And update the test button disabled check on line 377 similarly:

```typescript
          disabled={!settings.notification_email_to || testing}
```

Finally, update the `onChange` signature in `EmailTab` props. The current type `(field: keyof Settings, value: string | number | boolean)` already covers `string`, so the `onChange("notification_email_to", val ?? "")` call works. But we need to handle the empty-string-to-null conversion on save. In `handleChange` (line 456-459), add normalization:

```typescript
  function handleChange(field: keyof Settings, value: string | number | boolean) {
    const normalized = field === "notification_email_to" && value === "" ? null : value;
    setSettings((prev) => (prev ? { ...prev, [field]: normalized } : prev));
    setDirty((prev) => ({ ...prev, [field]: normalized }));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-coverage`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NotificationSettings.tsx apps/web/tests/unit/notification-settings.test.tsx
git commit -m "feat: add email tag input with validation and multi-recipient support

Replace single email input with a tag/chip component. Users press
Enter to add validated emails as chips. Removing all emails correctly
shows 'Not configured'. Duplicates and invalid formats are rejected
with inline error messages. Resolves #112."
```

---

### Task 4: Frontend — Update tab dot and configured flag to reflect local state

**Files:**
- Modify: `apps/web/src/components/NotificationSettings.tsx:507-511`
- Test: `apps/web/tests/unit/notification-settings.test.tsx`

The tab bar dot indicator for the Email tab reads `settings.email_configured` which only updates after a server round-trip. It should reflect local state immediately when the user adds/removes emails.

- [ ] **Step 1: Write failing test — tab dot updates immediately on email removal**

Add to `apps/web/tests/unit/notification-settings.test.tsx`:

```typescript
it("tab dot reflects unconfigured state after removing all emails", async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      telegram_bot_token: null,
      telegram_chat_id: null,
      notification_email_to: "user@test.com",
      notification_email_from: "podlog@localhost",
      smtp_host: "host.docker.internal",
      smtp_port: 25,
      smtp_user: null,
      smtp_password: null,
      smtp_use_tls: false,
      notification_frequency: "immediate",
      telegram_configured: false,
      email_configured: true,
    }),
  });

  render(<NotificationSettings />);
  await waitFor(() => screen.getByRole("tab", { name: /email/i }));
  fireEvent.click(screen.getByRole("tab", { name: /email/i }));

  // Remove the only email
  const removeBtn = screen.getByRole("button", { name: /remove user@test.com/i });
  fireEvent.click(removeBtn);

  // The email tab dot should now reflect unconfigured
  const emailTab = screen.getByRole("tab", { name: /email/i });
  const dot = emailTab.querySelector("span.rounded-full");
  expect(dot?.className).toContain("bg-muted-foreground");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-coverage -t "tab dot reflects"`

Expected: FAIL — dot still shows green because it reads `settings.email_configured`

- [ ] **Step 3: Update tab dot to use local state**

In `apps/web/src/components/NotificationSettings.tsx`, update the tabs array (around line 507-511) to derive email configured from the current field value:

```typescript
  const tabs: { key: Tab; label: string; dot?: boolean; configured?: boolean }[] = [
    { key: "telegram", label: "Telegram", dot: true, configured: settings.telegram_configured },
    { key: "email", label: "Email", dot: true, configured: !!settings.notification_email_to },
    { key: "general", label: "General" },
  ];
```

- [ ] **Step 4: Run all frontend tests**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-coverage`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/NotificationSettings.tsx apps/web/tests/unit/notification-settings.test.tsx
git commit -m "fix: email tab dot reflects local state immediately

The configured indicator in the tab bar now derives from the current
notification_email_to value rather than the server-computed flag,
so it updates instantly when emails are added or removed."
```

---

### Task 5: Full integration verification

**Files:** (no new changes — verification only)

- [ ] **Step 1: Run all backend tests**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_notification_settings.py tests/unit/test_notifications_api.py -v`

Expected: ALL PASS

- [ ] **Step 2: Run all frontend tests**

Run: `cd apps/web && npx jest tests/unit/notification-settings.test.tsx --no-coverage --verbose`

Expected: ALL PASS

- [ ] **Step 3: Verify no type errors**

Run: `cd apps/web && npx tsc --noEmit`

Expected: No errors (or only pre-existing ones unrelated to our changes)
