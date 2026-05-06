'use client';

interface HelpButtonProps {
  onOpen: () => void;
}

export function HelpButton({ onOpen }: HelpButtonProps) {
  return (
    <button
      onClick={onOpen}
      aria-label="Open tutorial"
      data-testid="help-button"
      className="rounded-full w-8 h-8 flex items-center justify-center text-sm font-semibold transition-colors"
      style={{
        background: 'hsl(var(--muted))',
        color: 'hsl(var(--muted-foreground))',
        border: '1px solid hsl(var(--border))',
      }}
    >
      ?
    </button>
  );
}
