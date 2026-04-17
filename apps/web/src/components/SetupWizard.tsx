"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useWizard } from "@/components/WizardProvider";
import WizardHealthCheck from "@/components/WizardHealthCheck";
import WizardAddFeed from "@/components/WizardAddFeed";
import WizardComplete from "@/components/WizardComplete";

type Step = 1 | 2 | 3;

export default function SetupWizard() {
  const { open, setOpen, markCompleted } = useWizard();
  const [step, setStep] = useState<Step>(1);
  const [feedAdded, setFeedAdded] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const router = useRouter();

  function handleHealthCheckSkip() {
    close();
  }

  function handleFeedSkip() {
    setFeedAdded(false);
    setStep(3);
  }

  function close() {
    setOpen(false);
    setStep(1);
    setFeedAdded(false);
    setDontShow(false);
  }

  function handleFinish() {
    markCompleted(dontShow);
    close();
    if (feedAdded) router.push("/queue");
    else router.push("/");
  }

  function handleNavigateFromCompletion() {
    markCompleted(dontShow);
    close();
  }

  function goToStep(s: Step) {
    // Only allow navigating to steps already visited (at or before current)
    if (s <= step) setStep(s);
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
      <DialogContent
        className="max-w-[calc(100vw-2rem)] w-[calc(100vw-2rem)] h-[calc(100vh-2rem)] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Setup Wizard</DialogTitle>
        <DialogDescription className="sr-only">
          First-run onboarding for health checks, feed setup, and next steps.
        </DialogDescription>
        {step === 1 && (
          <WizardHealthCheck
            onNext={() => setStep(2)}
            onSkip={handleHealthCheckSkip}
          />
        )}
        {step === 2 && (
          <WizardAddFeed
            onNext={() => { setFeedAdded(true); setStep(3); }}
            onBack={() => setStep(1)}
            onSkip={handleFeedSkip}
          />
        )}
        {step === 3 && (
          <WizardComplete
            feedAdded={feedAdded}
            onFinish={handleFinish}
            onDontShowChange={setDontShow}
            onNavigate={handleNavigateFromCompletion}
          />
        )}

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 pt-2" data-testid="step-dots">
          {([1, 2, 3] as Step[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Go to step ${s}`}
              disabled={s > step}
              onClick={() => goToStep(s)}
              className={`h-2 w-2 rounded-full transition-colors ${
                s === step
                  ? "bg-primary"
                  : s < step
                  ? "bg-primary/50 cursor-pointer hover:bg-primary/70"
                  : "bg-muted cursor-default"
              }`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
