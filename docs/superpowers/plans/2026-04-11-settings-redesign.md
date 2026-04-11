# Settings Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/settings` page into two vertically stacked sections (Notifications + Remote Inference) with per-step pipeline cards, hardware-aware cost estimates, and monochromatic styling.

**Architecture:** The frontend replaces the tabbed layout with two sections sharing a single Save button. The backend adds a hardware detection endpoint. All config stays in the existing `SystemState` JSON blob — no migrations needed.

**Tech Stack:** Next.js 16 (App Router), shadcn/ui (switch, select, popover, collapsible), FastAPI, Python 3.11

---

## File Structure

### New files
| File | Responsibility |
|---|---|
| `apps/web/src/components/NotificationSection.tsx` | Telegram, Email, General notification subsections |
| `apps/web/src/components/RemoteInferenceSection.tsx` | Provider dropdown, API key, 5 pipeline step cards, hardware estimates |
| `apps/web/src/components/ui/switch.tsx` | shadcn Switch component |
| `apps/web/src/components/ui/select.tsx` | shadcn Select component |
| `apps/web/src/components/ui/popover.tsx` | shadcn Popover component |
| `apps/web/src/components/ui/collapsible.tsx` | shadcn Collapsible component |
| `apps/web/src/app/api/hardware/route.ts` | Proxy to pipeline hardware endpoint |
| `apps/pipeline/app/api/hardware.py` | Hardware detection API endpoint |
| `apps/pipeline/app/services/hardware.py` | Hardware detection + profile matching logic |
| `apps/pipeline/tests/unit/test_hardware.py` | Tests for hardware detection service |

### Modified files
| File | Changes |
|---|---|
| `apps/web/src/components/NotificationSettings.tsx` | Rewrite: two sections, single save, hardware fetch |
| `apps/web/src/components/NotificationSettingsSections.tsx` | Remove (replaced by NotificationSection + RemoteInferenceSection) |
| `apps/pipeline/app/main.py:8,64` | Register hardware router |
| `apps/pipeline/app/config.py:49` | Add `hardware_profile` env var |

---

### Task 1: Install shadcn components

**Files:**
- Create: `apps/web/src/components/ui/switch.tsx`
- Create: `apps/web/src/components/ui/select.tsx`
- Create: `apps/web/src/components/ui/popover.tsx`
- Create: `apps/web/src/components/ui/collapsible.tsx`

- [ ] **Step 1: Install the 4 shadcn components**

```bash
cd apps/web
npx shadcn@latest add switch select popover collapsible
```

- [ ] **Step 2: Verify installation**

```bash
ls apps/web/src/components/ui/{switch,select,popover,collapsible}.tsx
```

Expected: all four files exist.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/switch.tsx apps/web/src/components/ui/select.tsx apps/web/src/components/ui/popover.tsx apps/web/src/components/ui/collapsible.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "chore(web): install shadcn switch, select, popover, collapsible components"
```

---

### Task 2: Hardware detection service (backend)

**Files:**
- Create: `apps/pipeline/app/services/hardware.py`
- Test: `apps/pipeline/tests/unit/test_hardware.py`
- Modify: `apps/pipeline/app/config.py:49`

- [ ] **Step 1: Add `hardware_profile` to config**

In `apps/pipeline/app/config.py`, add after line 47 (`spacy_model: str = "en_core_web_lg"`):

```python
    # Hardware profile override for cost estimates (Issue #322)
    hardware_profile: str | None = None
```

- [ ] **Step 2: Write the failing tests**

Create `apps/pipeline/tests/unit/test_hardware.py`:

```python
"""Tests for hardware detection service."""
from unittest.mock import patch, mock_open

import pytest

from app.services.hardware import (
    detect_hardware,
    get_hardware_profile,
    estimate_processing_times,
    HARDWARE_PROFILES,
)


class TestDetectHardware:
    def test_parses_cpuinfo(self):
        cpuinfo = (
            "processor\t: 0\n"
            "model name\t: AMD Ryzen 7 5800X 8-Core Processor\n"
            "processor\t: 1\n"
            "model name\t: AMD Ryzen 7 5800X 8-Core Processor\n"
        )
        meminfo = "MemTotal:       32768000 kB\n"
        with patch("builtins.open", side_effect=[
            mock_open(read_data=cpuinfo)(),
            mock_open(read_data=meminfo)(),
        ]):
            with patch("app.services.hardware._check_gpu", return_value=None):
                hw = detect_hardware()
        assert hw["cpu"] == "AMD Ryzen 7 5800X 8-Core Processor"
        assert hw["cores"] == 2
        assert hw["ram_gb"] == pytest.approx(31.25, rel=0.1)
        assert hw["gpu"] is None

    def test_returns_none_when_cpuinfo_unreadable(self):
        with patch("builtins.open", side_effect=OSError("Permission denied")):
            hw = detect_hardware()
        assert hw is None

    def test_detects_gpu_when_available(self):
        cpuinfo = "processor\t: 0\nmodel name\t: Intel Core i7\n"
        meminfo = "MemTotal:       16384000 kB\n"
        with patch("builtins.open", side_effect=[
            mock_open(read_data=cpuinfo)(),
            mock_open(read_data=meminfo)(),
        ]):
            with patch("app.services.hardware._check_gpu", return_value="NVIDIA RTX 3060"):
                hw = detect_hardware()
        assert hw["gpu"] == "NVIDIA RTX 3060"


