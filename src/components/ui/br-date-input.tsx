import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Masked date input in Brazilian format (dd/mm/yyyy).
 *
 * The component is controlled by an ISO string (yyyy-mm-dd) so it can be a
 * drop-in replacement for `<input type="date">` — but the visible text is
 * always dd/mm/yyyy regardless of the browser locale.
 *
 * `value`   — ISO date (yyyy-mm-dd) or "" for empty.
 * `onChange` — called with the ISO date (yyyy-mm-dd) or "" while the user is
 *              still typing / has an invalid value.
 */
export interface BrDateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: string; // ISO yyyy-mm-dd or ""
  onChange: (iso: string) => void;
}

function isoToBr(iso: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function brToIso(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (month < 1 || month > 12) return "";
  if (day < 1 || day > 31) return "";
  if (year < 1900 || year > 2999) return "";
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return "";
  }
  return `${yyyy}-${mm}-${dd}`;
}

function maskBr(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export const BrDateInput = React.forwardRef<HTMLInputElement, BrDateInputProps>(
  ({ value, onChange, className, placeholder = "dd/mm/aaaa", ...rest }, ref) => {
    const [text, setText] = React.useState<string>(() => isoToBr(value));

    // Keep local text in sync when parent updates ISO externally.
    React.useEffect(() => {
      const iso = brToIso(text);
      if (iso !== value) setText(isoToBr(value));
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const masked = maskBr(e.target.value);
          setText(masked);
          onChange(brToIso(masked));
        }}
        onBlur={(e) => {
          // On blur, if the value is incomplete, clear the ISO output.
          const iso = brToIso(text);
          if (!iso && text) onChange("");
          rest.onBlur?.(e);
        }}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...rest}
      />
    );
  },
);
BrDateInput.displayName = "BrDateInput";