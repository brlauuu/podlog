"use client";

import { HelpCircle, Wand2, BookOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWizard } from "@/components/WizardProvider";

export default function HelpMenu() {
  const { setOpen } = useWizard();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Help"
          className="flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => setOpen(true)} className="cursor-pointer gap-2">
          <Wand2 className="h-4 w-4" />
          Setup Wizard
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <a
            href="https://github.com/brlauuu/podlog/tree/main/docs/guide"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpen className="h-4 w-4" />
            User Guide
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