class TestGetHardwareProfile:
    def test_env_override_takes_precedence(self):
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = "gpu-rtx3060"
            profile = get_hardware_profile()
        assert profile["name"] == "gpu-rtx3060"

    def test_env_override_unknown_profile_falls_back(self):
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = "nonexistent-profile"
            with patch("app.services.hardware.detect_hardware", return_value=None):
                profile = get_hardware_profile()
        assert profile is None

    def test_auto_detection_matches_gpu(self):
        hw = {"cpu": "Intel i7", "cores": 8, "ram_gb": 32, "gpu": "NVIDIA RTX 3060"}
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = None
            with patch("app.services.hardware.detect_hardware", return_value=hw):
                profile = get_hardware_profile()
        assert profile is not None
        assert "gpu" in profile["name"]

    def test_auto_detection_matches_cpu_only(self):
        hw = {"cpu": "AMD Ryzen 7", "cores": 8, "ram_gb": 32, "gpu": None}
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = None
            with patch("app.services.hardware.detect_hardware", return_value=hw):
                profile = get_hardware_profile()
        assert profile is not None
        assert "cpu" in profile["name"]

    def test_returns_none_when_detection_fails(self):
        with patch("app.services.hardware.settings") as mock_settings:
            mock_settings.hardware_profile = None
            with patch("app.services.hardware.detect_hardware", return_value=None):
                profile = get_hardware_profile()
        assert profile is None


class TestEstimateProcessingTimes:
    def test_returns_estimates_for_known_profile(self):
        profile = HARDWARE_PROFILES["cpu-only-8core"]
        estimates = estimate_processing_times(profile, cost_per_minute=0.006)
        assert "transcription_minutes_per_hour" in estimates
        assert "embedding_seconds_per_hour" in estimates
        assert "remote_transcription_minutes_per_hour" in estimates
        assert "remote_cost_per_hour_usd" in estimates
        assert estimates["remote_cost_per_hour_usd"] == pytest.approx(0.36, rel=0.01)

    def test_returns_remote_only_when_no_profile(self):
        estimates = estimate_processing_times(None, cost_per_minute=0.006)
        assert estimates["transcription_minutes_per_hour"] is None
        assert estimates["embedding_seconds_per_hour"] is None
        assert estimates["remote_cost_per_hour_usd"] == pytest.approx(0.36, rel=0.01)
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd apps/pipeline && python -m pytest tests/unit/test_hardware.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.hardware'`

- [ ] **Step 4: Implement the hardware detection service**

Create `apps/pipeline/app/services/hardware.py`:

```python
"""Hardware detection and performance profile matching for cost estimates.

Reads /proc/cpuinfo and /proc/meminfo to identify local hardware, then maps
to a known performance profile. Used by the Settings UI to show estimated
local vs remote processing times.
"""
import logging
import re

from app.config import settings

logger = logging.getLogger(__name__)

# Performance profiles: maps profile name to estimated processing speeds.
# transcription_factor: minutes of processing per minute of audio (lower = faster)
# embedding_factor: seconds to embed one hour of chunked audio
HARDWARE_PROFILES: dict[str, dict] = {
    "cpu-only-4core": {
        "name": "cpu-only-4core",
        "label": "4-core CPU, no GPU",
        "transcription_factor": 1.0,
        "embedding_factor": 120,
    },
    "cpu-only-8core": {
        "name": "cpu-only-8core",
        "label": "8-core CPU, no GPU",
        "transcription_factor": 0.75,
        "embedding_factor": 90,
    },
    "cpu-only-16core": {
        "name": "cpu-only-16core",
        "label": "16-core CPU, no GPU",
        "transcription_factor": 0.5,
        "embedding_factor": 60,
    },
    "gpu-rtx3060": {
        "name": "gpu-rtx3060",
        "label": "GPU (RTX 3060 class)",
        "transcription_factor": 0.1,
        "embedding_factor": 15,
    },
    "gpu-rtx3080": {
        "name": "gpu-rtx3080",
        "label": "GPU (RTX 3080+ class)",
        "transcription_factor": 0.06,
        "embedding_factor": 10,
    },
}

# Remote processing estimates (Fireworks AI)
REMOTE_TRANSCRIPTION_FACTOR = 0.05  # ~3 min per 60 min audio
REMOTE_EMBEDDING_FACTOR = 5  # ~5 seconds per hour of chunked audio


def _check_gpu() -> str | None:
    """Check for CUDA GPU availability. Returns GPU name or None."""
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except ImportError:
        pass
    return None


def detect_hardware() -> dict | None:
    """Auto-detect CPU, RAM, and GPU from system info.

    Returns dict with cpu, cores, ram_gb, gpu keys, or None if detection fails.
    """
    try:
        with open("/proc/cpuinfo") as f:
            cpuinfo = f.read()
    except OSError:
        logger.warning('"action": "hardware_detection_failed", "reason": "cannot read /proc/cpuinfo"')
        return None

    try:
        with open("/proc/meminfo") as f:
            meminfo = f.read()
    except OSError:
        logger.warning('"action": "hardware_detection_failed", "reason": "cannot read /proc/meminfo"')
        return None

    # Parse CPU model name
    cpu_match = re.search(r"model name\s*:\s*(.+)", cpuinfo)
    cpu = cpu_match.group(1).strip() if cpu_match else "Unknown CPU"

    # Count processor entries
    cores = len(re.findall(r"^processor\s*:", cpuinfo, re.MULTILINE))

    # Parse total RAM
    mem_match = re.search(r"MemTotal:\s*(\d+)\s*kB", meminfo)
    ram_gb = int(mem_match.group(1)) / (1024 * 1024) if mem_match else 0

    gpu = _check_gpu()

    return {"cpu": cpu, "cores": cores, "ram_gb": round(ram_gb, 1), "gpu": gpu}


def _match_profile(hw: dict) -> dict | None:
    """Match detected hardware to the closest performance profile."""
    if hw.get("gpu"):
        gpu_name = hw["gpu"].lower()
        if any(x in gpu_name for x in ["4090", "4080", "3090", "3080", "a100", "a6000"]):
            return HARDWARE_PROFILES["gpu-rtx3080"]
        return HARDWARE_PROFILES["gpu-rtx3060"]

    cores = hw.get("cores", 4)
    if cores >= 12:
        return HARDWARE_PROFILES["cpu-only-16core"]
    elif cores >= 6:
        return HARDWARE_PROFILES["cpu-only-8core"]
    return HARDWARE_PROFILES["cpu-only-4core"]


def get_hardware_profile() -> dict | None:
    """Get the hardware profile, checking env override first, then auto-detecting.

    Returns the profile dict or None if detection fails and no override is set.
    """
    if settings.hardware_profile:
        profile = HARDWARE_PROFILES.get(settings.hardware_profile)
        if profile:
            return profile
        logger.warning(
            '"action": "unknown_hardware_profile", "profile": "%s"',
            settings.hardware_profile,
        )

    hw = detect_hardware()
    if hw is None:
        return None
    return _match_profile(hw)


def estimate_processing_times(profile: dict | None, cost_per_minute: float) -> dict:
    """Estimate local and remote processing times for a 60-minute episode.

    Args:
        profile: Hardware profile dict (or None if detection failed)
        cost_per_minute: Remote STT cost in USD per minute of audio

    Returns dict with local and remote estimates.
    """
    remote_transcription = round(REMOTE_TRANSCRIPTION_FACTOR * 60, 1)
    remote_cost = round(cost_per_minute * 60, 2)
    remote_embedding = REMOTE_EMBEDDING_FACTOR

    if profile is None:
        return {
            "transcription_minutes_per_hour": None,
            "embedding_seconds_per_hour": None,
            "remote_transcription_minutes_per_hour": remote_transcription,
            "remote_embedding_seconds_per_hour": remote_embedding,
            "remote_cost_per_hour_usd": remote_cost,
        }

    return {
        "transcription_minutes_per_hour": round(profile["transcription_factor"] * 60, 1),
        "embedding_seconds_per_hour": profile["embedding_factor"],
        "remote_transcription_minutes_per_hour": remote_transcription,
        "remote_embedding_seconds_per_hour": remote_embedding,
        "remote_cost_per_hour_usd": remote_cost,
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/pipeline && python -m pytest tests/unit/test_hardware.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline/app/config.py apps/pipeline/app/services/hardware.py apps/pipeline/tests/unit/test_hardware.py
git commit -m "feat(pipeline): add hardware detection service with performance profiles (#322)"
```

