"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SHORTCUT_GROUPS } from "@/lib/keyboardShortcuts";
import { useKeyboardShortcut } from "@/lib/useKeyboardShortcut";

/**
 * Global "?" help overlay listing every keyboard shortcut (#702). Mounted
 * once in the root layout. The shortcut bindings live in
 * lib/keyboardShortcuts.ts so this overlay stays in sync with the actual
 * handlers in other components.
 */
export default function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useKeyboardShortcut({
    key: "?",
    handler: () => setOpen((v) => !v),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press <kbd className="font-mono">?</kbd> any time to bring this up.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-sm font-semibold mb-2">{group.title}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {group.shortcuts.map((s) => (
                  <div key={s.keys} className="contents">
                    <dt>
                      <kbd className="font-mono px-1.5 py-0.5 rounded border border-border bg-muted text-xs">
                        {s.keys}
                      </kbd>
                    </dt>
                    <dd className="text-muted-foreground">{s.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
