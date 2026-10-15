import { Check } from "lucide-react";

export function Code({ children }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl border border-(--mws-line) bg-(--mws-soft) p-3 font-mono text-xs">{children}</pre>
  );
}

export function SubHeading({ children }) {
  return <h3 className="font-display text-sm font-bold text-(--mws-charcoal)">{children}</h3>;
}

export function Paragraph({ children }) {
  return <p className="mt-1 text-sm leading-6 text-(--mws-muted)">{children}</p>;
}

export function Steps({ items }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-(--mws-muted)">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ol>
  );
}

// How to know a part is finished, so nobody moves on guessing.
export function DoneWhen({ children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#b9d4b3] bg-[#f1f8ef] px-4 py-3 text-sm leading-6 text-[#3b5d36]">
      <Check size={16} className="mt-1 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">You are done when </span>
        {children}
      </p>
    </div>
  );
}