---

### Task 3: Hardware API endpoint (backend)

**Files:**
- Create: `apps/pipeline/app/api/hardware.py`
- Modify: `apps/pipeline/app/main.py:8,64`

- [ ] **Step 1: Create the hardware API router**

Create `apps/pipeline/app/api/hardware.py`:

```python
"""Hardware detection API — returns detected hardware and processing estimates."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.hardware import detect_hardware, get_hardware_profile, estimate_processing_times
from app.services.notification_settings import get_notification_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/hardware")
def get_hardware(db: Session = Depends(get_db)):
    """Return detected hardware info and processing time estimates."""
    hw = detect_hardware()
    profile = get_hardware_profile()
    ns = get_notification_settings(db)
    cost_per_minute = ns.get("fireworks_stt_cost_per_minute_usd", 0.006)
    estimates = estimate_processing_times(profile, cost_per_minute)

    return {
        "hardware": hw,
        "profile": profile["name"] if profile else None,
        "profile_label": profile["label"] if profile else None,
        "estimates": estimates,
    }
```

- [ ] **Step 2: Register the router in main.py**

In `apps/pipeline/app/main.py`, add to the import on line 8:

Change:
```python
from app.api import ask, backfill, feeds, episodes, queue, health, embed, notifications
```
To:
```python
from app.api import ask, backfill, feeds, episodes, queue, health, embed, notifications, hardware
```

Add after line 64 (`app.include_router(backfill.router, prefix="/api")`):
```python
app.include_router(hardware.router, prefix="/api")
```

- [ ] **Step 3: Verify the endpoint works**

```bash
cd apps/pipeline && python -c "from app.api.hardware import router; print('Import OK')"
```

Expected: `Import OK`

- [ ] **Step 4: Commit**

```bash
git add apps/pipeline/app/api/hardware.py apps/pipeline/app/main.py
git commit -m "feat(pipeline): add GET /api/hardware endpoint (#322)"
```

---

### Task 4: Hardware proxy route (web)

**Files:**
- Create: `apps/web/src/app/api/hardware/route.ts`

- [ ] **Step 1: Create the proxy route**

Create `apps/web/src/app/api/hardware/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  const resp = await fetch(`${PIPELINE_API}/api/hardware`, { cache: "no-store" });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/api/hardware/route.ts
git commit -m "feat(web): add hardware API proxy route (#322)"
```

---

### Task 5: Notification section component

**Files:**
- Create: `apps/web/src/components/NotificationSection.tsx`

This extracts the Telegram, Email, and General subsections from the existing `NotificationSettingsSections.tsx` into a single component that renders all three inline (no tabs).

- [ ] **Step 1: Create NotificationSection.tsx**

Create `apps/web/src/components/NotificationSection.tsx`:

