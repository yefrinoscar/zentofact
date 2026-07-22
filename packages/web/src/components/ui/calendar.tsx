import * as React from "react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
  type Locale,
} from "react-day-picker"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  locale,
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaults = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "group/calendar bg-background p-1 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(7)] in-data-[slot=popover-content]:bg-transparent",
        className
      )}
      captionLayout={captionLayout}
      locale={locale}
      formatters={{
        formatMonthDropdown: (date) => date.toLocaleString(locale?.code, { month: "short" }),
        ...formatters,
      }}
      classNames={{
        root: cn("w-fit", defaults.root),
        months: cn("relative grid grid-cols-1 gap-3 sm:grid-cols-2", defaults.months),
        month: cn("flex w-auto flex-col gap-2.5", defaults.month),
        nav: cn("absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1", defaults.nav),
        button_previous: cn(buttonVariants({ variant: buttonVariant }), "size-(--cell-size) p-0", defaults.button_previous),
        button_next: cn(buttonVariants({ variant: buttonVariant }), "size-(--cell-size) p-0", defaults.button_next),
        month_caption: cn("flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)", defaults.month_caption),
        caption_label: cn("text-sm font-medium capitalize select-none", defaults.caption_label),
        month_grid: cn("w-full border-collapse", defaults.month_grid),
        weekdays: cn("flex", defaults.weekdays),
        weekday: cn("flex-1 text-xs font-normal text-muted-foreground select-none", defaults.weekday),
        week: cn("mt-0.5 flex w-full", defaults.week),
        day: cn(
          "group/day relative aspect-square h-full w-full p-0 text-center select-none [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius) [&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaults.day
        ),
        range_start: cn("rounded-l-(--cell-radius) bg-accent", defaults.range_start),
        range_middle: cn("rounded-none bg-accent", defaults.range_middle),
        range_end: cn("rounded-r-(--cell-radius) bg-accent", defaults.range_end),
        today: cn("rounded-(--cell-radius) bg-muted text-foreground", defaults.today),
        outside: cn("text-muted-foreground/55", defaults.outside),
        disabled: cn("text-muted-foreground opacity-35", defaults.disabled),
        hidden: cn("invisible", defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation, ...iconProps }) => {
          const Icon = orientation === "left" ? ChevronLeft : orientation === "right" ? ChevronRight : ChevronDown
          return <Icon className={cn("size-4", className)} {...iconProps} />
        },
        DayButton: (dayProps) => <CalendarDayButton locale={locale} {...dayProps} />,
        ...components,
      }}
      {...props}
      style={{
        ...props.style,
        '--rdp-day-height': '28px',
        '--rdp-day-width': '28px',
        '--rdp-day_button-height': '28px',
        '--rdp-day_button-width': '28px',
        '--rdp-months-gap': '12px',
        '--rdp-nav_button-height': '28px',
        '--rdp-nav_button-width': '28px',
        '--rdp-nav-height': '32px',
        '--rdp-weekday-padding': '4px 0',
      } as React.CSSProperties}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  locale,
  ...props
}: React.ComponentProps<typeof DayButton> & { locale?: Partial<Locale> }) {
  const ref = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      data-day={day.date.toLocaleDateString(locale?.code)}
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      data-selected-single={modifiers.selected && !modifiers.range_start && !modifiers.range_end && !modifiers.range_middle}
      className={cn(
        "relative z-10 aspect-square size-auto w-full min-w-(--cell-size) border-0 text-sm font-normal data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:bg-foreground data-[range-end=true]:text-background data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-transparent data-[range-middle=true]:text-foreground data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:bg-foreground data-[range-start=true]:text-background data-[selected-single=true]:bg-foreground data-[selected-single=true]:text-background",
        className
      )}
      {...props}
    />
  )
}

export { Calendar }
