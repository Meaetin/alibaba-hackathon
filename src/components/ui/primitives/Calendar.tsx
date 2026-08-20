"use client"

import * as React from "react"
import {
  DayPicker,
  getDefaultClassNames,
  type DayButton,
} from "react-day-picker"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/primitives/Button"

function Calendar({
  className,
  classNames,
  showOutsideDays = false,
  captionLayout = "label",
  buttonVariant = "ghost",
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"]
}) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      fixedWeeks={false}
      className={cn(
        "[--cell-size:36px] [--cell-radius:50%]",
        "cn-calendar group/calendar bg-surface rounded-2xl p-5 min-w-[292px]",
        className
      )}
      captionLayout={captionLayout}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-row gap-4",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-2", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-(--cell-size) p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        caption_label: cn(
          "type-body-1 font-semibold text-content select-none",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 rounded-(--cell-radius) type-body-2 font-medium text-content-placeholder select-none",
          defaultClassNames.weekday
        ),
        week: cn("mt-1 flex w-full", defaultClassNames.week),
        day: cn(
          "group/day relative aspect-square h-full w-full rounded-(--cell-radius) p-0 text-center select-none",
          defaultClassNames.day
        ),
        range_start: cn(
          "rounded-l-(--cell-radius) bg-surface-brand",
          defaultClassNames.range_start
        ),
        range_middle: cn("rounded-none bg-surface-brand", defaultClassNames.range_middle),
        range_end: cn(
          "rounded-r-(--cell-radius) bg-surface-brand",
          defaultClassNames.range_end
        ),
        today: cn(
          "ring-1 ring-edge-brand-subtle",
          defaultClassNames.today
        ),
        outside: cn(
          "text-content-placeholder pointer-events-none",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-glyph-disabled opacity-50 pointer-events-none",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => (
          <div data-slot="calendar" ref={rootRef} className={cn(className)} {...props} />
        ),
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") return <ChevronLeft className={cn("size-4", className)} {...props} />
          if (orientation === "right") return <ChevronRight className={cn("size-4", className)} {...props} />
          return <ChevronDown className={cn("size-4", className)} {...props} />
        },
        DayButton: ({ ...props }) => <CalendarDayButton {...props} />,
        ...components,
      }}
      {...props}
    />
  )
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames()

  const ref = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm" icon="only"
      data-day={day.date.toLocaleDateString()}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      data-range-start={modifiers.range_start}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      className={cn(
        "cn-calendar-day-button relative isolate z-10 flex aspect-square size-auto w-full min-w-(--cell-size) flex-col gap-1 border-0 leading-none font-normal transition-colors duration-[var(--motion-duration-micro)]",
        "type-body-2 text-glyph",
        "hover:bg-surface-alt hover:text-glyph",
        "focus-visible:ring-0 focus-visible:border-0",
        "data-[range-end=true]:rounded-(--cell-radius) data-[range-end=true]:bg-action-brand data-[range-end=true]:text-content-on-dark data-[range-end=true]:hover:bg-action-brand-hover",
        "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-transparent data-[range-middle=true]:text-glyph",
        "data-[range-start=true]:rounded-(--cell-radius) data-[range-start=true]:bg-action-brand data-[range-start=true]:text-content-on-dark data-[range-start=true]:hover:bg-action-brand-hover",
        "data-[selected-single=true]:bg-action-brand data-[selected-single=true]:text-content-on-dark",
        defaultClassNames.day,
        className
      )}
      {...props}
    />
  )
}

export { Calendar }
