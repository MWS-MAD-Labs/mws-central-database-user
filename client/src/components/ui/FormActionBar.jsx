import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button } from "./Button.jsx";

export function FormActionBar({ children }) {
  const [minimized, setMinimized] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center justify-end gap-2">
      {!minimized ? (
        <div className="flex max-w-full flex-wrap justify-end gap-2 rounded-full bg-black/5 p-1.5 backdrop-blur-sm">
          {children}
        </div>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-9 w-9 rounded-full px-0 shadow-md"
        title={minimized ? "Show form actions" : "Minimize form actions"}
        aria-label={minimized ? "Show form actions" : "Minimize form actions"}
        onClick={() => setMinimized((current) => !current)}
      >
        {minimized ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </Button>
    </div>
  );
}
