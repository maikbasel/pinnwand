import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ChevronProps,
  DayPicker,
  getDefaultClassNames,
} from "react-day-picker";
import { cn } from "@/shared/lib/utils";

const NAV_BUTTON_CLASS =
  "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50";

function CalendarChevron({ orientation, className }: ChevronProps) {
  const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
  return <Icon className={cn("size-4", className)} />;
}

/**
 * Themed calendar on react-day-picker v10. Locked to the German locale so the
 * grid (weekday headers, month caption) reads „Mo/Di/Mi …" and „August 2026"
 * regardless of the device locale — the caller formats the selected value into
 * TT.MM.JJJJ. Rendered inline (never portaled) so it can live inside the task
 * detail sheet's mobile Vaul drawer without inheriting the body-lock.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      className={cn("w-fit", className)}
      classNames={{
        root: cn(defaults.root, "p-2"),
        months: cn(defaults.months, "relative flex flex-col gap-4"),
        month: cn(defaults.month, "flex flex-col gap-4"),
        month_caption: cn(
          defaults.month_caption,
          "flex h-8 items-center justify-center px-8"
        ),
        caption_label: cn(defaults.caption_label, "font-medium text-sm"),
        nav: cn(
          defaults.nav,
          "absolute inset-x-0 top-0 flex items-center justify-between"
        ),
        button_previous: cn(defaults.button_previous, NAV_BUTTON_CLASS),
        button_next: cn(defaults.button_next, NAV_BUTTON_CLASS),
        month_grid: cn(defaults.month_grid, "w-full border-collapse"),
        weekdays: cn(defaults.weekdays, "flex"),
        weekday: cn(
          defaults.weekday,
          "flex-1 font-normal text-[0.8rem] text-muted-foreground"
        ),
        week: cn(defaults.week, "mt-2 flex w-full"),
        day: cn(defaults.day, "flex-1 p-0 text-center text-sm"),
        day_button: cn(
          defaults.day_button,
          "inline-flex size-9 items-center justify-center rounded-md font-normal outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        ),
        selected: cn(
          defaults.selected,
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/90"
        ),
        today: cn(
          defaults.today,
          "[&>button]:ring-1 [&>button]:ring-primary/40"
        ),
        outside: cn(defaults.outside, "text-muted-foreground/50"),
        disabled: cn(defaults.disabled, "opacity-50"),
        hidden: cn(defaults.hidden, "invisible"),
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron }}
      locale={de}
      showOutsideDays={showOutsideDays}
      {...props}
    />
  );
}

export { Calendar };
