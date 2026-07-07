'use client';

import React, { useRef, useState, useCallback, DragEvent, KeyboardEvent, ChangeEvent } from 'react';

interface FileDropzoneProps {
  onFile: (file: File) => void;
  accept?: string;
  label?: string;
  sublabel?: string;
  disabled?: boolean;
  isLoading?: boolean;
}

export function FileDropzone({
  onFile,
  accept = '.csv,.xlsx,.xls,.xlsm',
  label = 'Drop your file here or click to browse',
  sublabel = 'Supports .csv, .xlsx, and .xls exports from QuickBooks, Xero, and most accounting software',
  disabled = false,
  isLoading = false,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setFileName(file.name);
      onFile(file);
    },
    [onFile]
  );

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled && !isLoading) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || isLoading) return;
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleClick = () => {
    if (!disabled && !isLoading) inputRef.current?.click();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.key === 'Enter' || e.key === ' ') && !disabled && !isLoading) {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const isActive = isDragging && !disabled && !isLoading;

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled || isLoading}
      data-testid="file-dropzone"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={[
        'relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-8 py-12 text-center transition-colors cursor-pointer select-none outline-none',
        isActive
          ? 'bg-blue-50'
          : 'bg-card',
        disabled || isLoading
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      ].join(' ')}
      style={{
        borderColor: isActive
          ? 'hsl(var(--primary))'
          : 'hsl(var(--border))',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled || isLoading}
        data-testid="file-dropzone-input"
        tabIndex={-1}
      />

      {isLoading ? (
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: 'hsl(var(--primary))', borderTopColor: 'transparent' }}
            aria-label="Loading"
          />
          <p className="text-sm" style={{ color: 'hsl(var(--muted-foreground))' }}>
            Processing file…
          </p>
        </div>
      ) : (
        <>
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'hsl(var(--muted))' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'hsl(var(--muted-foreground))' }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          {fileName ? (
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {fileName}
              </p>
              <p className="text-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                Click to replace
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <p className="text-sm font-medium" style={{ color: 'hsl(var(--foreground))' }}>
                {label}
              </p>
              {sublabel && (
                <p className="text-xs max-w-xs" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  {sublabel}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
