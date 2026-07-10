import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cn } from "@/shared/lib/utils";

// Base UI's ToggleGroup is array-valued (`value: readonly string[]`,
// `onValueChange: (string[], details) => void`); single-select is the default
// `multiple={false}`. Callers that need a single required value pass a
// one-element array and ignore an empty change (see TaskDetailSheet).
function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      className={cn("inline-flex gap-1 rounded-lg bg-muted p-1", className)}
      data-slot="toggle-group"
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      className={cn(
        "inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-2 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 data-pressed:bg-background data-pressed:font-medium data-pressed:shadow-sm",
        className
      )}
      data-slot="toggle-group-item"
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
