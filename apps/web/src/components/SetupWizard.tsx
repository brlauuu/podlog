"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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

  function handleSkip() {
    markCompleted(true);
    close();
  }

  function close() {
    setOpen(false);
    setStep(1);
    setFeedAdded(false);
    setDontShow(false);
  }

  function handleFinish() {
    if (dontShow) markCompleted(true);
    close();
    if (feedAdded) router.push("/queue");
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleSkip(); }}>
      <DialogContent className="max-w-xl" onPointerDownOutside={(e) => e.preventDefault()}>
        {step === 1 && (
          <WizardHealthCheck
            onNext={() => setStep(2)}
            onSkip={handleSkip}
          />
        )}
        {step === 2 && (
          <WizardAddFeed
            onNext={() => { setFeedAdded(true); setStep(3); }}
            onBack={() => setStep(1)}
            onSkip={() => { setFeedAdded(false); setStep(3); }}
          />
        )}
        {step === 3 && (
          <WizardComplete
            feedAdded={feedAdded}
            onFinish={handleFinish}
            onDontShowChange={setDontShow}
          />
        )}

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 pt-2" data-testid="step-dots">
          {([1, 2, 3] as Step[]).map((s) => (
            <span
              key={s}
              className={`h-2 w-2 rounded-full ${s === step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
