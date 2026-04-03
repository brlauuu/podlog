"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface WizardContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  markCompleted: (completed: boolean) => Promise<void>;
}

const WizardContext = createContext<WizardContextType>({
  open: false,
  setOpen: () => {},
  markCompleted: async () => {},
});

export function useWizard() {
  return useContext(WizardContext);
}

export default function WizardProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  // Auto-show on first visit
  useEffect(() => {
    if (checked) return;
    fetch("/api/wizard/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.completed) setOpen(true);
      })
      .catch(() => {
        // Fail-open: show wizard if we can't check status
        setOpen(true);
      })
      .finally(() => setChecked(true));
  }, [checked]);

  const markCompleted = useCallback(async (completed: boolean) => {
    await fetch("/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    }).catch(() => {});
  }, []);

  return (
    <WizardContext.Provider value={{ open, setOpen, markCompleted }}>
      {children}
    </WizardContext.Provider>
  );
}
