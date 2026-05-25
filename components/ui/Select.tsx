"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
  name?: string;
  id?: string;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder = "Виберіть…",
  label,
  hint,
  error,
  disabled,
  name,
  id,
}: SelectProps) {
  const generatedId = React.useId();
  const selectId = id ?? generatedId;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="text-xs font-medium uppercase tracking-wider text-ink-muted"
        >
          {label}
        </label>
      )}
      <SelectPrimitive.Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        name={name}
      >
        <SelectPrimitive.Trigger
          id={selectId}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border bg-surface px-3 py-2.5 text-sm text-ink",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500",
            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-muted",
            "data-[placeholder]:text-ink-subtle",
            error ? "border-danger focus:ring-danger/20" : "border-border",
          )}
          aria-invalid={!!error}
        >
          <SelectPrimitive.Value placeholder={placeholder} />
          <SelectPrimitive.Icon>
            <ChevronDown className="h-4 w-4 text-ink-subtle" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-surface shadow-lifted"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((opt) => (
                <SelectPrimitive.Item
                  key={opt.value}
                  value={opt.value}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-md px-2.5 py-2 pr-8 text-sm",
                    "data-[highlighted]:bg-brand-50 data-[highlighted]:text-brand-900",
                    "data-[state=checked]:font-medium",
                    "focus:outline-none",
                  )}
                >
                  <SelectPrimitive.ItemText>{opt.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center">
                    <Check className="h-4 w-4 text-brand-600" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