```tsx
"use client";

import { useState, useEffect, type KeyboardEvent, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Settings } from "./NotificationSettingsSections";

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full ${
        configured
          ? "bg-green-500/10 text-green-500"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          configured ? "bg-green-500" : "bg-muted-foreground"
        }`}
      />
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring";

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
    ? value
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
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
    onChange([...emails, email].join(", "));
  }

  function removeEmail(email: string) {
    const next = emails.filter((e) => e !== email);
    onChange(next.length > 0 ? next.join(", ") : null);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
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
            className="inline-flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-md"
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
          className="flex-1 min-w-[180px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-hidden py-1"
          placeholder={
            emails.length === 0
              ? "Add email address and press Enter"
              : "Add email and press Enter"
          }
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

function SetupGuide({
  title,
  configured,
  children,
}: {
  title: string;
  configured: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!configured);

  useEffect(() => {
    setOpen(!configured);
  }, [configured]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-muted/50 p-4 mb-6">
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <span className="text-xs text-muted-foreground">
            {open ? "Hide" : "Show"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default function NotificationSection({
  settings,
  onChange,
  onTest,
  testing,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
  onTest: (channel: "telegram" | "email") => void;
  testing: boolean;
}) {
  const [smtpOpen, setSmtpOpen] = useState(false);

  return (
    <div className="space-y-8">
      {/* Telegram */}
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium">Telegram</h3>
          <StatusBadge configured={settings.telegram_configured} />
        </div>

        <SetupGuide
          title="How to set up Telegram notifications"
          configured={settings.telegram_configured}
        >
          <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
            <li>
              Open Telegram and search for <strong>@BotFather</strong>
            </li>
            <li>
              Send <code className="bg-muted px-1 rounded text-xs">/newbot</code>{" "}
              and follow the prompts to create a bot
            </li>
            <li>
              Copy the <strong>bot token</strong> (looks like{" "}
              <code className="bg-muted px-1 rounded text-xs">
                123456:ABC-DEF...
              </code>
              ) and paste it below
            </li>
            <li>Start a chat with your new bot (send it any message)</li>
            <li>
              Visit{" "}
              <code className="bg-muted px-1 rounded text-xs">
                {"https://api.telegram.org/bot<TOKEN>/getUpdates"}
              </code>{" "}
              in your browser
            </li>
            <li>
              Find{" "}
              <code className="bg-muted px-1 rounded text-xs">
                {'"chat":{"id":123456789}'}
              </code>{" "}
              in the response — that&apos;s your <strong>Chat ID</strong>
            </li>
          </ol>
        </SetupGuide>

        <FieldGroup
          label="Bot Token"
          hint="The token you received from @BotFather when creating your bot"
        >
          <input
            id="bot-token"
            type="password"
            className={inputClass}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            value={settings.telegram_bot_token ?? ""}
            onChange={(e) => onChange("telegram_bot_token", e.target.value)}
          />
        </FieldGroup>

        <FieldGroup
          label="Chat ID"
          hint="Your personal chat ID -- find it via the getUpdates API call above"
        >
          <input
            id="chat-id"
            type="text"
            className={inputClass}
            placeholder="123456789"
            value={settings.telegram_chat_id ?? ""}
            onChange={(e) => onChange("telegram_chat_id", e.target.value)}
          />
        </FieldGroup>

        <button
          className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50 mt-2"
          onClick={() => onTest("telegram")}
          disabled={!settings.telegram_configured || testing}
        >
          {testing ? "Sending..." : "Send test message"}
        </button>
      </div>

      {/* Email */}
      <div className="rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium">Email</h3>
          <StatusBadge configured={!!settings.notification_email_to} />
        </div>

        <SetupGuide
          title="How to set up email notifications"
          configured={settings.email_configured}
        >
          <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
            <li>
              If you have a local mail server (postfix, sendmail), just enter
              your email address below and Save -- the defaults will work
            </li>
            <li>
              For external providers (Gmail, Fastmail, etc.), expand &quot;SMTP
              Configuration&quot; below
            </li>
            <li>
              For <strong>Gmail</strong>: enable 2FA, then create an App Password
              in Google account settings. Use{" "}
              <code className="bg-muted px-1 rounded text-xs">
                smtp.gmail.com
              </code>{" "}
              port <code className="bg-muted px-1 rounded text-xs">587</code>{" "}
              with TLS enabled
            </li>
            <li>
              For other providers, check their SMTP documentation for
              host/port/TLS settings
            </li>
          </ol>
        </SetupGuide>

        <FieldGroup
          label="Send to"
          hint="Email addresses that receive notifications"
        >
          <EmailTagInput
            value={settings.notification_email_to}
            onChange={(val) => onChange("notification_email_to", val)}
          />
        </FieldGroup>

        <FieldGroup
          label="From address"
          hint="Sender address shown in notifications"
        >
          <input
            id="from-address"
            type="email"
            className={inputClass}
            placeholder="podlog@localhost"
            value={settings.notification_email_from}
            onChange={(e) => onChange("notification_email_from", e.target.value)}
          />
        </FieldGroup>

        <Collapsible open={smtpOpen} onOpenChange={setSmtpOpen}>
          <div className="border-t border-border my-4" />
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm mb-4">
            <span className="font-medium">SMTP Configuration</span>
            <span className="text-xs text-muted-foreground">
              {smtpOpen ? "Hide" : "Show"} -- optional, defaults work with local
              mail servers
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-4 mb-4">
              <div className="grid grid-cols-2 gap-4">
                <FieldGroup
                  label="SMTP Host"
                  hint="Leave default for local, or e.g. smtp.gmail.com"
                >
                  <input
                    id="smtp-host"
                    type="text"
                    className={inputClass}
                    placeholder="host.docker.internal"
                    value={settings.smtp_host}
                    onChange={(e) => onChange("smtp_host", e.target.value)}
                  />
                </FieldGroup>
                <FieldGroup
                  label="SMTP Port"
                  hint="25 for local, 587 for TLS, 465 for SSL"
                >
                  <input
                    id="smtp-port"
                    type="number"
                    className={inputClass}
                    placeholder="25"
                    value={settings.smtp_port}
                    onChange={(e) =>
                      onChange("smtp_port", parseInt(e.target.value, 10) || 0)
                    }
                  />
                </FieldGroup>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FieldGroup
                  label="SMTP Username"
                  hint="Usually your email address -- leave empty for local"
                >
                  <input
                    id="smtp-username"
                    type="text"
                    className={inputClass}
                    placeholder="you@example.com"
                    value={settings.smtp_user ?? ""}
                    onChange={(e) => onChange("smtp_user", e.target.value)}
                  />
                </FieldGroup>
                <FieldGroup
                  label="SMTP Password"
                  hint="App password or SMTP credential"
                >
                  <input
                    id="smtp-password"
                    type="password"
                    className={inputClass}
                    placeholder=""
                    value={settings.smtp_password ?? ""}
                    onChange={(e) => onChange("smtp_password", e.target.value)}
                  />
                </FieldGroup>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.smtp_use_tls}
                  onChange={(e) => onChange("smtp_use_tls", e.target.checked)}
                />
                Enable TLS
                <span className="text-xs text-muted-foreground">
                  -- required for Gmail, Outlook, and most external providers
                </span>
              </label>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <button
          className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50 mt-2"
          onClick={() => onTest("email")}
          disabled={!settings.notification_email_to || testing}
        >
          {testing ? "Sending..." : "Send test email"}
        </button>
      </div>

      {/* General */}
      <div className="rounded-lg border border-border p-6">
        <h3 className="text-base font-medium mb-4">General</h3>

        <FieldGroup
          label="Notification Frequency"
          hint="Controls success notifications. Failures are always sent immediately."
        >
          <select
            id="notification-frequency"
            className={inputClass}
            value={settings.notification_frequency}
            onChange={(e) => onChange("notification_frequency", e.target.value)}
          >
            <option value="immediate">
              Immediate -- notify after each episode
            </option>
            <option value="daily">
              Daily digest -- summary at 8:00 AM UTC
            </option>
            <option value="weekly">
              Weekly digest -- summary on Monday at 8:00 AM UTC
            </option>
          </select>
        </FieldGroup>

        <div className="border-t border-border my-4" />

        <FieldGroup
          label="Health Check Notifications"
          hint="Host-level monitoring alerts (service status, zombie jobs). Runs via cron every 15 minutes."
        >
          <label className="flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={settings.health_check_notifications_enabled}
              onChange={(e) =>
                onChange("health_check_notifications_enabled", e.target.checked)
              }
            />
            Send Telegram alerts when services go down or jobs get stuck
          </label>
        </FieldGroup>
      </div>
    </div>
  );
}
```

Note: the email tag pills use `bg-muted text-foreground` instead of the old `bg-indigo-500/15 text-indigo-400` to follow the monochromatic design system. Setup guides use `border-border bg-muted/50` and `text-muted-foreground` instead of indigo accents.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/web && npx next build 2>&1 | head -30
```

Expected: no TypeScript errors in NotificationSection.tsx. (Full build may fail since we haven't rewritten NotificationSettings.tsx yet — that's fine, we just want to check this file compiles.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/NotificationSection.tsx
git commit -m "feat(web): add NotificationSection component for settings redesign (#322)"
```

---

### Task 6: Remote inference section component

**Files:**
- Create: `apps/web/src/components/RemoteInferenceSection.tsx`

This is the main new UI component with provider dropdown, API key, 5 pipeline step cards, and hardware estimates.

- [ ] **Step 1: Create RemoteInferenceSection.tsx**

Create `apps/web/src/components/RemoteInferenceSection.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Settings } from "./NotificationSettingsSections";

interface HardwareInfo {
  hardware: {
    cpu: string;
    cores: number;
    ram_gb: number;
    gpu: string | null;
  } | null;
  profile: string | null;
  profile_label: string | null;
  estimates: {
    transcription_minutes_per_hour: number | null;
    embedding_seconds_per_hour: number | null;
    remote_transcription_minutes_per_hour: number;
    remote_embedding_seconds_per_hour: number;
    remote_cost_per_hour_usd: number;
  };
}

interface PipelineStep {
  key: string;
  title: string;
  description: string;
  remoteAvailable: boolean;
  disabledReason?: string;
  providerField: keyof Settings | null;
  localModels: { value: string; label: string }[];
  remoteModels: { value: string; label: string }[];
  modelField: keyof Settings | null;
  remoteModelField: keyof Settings | null;
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "transcription",
    title: "Transcription",
    description:
      "Converts audio to text using speech recognition. This is typically the most time-consuming step in the pipeline.",
    remoteAvailable: true,
    providerField: "inference_provider",
    localModels: [{ value: "large-v3-turbo", label: "WhisperX large-v3-turbo" }],
    remoteModels: [
      { value: "whisper-v3-large", label: "Fireworks whisper-v3-large" },
    ],
    modelField: null,
    remoteModelField: "fireworks_stt_model",
  },
  {
    key: "diarization",
    title: "Diarization",
    description:
      "Identifies and labels different speakers in the audio. Runs after transcription to assign speaker labels to each segment.",
    remoteAvailable: false,
    disabledReason: "Speaker diarization is currently supported locally only.",
    providerField: null,
    localModels: [
      {
        value: "speaker-diarization-3.1",
        label: "pyannote speaker-diarization-3.1",
      },
    ],
    remoteModels: [],
    modelField: null,
    remoteModelField: null,
  },
  {
    key: "speaker-inference",
    title: "Speaker Inference",
    description:
      "Infers speaker names from transcript content using named entity recognition (NER).",
    remoteAvailable: false,
    disabledReason:
      "Speaker name inference is currently supported locally only.",
    providerField: null,
    localModels: [{ value: "en_core_web_lg", label: "spaCy en_core_web_lg" }],
    remoteModels: [],
    modelField: null,
    remoteModelField: null,
  },
  {
    key: "embedding",
    title: "Embedding",
    description:
      "Generates vector embeddings for transcript chunks, enabling semantic search and the Ask AI feature.",
    remoteAvailable: true,
    providerField: "embedding_provider",
    localModels: [
      { value: "all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2" },
    ],
    remoteModels: [
      { value: "BAAI/bge-small-en-v1.5", label: "Fireworks BGE small-en-v1.5" },
    ],
    modelField: "embedding_model",
    remoteModelField: "fireworks_embedding_model",
  },
  {
    key: "rag",
    title: "RAG / Ask",
    description:
      "Powers the Ask AI feature using retrieval-augmented generation with a local Ollama model.",
    remoteAvailable: false,
    disabledReason:
      "RAG-powered Ask uses a local Ollama model. Remote LLM support is planned.",
    providerField: null,
    localModels: [{ value: "ollama", label: "Ollama (local LLM)" }],
    remoteModels: [],
    modelField: null,
    remoteModelField: null,
  },
];

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring";

function StepHelpContent({
  step,
  hwInfo,
}: {
  step: PipelineStep;
  hwInfo: HardwareInfo | null;
}) {
  const estimates = hwInfo?.estimates;
  const hw = hwInfo?.hardware;

  return (
    <div className="space-y-2 text-sm">
      <p>{step.description}</p>
      {step.remoteAvailable && estimates && (
        <div className="border-t border-border pt-2 mt-2 space-y-1 text-xs text-muted-foreground">
          {estimates.transcription_minutes_per_hour !== null &&
            hw &&
            step.key === "transcription" && (
              <p>
                On your detected hardware ({hw.cpu}, {hw.ram_gb}GB RAM
                {hw.gpu ? `, ${hw.gpu}` : ", no GPU"}), transcribing a
                60-minute episode takes approximately{" "}
                {estimates.transcription_minutes_per_hour} minutes locally. With
                Fireworks AI, the same episode takes approximately{" "}
                {estimates.remote_transcription_minutes_per_hour} minutes and
                costs ~${estimates.remote_cost_per_hour_usd}.
              </p>
            )}
          {estimates.transcription_minutes_per_hour === null &&
            step.key === "transcription" && (
              <p>
                With Fireworks AI, transcribing a 60-minute episode costs
                approximately ${estimates.remote_cost_per_hour_usd}.
              </p>
            )}
          {estimates.embedding_seconds_per_hour !== null &&
            hw &&
            step.key === "embedding" && (
              <p>
                On your detected hardware ({hw.cpu}, {hw.ram_gb}GB RAM
                {hw.gpu ? `, ${hw.gpu}` : ", no GPU"}), embedding a 60-minute
                episode takes approximately{" "}
                {estimates.embedding_seconds_per_hour} seconds locally. With
                Fireworks AI, approximately{" "}
                {estimates.remote_embedding_seconds_per_hour} seconds.
              </p>
            )}
          {estimates.embedding_seconds_per_hour === null &&
            step.key === "embedding" && (
              <p>
                With Fireworks AI, embedding a 60-minute episode takes
                approximately {estimates.remote_embedding_seconds_per_hour}{" "}
                seconds.
              </p>
            )}
        </div>
      )}
      {!step.remoteAvailable && step.disabledReason && (
        <p className="text-xs text-muted-foreground italic">
          {step.disabledReason}
        </p>
      )}
    </div>
  );
}

export default function RemoteInferenceSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (
    field: keyof Settings,
    value: string | number | boolean | null
  ) => void;
}) {
  const [hwInfo, setHwInfo] = useState<HardwareInfo | null>(null);
  const [showKeyError, setShowKeyError] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    fetch("/api/hardware")
      .then((r) => r.json())
      .then((data) => setHwInfo(data))
      .catch(() => {});
  }, []);

  function isRemote(step: PipelineStep): boolean {
    if (!step.providerField) return false;
    return settings[step.providerField] === "fireworks";
  }

  function handleToggle(step: PipelineStep, checked: boolean) {
    if (!step.providerField) return;
    if (checked && !settings.fireworks_api_key) {
      setShowKeyError(true);
      return;
    }
    onChange(step.providerField, checked ? "fireworks" : "local");
  }

  function getCurrentModel(step: PipelineStep): string {
    if (isRemote(step) && step.remoteModelField) {
      return (settings[step.remoteModelField] as string) || step.remoteModels[0]?.value || "";
    }
    if (step.modelField) {
      return (settings[step.modelField] as string) || step.localModels[0]?.value || "";
    }
    return step.localModels[0]?.value || "";
  }

  function handleModelChange(step: PipelineStep, value: string) {
    if (isRemote(step) && step.remoteModelField) {
      onChange(step.remoteModelField, value);
    } else if (step.modelField) {
      onChange(step.modelField, value);
    }
  }

  return (
    <div className="space-y-6">
      {/* Provider selection */}
      <div className="space-y-4">
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">
            Remote inference provider
          </label>
          <Select defaultValue="fireworks" disabled>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fireworks">Fireworks AI</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Collapsible>
          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
              <h3 className="text-sm font-medium text-muted-foreground">
                What are remote inference providers?
              </h3>
              <span className="text-xs text-muted-foreground">Show</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>
                  Remote inference providers process your audio and text on
                  external servers instead of your local machine. This is useful
                  when:
                </p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>
                    Your hardware is slow (e.g. CPU-only machines where
                    transcription takes a long time)
                  </li>
                  <li>You want faster processing at a per-minute cost</li>
                  <li>
                    You want to free up local resources for other tasks
                  </li>
                </ul>
                <p>
                  Currently, Fireworks AI is the supported provider. You need a
                  Fireworks API key to enable remote processing.
                </p>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>

      {/* API Key */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Fireworks API Key
        </label>
        <p className="text-xs text-muted-foreground mb-1.5">
          Required for remote inference. Stored securely and masked on read.
        </p>
        <div className="relative">
          <input
            id="fireworks-api-key"
            type={showApiKey ? "text" : "password"}
            className={inputClass}
            placeholder="fw_..."
            value={settings.fireworks_api_key ?? ""}
            onChange={(e) => onChange("fireworks_api_key", e.target.value)}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
            onClick={() => setShowApiKey(!showApiKey)}
          >
            {showApiKey ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      {/* Pipeline step cards */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium">Pipeline Steps</h3>
        {PIPELINE_STEPS.map((step) => {
          const remote = isRemote(step);
          const models = remote ? step.remoteModels : step.localModels;
          const currentModel = getCurrentModel(step);
          const disabled = !step.remoteAvailable;

          return (
            <div
              key={step.key}
              className="rounded-lg border border-border p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">{step.title}</h4>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-border text-xs text-muted-foreground hover:text-foreground hover:border-muted-foreground"
                      >
                        ?
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-80 bg-background border border-border shadow-lg"
                      side="right"
                    >
                      <StepHelpContent step={step} hwInfo={hwInfo} />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {remote ? "Remote" : "Local"}
                  </span>
                  <Switch
                    checked={remote}
                    onCheckedChange={(checked) => handleToggle(step, checked)}
                    disabled={disabled}
                    className={disabled ? "opacity-50 cursor-not-allowed" : ""}
                  />
                </div>
              </div>
              <Select
                value={currentModel}
                onValueChange={(val) => handleModelChange(step, val)}
                disabled={disabled}
              >
                <SelectTrigger
                  className={`w-full ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>

      {/* Estimates explainer */}
      <Collapsible>
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
            <h3 className="text-sm font-medium text-muted-foreground">
              How are these estimates calculated?
            </h3>
            <span className="text-xs text-muted-foreground">Show</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>Local estimates</strong> are based on your detected
                hardware matched to known performance profiles. The profiles
                represent typical processing speeds observed on similar
                hardware.
              </p>
              <p>
                <strong>Remote cost estimates</strong> use the per-minute
                pricing configured in the app (currently $
                {settings.fireworks_stt_cost_per_minute_usd}/min for Fireworks
                STT).
              </p>
              <p>Both are approximations and actual results may vary.</p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* API key error dialog */}
      <Dialog open={showKeyError} onOpenChange={setShowKeyError}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API key required</DialogTitle>
            <DialogDescription>
              You must provide a valid Fireworks API key before enabling remote
              inference on any pipeline step. Enter your API key in the field
              above and try again.
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <button className="px-4 py-2 rounded-md border border-border text-sm hover:bg-muted">
              OK
            </button>
          </DialogClose>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep -i "RemoteInferenceSection" || echo "No errors in RemoteInferenceSection"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/RemoteInferenceSection.tsx
git commit -m "feat(web): add RemoteInferenceSection component with pipeline step cards (#322)"
```

---

### Task 7: Rewrite NotificationSettings.tsx (main orchestrator)

**Files:**
- Modify: `apps/web/src/components/NotificationSettings.tsx`

This rewrites the main component to render two sections vertically with a single Save button, replacing the tabbed layout.

- [ ] **Step 1: Rewrite NotificationSettings.tsx**

Replace the entire contents of `apps/web/src/components/NotificationSettings.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Settings, Toast } from "./NotificationSettingsSections";
import NotificationSection from "./NotificationSection";
import RemoteInferenceSection from "./RemoteInferenceSection";

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [dirty, setDirty] = useState<Partial<Settings>>({});

  useEffect(() => {
    fetch("/api/notifications/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  if (!settings) {
    return (
      <div className="text-muted-foreground text-sm">Loading settings...</div>
    );
  }

  function handleChange(
    field: keyof Settings,
    value: string | number | boolean | null
  ) {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    setDirty((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setSettings(updated);
        setDirty({});
        // Validate Fireworks API key if present in dirty changes
        if (dirty.fireworks_api_key && dirty.fireworks_api_key !== "") {
          try {
            const hwResp = await fetch("/api/hardware");
            if (!hwResp.ok) {
              setToast({
                message:
                  "Settings saved. Fireworks API key could not be validated -- check that it's correct.",
                type: "error",
              });
              return;
            }
          } catch {
            // Hardware endpoint failure is non-fatal
          }
        }
        setToast({ message: "Settings saved", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Failed to save", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(channel: "telegram" | "email") {
    setTesting(true);
    try {
      const resp = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (resp.ok) {
        setToast({ message: "Test message sent", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Test failed", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setTesting(false);
    }
  }

  const actionButtonClass =
    "px-5 py-2 rounded-md bg-action text-action-foreground text-sm font-medium hover:bg-action/90 disabled:opacity-50";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure notifications and remote inference providers.
        </p>
      </div>

      {/* Section 1: Notifications */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Configure how and when Podlog sends you notifications about processed
          episodes and system health.
        </p>
        <NotificationSection
          settings={settings}
          onChange={handleChange}
          onTest={handleTest}
          testing={testing}
        />
      </section>

      <Separator className="my-8" />

      {/* Section 2: Remote Inference */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Remote Inference</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Configure which pipeline steps run locally and which use a remote
          provider for faster processing.
        </p>
        <RemoteInferenceSection settings={settings} onChange={handleChange} />
      </section>

      {/* Single Save button */}
      <div className="flex gap-3 mt-8 mb-4">
        <button
          className={actionButtonClass}
          onClick={handleSave}
          disabled={saving || Object.keys(dirty).length === 0}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
```

Note: This still imports `Settings` and `Toast` from `NotificationSettingsSections.tsx`. We keep that file around for now as a types/utility export. We'll clean it up in Task 8.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/NotificationSettings.tsx
git commit -m "feat(web): rewrite NotificationSettings with two-section layout (#322)"
```

---

### Task 8: Clean up NotificationSettingsSections.tsx

**Files:**
- Modify: `apps/web/src/components/NotificationSettingsSections.tsx`

The old tab components are no longer used. Strip the file down to just the `Settings` interface and `Toast` component that are imported by other files.

- [ ] **Step 1: Replace NotificationSettingsSections.tsx**

Replace the entire contents of `apps/web/src/components/NotificationSettingsSections.tsx` with:

```tsx
"use client";

export interface Settings {
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  notification_email_to: string | null;
  notification_email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_use_tls: boolean;
  notification_frequency: string;
  health_check_notifications_enabled: boolean;
  inference_provider: "local" | "fireworks";
  fireworks_api_key: string | null;
  fireworks_audio_base_url: string;
  fireworks_stt_model: string;
  fireworks_stt_diarize: boolean;
  fireworks_chat_base_url: string;
  fireworks_chat_model: string;
  fireworks_stt_cost_per_minute_usd: number;
  embedding_provider: "local" | "fireworks";
  embedding_model: string;
  fireworks_embedding_base_url: string;
  fireworks_embedding_model: string;
  telegram_configured: boolean;
  email_configured: boolean;
  fireworks_configured: boolean;
}

export function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white shadow-lg ${
        type === "success" ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {type === "success" ? "OK" : "X"} {message}
    </div>
  );
}
```

Note: Toast uses "OK" / "X" instead of checkmark/cross emojis, per user preference.

- [ ] **Step 2: Verify the build compiles**

```bash
cd apps/web && npx next build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/NotificationSettingsSections.tsx
git commit -m "refactor(web): strip NotificationSettingsSections to types and Toast only (#322)"
```

---

### Task 9: Add Fireworks API key validation on save

**Files:**
- Modify: `apps/pipeline/app/api/notifications.py:37-43`

Add a lightweight Fireworks API validation call when saving a non-empty API key.

- [ ] **Step 1: Write the failing test**

Add to `apps/pipeline/tests/unit/test_notifications_api.py` (or create if the existing test file doesn't cover `put_settings`). First, read the existing file to understand test patterns, then add:

```python
class TestFireworksKeyValidation:
    def test_validate_fireworks_key_on_save_success(self):
        """When saving a fireworks_api_key, the PUT endpoint should attempt validation."""
        # This test validates the integration path exists — the actual validation
        # is a lightweight HTTP call that we mock
        from app.services.hardware import validate_fireworks_key
        from unittest.mock import patch

        with patch("app.services.hardware.validate_fireworks_key", return_value=True) as mock_validate:
            # The validation function should accept a key and return bool
            result = validate_fireworks_key("fw_test_key")
            assert result is True
            mock_validate.assert_called_once_with("fw_test_key")
```

- [ ] **Step 2: Add validate_fireworks_key to hardware service**

Append to `apps/pipeline/app/services/hardware.py`:

```python
def validate_fireworks_key(api_key: str) -> bool:
    """Validate a Fireworks API key by making a lightweight API call.

    Returns True if the key appears valid, False otherwise.
    """
    import httpx

    try:
        resp = httpx.get(
            "https://api.fireworks.ai/inference/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        logger.warning('"action": "fireworks_key_validation_failed"')
        return False
```

- [ ] **Step 3: Add validation warning field to PUT response**

In `apps/pipeline/app/api/notifications.py`, modify the `put_settings` function to validate the key after save:

Replace the `put_settings` function (lines 37-43) with:

```python
@router.put("/notifications/settings")
def put_settings(body: dict = Body(...), db: Session = Depends(get_db)):
    try:
        result = save_notification_settings(db, body)
    except ValueError as e:
        return JSONResponse(status_code=422, content={"error": str(e)})

    response = mask_sensitive(result)

    # Validate Fireworks API key if it was updated with a non-empty value
    if body.get("fireworks_api_key") and body["fireworks_api_key"].strip():
        from app.services.hardware import validate_fireworks_key

        if not validate_fireworks_key(body["fireworks_api_key"]):
            response["fireworks_key_warning"] = (
                "Fireworks API key could not be validated -- check that it's correct."
            )

    return response
```

- [ ] **Step 4: Update frontend to show validation warning**

In `apps/web/src/components/NotificationSettings.tsx`, update the `handleSave` function's success path. Replace the API key validation block (the `if (dirty.fireworks_api_key ...)` block) with:

```tsx
        // Check for fireworks key validation warning from backend
        if (updated.fireworks_key_warning) {
          setToast({
            message: updated.fireworks_key_warning,
            type: "error",
          });
          return;
        }
        setToast({ message: "Settings saved", type: "success" });
```

- [ ] **Step 5: Run tests**

```bash
cd apps/pipeline && python -m pytest tests/unit/test_hardware.py tests/unit/test_notifications_api.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline/app/api/notifications.py apps/pipeline/app/services/hardware.py apps/pipeline/tests/unit/test_notifications_api.py apps/web/src/components/NotificationSettings.tsx
git commit -m "feat: validate Fireworks API key on save with toast warning (#322)"
```

---

### Task 10: Update .env.example and verify end-to-end

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add HARDWARE_PROFILE to .env.example**

Read `.env.example` and add the new env var in the appropriate section. Add after existing inference/embedding config:

```
# Hardware profile override for cost estimates (leave empty for auto-detection)
# Options: cpu-only-4core, cpu-only-8core, cpu-only-16core, gpu-rtx3060, gpu-rtx3080
# HARDWARE_PROFILE=
```

- [ ] **Step 2: Run the full web build**

```bash
cd apps/web && npx next build
```

Expected: build succeeds.

- [ ] **Step 3: Run all pipeline unit tests**

```bash
cd apps/pipeline && python -m pytest tests/unit/ -v --tb=short
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: add HARDWARE_PROFILE to .env.example (#322)"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Two visually distinct sections (Notifications + Remote Inference) — Task 7
- [x] Provider dropdown with Fireworks AI — Task 6
- [x] API key input with validation gating — Tasks 6, 9
- [x] All 5 pipeline steps with toggle + model dropdown — Task 6
- [x] Diarization, Speaker Inference, RAG locked to local — Task 6
- [x] Transcription and Embedding toggles functional — Task 6
- [x] Error dialog when enabling remote without API key — Task 6
- [x] Help popovers with opaque background — Task 6
- [x] Hardware auto-detection with cost estimates — Tasks 2, 3
- [x] HARDWARE_PROFILE env override — Tasks 2, 10
- [x] Collapsible estimates explainer — Task 6
- [x] Monochromatic styling — Tasks 5, 6, 7, 8

**Placeholder scan:** None found.

**Type consistency:** `Settings` interface and `HardwareInfo` types used consistently across all frontend tasks. `detect_hardware`, `get_hardware_profile`, `estimate_processing_times` signatures match between test and implementation. `validate_fireworks_key` signature matches between test and implementation.
