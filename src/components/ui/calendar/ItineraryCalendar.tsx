import type { CalendarActivity } from "./ActivityTimeslot";

export interface CalendarDay {
  id: string;
  date: Date;
  activities: CalendarActivity[];
}
