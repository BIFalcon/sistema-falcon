import { forwardRef, useState } from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface PasswordRequirement {
  label: string;
  test: (value: string) => boolean;
}

export const DEFAULT_PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { label: "Mínimo 8 caracteres", test: (v) => v.length >= 8 },
  { label: "Pelo menos 1 letra maiúscula", test: (v) => /[A-Z]/.test(v) },
  { label: "Pelo menos 1 letra minúscula", test: (v) => /[a-z]/.test(v) },
  { label: "Pelo menos 1 número", test: (v) => /\d/.test(v) },
];

export function isPasswordStrong(value: string, requirements = DEFAULT_PASSWORD_REQUIREMENTS) {
  return requirements.every((r) => r.test(value));
}

interface PasswordInputProps extends Omit<React.ComponentProps<typeof Input>, "type"> {
  showChecklist?: boolean;
  requirements?: PasswordRequirement[];
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ showChecklist = false, requirements = DEFAULT_PASSWORD_REQUIREMENTS, value, className, ...rest }, ref) => {
    const [visible, setVisible] = useState(false);
    const stringValue = typeof value === "string" ? value : "";

    return (
      <div className="space-y-2">
        <div className="relative">
          <Input
            ref={ref}
            type={visible ? "text" : "password"}
            value={value}
            className={cn("pr-10", className)}
            {...rest}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
            aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {showChecklist && (
          <ul className="space-y-1 text-xs">
            {requirements.map((r) => {
              const ok = r.test(stringValue);
              return (
                <li
                  key={r.label}
                  className={cn(
                    "flex items-center gap-1.5 transition-colors",
                    ok ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  <span>{r.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";