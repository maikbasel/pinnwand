import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { CalendarClock, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { cn } from "@/shared/lib/utils";
import {
  TASK_DUE_CLEAR_LABEL,
  TASK_DUE_LABEL,
  TASK_DUE_PLACEHOLDER,
} from "../lib/copy";

const FIELD_ICON_CLASS = "size-4 text-muted-foreground";
// TT.MM.JJJJ for display; the value crossing the boundary stays ISO yyyy-MM-dd.
const DISPLAY_FORMAT = "dd.MM.yyyy";
const ISO_FORMAT = "yyyy-MM-dd";

/**
 * German-formatted due date. The trigger shows TT.MM.JJJJ (or a placeholder) and
 * toggles an inline calendar below it — inline rather than a popover/second
 * drawer because the detail sheet is itself a Vaul drawer on mobile, and a
 * portaled surface there inherits the body-lock (see assignee-picker). The value
 * in and out is an ISO date string; "" means no due date.
 */
export function DueDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value === "" ? undefined : parseISO(value);

  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 font-medium text-sm">
        <CalendarClock aria-hidden="true" className={FIELD_ICON_CLASS} />
        {TASK_DUE_LABEL}
      </span>
      <div className="flex items-center gap-2">
        <Button
          aria-expanded={open}
          className={cn(
            "flex-1 justify-start font-normal",
            selected ? undefined : "text-muted-foreground"
          )}
          onClick={() => setOpen((current) => !current)}
          type="button"
          variant="outline"
        >
          {selected
            ? format(selected, DISPLAY_FORMAT, { locale: de })
            : TASK_DUE_PLACEHOLDER}
        </Button>
        {selected ? (
          <Button
            aria-label={TASK_DUE_CLEAR_LABEL}
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="rounded-md border p-1">
          <Calendar
            mode="single"
            onSelect={(date) => {
              if (date) {
                onChange(format(date, ISO_FORMAT));
                setOpen(false);
              }
            }}
            selected={selected}
            // Open on the due date's month rather than today; omitted (not
            // passed as undefined) so exactOptionalPropertyTypes is satisfied.
            {...(selected ? { defaultMonth: selected } : {})}
          />
        </div>
      ) : null}
    </div>
  );
}
